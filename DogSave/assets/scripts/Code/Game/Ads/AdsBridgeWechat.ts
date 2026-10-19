import { Log } from '../../../Mono/Module/Log/Log';
import { TimeInfo } from '../../../Mono/Module/Timer/TimeInfo';
import { AdsErrorKind, IAdsBridge, IAdsShowObserver } from './IAdsBridge';

/**
 * 微信小游戏（`wx.createRewardedVideoAd`）—— `AdsController.Wechat.cs` 的 TS 版。
 *
 * 工程里没有 WeChatWASM 的类型声明，所以 `wx` 走 `globalThis` + `any`：
 * 这样**在非微信环境下这个文件也能正常编译**，只是 `available` 为 `false`。
 *
 * ⚠️ 与原码的**结构差异**（有意的）：原码 `ShowRewardAdsForWechat` 自己又写了一遍
 *    "轮转广告位 + 依次尝试"的循环，和 `AdsController.cs` 里那份是重复的两套。
 *    这里把循环统一收进 `AdsManager`，本文件只负责"加载一个广告位"和"播一个广告位"。
 */
export class AdsBridgeWechat implements IAdsBridge
{
    /** 微信 `OnError` 里"当前没有合适的广告"的错误码（原码 `case 1004`） */
    private static readonly ERR_NO_FILL: number = 1004;

    public readonly name: string = "wechat";

    public readonly available: boolean =
        AdsBridgeWechat.wx() != null
        && typeof AdsBridgeWechat.wx().createRewardedVideoAd === "function";

    /** 原码 `AdsController.Wechat.cs` 里的那份 `AdsIdList`（`adunit-xxx`） */
    public readonly unitIds: readonly string[] = [
        "adunit-3e553a21e89f7922",
        "adunit-ccf3235a390c7f56",
    ];

    /**
     * 小游戏侧广告数据上报。
     * 原码：`GameCenter.MrAdapter.UploadAdData(showingAdId, status, startTime, endTime)`，
     * 只在 `Mr_MiNi` 宏下编译。DogSave 里没有 ⇒ 默认空实现。
     */
    public onUploadAdData: (unitId: string, status: number, startTime: number, endTime: number) => void = null;

    /** 正在播的广告位（原码 `showingAdId`） */
    private _showingUnitId: string = "";
    /** 开播时刻（原码 `startTime = GameUtils.GetClientUTCTime()`） */
    private _startTime: number = 0;

    private readonly _cache: Map<string, IWechatRewardCache> = new Map<string, IWechatRewardCache>();

    /** 取微信全局对象。非微信环境返回 null。 */
    private static wx(): any
    {
        const g: any = globalThis as any;
        return g != null && g.wx != null ? g.wx : null;
    }

    public init(): void
    {
        if (!this.available) return;

        // 原码 `InitForWechat()`：非编辑器下把每个广告位都预创建一遍。
        // 微信的激励视频组件创建后会自动拉一次广告，用户关掉广告后它也会自己去拉下一条。
        for (const unitId of this.unitIds)
        {
            this._createRewardVideoAd(unitId);
        }
    }

    public destroy(): void
    {
        // 原码 `ClearForWechat()` 只做 `adsStatusDic.Clear()`；
        // 微信的广告组件没有显式销毁接口，清引用即可。
        this._cache.clear();
        this._showingUnitId = "";
    }

    public load(unitId: string, onDone: (ok: boolean, kind: AdsErrorKind, rawCode: number) => void): void
    {
        if (!this.available)
        {
            onDone(false, AdsErrorKind.Other, 0);
            return;
        }

        let item = this._cache.get(unitId);
        if (item == null)
        {
            item = this._createRewardVideoAd(unitId);
            if (item == null)
            {
                onDone(false, AdsErrorKind.Other, 0);
                return;
            }
        }

        // 已经就绪就直接报成功，不用白等一次 OnLoad 回调
        if (item.ready)
        {
            onDone(true, AdsErrorKind.None, 0);
            return;
        }

        item.onLoadDone = onDone;
        item.ad?.Load?.();
    }

    public show(unitId: string, buttonId: string, observer: IAdsShowObserver): void
    {
        const item = this._cache.get(unitId);
        if (item == null || item.ad == null)
        {
            // 兜底：没有组件就没法播。直接按"没看完"收尾，免得 observer 永远悬着。
            Log.warning(`[Ads][wechat] ${unitId} 没有对应的广告组件，无法播放`);
            observer.onClosed(false);
            return;
        }

        // ⚠️ `buttonId`（激励点位）在微信侧**用不上** —— 原码的微信分支压根没把它传给 SDK。
        //    原生分支会放进 `AdsParam.button_id`。这里保持原样。
        item.observer = observer;
        this._showingUnitId = unitId;
        this._startTime = TimeInfo.instance.clientNow();

        item.ad.Show?.();
    }

    // ═══════════════════════════════════════════════════════════════════

    /** 创建（或取回）一个激励视频组件。对应原码 `CreateRewardVideoAd`。 */
    private _createRewardVideoAd(unitId: string): IWechatRewardCache
    {
        if (!this.available) return null;

        const existing = this._cache.get(unitId);
        if (existing != null) return existing;

        const wx: any = AdsBridgeWechat.wx();
        // `multiton: true` = 同一个 adUnitId 可以创建多个实例（原码同）
        const ad: any = wx.createRewardedVideoAd({ adUnitId: unitId, multiton: true });
        if (ad == null) return null;

        const item: IWechatRewardCache = { ad, ready: false, observer: null, onLoadDone: null };
        this._cache.set(unitId, item);

        ad.OnLoad?.((res: any) =>
        {
            Log.debug(`[Ads][wechat] onLoad callbackId:${res?.callbackId} unitId:${unitId}`);
            item.ready = true;

            const done = item.onLoadDone;
            item.onLoadDone = null;
            done?.(true, AdsErrorKind.None, 0);
        });

        ad.OnError?.((res: any) =>
        {
            const errCode: number = res?.errCode ?? 0;
            Log.debug(`[Ads][wechat] OnError errCode:${errCode} callbackId:${res?.callbackId} unitId:${unitId}`);

            // 出错就标记未就绪，下次 load 会重新拉（原码同）
            item.ready = false;

            const kind: AdsErrorKind = errCode === AdsBridgeWechat.ERR_NO_FILL
                ? AdsErrorKind.NoFill
                : AdsErrorKind.Other;

            const done = item.onLoadDone;
            item.onLoadDone = null;
            done?.(false, kind, errCode);

            // ⚠️ 有意的偏离：原码这里**不结束**播放流程（既不调奖励回调、也不收尾），
            //    于是"播放中途出错"会让那条回调永远挂着 —— 连 30 秒兜底都等不到，
            //    因为 `onClosed` 根本不会来。这里补一次 `onClosed(false)` 把流程收干净。
            if (this._showingUnitId === unitId && item.observer != null)
            {
                const observer = item.observer;
                item.observer = null;
                observer.onClosed(false);
            }

            if (this._showingUnitId === unitId)
            {
                this._uploadAdData(0);
            }
        });

        ad.OnClose?.((res: any) =>
        {
            const isEnded: boolean = res?.isEnded === true;
            Log.debug(`[Ads][wechat] OnClose callbackId:${res?.callbackId} unitId:${unitId} isEnded:${isEnded}`);

            // 微信只有一个 `OnClose(isEnded)`，在这里拆成"发奖励"和"收尾"两个事件，
            // 对应原生 SDK 的 `onEarnedReward` / `onAdClosed`。
            const observer = item.observer;
            item.observer = null;

            if (observer != null)
            {
                if (isEnded)
                {
                    // ⚠️ 原码只在 `isEnded` 时才把 `Ready` 置回 false。提前关掉的话
                    //    `Ready` 保持 true（组件随后会自己去拉下一条）。保持原样。
                    item.ready = false;
                    observer.onEarnedReward();
                }
                observer.onClosed(isEnded);
            }

            if (this._showingUnitId === unitId)
            {
                this._uploadAdData(isEnded ? 1 : 0);
            }
        });

        return item;
    }

    /** 对应原码 `UploadAdData`：上报一次（可能没有实现），然后把 `showingAdId` 清空。 */
    private _uploadAdData(status: number): void
    {
        this.onUploadAdData?.(
            this._showingUnitId,
            status,
            this._startTime,
            TimeInfo.instance.clientNow(),
        );
        this._showingUnitId = "";
    }
}

/** 一个广告位的缓存项（对应原码的 `CacheRewardItem`） */
interface IWechatRewardCache
{
    /** `wx.createRewardedVideoAd(...)` 返回的组件 */
    ad: any;
    /** 是否已加载好、可以播（原码 `Ready`） */
    ready: boolean;
    /** 这一次播放的观察者。组件是复用的，所以回调挂在缓存项上 */
    observer: IAdsShowObserver | null;
    /** 加载结果往哪报（`AdsManager._load` 传进来的回调） */
    onLoadDone: ((ok: boolean, kind: AdsErrorKind, rawCode: number) => void) | null;
}
