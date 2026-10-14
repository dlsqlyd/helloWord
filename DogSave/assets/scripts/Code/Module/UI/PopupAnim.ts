import { Button, Node, Tween, tween, UIOpacity, Vec3 } from "cc";
import { Log } from "../../../Mono/Module/Log/Log";

/**
 * 一套"弹窗弹出 / 收起"动画的参数。三个弹窗（结算 / 消息框 / Toast）共用同一份默认值，
 * 需要不一样的观感时只改字段，不改逻辑。
 *
 * 这里**故意不用 backOut 这类"自带过冲"的缓动**：它们的过冲量正比于 (目标 - 起始)，
 * 从 0.72 弹到 1 只过冲到 0.72 + 0.28×1.0877 ≈ 1.025（2.5%），肉眼看不出来，
 * "弹"就没了。所以过冲拆成两段显式写（先冲到 peak，再回落），幅度自己说了算。
 */
export class PopupAnimStyle
{
    /** 遮罩淡入 */
    public dimFade: number = 0.20;
    /** 底板淡入（比缩放快，免得放大过程糊成一团） */
    public panelFade: number = 0.16;
    /** 底板上浮 */
    public panelRise: number = 0.24;
    /** 底板放大到过冲位 */
    public panelPopUp: number = 0.20;
    /** 底板从过冲位回落到 1 */
    public panelPopSettle: number = 0.14;
    /** 按钮比底板晚一拍 */
    public buttonDelay: number = 0.18;
    public buttonPopUp: number = 0.14;
    public buttonPopSettle: number = 0.10;

    /** 底板起始缩放：看得出"从中心长出来"，又不至于小到糊 */
    public fromScale: number = 0.72;
    /** 底板起始下沉量（局部坐标像素），配合上浮形成"从下方升起"的感觉 */
    public fromOffsetY: number = -60;
    /** 按钮起始缩放 */
    public buttonFromScale: number = 0.80;
    /** 过冲幅度 */
    public peakScale: number = 1.06;
    public buttonPeakScale: number = 1.08;

    /** 收起：比弹出快，关闭是用户的意图，拖沓会显得卡 */
    public hideDuration: number = 0.18;
    /** 遮罩刻意比底板长一点，收完那一帧正好被它盖住 */
    public dimHideDuration: number = 0.20;
    public hideScale: number = 0.88;
    /** 收起时底板额外下沉的像素（比弹出的 -60 浅，避免整段位移被完整倒放） */
    public hideSink: number = -30;

    /**
     * 从"弹出开始"到"按钮动画落定"的总时长。
     * 这段时间里按钮会被 `interactable = false` 关掉 —— 一是防误触（面板还在长出来就点到按钮），
     * 二是**躲开和 cc.Button 自己那条 SCALE 按下过渡抢 `node.scale`**（见 PopupAnim 里的注释）。
     */
    public get buttonSettleTotal(): number
    {
        return this.buttonDelay + this.buttonPopUp + this.buttonPopSettle;
    }
}

export interface PopupAnimOptions
{
    /** 不传就用默认参数 */
    style?: PopupAnimStyle;
    /** 遮罩节点。不传就按结构找（根下不是底板、且名字在 dimNames 里的那个子节点） */
    dim?: Node;
    /** 底板节点。不传就按结构找（见 PopupAnim.resolve） */
    panel?: Node;
    /** 用来识别"谁是底板"的变体子节点名，默认 win_node / fail_node */
    variantNames?: string[];
    /** 用来识别遮罩的子节点名 */
    dimNames?: string[];
    /** 用来识别底板的子节点名（结构判据失效时的第二判据） */
    panelNames?: string[];
    /**
     * 每次播放时返回"当前生效"的额外弹出目标（一般是按钮）。
     * 做成回调而不是数组，是因为结果弹窗的按钮会随 win/fail 切换，
     * 必须在**每次** playShow 时重新取，不能在构造时取一次。
     */
    extraTargets?: () => Node[];
}

/**
 * 弹窗弹出/收起动画的驱动器。
 *
 * 全部走代码 tween，**不动预制体**，理由有三：
 *   1) 工程里 UI 预制体上的 `cc.Animation` 都是空壳（`_clips` 为空），UI 侧位移/缩放本来就用 tween；
 *   2) 节点会被 `GameObjectPoolManager` 复用，动画状态必须由代码负责复位，
 *      写死在预制体上反而容易留下"上次播到一半"的姿态；
 *   3) 不碰美术资源，改起来只在 TS 里改。
 *
 * 它是**组合**用的（视图里 `private _pop = new PopupAnim(this.node)`），不是基类 ——
 * 工程里 `UIBaseView` 下面直接挂各种视图，中间插一层基类会影响 `getComponent<UIBaseView>()` 的取法。
 *
 * ⚠️ 时序约束（它决定了"起始姿态"摆在哪）：
 *   `UIBaseContainer.setActive(true)` 的顺序是 onEnable() -> afterOnEnable() -> node.active = true，
 *   也就是 **onEnable 跑完节点才 active**。起始姿态必须在 onEnable（或更早的 onCreate）里就位，
 *   否则会先闪一帧"完整尺寸 + 完整不透明"的成品画面，再跳回 0.72 倍开始动。
 *   所以 `applyStartPose()` 在 onCreate 和 playShow 里各摆一次。
 */

export class PopupAnim
{
    private _root: Node = null;
    private _style: PopupAnimStyle = null;
    private _opts: PopupAnimOptions = null;

    private _dim: Node = null;
    private _panel: Node = null;
    private _dimOpacity: UIOpacity = null;
    private _panelOpacity: UIOpacity = null;

    /**
     * 设计态姿态，取一次就记住。
     * 节点是从对象池借出来的，借出来时可能还带着上一次播到一半的姿态 ——
     * 之所以敢"借出来就记"，是因为 resetPose 一定会被调用（视图在 onDisable 里调）。
     */
    private _panelHome: Vec3 = null;

    /** 本次播放的额外目标（按钮）及其设计态位置 */
    private _targets: Node[] = [];
    private _targetHomes: Map<Node, Vec3> = new Map();

    private _resolved: boolean = false;

    /** 收起状态机：idle 没在收 / running 正在收 / done 已经收完了 */
    private _hideState: string = "idle";
    private _hideWaiters: Array<() => void> = null;

    constructor(root: Node, options?: PopupAnimOptions)
    {
        this._root = root;
        this._opts = options || {};
        this._style = this._opts.style || new PopupAnimStyle();
    }

    public get style(): PopupAnimStyle
    {
        return this._style;
    }

    public get panel(): Node
    {
        return this._panel;
    }

    public get dim(): Node
    {
        return this._dim;
    }

    /**
     * 解析出遮罩 / 底板。
     *
     * 根下可能出现**两个同名子节点 "bg"**（索引 0 是全屏遮罩、索引 1 是弹窗底板），
     * 而 `find()` / `getChildByName()` 遇到同名只认第一个，所以不能按名字取第二个 ——
     * 判据用"谁下面挂着 win_node / fail_node"这种**结构**特征。
     * 像消息框 / Toast 这种"根自己就是面板、根本没有遮罩"的弹窗，会退回 `panel = root`、`dim = null`。
     */
    public resolve(): void
    {
        if (this._resolved) return;
        const root = this._root;
        if (root == null) return;

        const variantNames = this._opts.variantNames || ["win_node", "fail_node"];
        const dimNames = this._opts.dimNames || ["bg", "mask", "dim"];
        const panelNames = this._opts.panelNames || ["bg", "panel", "content"];

        this._panel = this._opts.panel || null;
        this._dim = this._opts.dim || null;

        // 1) 结构判据：谁下面挂着变体节点，谁就是底板
        if (this._panel == null)
        {
            for (let i = 0; i < root.children.length && this._panel == null; i++)
            {
                const child = root.children[i];
                for (let j = 0; j < variantNames.length; j++)
                {
                    if (child.getChildByName(variantNames[j]) != null)
                    {
                        this._panel = child;
                        break;
                    }
                }
            }
        }

        // 2) 名字判据
        if (this._panel == null)
        {
            for (let i = 0; i < root.children.length; i++)
            {
                if (panelNames.indexOf(root.children[i].name) >= 0)
                {
                    this._panel = root.children[i];
                    break;
                }
            }
        }

        // 3) 兜底：根自己就是面板（消息框 / Toast）
        if (this._panel == null) this._panel = root;

        // 遮罩：根下名字命中 dimNames 且不是底板
        if (this._dim == null)
        {
            for (let i = 0; i < root.children.length; i++)
            {
                const child = root.children[i];
                if (child !== this._panel && dimNames.indexOf(child.name) >= 0)
                {
                    this._dim = child;
                    break;
                }
            }
        }

        if (this._panel == null)
        {
            Log.warning("[PopupAnim] 找不到底板节点，弹出动画跳过：" + root.name);
            return;
        }

        this._panelOpacity = this.ensureOpacity(this._panel);
        if (this._dim != null) this._dimOpacity = this.ensureOpacity(this._dim);

        if (this._panelHome == null) this._panelHome = this._panel.position.clone();

        this._resolved = true;
    }

    // -----------------------------------------------------------------------
    // 弹出
    // -----------------------------------------------------------------------

    /** 播放弹出动画。onEnable 里调；外面要"换完内容再弹一次"也可以直接调 */
    public playShow(): void
    {
        this.resolve();
        if (this._panel == null) return;

        // 先停旧的再摆姿态：顺序反过来的话，上一轮还在跑的 tween 会把刚摆好的姿态覆盖掉
        this.stop();
        this._hideState = "idle";
        this.applyStartPose();

        this.collectTargets();
        this.setButtonsInteractable(false);

        const style = this._style;
        const home = this._panelHome;

        // 遮罩淡入
        if (this._dimOpacity != null)
        {
            tween(this._dimOpacity)
                .to(style.dimFade, { opacity: 255 }, { easing: 'quadOut' })
                .start();
        }

        // 底板淡入
        if (this._panelOpacity != null)
        {
            tween(this._panelOpacity)
                .to(style.panelFade, { opacity: 255 }, { easing: 'quadOut' })
                .start();
        }

        // 底板上浮（和缩放是两条独立的 tween，各自用各自的缓动；
        // Tween.stopAllByTarget 会一起收掉，不用单独记引用）
        if (home != null)
        {
            tween(this._panel)
                .to(style.panelRise, { position: new Vec3(home.x, home.y, home.z) }, { easing: 'quadOut' })
                .start();
        }

        // 底板缩放弹出：先冲到过冲位、再回落（两段串在一条 tween 里 ——
        // 是"放大 → 回弹"一个动作，不是两个独立动作，所以不能拆成两条 tween）
        tween(this._panel)
            .to(style.panelPopUp, { scale: new Vec3(style.peakScale, style.peakScale, 1) }, { easing: 'quadOut' })
            .to(style.panelPopSettle, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .start();

        // 额外目标（按钮）晚一拍
        for (let i = 0; i < this._targets.length; i++)
        {
            tween(this._targets[i])
                .delay(style.buttonDelay)
                .to(style.buttonPopUp, { scale: new Vec3(style.buttonPeakScale, style.buttonPeakScale, 1) }, { easing: 'quadOut' })
                .to(style.buttonPopSettle, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
                .start();
        }

        // 全部落定后才放开点击（理由见 PopupAnimStyle.buttonSettleTotal）
        tween(this._panel)
            .delay(style.buttonSettleTotal)
            .call(() => this.setButtonsInteractable(true))
            .start();
    }

    // -----------------------------------------------------------------------
    // 收起
    // -----------------------------------------------------------------------

    /**
     * 播放收起动画，跑完调 onComplete。
     *
     * 和 playShow 的关键差别：**不能调 applyStartPose()**。
     * 收起是从"当前姿态"往回收，先摆起始姿态会把画面瞬间弹回 0.72 倍再收 —— 等于闪一下。
     */
    public playHide(onComplete?: () => void): void
    {
        this.resolve();
        if (this._panel == null)
        {
            this.finishHide();
            if (onComplete) onComplete();
            return;
        }

        // 注意：这里用 stopInternal() 而不是 stop()。
        // playHideAsync() 是**先登记等待者、再调 playHide()** 的，
        // 而 stop() 会 flushHideWaiters() 把等待者放行 —— 那样 closeSelf() 会立刻继续往下走、
        // 把节点关掉，收起动画等于没播。stopInternal() 只停 tween，不碰等待者。
        this.stopInternal();
        this._hideState = "running";
        this.collectTargets();
        this.setButtonsInteractable(false);

        const style = this._style;
        const home = this._panelHome;

        if (this._dimOpacity != null)
        {
            tween(this._dimOpacity)
                .to(style.dimHideDuration, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }

        if (this._panelOpacity != null)
        {
            tween(this._panelOpacity)
                .to(style.hideDuration, { opacity: 0 }, { easing: 'quadIn' })
                .start();
        }

        // onComplete 挂在缩放这条上（它是收起动画的"主时长"）
        tween(this._panel)
            .to(style.hideDuration, { scale: new Vec3(style.hideScale, style.hideScale, 1) }, { easing: 'quadIn' })
            .call(() =>
            {
                this.finishHide();
                if (onComplete) onComplete();
            })
            .start();

        if (home != null)
        {
            tween(this._panel)
                .to(style.hideDuration, { position: new Vec3(home.x, home.y + style.hideSink, home.z) }, { easing: 'quadIn' })
                .start();
        }
    }

    /**
     * 收起动画的 Promise 版。**重复调用只播一次，但每次都会等到动画结束才 resolve** ——
     * 所以视图可以直接把它当成"关之前的等待"，不用自己再加重入标志。
     */
    public playHideAsync(): Promise<void>
    {
        this.resolve();
        if (this._panel == null) return Promise.resolve();
        if (this._hideState === "done") return Promise.resolve();

        if (this._hideWaiters == null) this._hideWaiters = [];
        const promise = new Promise<void>((resolve) => this._hideWaiters.push(resolve));

        if (this._hideState !== "running") this.playHide();
        return promise;
    }

    /** 停止所有动画并复位。视图 onDisable 里调（节点会被对象池复用，不复位下次第一帧就是半透明） */
    public stop(): void
    {
        this.stopInternal();
        // 动画被打断时，等在 playHideAsync 上的调用方不能永远挂着
        this.flushHideWaiters();
    }

    /** 只停 tween，不碰 playHideAsync 的等待者。playHide() 内部要用这个 */
    private stopInternal(): void
    {
        if (this._dimOpacity != null) Tween.stopAllByTarget(this._dimOpacity);
        if (this._panelOpacity != null) Tween.stopAllByTarget(this._panelOpacity);
        if (this._panel != null) Tween.stopAllByTarget(this._panel);
        for (let i = 0; i < this._targets.length; i++)
        {
            Tween.stopAllByTarget(this._targets[i]);
        }
    }

    /**
     * 复位到设计态。
     * 这一步不是"洁癖"：借出去的节点回收后会再借给下一次 openBox，
     * 不复位的话下一次打开的第一帧就是上次停在的半透明/半缩放状态。
     */
    public resetPose(): void
    {
        this.resolve();
        if (this._panel == null) return;

        if (this._dimOpacity != null) this._dimOpacity.opacity = 255;
        if (this._panelOpacity != null) this._panelOpacity.opacity = 255;

        this._panel.setScale(1, 1, 1);
        if (this._panelHome != null)
        {
            this._panel.setPosition(this._panelHome.x, this._panelHome.y, this._panelHome.z);
        }

        for (let i = 0; i < this._targets.length; i++)
        {
            const target = this._targets[i];
            target.setScale(1, 1, 1);
            const home = this._targetHomes.get(target);
            if (home != null) target.setPosition(home.x, home.y, home.z);
        }

        // 动画期间被禁掉的按钮要放开 —— 否则节点回收后下次借出来是点不动的
        this.setButtonsInteractable(true);
    }

    /** 摆出"动画第 0 帧"的姿态 */
    public applyStartPose(): void
    {
        this.resolve();
        if (this._panel == null) return;

        if (this._dimOpacity != null) this._dimOpacity.opacity = 0;
        if (this._panelOpacity != null) this._panelOpacity.opacity = 0;

        this._panel.setScale(this._style.fromScale, this._style.fromScale, 1);
        if (this._panelHome != null)
        {
            this._panel.setPosition(this._panelHome.x, this._panelHome.y + this._style.fromOffsetY, this._panelHome.z);
        }

        this.collectTargets();
        for (let i = 0; i < this._targets.length; i++)
        {
            this._targets[i].setScale(this._style.buttonFromScale, this._style.buttonFromScale, 1);
        }
    }

    // -----------------------------------------------------------------------
    // 内部
    // -----------------------------------------------------------------------

    /** 取本次要"延迟弹出 + 动画期间禁用"的节点，并记下它们的设计态位置 */
    private collectTargets(): void
    {
        this._targets = [];
        if (this._opts.extraTargets == null) return;

        const list = this._opts.extraTargets();
        if (list == null) return;

        for (let i = 0; i < list.length; i++)
        {
            const node = list[i];
            if (node == null) continue;
            this._targets.push(node);
            if (!this._targetHomes.has(node)) this._targetHomes.set(node, node.position.clone());
        }
    }

    /**
     * 动画期间把按钮禁掉。
     *
     * 不只是防误触 —— 更关键的是**避免两个系统抢 `node.scale`**：
     * 这些按钮的 `cc.Button` 是 SCALE 过渡，按下/抬起时它自己也会写 `node.scale`。
     * 引擎里 `_onTargetTransformChanged` 会把外部写的 scale 同步进 `_originalScale`，
     * 所以不会被"还原"成起始姿态；但两者仍在同一段时间里同时写同一个属性，
     * 叠起来会让 `_originalScale` 停在一个中间值上（"按一下之后按钮略大一圈"）。
     * `interactable = false` 期间 cc.Button 不会进入 press 状态，也就不会碰 scale，冲突窗口直接消失。
     * 代价是弹出那零点几秒里点不动 —— 那本来也不该点。
     */
    private setButtonsInteractable(flag: boolean): void
    {
        for (let i = 0; i < this._targets.length; i++)
        {
            const button = this._targets[i].getComponent(Button);
            if (button != null) button.interactable = flag;
        }
    }

    private finishHide(): void
    {
        this._hideState = "done";
        this.flushHideWaiters();
    }

    private flushHideWaiters(): void
    {
        const waiters = this._hideWaiters;
        this._hideWaiters = null;
        if (waiters == null) return;
        for (let i = 0; i < waiters.length; i++) waiters[i]();
    }

    /**
     * 取/挂 UIOpacity。
     *
     * 工程里没有任何预制体挂过 UIOpacity；自研的 `Mono/Module/UI/CanvasGroup.ts` 是**破坏性**的
     * —— 它把子节点 `UIRenderer.color.a` 直接改写成 `alpha*255`，不记原值，
     * 一旦面板里出现半透明素材就回不去了，所以这里不用它。
     * UIOpacity 是引擎自带的**乘法**不透明度，不改素材本身的颜色，最安全；
     * 运行时 addComponent 一次即可，节点被对象池复用时会带着走，用 getComponent 兜住幂等。
     */
    private ensureOpacity(node: Node): UIOpacity
    {
        return node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
    }
}
