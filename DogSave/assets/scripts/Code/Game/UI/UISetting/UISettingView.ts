import { Button, Node, Tween, tween, Vec3 } from "cc";
import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnDisable } from "../../../Module/UI/IOnDisable";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { PopupAnim } from "../../../Module/UI/PopupAnim";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { SoundManager } from "../../../Module/Resource/SoundManager";
import { CacheManager } from "../../../Module/Player/CacheManager";
import { CacheKeys } from "../../../Module/Const/CacheKeys";
import { Log } from "../../../../Mono/Module/Log/Log";
import { UIToast } from "../UICommon/UIToast";

// ---------------------------------------------------------------------------
// 设置界面
// ---------------------------------------------------------------------------
// 版式来自 `04_settings.png`（1080x1920），预制体由 `uisetting_src/gen_prefab.py` 生成，
// 结构校验 + 离线渲染见 `uisetting_src/preview_prefab.py`。
//
// 和结算界面（UIGameResultView）的**结构差别**，动手改之前先看一眼：
//   结算界面是"弹窗" —— 根下两个同名 bg（全屏遮罩 + 小底板），靠 win_node/fail_node 让
//   PopupAnim 认出底板；本界面是**整屏页**，根下只有 `mask`（整屏底色）和 `panel`（内容容器），
//   两个名字正好命中 PopupAnim 的默认判据（dimNames / panelNames），所以不用传 dim/panel。
//
// ⚠️ 名字不能改：把 `mask` 改成 `bg` 的话，PopupAnim 的"名字判据"会先命中它，
//   于是**整屏底色被当成底板**去缩放 —— 底图会从 0.72 倍长出来，内容反而不动。
//
// ⚠️ 时序约束和结算界面一样：`UIBaseContainer.setActive(true)` 是
//   onEnable() -> afterOnEnable() -> node.active = true，也就是 **onEnable 跑完节点才 active**。
//   起始姿态必须在 onCreate 里就摆好，否则会先闪一帧成品画面再跳回 0.72 倍。
//
// 数据来源（工程里现在真实存在的只有前两项）：
//   音乐 / 音效 -> SoundManager（音量本身就是 0..10，已经在 CacheManager 里持久化）
//   震动 / 提示 -> CacheManager 的 Vibrate / Hint（**没有**消费方，见 writeToggle 的注释）
//   语言 / 保存进度 / 联系我们 / 隐私政策 / 服务条款 -> 工程里还没有对应界面，点击只弹提示
export type SettingRowId =
    "music" | "sound" | "vibrate" | "hint" |
    "lang" | "save" | "contact" | "privacy" | "terms";

interface RowDef
{
    id: SettingRowId;
    /** 预制体里的节点名，改预制体要同步改这里 */
    nodeName: string;
    /** true = 行尾是开关（点一下切状态）；false = 行尾是箭头（点一下进二级页） */
    isToggle: boolean;
}

const ROWS: RowDef[] = [
    { id: "music",   nodeName: "row_music",   isToggle: true },
    { id: "sound",   nodeName: "row_sound",   isToggle: true },
    { id: "vibrate", nodeName: "row_vibrate", isToggle: true },
    { id: "hint",    nodeName: "row_hint",    isToggle: true },
    { id: "lang",    nodeName: "row_lang",    isToggle: false },
    { id: "save",    nodeName: "row_save",    isToggle: false },
    { id: "contact", nodeName: "row_contact", isToggle: false },
    { id: "privacy", nodeName: "row_privacy", isToggle: false },
    { id: "terms",   nodeName: "row_terms",   isToggle: false },
];

/** 旋钮在"开"状态下的局部 x，必须和 gen_prefab.py 的 KNOB_ON_X 一致 */
const KNOB_ON_X: number = 52;
/** 旋钮滑动时长（秒）。比 PopupAnim 的按钮弹出快，开关要跟手 */
const KNOB_SLIDE: number = 0.14;

class ToggleView
{
    public trackOn: Node = null;
    public trackOff: Node = null;
    public knob: Node = null;
    /** 旋钮设计态 y/z，滑动只改 x */
    public knobY: number = 0;
    public knobZ: number = 0;
}

class RowView
{
    public def: RowDef = null;
    public node: Node = null;
    public button: Button = null;
    public toggle: ToggleView = null;
    /** 挂在 Button 上的回调，onDisable 要用同一个引用摘掉 */
    public handler: () => void = null;
}

@UIView("UISettingView")
export class UISettingView extends UIBaseView implements IOnCreate, IOnEnable, IOnDisable
{
    public static readonly PrefabPath: string = "ui/uisetting/prefabs/uiSettingView";

    private _pop: PopupAnim = null;

    /** 收起动画只允许触发一次：双击不能让 closeSelf() 跑两遍 */
    private _closing: boolean = false;

    private _backButton: Button = null;
    private _rows: RowView[] = null;

    public getConstructor()
    {
        return UISettingView;
    }

    public onCreate()
    {
        this._pop = new PopupAnim(this.node, {
            // 返回钮和 9 行都晚底板一拍弹出来，顺便在弹出那 0.42 秒里被禁掉（见 PopupAnim 的注释）
            extraTargets: () => this.popTargets(),
        });
        this._pop.resolve();

        this._rows = this.resolveRows();

        // 赶在第一次渲染之前把起始姿态摆好，见文件头的时序约束
        this._pop.applyStartPose();
    }

    public onEnable()
    {
        this._closing = false;

        // 先把开关摆到存档里的状态，再播动画 —— 反过来的话会先看到全"开"再跳回去
        this.refreshAll();

        this.bindButtons();
        this._pop.playShow();
    }

    public onDisable()
    {
        this._pop.stop();
        this.unbindButtons();
        this._pop.resetPose();
    }

    // -----------------------------------------------------------------------
    // 关闭
    // -----------------------------------------------------------------------

    /**
     * 收起动画 + 关掉自己。
     *
     * 覆盖 `closeSelf()` 而不是另开一个方法，是为了让**所有**关闭路径都带上动画：
     * 返回钮、`onInputKeyBack()`（安卓返回键，基类实现会调 closeSelf）、
     * 以及外面 `UIManager.closeWindow(UISettingView)`。
     */
    public async closeSelf(): Promise<void>
    {
        if (this._closing) return;
        this._closing = true;

        // 节点已经被停用时不要再等动画（tween 不会跑，等下去就永远关不掉）
        if (this._pop != null && this.node != null && this.node.activeInHierarchy)
        {
            await this._pop.playHideAsync();
        }
        return super.closeSelf();
    }

    // -----------------------------------------------------------------------
    // 按钮
    // -----------------------------------------------------------------------

    /**
     * 挂按钮回调。
     *
     * ⚠️ 用"已解析出来的节点 + getComponent(Button)"，**不用**
     *   `this.addComponent<UIButton>(UIButton, "panel/row_music")` ——
     *   按路径解析走 getChildByPath，它按名字逐级找，而这里 9 个行节点的父节点都叫
     *   `panel_music` / `panel_system` / `panel_legal` 三个不同名字，路径要写得很长；
     *   一旦预制体改了层级，路径就静默失效（Log.error 之后按钮点不动）。
     *   直接拿 onCreate 里已经解析好的节点更稳。
     */
    private bindButtons()
    {
        this.unbindButtons();

        const backNode = this.node != null ? this.node.getChildByPath("panel/btn_back") : null;
        this._backButton = backNode != null ? backNode.getComponent(Button) : null;
        if (this._backButton != null)
        {
            this._backButton.node.on(Button.EventType.CLICK, this.onClickBack, this);
        }

        const rows = this.rowViews();
        for (let i = 0; i < rows.length; i++)
        {
            const row = rows[i];
            if (row.button == null) continue;
            if (row.handler == null) row.handler = () => this.onClickRow(row);
            row.button.node.on(Button.EventType.CLICK, row.handler, this);
        }
    }

    private unbindButtons()
    {
        if (this._backButton != null)
        {
            this._backButton.node.off(Button.EventType.CLICK, this.onClickBack, this);
        }
        this._backButton = null;

        const rows = this.rowViews();
        for (let i = 0; i < rows.length; i++)
        {
            const row = rows[i];
            if (row.button == null || row.handler == null) continue;
            row.button.node.off(Button.EventType.CLICK, row.handler, this);
        }
    }

    private onClickBack()
    {
        this.closeSelf();
    }

    private onClickRow(row: RowView)
    {
        if (row.def.isToggle)
        {
            const next = !this.readToggle(row.def.id);
            this.writeToggle(row.def.id, next);
            this.applyToggle(row, next, true);
            return;
        }

        // 语言 / 保存进度 / 联系我们 / 隐私政策 / 服务条款 —— 工程里**都还没有**对应界面。
        // 这里只给一个看得见的反馈，不假装已经接上；等二级页做出来，把这里换成
        // `UIManager.instance.openWindow(...)` 即可，界面本身不用动。
        Log.warning("[UISettingView] 行 " + row.def.id + " 还没有对应界面");
        UIToast.showToast("敬请期待");
    }

    // -----------------------------------------------------------------------
    // 开关状态
    // -----------------------------------------------------------------------

    /** 读存档。读不到就按"开"处理 —— 默认静音比默认有声音更让人意外 */
    private readToggle(id: SettingRowId): boolean
    {
        switch (id)
        {
            case "music":
            {
                const sm = SoundManager.instance;
                return sm != null ? sm.MusicVolume > 0 : true;
            }
            case "sound":
            {
                const sm = SoundManager.instance;
                return sm != null ? sm.SoundVolume > 0 : true;
            }
            case "vibrate":
                return this.readFlag(CacheKeys.Vibrate);
            case "hint":
                return this.readFlag(CacheKeys.Hint);
            default:
                return true;
        }
    }

    private writeToggle(id: SettingRowId, on: boolean)
    {
        switch (id)
        {
            case "music":
            {
                // 音量是 0..10 的整数，SoundManager 自己会写 CacheKeys.MusicVolume
                const sm = SoundManager.instance;
                if (sm != null) sm.setMusicVolume(on ? SoundManager.DEFAULTVALUE : 0);
                break;
            }
            case "sound":
            {
                const sm = SoundManager.instance;
                if (sm != null) sm.setSoundVolume(on ? SoundManager.DEFAULTVALUE : 0);
                break;
            }
            case "vibrate":
                // ⚠️ 震动/提示在工程里**没有任何消费方**（没有震动 API，也没有提示功能）。
                //    这里只把玩家意愿存下来，别的地方要用了直接读这两个 key；
                //    在此之前，开关"能记住"但"不产生行为"。
                this.writeFlag(CacheKeys.Vibrate, on);
                break;
            case "hint":
                this.writeFlag(CacheKeys.Hint, on);
                break;
        }
    }

    private readFlag(key: string): boolean
    {
        const cm = CacheManager.instance;
        return cm != null ? cm.getInt(key, 1) !== 0 : true;
    }

    private writeFlag(key: string, on: boolean)
    {
        const cm = CacheManager.instance;
        if (cm != null) cm.setInt(key, on ? 1 : 0);
    }

    /** 把所有开关摆到存档状态（不带动画）。onEnable 里调 */
    private refreshAll()
    {
        const rows = this.rowViews();
        for (let i = 0; i < rows.length; i++)
        {
            const row = rows[i];
            if (!row.def.isToggle) continue;
            this.applyToggle(row, this.readToggle(row.def.id), false);
        }
    }

    /**
     * 摆开关的视觉状态。
     *
     * 轨道是**两个叠在同一位置的节点**（track_on / track_off），靠 active 切换，
     * 不是运行时换 spriteFrame —— 换图要按 uuid 加载，uuid 一旦被重新导入就变。
     */
    private applyToggle(row: RowView, on: boolean, animate: boolean)
    {
        const t = row.toggle;
        if (t == null) return;

        if (t.trackOn != null) t.trackOn.active = on;
        if (t.trackOff != null) t.trackOff.active = !on;
        if (t.knob == null) return;

        const targetX = on ? KNOB_ON_X : -KNOB_ON_X;

        // 先停旧 tween 再摆位置：顺序反了的话上一轮还在跑的 tween 会覆盖掉刚摆好的姿态
        Tween.stopAllByTarget(t.knob);

        if (!animate)
        {
            t.knob.setPosition(targetX, t.knobY, t.knobZ);
            return;
        }

        tween(t.knob)
            .to(KNOB_SLIDE, { position: new Vec3(targetX, t.knobY, t.knobZ) }, { easing: "quadOut" })
            .start();
    }

    // -----------------------------------------------------------------------
    // 节点取用
    // -----------------------------------------------------------------------

    /** 懒解析。预制体结构变了要在这里同步改（节点名见 gen_prefab.py 的 ROWS） */
    private rowViews(): RowView[]
    {
        if (this._rows == null) this._rows = this.resolveRows();
        return this._rows;
    }

    private resolveRows(): RowView[]
    {
        const result: RowView[] = [];
        if (this.node == null) return result;

        const panel = this.node.getChildByPath("panel");
        if (panel == null)
        {
            Log.error("[UISettingView] 预制体里找不到 panel 节点");
            return result;
        }

        for (let i = 0; i < ROWS.length; i++)
        {
            const def = ROWS[i];
            const node = this.findRowNode(panel, def.nodeName);
            if (node == null)
            {
                Log.error("[UISettingView] 预制体里找不到行节点 " + def.nodeName);
                continue;
            }

            const row = new RowView();
            row.def = def;
            row.node = node;
            row.button = node.getComponent(Button);

            if (def.isToggle)
            {
                const toggleNode = node.getChildByName("toggle");
                if (toggleNode != null)
                {
                    const t = new ToggleView();
                    t.trackOn = toggleNode.getChildByName("track_on");
                    t.trackOff = toggleNode.getChildByName("track_off");
                    t.knob = toggleNode.getChildByName("knob");
                    if (t.knob != null)
                    {
                        t.knobY = t.knob.position.y;
                        t.knobZ = t.knob.position.z;
                    }
                    row.toggle = t;
                }
            }

            result.push(row);
        }
        return result;
    }

    /**
     * 行节点在三个面板之一里，面板名不确定时就遍历一层。
     * 直接 `panel.getChildByName(name)` 找不到 —— 行不是 panel 的直接子节点。
     */
    private findRowNode(panel: Node, name: string): Node
    {
        const children = panel.children;
        for (let i = 0; i < children.length; i++)
        {
            const found = children[i].getChildByName(name);
            if (found != null) return found;
        }
        return null;
    }

    /** 晚一拍弹出、动画期间禁用的节点：返回钮 + 9 行 */
    private popTargets(): Node[]
    {
        const result: Node[] = [];
        if (this._backButton != null) result.push(this._backButton.node);

        const rows = this.rowViews();
        for (let i = 0; i < rows.length; i++)
        {
            if (rows[i].node != null) result.push(rows[i].node);
        }
        return result;
    }
}
