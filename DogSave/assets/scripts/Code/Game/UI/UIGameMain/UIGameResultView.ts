import { Button, find, Label, Node, Tween, tween, UIOpacity, Vec3 } from "cc";
import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnDisable } from "../../../Module/UI/IOnDisable";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { IOnWidthPaddingChange } from "../../../Module/UI/IOnWidthPaddingChange";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { MenuPara } from "../UICommon/UIMenu";

// ---------------------------------------------------------------------------
// 结算界面的弹出动画
// ---------------------------------------------------------------------------
// 全部走代码 tween，**不动预制体**，理由有三：
//   1) 预制体根上那个 cc.Animation 是空壳（_clips 为空、_defaultClip 为 null），
//      全工程也只有 DogNode.prefab 真的挂了 clip；UI 侧的位移/缩放本来就用 tween。
//   2) 节点会被 GameObjectPoolManager 复用，动画状态必须由代码负责复位，
//      写死在预制体上反而容易留下"上次播到一半"的姿态。
//   3) 不碰美术资源，改起来只在 TS 里改。
//
// 三层同时开动：
//   遮罩 —— 根下第 1 个 bg（1100x2000，半透明黑 + BlockInputEvents）淡入
//   底板 —— 根下第 2 个 bg（650x660，白色面板）下沉上浮 + 缩放弹出
//   按钮 —— 生效那个节点的按钮（win_node/btn_next 或 fail_node/btn_replay）延迟一拍再弹
//
// 收起方向（playHide）是同一套东西往回走：缩小 + 下沉 + 淡出，跑完再 closeSelf()。
// 两个按钮的点击回调挂在**已解析出来的节点**上，不走 addComponent<UIButton>(path) ——
// 见 resolveNodes() 里"两个 bg 同名"那条注释，按路径取一定会取错。
//
// 结果（win / fail）由 `ResultPara` 传进来（见 onEnable），本类**不判断**谁输谁赢：
// 预制体里 win_node / fail_node 两套文案都是齐的，但顶部标题是两者共用的
// 一行（写死"恭喜过关"），所以失败文案必须调用方给。详见 ResultPara 的注释。
//
// ⚠️ 时序约束（它决定了"起始姿态"写在哪）：
//   UIBaseContainer.setActive(true) 的顺序是 onEnable() -> afterOnEnable() -> innerSetActive(true)，
//   也就是 **onEnable 跑完节点才 active**。起始姿态必须在 onEnable（或更早的 onCreate）里就位，
//   否则会先闪一帧"完整尺寸 + 完整不透明"的成品画面，再跳回 0.72 倍开始动。
//   这里两处都摆一次：onCreate 摆（兜住"节点已 active 但还没走到 onEnable"的那几个微任务），
//   onEnable 再摆一次并起 tween。
const DIM_FADE_DURATION = 0.20;    // 遮罩淡入
const PANEL_FADE_DURATION = 0.16;  // 底板淡入（比缩放快，免得放大过程糊成一团）
const PANEL_RISE_DURATION = 0.24;  // 底板上浮
const PANEL_POP_UP = 0.20;         // 底板放大到过冲位
const PANEL_POP_SETTLE = 0.14;     // 底板从过冲位回落到 1
const BUTTON_DELAY = 0.18;         // 按钮比底板晚一拍
const BUTTON_POP_UP = 0.14;
const BUTTON_POP_SETTLE = 0.10;

/**
 * 从"弹出开始"到"按钮动画落定"的总时长。
 * 这段时间里两个按钮会被 `interactable = false` 关掉 ——
 * 一是防误触（面板还在长出来就点到按钮），
 * 二是**躲开和 cc.Button 自己那条 SCALE 按下过渡抢 `node.scale`**（见 setButtonsInteractable）。
 */
const BUTTON_SETTLE_TOTAL = BUTTON_DELAY + BUTTON_POP_UP + BUTTON_POP_SETTLE;

/** 底板起始缩放：看得出"从中心长出来"，又不至于小到糊 */
const PANEL_FROM_SCALE = 0.72;
/** 底板起始下沉量（局部坐标像素），配合上浮形成"从下方升起"的感觉 */
const PANEL_FROM_OFFSET_Y = -60;
/** 按钮起始缩放 */
const BUTTON_FROM_SCALE = 0.8;

// 过冲幅度。
// 这里**故意不用 backOut** —— backOut 的过冲量正比于 (1 - 起始值)，
// 从 0.72 弹到 1 只过冲到 0.72 + 0.28×1.0877 ≈ 1.025，也就是 2.5%，
// 肉眼基本看不出来，"弹"就没了。所以拆成两段显式写，幅度自己说了算。
const PANEL_PEAK_SCALE = 1.06;
const BUTTON_PEAK_SCALE = 1.08;

/**
 * `UIManager.openBox(UIGameResultView, path, para)` 的第三个参数（透传给 onEnable）。
 * 不传 ⇒ 保持预制体原样（win_node 开、fail_node 关），和加这个类之前完全一致。
 */
export class ResultPara
{
    /** true = 过关（显示 win_node），false = 失败（显示 fail_node）。不传就不动 */
    public isWin?: boolean;

    /**
     * 顶部标题（`titlebg/Text`，预制体里写死的是"恭喜过关"）。
     *
     * ⚠️ 这一行在 `win_node` / `fail_node` **之外**，是两种结果共用的一行 ——
     * 也就是说失败时它照样显示"恭喜过关"。预制体里没有失败版的标题文案，
     * 所以这里不编，由调用方传；不传就不动它。
     */
    public title?: string;
}

// 收起（playHide）—— 弹出是"从中心长出来"，收起就是往回缩 + 淡掉。
// 比弹出快：关闭是用户的意图，拖沓会显得卡；0.2s 左右刚好。
// 刻意**不做**和弹出完全对称的动画（弹出带过冲，没法倒放），
// 只保留"缩小 + 下沉 + 淡出"三个同向的动作，读起来就是一个"收回去"。
const PANEL_HIDE_DURATION = 0.18;
const DIM_HIDE_DURATION = 0.20;
const PANEL_HIDE_SCALE = 0.88;
/** 收起时底板额外下沉的像素（比弹出的 -60 浅，避免整段位移被完整倒放） */
const PANEL_HIDE_SINK = -30;

@UIView("UIGameResultView")
export class UIGameResultView extends UIBaseView implements IOnCreate, IOnEnable<ResultPara>, IOnDisable, IOnWidthPaddingChange {

    public static readonly PrefabPath:string = "ui/uiresult/prefabs/uiGameResultView";

    /** 全屏遮罩（根下第 1 个 bg） */
    private _dim: Node = null;
    private _dimOpacity: UIOpacity = null;

    /** 弹窗底板（根下第 2 个 bg）。缩放/上浮都作用在它身上，遮罩不能跟着缩 */
    private _panel: Node = null;
    private _panelOpacity: UIOpacity = null;

    /** 生效的那个按钮（win_node/btn_next 或 fail_node/btn_replay），两个节点都关着时为 null */
    private _button: Node = null;

    /**
     * 设计态姿态，取一次就记住。
     * 节点是从对象池借出来的，借出来时可能还带着上一次播到一半的姿态 ——
     * 之所以敢"借出来就记"，是因为 onDisable 里一定会复位（见 resetPose）。
     */
    private _panelHome: Vec3 = null;
    private _buttonHome: Vec3 = null;

    /** 两个按钮的 cc.Button，onEnable 挂、onDisable 摘（节点会被复用，不能挂两次） */
    private _winButton: Button = null;
    private _failButton: Button = null;

    /** 收起动画正在跑。用来吃掉重复点击 —— 双击不能让 closeSelf() 跑两遍 */
    private _closing: boolean = false;

    /**
     * win_node / fail_node / 标题的设计态，第一次解析时记一次。
     * 因为 setResult() 会改它们，而节点是池子复用的 —— 不复位的话下一次打开
     * 会带着上一次的结果（"上次是失败，这次一打开还是失败文案"）。
     */
    private _winDefaultActive: boolean = null;
    private _defaultTitle: string = null;

    public getConstructor()
    {
        return UIGameResultView;
    }

    get isOnWidthPaddingChange(){
        return true;
    }

    public onCreate()
    {
        this.resolveNodes();
        // 赶在第一次渲染之前把起始姿态摆好，见文件头的时序约束
        this.applyStartPose();
    }

    public onEnable(para?: ResultPara)
    {
        // 1) 结果必须最先定 —— 它决定 win_node/fail_node 的 active，后面挑按钮、弹哪个都看它
        if (para != null) this.applyResult(para);
        // 2) 按钮要在 playShow() **之前**挂好：playShow 里会 setButtonsInteractable(false)，
        //    那一步要用到 _winButton / _failButton，没挂上就是空操作（弹出期间照样能点到按钮，
        //    也就躲不开 cc.Button 的 SCALE 过渡抢 node.scale）。
        this.bindButtons();
        // 3) 最后才播动画
        this.playShow();
    }

    public onDisable()
    {
        this.stopShow();
        // resetPose 会把 interactable 恢复成 true，必须在 unbindButtons() 之前 ——
        // unbindButtons 会把两个 Button 引用置空，之后就够不着了
        this.resetPose();
        this.unbindButtons();
    }

    // -----------------------------------------------------------------------
    // 结果（win / fail）
    // -----------------------------------------------------------------------

    /**
     * 只切 win_node / fail_node 的 active，不碰标题、不重播动画。
     * 给"弹窗已经开着、结果才定下来"的场景用；刚打开就走 ResultPara。
     */
    public setResult(isWin: boolean)
    {
        if (this._panel == null) this.resolveNodes();
        const panel = this._panel;
        if (panel == null) return;

        const winNode = panel.getChildByName("win_node");
        const failNode = panel.getChildByName("fail_node");
        if (winNode != null) winNode.active = isWin;
        if (failNode != null) failNode.active = !isWin;

        // 生效的按钮跟着 active 走，切完要重挑
        this.pickButton();
    }

    private applyResult(para: ResultPara)
    {
        if (para.isWin != null) this.setResult(para.isWin);

        if (para.title != null && this._panel != null)
        {
            const titlebg = this._panel.getChildByName("titlebg");
            const textNode = titlebg != null ? titlebg.getChildByName("Text") : null;
            const label = textNode != null ? textNode.getComponent(Label) : null;
            if (label != null) label.string = para.title;
        }
    }

    public onMenuIndexChanged(para: MenuPara){
        // this.curId = para.id;
        // this.refreshItemSpaceShow();
    }

    public refreshItemSpaceShow()
    {
    }

    // -----------------------------------------------------------------------
    // 弹出动画
    // -----------------------------------------------------------------------

    /**
     * 播放弹出动画。onEnable 里自动调；外面若要"换了 win_node/fail_node 之后再弹一次"
     * 也可以直接调（每次都会重新挑按钮）。
     */
    public playShow()
    {
        if (this._panel == null) this.resolveNodes();
        if (this._panel == null || this._dim == null) return;

        this._closing = false;
        this.pickButton();

        // 先停旧的再摆姿态：顺序反过来的话，上一轮还在跑的 tween 会把刚摆好的姿态覆盖掉
        this.stopShow();
        this.applyStartPose();
        this.setButtonsInteractable(false);

        const home = this._panelHome;

        // 遮罩淡入
        tween(this._dimOpacity)
            .to(DIM_FADE_DURATION, { opacity: 255 }, { easing: 'quadOut' })
            .start();

        // 底板淡入
        tween(this._panelOpacity)
            .to(PANEL_FADE_DURATION, { opacity: 255 }, { easing: 'quadOut' })
            .start();

        // 底板上浮（和缩放是两条独立的 tween，各自用各自的缓动；
        // Tween.stopAllByTarget 会一起收掉，不用单独记引用）
        if (home != null)
        {
            tween(this._panel)
                .to(PANEL_RISE_DURATION, { position: new Vec3(home.x, home.y, home.z) }, { easing: 'quadOut' })
                .start();
        }

        // 底板缩放弹出：先冲到过冲位、再回落（两段串在一条 tween 里 ——
        // 是"放大 → 回弹"一个动作，不是两个独立动作，所以不能拆成两条 tween）
        tween(this._panel)
            .to(PANEL_POP_UP, { scale: new Vec3(PANEL_PEAK_SCALE, PANEL_PEAK_SCALE, 1) }, { easing: 'quadOut' })
            .to(PANEL_POP_SETTLE, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .start();

        // 按钮晚一拍
        if (this._button != null)
        {
            tween(this._button)
                .delay(BUTTON_DELAY)
                .to(BUTTON_POP_UP, { scale: new Vec3(BUTTON_PEAK_SCALE, BUTTON_PEAK_SCALE, 1) }, { easing: 'quadOut' })
                .to(BUTTON_POP_SETTLE, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
                .start();
        }

        // 全部落定后才放开点击（理由见 BUTTON_SETTLE_TOTAL 的注释）
        tween(this._panel)
            .delay(BUTTON_SETTLE_TOTAL)
            .call(() => this.setButtonsInteractable(true))
            .start();
    }

    // -----------------------------------------------------------------------
    // 收起动画 + 按钮
    // -----------------------------------------------------------------------

    /**
     * 播放收起动画，跑完调 onComplete。
     *
     * 和 playShow 的关键差别：**不能调 applyStartPose()**。
     * 收起是从"当前姿态"往回收，先摆起始姿态会把画面瞬间弹回 0.72 倍再收 —— 等于闪一下。
     */
    public playHide(onComplete?: () => void)
    {
        if (this._panel == null) this.resolveNodes();
        if (this._panel == null || this._dim == null)
        {
            if (onComplete) onComplete();
            return;
        }

        this.pickButton();
        this.stopShow();
        this.setButtonsInteractable(false);

        tween(this._dimOpacity)
            .to(DIM_HIDE_DURATION, { opacity: 0 }, { easing: 'quadIn' })
            .start();

        tween(this._panelOpacity)
            .to(PANEL_HIDE_DURATION, { opacity: 0 }, { easing: 'quadIn' })
            .start();

        // onComplete 挂在缩放这条上（它是收起动画的"主时长"）。
        // 遮罩比它长一点点，所以收完还会剩一帧很淡的遮罩 —— 这是故意的：
        // 关掉的那一帧正好被它盖住，不会看到"面板先没了、背景还亮着"。
        tween(this._panel)
            .to(PANEL_HIDE_DURATION, { scale: new Vec3(PANEL_HIDE_SCALE, PANEL_HIDE_SCALE, 1) }, { easing: 'quadIn' })
            .call(() => { if (onComplete) onComplete(); })
            .start();

        const home = this._panelHome;
        if (home != null)
        {
            tween(this._panel)
                .to(PANEL_HIDE_DURATION, { position: new Vec3(home.x, home.y + PANEL_HIDE_SINK, home.z) }, { easing: 'quadIn' })
                .start();
        }
    }

    /**
     * 收起动画 + 关掉自己。重复调用只关一次。
     * 按钮和外部流程都走这个，别直接 closeSelf()，否则没有收起动画。
     */
    public closeWithAnim()
    {
        if (this._closing) return;
        this._closing = true;
        this.playHide(() => this.closeSelf());
    }

    /**
     * 结算弹窗的两个按钮。
     *
     * ⚠️ 目前只做"收起来关掉" —— 真正的流程要接 GameDataManager：
     *     下一关 → GameDataManager.instance.SetLevelCfgById(curFightLevelId + 1)
     *     重开   → GameDataManager.instance.SetLevelCfgById(curFightLevelId)
     *   （SetLevelCfgById 会 clone 配置 + 写 CacheManager + 调 gameMainObj.start() 重铺盘）
     *
     * 没直接写进去，是因为**还没有任何代码在决定"什么时候算过关、什么时候弹这个弹窗"**
     * —— 现在这个弹窗是被 settingBtn 当调试入口拉起来的，顺手推进关卡会在调试时误伤。
     * 等过关判定落地了，把下面两行换成上面的调用即可。
     */
    private onResultButton(isNext: boolean)
    {
        console.log("[UIGameResultView] 点击 " + (isNext ? "btn_next" : "btn_replay"));
        this.closeWithAnim();
    }

    private onClickNext() { this.onResultButton(true); }
    private onClickReplay() { this.onResultButton(false); }

    /**
     * 挂按钮回调。
     *
     * 用"已解析出来的节点 + getComponent(Button)"，**不用**
     * `this.addComponent<UIButton>(UIButton, "bg/win_node/btn_next")` ——
     * 按路径解析走的是 getChildByPath，第一个 "bg" 就匹配到全屏遮罩了，
     * 后面根本找不到 win_node，结果是 Log.error + 按钮点不动
     * （详见 resolveNodes 里"两个 bg 同名"的注释）。
     */
    private bindButtons()
    {
        this.unbindButtons();

        const panel = this._panel;
        if (panel == null) return;

        const winNode = panel.getChildByName("win_node");
        const failNode = panel.getChildByName("fail_node");

        const winBtnNode = winNode != null ? winNode.getChildByName("btn_next") : null;
        const failBtnNode = failNode != null ? failNode.getChildByName("btn_replay") : null;

        this._winButton = winBtnNode != null ? winBtnNode.getComponent(Button) : null;
        this._failButton = failBtnNode != null ? failBtnNode.getComponent(Button) : null;

        if (this._winButton != null) this._winButton.node.on(Button.EventType.CLICK, this.onClickNext, this);
        if (this._failButton != null) this._failButton.node.on(Button.EventType.CLICK, this.onClickReplay, this);
    }

    private unbindButtons()
    {
        if (this._winButton != null) this._winButton.node.off(Button.EventType.CLICK, this.onClickNext, this);
        if (this._failButton != null) this._failButton.node.off(Button.EventType.CLICK, this.onClickReplay, this);
        this._winButton = null;
        this._failButton = null;
    }

    /**
     * 动画期间把按钮禁掉。
     *
     * 不只是防误触 —— 更关键的是**避免两个系统抢 `node.scale`**：
     * 这两个按钮的 `cc.Button` 是 SCALE 过渡，按下/抬起时它自己也会写 `node.scale`
     * （而且 `zoomScale` 没在预制体里设过，吃的是引擎默认 **1.2**，按下会放大 20%）。
     * 弹出动画同时在给同一个属性写值，两者叠起来会让 cc.Button 缓存的
     * `_originalScale` 停在一个中间值上（"按一下之后按钮略大一圈"）。
     * `interactable = false` 期间 cc.Button 不会进入 press 状态，也就不会碰 scale，
     * 冲突窗口直接消失。代价是弹出那 0.42s 里点不动 —— 那本来也不该点。
     */
    private setButtonsInteractable(flag: boolean)
    {
        if (this._winButton != null) this._winButton.interactable = flag;
        if (this._failButton != null) this._failButton.interactable = flag;
    }

    /** 摆出"动画第 0 帧"的姿态 */
    private applyStartPose()
    {
        if (this._dimOpacity != null) this._dimOpacity.opacity = 0;
        if (this._panelOpacity != null) this._panelOpacity.opacity = 0;

        if (this._panel != null)
        {
            this._panel.setScale(PANEL_FROM_SCALE, PANEL_FROM_SCALE, 1);
            const home = this._panelHome;
            if (home != null)
                this._panel.setPosition(home.x, home.y + PANEL_FROM_OFFSET_Y, home.z);
        }

        if (this._button != null)
            this._button.setScale(BUTTON_FROM_SCALE, BUTTON_FROM_SCALE, 1);
    }

    private stopShow()
    {
        if (this._dimOpacity != null) Tween.stopAllByTarget(this._dimOpacity);
        if (this._panelOpacity != null) Tween.stopAllByTarget(this._panelOpacity);
        if (this._panel != null) Tween.stopAllByTarget(this._panel);
        if (this._button != null) Tween.stopAllByTarget(this._button);
    }

    /**
     * 复位到设计态。
     * 这一步不是"洁癖"：借出去的节点回收后会再借给下一次 openBox，
     * 不复位的话下一次打开的第一帧就是上次停在的半透明/半缩放状态。
     */
    private resetPose()
    {
        if (this._dimOpacity != null) this._dimOpacity.opacity = 255;
        if (this._panelOpacity != null) this._panelOpacity.opacity = 255;

        if (this._panel != null)
        {
            this._panel.setScale(1, 1, 1);
            const home = this._panelHome;
            if (home != null) this._panel.setPosition(home.x, home.y, home.z);
        }

        if (this._button != null)
        {
            this._button.setScale(1, 1, 1);
            const home = this._buttonHome;
            if (home != null) this._button.setPosition(home.x, home.y, home.z);
        }

        // 结果和标题也要复位 —— setResult() 改过它们，节点回收后会带着上一次的结果
        if (this._panel != null && this._winDefaultActive != null)
        {
            const winNode = this._panel.getChildByName("win_node");
            const failNode = this._panel.getChildByName("fail_node");
            if (winNode != null) winNode.active = this._winDefaultActive;
            if (failNode != null) failNode.active = !this._winDefaultActive;
        }
        if (this._panel != null && this._defaultTitle != null)
        {
            const titlebg = this._panel.getChildByName("titlebg");
            const textNode = titlebg != null ? titlebg.getChildByName("Text") : null;
            const label = textNode != null ? textNode.getComponent(Label) : null;
            if (label != null) label.string = this._defaultTitle;
        }

        // 动画期间被禁掉的按钮要放开 —— 否则节点回收后下次借出来是点不动的
        this.setButtonsInteractable(true);
    }

    // -----------------------------------------------------------------------
    // 节点解析
    // -----------------------------------------------------------------------

    private resolveNodes()
    {
        const root = this.node;
        if (root == null) return;

        this._dim = null;
        this._panel = null;

        // 根下有两个**同名**子节点 "bg"：索引 0 是全屏遮罩，索引 1 是弹窗底板。
        // find()/getChildByName() 遇到同名只认第一个，所以不能按名字取第二个 ——
        // 这里按"谁下面挂着 win_node/fail_node"来认底板，剩下的 bg 就是遮罩。
        for (let i = 0; i < root.children.length; i++)
        {
            const child = root.children[i];
            if (child.getChildByName("win_node") != null || child.getChildByName("fail_node") != null)
                this._panel = child;
            else if (child.name === "bg" && this._dim == null)
                this._dim = child;
        }

        // 兜底：结构万一被改过，退回"根下第 1 / 第 2 个子节点"
        if (this._panel == null && root.children.length > 1) this._panel = root.children[1];
        if (this._dim == null && root.children.length > 0) this._dim = root.children[0];

        if (this._dim == null || this._panel == null)
        {
            console.warn("[UIGameResultView] 预制体结构与预期不符，弹出动画跳过（期待根下两个 bg 子节点）");
            return;
        }

        this._dimOpacity = this.ensureOpacity(this._dim);
        this._panelOpacity = this.ensureOpacity(this._panel);

        if (this._panelHome == null) this._panelHome = this._panel.position.clone();

        // 设计态记一次（只在第一次解析时记，之后由 resetPose 保证节点是干净的）
        if (this._winDefaultActive == null)
        {
            const winNode = this._panel.getChildByName("win_node");
            this._winDefaultActive = winNode != null ? winNode.active : true;
        }
        if (this._defaultTitle == null)
        {
            const titlebg = this._panel.getChildByName("titlebg");
            const textNode = titlebg != null ? titlebg.getChildByName("Text") : null;
            const label = textNode != null ? textNode.getComponent(Label) : null;
            this._defaultTitle = label != null ? label.string : "";
        }

        this.pickButton();
    }

    /**
     * 挑出"当前生效"的按钮。
     * 谁生效由 setResult() 决定（不调就是预制体原样：win_node 开、fail_node 关），
     * 这里只认当前 active 的那个；两个都关着就当没有按钮（不弹按钮那一层）。
     */
    private pickButton()
    {
        const panel = this._panel;
        if (panel == null) return;

        const winNode = panel.getChildByName("win_node");
        const failNode = panel.getChildByName("fail_node");

        const owner = (winNode != null && winNode.active) ? winNode
                    : ((failNode != null && failNode.active) ? failNode : null);

        const btn = owner == null ? null
                  : find(owner === winNode ? "btn_next" : "btn_replay", owner);

        if (btn !== this._button)
        {
            this._button = btn;
            // 按钮只做缩放、不做位移，所以任何时候读到的 position 都是设计态
            this._buttonHome = btn != null ? btn.position.clone() : null;
        }
    }

    /**
     * 取/挂 UIOpacity。
     *
     * 工程里没有任何预制体挂过 UIOpacity，也没有挂过自研的 CanvasGroup
     * （Mono/Module/UI/CanvasGroup.ts 那个是**破坏性**的：它把子节点 UIRenderer 的
     * color.a 直接改写成 alpha*255，不记原值 —— 一旦某天面板里出现半透明素材就回不去了，
     * 所以这里不用它）。
     *
     * UIOpacity 是引擎自带的**乘法**不透明度，不改素材本身的颜色，最安全；
     * 运行时 addComponent 一次即可，节点被对象池复用时会带着走，用 getComponent 兜住幂等。
     */
    private ensureOpacity(node: Node): UIOpacity
    {
        return node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
    }
}
