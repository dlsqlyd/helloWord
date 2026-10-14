import { Button, Label, Node } from "cc";
import { GameDataManager } from "../../GameDataManager";
import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnDisable } from "../../../Module/UI/IOnDisable";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { IOnWidthPaddingChange } from "../../../Module/UI/IOnWidthPaddingChange";
import { PopupAnim } from "../../../Module/UI/PopupAnim";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { MenuPara } from "../UICommon/UIMenu";

// ---------------------------------------------------------------------------
// 结算界面的弹出动画
// ---------------------------------------------------------------------------
// 动画本身在 `Module/UI/PopupAnim` 里（结算 / 消息框 / Toast 三个弹窗共用一套），
// 这里只负责结算界面**特有**的两件事：
//   1) 结果（win / fail）决定 win_node / fail_node 谁 active，动画再按 active 挑要弹的按钮；
//   2) 顶部的标题是 win/fail **共用**的一行，需要调用方给（见 ResultPara 的注释）。
//
// 预制体结构：根下两个**同名**子节点 "bg" —— 索引 0 是全屏遮罩，索引 1 是弹窗底板。
// PopupAnim 按"谁下面挂着 win_node/fail_node"来认底板，不靠名字（见 PopupAnim.resolve）。
//
// ⚠️ 时序约束：`UIBaseContainer.setActive(true)` 的顺序是
//   onEnable() -> afterOnEnable() -> node.active = true，
//   也就是 **onEnable 跑完节点才 active**。起始姿态必须在 onEnable（或更早的 onCreate）里就位，
//   否则会先闪一帧"完整尺寸 + 完整不透明"的成品画面，再跳回 0.72 倍开始动。
//   所以 onCreate 和 playShow 里各摆一次。
//
// ⚠️ 结果（isWin）必须在 playShow() **之前**定下来 —— 动画是按 `active` 挑按钮的，
//   切晚了会去弹上一个结果的那个按钮。
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

@UIView("UIGameResultView")
export class UIGameResultView extends UIBaseView implements IOnCreate, IOnEnable<ResultPara>, IOnDisable, IOnWidthPaddingChange {

    public static readonly PrefabPath:string = "ui/uiresult/prefabs/uiGameResultView";

    private _pop: PopupAnim = null;

    /** 两个按钮的 cc.Button，onEnable 挂、onDisable 摘（节点会被复用，不能挂两次） */
    private _winButton: Button = null;
    private _failButton: Button = null;
    private _reviveButton: Button = null;

    /** 收起动画只允许触发一次：双击不能让 closeSelf() 跑两遍 */
    private _closing: boolean = false;

    /** 本次是赢还是输。安卓返回键要按"默认那个按钮"处理，得知道是哪种结果 */
    private _lastIsWin: boolean = true;

    /**
     * win_node / fail_node / 标题的设计态，第一次解析时记一次。
     * 因为 setResult() / applyResult() 会改它们，而节点是池子复用的 —— 不复位的话下一次打开
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
        this._pop = new PopupAnim(this.node, {
            // 每次 playShow 都重新取 —— win/fail 切换后生效的按钮会变，不能在构造时取一次
            extraTargets: () => this.activeButtonNodes(),
        });
        this._pop.resolve();

        // 此刻节点是干净的（刚实例化出来），是唯一能安全记"设计态"的时机
        this.captureDefaults();

        // 赶在第一次渲染之前把起始姿态摆好，见文件头的时序约束
        this._pop.applyStartPose();
    }

    public onEnable(para?: ResultPara)
    {
        this._closing = false;

        // 每次打开都从"预制体的默认结果"起算。节点是池子复用的，
        // 不复位的话上一次的 win/fail 会留给这一次的返回键用。
        // 不传 para 时（例如 settingBtn 那个调试入口）预制体默认开的是 win_node ⇒ true
        this._lastIsWin = true;

        // 1) 结果必须最先定 —— 它决定 win_node/fail_node 的 active，动画挑按钮全看它
        if (para != null) this.applyResult(para);
        if (this._winDefaultActive == null) this.captureDefaults();

        // 2) 挂按钮回调
        this.bindButtons();

        // 3) 最后才播动画
        this.playShow();
    }

    public onDisable()
    {
        this._pop.stop();
        // 复位到设计态：借出去的节点回收后会再借给下一次 openBox，
        // 不复位的话下一次打开的第一帧就是上次停在的半透明/半缩放状态，
        // 而且会带着上一次的结果文案（见 _winDefaultActive 的注释）
        this.resetVariant();
        this._pop.resetPose();
        this.unbindButtons();
    }

    // -----------------------------------------------------------------------
    // 动画（转发给 PopupAnim；做成 public 是为了"换了 win/fail 之后再弹一次"这种场景）
    // -----------------------------------------------------------------------

    public playShow()
    {
        this._pop.playShow();
    }

    public playHide(onComplete?: () => void)
    {
        this._pop.playHide(onComplete);
    }

    /**
     * 收起动画 + 关掉自己。
     *
     * 覆盖 `closeSelf()` 而不是另开一个 `closeWithAnim()`，是为了让**所有**关闭路径都带上动画
     * —— 两个按钮的回调、`onInputKeyBack()`（安卓返回键）、以及外面 `win.closeSelf()`。
     * 工程里关弹窗只有 `UIManager.closeBox()` 这一条路，没有"按层批量关 box"的逻辑
     * （`closeWindowByLayer` / `destroyWindowExceptNames` 处理的都是 window 不是 box）。
     */
    public async closeSelf(): Promise<void> {
        if (this._closing) return;
        this._closing = true;

        // 节点已经被停用时不要再等动画（tween 不会跑，等下去就永远关不掉）
        if (this._pop != null && this.node != null && this.node.activeInHierarchy) {
            await this._pop.playHideAsync();
        }
        return super.closeSelf();
    }

    /**
     * 安卓返回键。
     *
     * ⚠️ **不能**像别的弹窗那样只关掉自己：关卡结算之后盘面是冻住的
     * （见 GameDataManager.LevelState —— 只有 Playing 才接受点击），
     * 光关弹窗会留下一个"既玩不了、又不会再弹结算"的死局。
     * 所以返回键按"默认那个按钮"处理 —— 赢了当「下一关」、输了当「重玩」。
     */
    public onInputKeyBack(): Promise<void> {
        return this.onResultButton(this._lastIsWin);
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
        const panel = this.panelNode();
        if (panel == null) return;

        const winNode = panel.getChildByName("win_node");
        const failNode = panel.getChildByName("fail_node");
        if (winNode != null) winNode.active = isWin;
        if (failNode != null) failNode.active = !isWin;
    }

    private applyResult(para: ResultPara)
    {
        if (para.isWin != null)
        {
            this._lastIsWin = para.isWin;
            this.setResult(para.isWin);
        }

        if (para.title != null)
        {
            const label = this.titleLabel();
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
    // 按钮
    // -----------------------------------------------------------------------

    /**
     * 挂按钮回调。
     *
     * 用"已解析出来的节点 + getComponent(Button)"，**不用**
     * `this.addComponent<UIButton>(UIButton, "bg/win_node/btn_next")` ——
     * 按路径解析走的是 getChildByPath，第一个 "bg" 就匹配到全屏遮罩了，
     * 后面根本找不到 win_node，结果是 Log.error + 按钮点不动。
     */
    private bindButtons()
    {
        this.unbindButtons();

        const winBtnNode = this.buttonNode("win_node", "btn_next");
        const failBtnNode = this.buttonNode("fail_node", "btn_replay");
        const reviveBtnNode = this.buttonNode("fail_node", "btn_revive");

        this._winButton = winBtnNode != null ? winBtnNode.getComponent(Button) : null;
        this._failButton = failBtnNode != null ? failBtnNode.getComponent(Button) : null;
        this._reviveButton = reviveBtnNode != null ? reviveBtnNode.getComponent(Button) : null;

        if (this._winButton != null) this._winButton.node.on(Button.EventType.CLICK, this.onClickNext, this);
        if (this._failButton != null) this._failButton.node.on(Button.EventType.CLICK, this.onClickReplay, this);
        if (this._reviveButton != null) this._reviveButton.node.on(Button.EventType.CLICK, this.onClickRevive, this);

    }

    private unbindButtons()
    {
        if (this._winButton != null) this._winButton.node.off(Button.EventType.CLICK, this.onClickNext, this);
        if (this._failButton != null) this._failButton.node.off(Button.EventType.CLICK, this.onClickReplay, this);
        if (this._reviveButton != null) this._reviveButton.node.off(Button.EventType.CLICK, this.onClickRevive, this);
        this._winButton = null;
        this._failButton = null;
        this._reviveButton = null;
    }

    /**
     * 结算弹窗里「下一关 / 重玩」这两个按钮的公共出口。
     * （第三个按钮「复活」不走这里 —— 它不换关、不重铺，见 onRevive。）
     *
     * 弹窗自己**不认识关卡**（连 curFightLevelId 都不该知道），只把"玩家选了哪个"报上去；
     * 「下一关到底是第几关」交给 GameDataManager —— 只有它同时握着当前关卡号和关卡总数。
     *
     * 顺序是「先收弹窗、再推进关卡」，不能反过来：反过来的话新盘会在弹窗底下先铺好，
     * 收起动画那 0.2 秒里玩家能看到"新盘已经在了"的穿帮。
     */
    private async onResultButton(isNext: boolean)
    {
        console.log("[UIGameResultView] 点击 " + (isNext ? "btn_next" : "btn_replay"));
        await this.closeSelf();
        if (GameDataManager.instance != null) GameDataManager.instance.OnResultButton(isNext);
    }

    private onClickNext() { this.onResultButton(true); }
    private onClickReplay() { this.onResultButton(false); }

    /**
     * 「复活」：**不重开本关**，把同一盘棋继续下去，只补时间。
     *
     * ⚠️ 原先这里是 `this.onResultButton(false)` —— 和「重玩」一字不差，
     * 玩家看到「复活」、拿到「重玩」（盘面重铺、进度全丢）。那是**功能缺口**，
     * 不是按钮绑错；现在改走 GameDataManager.ReviveLevel()：
     * 盘面原样保留、levelState 回到 Playing、倒计时补一段。
     *
     * 顺序和 onResultButton 一致 ——「先收弹窗、再动作」，否则复活后盘面会在
     * 弹窗底下先动起来，收起动画那 0.2 秒里玩家能看到穿帮。
     */
    private async onRevive()
    {
        console.log("[UIGameResultView] 点击 btn_revive（复活：补时继续本关）");
        await this.closeSelf();
        if (GameDataManager.instance != null) GameDataManager.instance.ReviveLevel();
    }

    private onClickRevive() { this.onRevive(); }

    // -----------------------------------------------------------------------
    // 节点取用
    // -----------------------------------------------------------------------

    private panelNode(): Node
    {
        return this._pop != null ? this._pop.panel : null;
    }

    /**
     * 生效的变体（win_node / fail_node）里**所有**可见按钮；两个变体都关着时返回空数组。
     *
     * ⚠️ 这里以前只返回**一个**节点：
     *        return owner.getChildByName(owner === winNode ? "btn_next" : "btn_replay");
     *   而预制体 `uiGameResultView` 的 fail_node 下挂着**两个**按钮 ——
     *   `btn_replay`（x=-140，"重玩"）和 `btn_revive`（x=+140，"复活"），同一排并排、
     *   两个都是 active。于是 `btn_revive` 虽然挂了点击回调、也画在屏幕上，却不进
     *   PopupAnim 的 `_targets`：
     *     a) 不参与"按钮比底板晚一拍"的弹出 —— 重玩从 0.80 倍弹上来，复活一直停在 1.0 倍，
     *        同一排两个按钮动作不一致；
     *     b) 不参与 `setButtonsInteractable(false)` —— 弹出那 0.42s 里重玩点不动、复活点得动。
     *
     * 根因是**同一份按钮名单写了两处**（`bindButtons()` 一份、这里又手写一份），两份漂了。
     * 所以改成**从变体的子节点里扫**：谁挂着 cc.Button 谁就是按钮 —— 名单不存在了，
     * 以后预制体再加按钮也不会漏。
     *
     * 只扫**直接**子节点：预制体里按钮都是变体的直接子节点，没有再嵌一层。
     * 判据见 `level_tools/verify_level_loop.py` 第 17 项。
     */
    private activeButtonNodes(): Node[]
    {
        const panel = this.panelNode();
        if (panel == null) return [];

        const winNode = panel.getChildByName("win_node");
        const failNode = panel.getChildByName("fail_node");

        const owner = (winNode != null && winNode.active) ? winNode
                    : ((failNode != null && failNode.active) ? failNode : null);
        if (owner == null) return [];

        const result: Node[] = [];
        const children = owner.children;
        for (let i = 0; i < children.length; i++)
        {
            const child = children[i];
            if (!child.active) continue;
            if (child.getComponent(Button) == null) continue;
            result.push(child);
        }
        return result;
    }

    private buttonNode(variantName: string, buttonName: string): Node
    {
        const panel = this.panelNode();
        if (panel == null) return null;
        const variant = panel.getChildByName(variantName);
        return variant != null ? variant.getChildByName(buttonName) : null;
    }

    private titleLabel(): Label
    {
        const panel = this.panelNode();
        if (panel == null) return null;
        const titlebg = panel.getChildByName("titlebg");
        const textNode = titlebg != null ? titlebg.getChildByName("Text") : null;
        return textNode != null ? textNode.getComponent(Label) : null;
    }

    private captureDefaults()
    {
        const panel = this.panelNode();
        if (panel == null) return;

        const winNode = panel.getChildByName("win_node");
        this._winDefaultActive = winNode != null ? winNode.active : true;

        const label = this.titleLabel();
        this._defaultTitle = label != null ? label.string : "";
    }

    private resetVariant()
    {
        const panel = this.panelNode();
        if (panel == null) return;

        if (this._winDefaultActive != null)
        {
            const winNode = panel.getChildByName("win_node");
            const failNode = panel.getChildByName("fail_node");
            if (winNode != null) winNode.active = this._winDefaultActive;
            if (failNode != null) failNode.active = !this._winDefaultActive;
        }

        if (this._defaultTitle != null)
        {
            const label = this.titleLabel();
            if (label != null) label.string = this._defaultTitle;
        }
    }
}
