import { sys } from 'cc';
import { Log } from '../../../Mono/Module/Log/Log';
import { AdsErrorKind, IAdsBridge, IAdsShowObserver } from './IAdsBridge';

/**
 * 原生 SDK 的接缝 —— 对应原码里的 `Usdk` 静态类。
 *
 * 原码直接 `Usdk.Subscribe(...)` / `Usdk.CallService(...)`，那是个宿主注入的全局对象。
 * DogSave 里没有，所以这里把同样的三个能力抽成接口，由宿主在
 * `AdsManager.instance.init()` **之前** 用 `AdsBridgeNative.setNativeSdk(...)` 注入。
 * 没注入 ⇒ `available` 为 `false`，`AdsManager` 会自动退到别的 bridge。
 *
 * 事件 / 服务的名字、以及消息体格式都照抄原码，方便和原生侧对齐。
 */
export interface INativeAdsSdk
{
    /** 订阅原生事件 */
    subscribe(event: string, handler: (msg: string) => void): void;
    /** 退订 */
    unsubscribe(event: string, handler: (msg: string) => void): void;
    /** 调原生服务，`json` 是参数（`AdsParam` 的 JSON） */
    callService(serviceName: string, json: string): void;
}

/** 原生回包。对应原码 `RetMsg`。 */
interface INativeRetMsg
{
    statusCode: number;
    data: string;
    message: string;
}

/** 回包里的 `data` 反序列化之后。对应原码 `DataInMsg`。 */
interface INativeDataInMsg
{
    advertising_type: string;
    advertising_id: string;
    method_name: string;
}

/**
 * 原生（Android / iOS）激励视频 —— `AdsController.cs` 里 `#if !UNITY_WEBGL && !WECHAT_MINI`
 * 那半边的 TS 版。
 *
 * ⚠️ 原码把「加载状态字典 / 回调字典 / 30 秒兜底」和「SDK 调用」写在同一个类里。
 *    这里只搬 SDK 那一层：状态机在 `AdsManager`。所以本文件里**没有** 30 秒兜底 ——
 *    它是平台无关的状态机逻辑，放在 manager 里两个平台共用。
 */
export class AdsBridgeNative implements IAdsBridge
{
    // 事件名 / 服务名，照抄原码
    private static readonly EVT_ADD_AD: string = "Advertising_addAdCallback";
    private static readonly EVT_SHOW_AD: string = "Advertising_showAdCallback";
    private static readonly SVC_ADD_AD: string = "Advertising_addAd";
    private static readonly SVC_SHOW_AD: string = "Advertising_showAd";

    /**
     * 原码 `private readonly string placements = "[\"SLOT_IOS-3622001\"]";`
     * ⚠️ 注意它本身**是一个 JSON 字符串**（值是字符串，不是数组），原样照抄。
     */
    private static readonly PLACEMENTS: string = "[\"SLOT_IOS-3622001\"]";

    /** 原生 SDK 的 `method_name` 取值 */
    private static readonly METHOD_EARNED: string = "onEarnedReward";
    private static readonly METHOD_CLOSED: string = "onAdClosed";

    private static _sdk: INativeAdsSdk = null;

    /** 注入原生 SDK。必须在 `AdsManager.instance.init()` 之前调用。 */
    public static setNativeSdk(sdk: INativeAdsSdk): void
    {
        AdsBridgeNative._sdk = sdk;
    }

    public static get nativeSdk(): INativeAdsSdk
    {
        return AdsBridgeNative._sdk;
    }

    public readonly name: string = "native";

    public get available(): boolean
    {
        return AdsBridgeNative._sdk != null;
    }

    /**
     * 广告位 id。对应原码 `AdsIdList` 上的 `#if UNITY_IOS`。
     * ⚠️ 原码里 iOS 和 Android 用的是**不同的广告位 id**，别混。
     */
    public get unitIds(): readonly string[]
    {
        if (sys.os === sys.OS.IOS)
        {
            return [
                "ca-app-pub-1022820009422209/3968130160",
                "ca-app-pub-1022820009422209/9122138512",
            ];
        }
        return [
            "ca-app-pub-1022820009422209/7350682416",
            "ca-app-pub-1022820009422209/6416160681",
        ];
    }

    /** 加载结果往哪报（`AdsManager._load` 传进来的回调），按广告位分 */
    private readonly _loadCallbacks: Map<string, (ok: boolean, kind: AdsErrorKind, rawCode: number) => void> =
        new Map<string, (ok: boolean, kind: AdsErrorKind, rawCode: number) => void>();

    /** 播放事件的**路由表**：原生回包只带 `advertising_id`，得靠它找回 observer */
    private readonly _observers: Map<string, IAdsShowObserver> = new Map<string, IAdsShowObserver>();

    // 存下绑定过的函数引用 —— 退订时必须是同一个引用，否则退不掉
    private _boundAddAd: (msg: string) => void = null;
    private _boundShowAd: (msg: string) => void = null;

    public init(): void
    {
        const sdk = AdsBridgeNative._sdk;
        if (sdk == null) return;

        this._boundAddAd = (msg: string) => this._onAddAdResult(msg);
        this._boundShowAd = (msg: string) => this._onShowAdResult(msg);
        sdk.subscribe(AdsBridgeNative.EVT_ADD_AD, this._boundAddAd);
        sdk.subscribe(AdsBridgeNative.EVT_SHOW_AD, this._boundShowAd);
    }

    public destroy(): void
    {
        const sdk = AdsBridgeNative._sdk;
        if (sdk != null)
        {
            if (this._boundAddAd != null) sdk.unsubscribe(AdsBridgeNative.EVT_ADD_AD, this._boundAddAd);
            if (this._boundShowAd != null) sdk.unsubscribe(AdsBridgeNative.EVT_SHOW_AD, this._boundShowAd);
        }
        this._boundAddAd = null;
        this._boundShowAd = null;
        this._loadCallbacks.clear();
        this._observers.clear();
    }

    public load(unitId: string, onDone: (ok: boolean, kind: AdsErrorKind, rawCode: number) => void): void
    {
        const sdk = AdsBridgeNative._sdk;
        if (sdk == null)
        {
            onDone(false, AdsErrorKind.Other, 0);
            return;
        }

        this._loadCallbacks.set(unitId, onDone);
        sdk.callService(AdsBridgeNative.SVC_ADD_AD, this._buildParamJson(unitId, ""));
    }

    public show(unitId: string, buttonId: string, observer: IAdsShowObserver): void
    {
        const sdk = AdsBridgeNative._sdk;
        if (sdk == null)
        {
            observer.onClosed(false);
            return;
        }

        this._observers.set(unitId, observer);
        sdk.callService(AdsBridgeNative.SVC_SHOW_AD, this._buildParamJson(unitId, buttonId));
    }

    // ═══════════════════════════════════════════════════════════════════

    /**
     * 构造 `AdsParam` 的 JSON。对应原码 `AdsCallService`：
     *
     *     var param = ReferencePool.Acquire&lt;AdsParam&gt;();
     *     param.advertising_id = adsId;
     *     param.advertising_type = "reward";
     *     param.button_id = buttonId;
     *     param.placements = placements;
     *     Usdk.CallService(serviceName, DHUtility.Json.ToJson(param));
     *
     * 原码用 `ReferencePool` 只是为了少产生垃圾；TS 里直接构造字面量即可，
     * 序列化出来的字段完全一致。
     */
    private _buildParamJson(unitId: string, buttonId: string): string
    {
        return JSON.stringify({
            advertising_type: "reward",
            advertising_id: unitId,
            button_id: buttonId,
            placements: AdsBridgeNative.PLACEMENTS,
        });
    }

    /** 加载回调。对应原码 `OnAddAdResult`。 */
    private _onAddAdResult(msg: string): void
    {
        Log.debug(`[Ads][native] OnAddAdResult: ${msg}`);

        let unitId: string = "";
        try
        {
            const ret: INativeRetMsg = JSON.parse(msg);
            const data: INativeDataInMsg = JSON.parse(ret?.data ?? "{}");
            unitId = data?.advertising_id ?? "";

            const ok: boolean = ret?.statusCode === 0;
            const done = this._loadCallbacks.get(unitId);
            this._loadCallbacks.delete(unitId);
            done?.(ok, ok ? AdsErrorKind.None : AdsErrorKind.Other, ret?.statusCode ?? -1);
        }
        catch (e)
        {
            // 原码这里 `adsStatusDic.Clear()` —— 回包解析不了说明格式不对，
            // 把状态全清掉、下次重新加载，免得拿着脏状态一路误判。这里清回调表。
            this._loadCallbacks.clear();
            Log.error(`[Ads][native] OnAddAdResult ${(e as Error).message}\n${(e as Error).stack}`);
        }
    }

    /**
     * 播放回调。对应原码 `OnShowAdResult` —— 两个 `method_name` 分支。
     *
     * ⚠️ 这里**只做路由**：把 `onEarnedReward` / `onAdClosed` 翻成 observer 的两个方法。
     *    原码在这一层做的「30 秒兜底」「删回调字典」都归 `AdsManager` 管
     *    （见 `AdsManager._onAdClosed`），两个平台共用一套。
     */
    private _onShowAdResult(msg: string): void
    {
        Log.debug(`[Ads][native] OnShowAdResult: ${msg}`);

        try
        {
            const ret: INativeRetMsg = JSON.parse(msg);
            const data: INativeDataInMsg = JSON.parse(ret?.data ?? "{}");
            const unitId: string = data?.advertising_id ?? "";
            const methodName: string = data?.method_name ?? "";

            const observer = this._observers.get(unitId);
            if (observer == null) return;          // 不是我们在等的那次播放，忽略

            if (ret?.statusCode !== 0)
            {
                // 播放失败：原码直接走 `OnShowAdsFinish`（不发奖励）。这里翻成"关掉了"。
                this._observers.delete(unitId);
                observer.onClosed(false);
                return;
            }

            if (methodName === AdsBridgeNative.METHOD_EARNED)
            {
                // ⚠️ 这里**不删** `_observers`：后面还会来一条 `onAdClosed`，
                //    而 manager 要靠它收尾（隐藏遮罩 + 补货）。原码同理 ——
                //    它删的是"奖励回调"那一份，不是这条路由。
                observer.onEarnedReward();
            }
            else if (methodName === AdsBridgeNative.METHOD_CLOSED)
            {
                this._observers.delete(unitId);
                observer.onClosed(true);
            }
        }
        catch (e)
        {
            // 原码这个 catch 里做了 `netWaittingUI.Close()` + `adsShowCallbackDic.Clear()`。
            // 这里把还在等的播放全部收尾（等价的清理），再把错误报出来。
            Log.error(`[Ads][native] OnShowAdResult ${(e as Error).message}\n${(e as Error).stack}`);

            const pending = Array.from(this._observers.values());
            this._observers.clear();
            for (const observer of pending)
            {
                observer.onClosed(false);
            }
        }
    }
}
