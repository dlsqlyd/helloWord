import { Button, Label, Node } from "cc";
import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnDisable } from "../../../Module/UI/IOnDisable";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { UIManager } from "../../../Module/UI/UIManager";
import { CacheManager } from "../../../Module/Player/CacheManager";
import { CacheKeys } from "../../../Module/Const/CacheKeys";
import { GameDataManager } from "../../GameDataManager";
import { UISettingView } from "../UISetting/UISettingView";
import { UICalendarView } from "../UICalendar/UICalendarView";
import { UIGameMainView } from "../UIGameMain/UIGameMainView";
import { UIToast } from "../UICommon/UIToast";

// ---------------------------------------------------------------------------
// 大门界面（Home / Gate）
// ---------------------------------------------------------------------------
// 版式来自效果图（1080x1920），预制体由 `uigate_src/gen_prefab.py` 生成，
// 结构校验 + 离线渲染见 `uigate_src/preview_prefab.py`，量测口径见 `uigate_src/build_assets.py` 文件头。
//
// ## 和结算界面 / 设置界面的结构差别（动手改之前先看这段）
//
//   结算界面：**弹窗**，根下两个同名 bg（整屏遮罩 + 小底板），靠 win_node/fail_node 让
//             PopupAnim 认出底板。
//   设置界面：整屏页，根下 `mask` + `panel`，两个名字正好命中 PopupAnim 的默认判据。
//   本界面：  **整屏页**，根下 `bg` + `content` —— 而且这里**故意不挂 PopupAnim**。
//
//   ⚠️ 名字是 `bg` 而不是 `mask`：一旦以后给本界面加 PopupAnim，它的"名字判据"会先命中
//      `bg`（dimNames 里就有 bg），于是**整屏底色被当成底板**去缩放，内容反而不动。
//      真要加弹出动画，先把 `bg` 改名（例如 `dim`），再传 dim/panel 显式指定。
//
// ## 入口
//
//   ⚠️ 本界面**目前不是**启动页。`LoginScene.onSwitchSceneEnd()` 里打开的仍然是
//      `UIGameMainView`。要把大门当主页，把那一行换成：
//          await UIManager.instance.openWindow(UIGateView, UIGateView.PrefabPath);
//      这是**导航改动**（谁先出现、结算完回到哪），不是纯粹的换皮，所以没有擅自改。
//
// ## 哪些按钮是真接通的
//
//   齿轮         -> 设置界面（UISettingView，真接通）
//   开始游戏     -> 关卡界面（UIGameMainView，真接通；不关大门，关卡关掉后回到这里）
//   加号         -> 商店：**工程里没有商店**，弹提示
//   开始(红卡)   -> 日历界面（UICalendarView，真接通；日历的返回键回到大门）
//   参与(黄卡)   -> 拼图活动：**系统不存在**，弹提示
//
//   金币数字读 CacheKeys.Coin（缺省 0，工程里还没有钱包）；"0/9" 没有数据源，
//   预制体里是静态文本，等有拼图系统了调 `setPuzzleProgress()` 即可。
export class GateProgress
{
    public done: number = 0;
    public total: number = 9;
}

@UIView("UIGateView")
export class UIGateView extends UIBaseView implements IOnCreate, IOnEnable, IOnDisable
{
    public static readonly PrefabPath: string = "ui/uigate/prefabs/uiGateView";

    /** 预制体里的节点路径。改预制体要同步改这里（路径错了会静默失效，只留一条 Log） */
    private static readonly PATH_COIN: string = "content/coin_bar/Text";
    private static readonly PATH_LEVEL: string = "content/pill_level/Text";
    private static readonly PATH_PROGRESS: string = "content/card_puzzle/pill_prog/Text";

    private static readonly PATH_BTN_GEAR: string = "content/gear";
    private static readonly PATH_BTN_PLUS: string = "content/coin_bar/btn_plus";
    private static readonly PATH_BTN_START: string = "content/card_daily/btn_start";
    private static readonly PATH_BTN_JOIN: string = "content/card_puzzle/btn_join";
    private static readonly PATH_BTN_PLAY: string = "content/btn_play";

    private _coinLabel: Label = null;
    private _levelLabel: Label = null;
    private _progressLabel: Label = null;

    private _progress: GateProgress = new GateProgress();

    /** 按钮 + 各自的回调。onDisable 要用同一份引用摘监听，所以存起来而不是现场 new */
    private _buttons: Button[] = null;
    private _handlers: (() => void)[] = null;

    /** 「开始游戏」要开一次关卡界面。双击不能开两个，用一个标志挡住 */
    private _openingGame: boolean = false;

    public getConstructor()
    {
        return UIGateView;
    }

    public onCreate()
    {
        this._coinLabel = this.findLabel(UIGateView.PATH_COIN);
        this._levelLabel = this.findLabel(UIGateView.PATH_LEVEL);
        this._progressLabel = this.findLabel(UIGateView.PATH_PROGRESS);

        this._buttons = [
            this.findButton(UIGateView.PATH_BTN_GEAR),
            this.findButton(UIGateView.PATH_BTN_PLUS),
            this.findButton(UIGateView.PATH_BTN_START),
            this.findButton(UIGateView.PATH_BTN_JOIN),
            this.findButton(UIGateView.PATH_BTN_PLAY),
        ];
        this._handlers = [
            () => this.onClickGear(),
            () => this.onClickShop(),
            () => this.onClickDaily(),
            () => this.onClickPuzzle(),
            () => this.onClickPlay(),
        ];
    }

    public onEnable()
    {
        this._openingGame = false;

        // 先刷数据再挂按钮：反过来的话，刷新期间玩家点一下会读到上一关的关卡号
        this.refreshLevel();
        this.refreshCoin();
        this.refreshProgress();

        this.bindButtons();
    }

    public onDisable()
    {
        this.unbindButtons();
        this._openingGame = false;
    }

    // -----------------------------------------------------------------------
    // 对外
    // -----------------------------------------------------------------------

    /**
     * 刷新金币。钱包还没有，所以现在只会读到缺省值 0；
     * 预制体里写死的 520 是效果图示例值，进游戏就被这行覆盖。
     */
    public refreshCoin(): void
    {
        if (this._coinLabel == null) return;
        this._coinLabel.string = `${CacheManager.instance.getInt(CacheKeys.Coin, 0)}`;
    }

    /** 关卡号。格式和 GameMainObj 里的一致：`第N关` */
    public refreshLevel(): void
    {
        if (this._levelLabel == null) return;
        this._levelLabel.string = `第${GameDataManager.instance.curFightLevelId}关`;
    }

    /**
     * 拼图进度。拼图活动系统还不存在，这里只是留好接口，
     * 免得以后有数据了还要回来改预制体。
     */
    public setPuzzleProgress(done: number, total: number): void
    {
        this._progress.done = Math.max(0, Math.floor(done));
        this._progress.total = Math.max(0, Math.floor(total));
        this.refreshProgress();
    }

    public refreshProgress(): void
    {
        if (this._progressLabel == null) return;
        this._progressLabel.string = `${this._progress.done}/${this._progress.total}`;
    }

    // -----------------------------------------------------------------------
    // 按钮
    // -----------------------------------------------------------------------

    private bindButtons()
    {
        this.unbindButtons();
        for (let i = 0; i < this._buttons.length; i++)
        {
            const btn = this._buttons[i];
            if (btn == null) continue;
            btn.node.on(Button.EventType.CLICK, this._handlers[i], this);
        }
    }

    private unbindButtons()
    {
        if (this._buttons == null) return;
        for (let i = 0; i < this._buttons.length; i++)
        {
            const btn = this._buttons[i];
            if (btn == null) continue;
            btn.node.off(Button.EventType.CLICK, this._handlers[i], this);
        }
    }

    private onClickGear(): void
    {
        // 设置界面是**弹窗**，会叠在大门上面；关掉它就回到大门，不用管这里
        UIManager.instance.openWindow(UISettingView, UISettingView.PrefabPath);
    }

    private onClickShop(): void
    {
        // 工程里没有商店，也没有钱包 —— 别让按钮点了没反应
        UIToast.showToast("商店还没做");
    }

    private onClickDaily(): void
    {
        // 每日挑战**日历**已经做好了（UICalendarView），所以这里真的打开它。
        // 但"每日挑战"这套**玩法**仍然不存在：没有每日任务表、没有次数、没有领奖，
        // 日历里点「开始今日挑战」走的是普通关卡。
        // ⚠️ 不想让大门的这张卡通向日历的话，把下面这行换回
        //    `UIToast.showToast("每日挑战还没做");` 即可，就一行。
        UIManager.instance.openWindow(UICalendarView, UICalendarView.PrefabPath);
    }

    private onClickPuzzle(): void
    {
        // 拼图活动系统不存在（"0/9" 是效果图里的静态数字）
        UIToast.showToast("拼图活动还没做");
    }

    private async onClickPlay(): Promise<void>
    {
        if (this._openingGame) return;
        this._openingGame = true;
        try
        {
            // ⚠️ 不关大门：关卡界面关掉之后要能回到这里。
            //    如果以后关卡界面改成"关掉即退出到登录"，这里要跟着改。
            await UIManager.instance.openWindow(UIGameMainView, UIGameMainView.PrefabPath);
            GameDataManager.instance.OnResultButton(false);
        }
        finally
        {
            this._openingGame = false;
        }
    }

    // -----------------------------------------------------------------------
    // 解析
    // -----------------------------------------------------------------------

    /**
     * 按路径取节点。
     *
     * ⚠️ 这里**不用** `addComponent<UIText>(UIText, "path")` 那一套：
     *    路径解析失败时它只打一条 Log，然后返回 null，界面看起来就是"文字永远是效果图里那个值"。
     *    自己取 + 显式判空，至少能在改预制体时立刻发现。
     */
    private findNode(path: string): Node
    {
        if (this.node == null) return null;
        const n = this.node.getChildByPath(path);
        if (n == null)
        {
            console.warn(`[UIGateView] 找不到节点: ${path}（预制体改过层级？）`);
        }
        return n;
    }

    private findLabel(path: string): Label
    {
        const n = this.findNode(path);
        return n != null ? n.getComponent(Label) : null;
    }

    private findButton(path: string): Button
    {
        const n = this.findNode(path);
        return n != null ? n.getComponent(Button) : null;
    }
}
