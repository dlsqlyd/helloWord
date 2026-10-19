import { IManager } from '../../../Mono/Core/Manager/IManager';
import { Log } from '../../../Mono/Module/Log/Log';
import { TimeInfo } from '../../../Mono/Module/Timer/TimeInfo';
import { UIToast } from '../UI/UICommon/UIToast';
import { AdsBridgeDev } from './AdsBridgeDev';
import { AdsBridgeNative } from './AdsBridgeNative';
import { AdsBridgeWechat } from './AdsBridgeWechat';
import { AdsErrorKind, AdsStatus, IAdsBridge, IAdsShowObserver } from './IAdsBridge';

/**
 * 「广告关了但一直没等到 onEarnedReward」的兜底时间。
 * 原码写死 30 秒（`Time.realtimeSinceStartup - beginTime > 30`），这里保持一致。
 */
const REWARD_FALLBACK_TIMEOUT_MS = 30 * 1000;

/**
 * 激励视频广告管理器 —— `AdsController.cs` + `AdsController.Wechat.cs` 的 TypeScript 版。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════
 *
 *     AdsManager.instance.showRewardAds("revive", () => {
 *         // 看完了，发奖励
 *         GameDataManager.instance.ReviveLevel();
 *     });
 *
 * 工程里四处「看广告」的挂点（三处 `onAdsUnlock` 的源码注释里已经写明
 * 「接真广告 SDK 时把 onAdsUnlock() 挪进广告成功的回调」）：
 *   · `UIGameResultView.onRevive()`  —— 结算弹窗的「复活」（`btn_revive`）
 *   · `DoorNode.onAdsUnlock()`       —— 门
 *   · `RoomNode.onAdsUnlock()`       —— 狗窝
 *   · `ChairNode.onAdsUnlock()`      —— 椅子
 *
 * ⚠️ 这四处现在都是**直接**调 `onAdsUnlock()` / `ReviveLevel()`，**没有**过广告。
 *    接上本管理器之后要改成上面那种写法，否则"看广告解锁"仍然只是装饰。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 与原码的差异（都是有意的，逐条记下来）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. **SDK 调用抽成了 `IAdsBridge`**。原码直接调 `Usdk.CallService` / `WX.*`，
 *    用 `#if UNITY_WEBGL || WECHAT_MINI` 分叉；TS 没有 `#if`，而且 DogSave 还没接
 *    任何广告 SDK，所以平台差异收进 bridge。**状态机（加载状态、回调字典、30 秒兜底、
 *    广告位轮转）全部留在这里**，和原码一样。
 *
 * 2. **DH / 业务侧的依赖变成了可选钩子**（见下面「宿主环境接缝」），默认全是空实现 ——
 *    这样本文件在 DogSave 里能直接编译、流程能跑通；接服务端协议 / 月卡时再填。
 *
 * 3. **编辑器里走的是真状态机**。原码 `#if UNITY_EDITOR` 是直接
 *    `rewardCallback?.Invoke()`，绕过了 `adsShowCallbackDic`；这里让 `AdsBridgeDev`
 *    老老实实回调 observer —— 好处是**编辑器里也能把状态机走一遍**（回调字典、
 *    30 秒兜底、加载状态都会被真正执行到），而不是"编辑器里全绿、真机上才炸"。
 *
 * 4. **删字典的时机提前到"调奖励回调之前"**（见 `_tryShow` 里的 observer）。
 *    原码是 `callback?.Invoke(); adsShowCallbackDic.Remove(adsId);` —— 如果奖励回调里
 *    又触发了一次同一个广告位，后一次注册的条目会被前一次的 Remove 误删。先删后调没有
 *    这个洞，且**非重入情况下行为完全一致**。
 *
 * ⚠️ 保留下来、但**值得产品/服务端确认**的原码行为（我没有擅自改）：
 *   · `onReportLookAdStart` 在**免广告特权判断之前**就发出去了 ⇒ 买了月卡的玩家
 *     每次点按钮也会上报一条"要看广告"。
 *   · 30 秒兜底会**直接给奖励**，等于"开广告后立刻关掉、卡满 30 秒"能薅到奖励。
 *   · 所有广告位都没准备好时原码把提示**注释掉了** ⇒ 点了没反应（静默失败）。
 *   · `isOpenAds` 原码恒为 `true`、且只在微信分支被检查（原生分支不检查）。
 *     这里统一检查；因为恒为 true，两种写法行为一致。
 */
export class AdsManager implements IManager
{
    // 提示文案。⚠️ 原码从 `ConfigCenter.GetGlobalString(...)` 取（走 I18N），
    //    DogSave 的 `I18NKey` 表里还没有广告相关的键，先写成明文常量；
    //    要上多语言的话把这三条挪进 `Code/Module/Const/I18NKey.ts` 再改成传 key。
    private static readonly TIP_NOT_READY: string = "广告还没准备好，请稍候再试";
    private static readonly TIP_NO_FILL: string = "无合适的广告";
    private static readonly TIP_PLAY_FAILED: string = "播放广告失败，请稍候再试";

    private static _instance: AdsManager;

    public static get instance(): AdsManager
    {
        return AdsManager._instance;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  宿主环境接缝
    //
    //  原码依赖 DH 框架 / 业务侧的一堆东西，DogSave 里都还没有。
    //  全部做成可选钩子 + 空实现 ⇒ 本文件能独立编译、能跑通，接入时逐个填。
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 免广告特权。
     * 原码：`DataCenter.MonthCardData.ForeverCardIsBuy`（永久卡 / 月卡）。
     * DogSave 还没有月卡系统 ⇒ 恒 `false`。
     */
    public hasAdFreePrivilege: () => boolean = () => false;

    /**
     * 「用户要看广告」的服务端上报。
     * 原码：`PayController.SendLookAd()`（`ShowRewardAds` 第一行就调）。
     */
    public onReportLookAdStart: (buttonId: string) => void = null;

    /**
     * 「广告看完了」的服务端上报。
     * 原码：`PayController.SendLookAdvComplete()`（在奖励回调的包装里调）。
     */
    public onReportLookAdComplete: (buttonId: string) => void = null;

    /**
     * 播放期间的等待遮罩。
     * 原码：`ManagerCenter.UiMgr.netWaittingUI.Show() / Close()`。
     * ⚠️ DogSave 里**没有**对应的 UI —— `UILoadingView` 是整屏加载窗，拿它当广告等待
     *    遮罩会把整个界面盖掉。所以默认不显示；要做的话在这里接一个轻量遮罩。
     */
    public showWaiting: () => void = null;
    public hideWaiting: () => void = null;

    /**
     * 异常上报。原码：`ULogClient.ReportError(LogTag, method, msg)`。
     * 默认只落一条 `Log.error`，接了崩溃/埋点上报之后再覆盖。
     */
    public onErrorReport: (method: string, msg: string) => void = null;

    // ═══════════════════════════════════════════════════════════════════

    /**
     * 总开关（原码 `IsOpenAds`）。
     * ⚠️ 原码里它恒为 `true`（`InitController` 里赋值之后再没人改过），
     *    而且**只有微信分支**检查它。这里统一检查，行为不变。
     */
    public isOpenAds: boolean = true;

    private _bridge: IAdsBridge = null;

    /** 广告位轮转队列。**会被就地轮转**（播过的挪到队尾），和原码 `AdsIdList` 一样 */
    private _unitIds: string[] = [];

    /** 加载状态。只在"加载中 / 已加载"时有键 —— 对应原码 `adsStatusDic` */
    private readonly _status: Map<string, AdsStatus> = new Map<string, AdsStatus>();

    /** 正在等结果的广告位 → 它的 observer —— 对应原码 `adsShowCallbackDic` */
    private readonly _showing: Map<string, IAdsShowObserver> = new Map<string, IAdsShowObserver>();

    /** 正在等结果的广告位 → 开播时刻，给 30 秒兜底用 —— 对应原码 `adsShowTimeDic` */
    private readonly _showStartAt: Map<string, number> = new Map<string, number>();

    /** 原码 `LogTag = "ad"` */
    private readonly _logTag: string = "ad";

    // ═══════════════════════════════════════════════════════════════════
    //  IManager
    // ═══════════════════════════════════════════════════════════════════

    public init(): void
    {
        AdsManager._instance = this;
        this.isOpenAds = true;

        this._bridge = AdsManager._createBridge();
        this._unitIds = this._bridge.unitIds.slice();
        this._status.clear();
        this._showing.clear();
        this._showStartAt.clear();

        this._bridge.init();
        Log.debug(`[Ads] 初始化：bridge=${this._bridge.name} 可用=${this._bridge.available} 广告位=${this._unitIds.length} 个`);

        // 原码把预加载单独暴露成 `InitLoadRewardAds()`，由登录/入口流程调。
        // DogSave 里没有那个调用点，所以在 init 里直接预加载一次。
        this.preloadAll();
    }

    public destroy(): void
    {
        this._bridge?.destroy();
        this._status.clear();
        this._showing.clear();
        this._showStartAt.clear();
        this._unitIds.length = 0;
        AdsManager._instance = null;
    }

    /**
     * 按平台挑 bridge。顺序即优先级。
     * 前两个都不可用时退到 `AdsBridgeDev`（编辑器 / 预览：不播广告直接给奖励）。
     */
    private static _createBridge(): IAdsBridge
    {
        const wechat = new AdsBridgeWechat();
        if (wechat.available) return wechat;

        const native = new AdsBridgeNative();
        if (native.available) return native;

        return new AdsBridgeDev();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  对外
    // ═══════════════════════════════════════════════════════════════════

    /** 预加载全部广告位（原码 `InitLoadRewardAds`） */
    public preloadAll(): void
    {
        for (const unitId of this._unitIds)
        {
            this._load(unitId);
        }
    }

    /**
     * 展示激励视频广告；看完了调 `rewardCallback`。
     * 对应原码 `AdsController.ShowRewardAds(string buttonId, Action rewardCallback)`。
     *
     * @param buttonId 激励点位（自定义字符串，原样透传给 SDK / 服务端）
     * @param rewardCallback 看完之后的发奖励回调。**没看完不会调**。
     */
    public showRewardAds(buttonId: string, rewardCallback: () => void): void
    {
        // ⚠️ 原码第一行就是 `SendLookAd()` —— 在免广告判断**之前**。
        //    保持原样（见类注释里那条"值得确认"）。
        this.onReportLookAdStart?.(buttonId);

        // 免广告特权：不发广告，直接给奖励（原码同）
        if (this.hasAdFreePrivilege())
        {
            rewardCallback?.();
            return;
        }

        if (!this.isOpenAds)
        {
            rewardCallback?.();
            return;
        }

        if (this._bridge == null || !this._bridge.available)
        {
            Log.warning("[Ads] 没有可用的广告 SDK，直接发奖励");
            rewardCallback?.();
            return;
        }

        // 奖励回调的包装：先上报"看完了"，再发奖励（原码里的 `cb`）
        const cb = () =>
        {
            this.onReportLookAdComplete?.(buttonId);
            rewardCallback?.();
        };

        // 轮转广告位：对每个依次尝试，播出去一个就结束。
        // `_unitIds[0]` 取完立刻挪到队尾 —— 和原码的 RemoveAt(0) + Add 一致，
        // 效果是"这一轮从上次停下的地方接着试"，不会一直卡在第一个广告位。
        const count = this._unitIds.length;
        for (let i = 0; i < count; ++i)
        {
            const unitId = this._unitIds[0];
            this._unitIds.shift();
            this._unitIds.push(unitId);

            if (this._tryShow(unitId, buttonId, cb))
            {
                return;                       // 已经播出去了，结果稍后回调
            }
        }

        // 一个都没播出来。⚠️ 原码在这里把 toast **注释掉了** ⇒ 静默失败（点了没反应）。
        //    保持原样，把该说的话留在原地：想恢复提示，打开下面这行即可。
        // UIToast.showToast(AdsManager.TIP_NOT_READY);
        Log.warning("[Ads] 所有广告位都没准备好，本次没有播放广告");
    }

    /** 当前有几个广告位处于"可以播"的状态。给调试/兜底 UI 用。 */
    public get readyCount(): number
    {
        let n = 0;
        for (const s of this._status.values())
        {
            if (s === AdsStatus.Loaded) n++;
        }
        return n;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  内部：加载 / 播放 / 收尾
    // ═══════════════════════════════════════════════════════════════════

    /** 预加载一个广告位。对应原码 `LoadRewardAds`。 */
    private _load(unitId: string): void
    {
        if (this._bridge == null || !this._bridge.available) return;

        if (this._status.has(unitId))
        {
            Log.debug(`[Ads] ${unitId} 正在加载中，跳过`);
            return;
        }

        Log.debug(`[Ads] 开始加载 ${unitId}`);
        this._status.set(unitId, AdsStatus.Loading);

        this._bridge.load(unitId, (ok: boolean, kind: AdsErrorKind, rawCode: number) =>
        {
            if (ok)
            {
                this._status.set(unitId, AdsStatus.Loaded);
                return;
            }

            this._status.delete(unitId);

            // 失败提示。对应微信侧 `OnError` 的两个分支（1004 → "无合适的广告"）。
            // ⚠️ 原码在**后台预加载失败**时也会弹这个 toast（例如刚进游戏、玩家还没点
            //    任何按钮）。保持原样，但这是接 SDK 之后第一个该盯的观感问题。
            if (kind === AdsErrorKind.NoFill)
            {
                this._toast(AdsManager.TIP_NO_FILL);
            }
            else
            {
                this._toast(`${AdsManager.TIP_PLAY_FAILED} 错误码: ${rawCode}`);
            }
            Log.debug(`[Ads] ${unitId} 加载失败 kind=${kind} rawCode=${rawCode}`);
        });
    }

    /**
     * 尝试播一个广告位。
     * @returns `true` = 已经播出去了（结果稍后经 observer 回调）；
     *          `false` = 这个广告位没准备好，调用方继续试下一个。
     *
     * 对应原码 `private bool ShowRewardAds(adsId, buttonId, rewardCallback)`。
     */
    private _tryShow(unitId: string, buttonId: string, cb: () => void): boolean
    {
        Log.debug(`[Ads] 尝试播放 ${unitId}`);

        if (this._status.get(unitId) !== AdsStatus.Loaded)
        {
            // 没加载好：提示 + 补一次加载 + 让调用方换下一个广告位（原码同）
            this._toast(AdsManager.TIP_NOT_READY);
            this._load(unitId);
            return false;
        }

        this._status.delete(unitId);
        this.showWaiting?.();

        // ⚠️ 先删后调（见类注释第 4 条）：奖励回调里万一又触发同一个广告位，
        //    不会把新注册的 observer 误删掉。
        const observer: IAdsShowObserver = {
            onEarnedReward: () =>
            {
                this._showing.delete(unitId);
                cb();
            },
            onClosed: (_isEnded: boolean) =>
            {
                this._onAdClosed(unitId);
            },
        };

        this._showing.set(unitId, observer);
        this._showStartAt.set(unitId, TimeInfo.instance.clientNow());

        this._bridge.show(unitId, buttonId, observer);
        return true;
    }

    /**
     * 广告关闭。对应原码 `OnShowAdResult` 的 `onAdClosed` 分支 + `OnShowAdsFinish`。
     *
     * 这里的 30 秒兜底是原码最"有性格"的一段：广告都关了却一直没等到
     * `onEarnedReward`，原码选择**手动发奖励**，只补一条错误上报。
     * 保持原样 —— 这是"宁可多发、不可少发"的取舍，不是笔误。
     */
    private _onAdClosed(unitId: string): void
    {
        const observer = this._showing.get(unitId);
        const startAt = this._showStartAt.get(unitId);

        if (observer != null && startAt != null
            && TimeInfo.instance.clientNow() - startAt > REWARD_FALLBACK_TIMEOUT_MS)
        {
            const msg = `[Ads] ${unitId} 超过 ${REWARD_FALLBACK_TIMEOUT_MS / 1000} 秒没有收到 onEarnedReward，手动给奖励`;
            Log.debug(msg);
            observer.onEarnedReward();
            this._reportError("OnShowAdResult", msg);
        }

        this._finishShow(unitId);
    }

    /** 一次播放彻底收尾。对应原码 `OnShowAdsFinish`。 */
    private _finishShow(unitId: string): void
    {
        this.hideWaiting?.();
        this._showing.delete(unitId);
        this._showStartAt.delete(unitId);

        // 立刻补货，下一次点按钮就能播（原码同）
        this._load(unitId);
    }

    // ═══════════════════════════════════════════════════════════════════

    /** 弹提示。包一层 try/catch：广告流程可能在 UI 还没起来的时候跑，不该把整个流程带崩。 */
    private _toast(text: string): void
    {
        try
        {
            UIToast.showToast(text);
        }
        catch (e)
        {
            Log.warning(`[Ads] 弹提示失败（UI 还没准备好？）：${text}`);
        }
    }

    /** 异常上报。默认落 `Log.error`，对应原码 `ULogClient.ReportError`。 */
    private _reportError(method: string, msg: string): void
    {
        if (this.onErrorReport != null)
        {
            this.onErrorReport(method, msg);
            return;
        }
        Log.error(`[Ads] ${this._logTag} ${method} ${msg}`);
    }
}
