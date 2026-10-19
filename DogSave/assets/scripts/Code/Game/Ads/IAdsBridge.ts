/**
 * 激励视频广告的 **SDK 接缝**。
 *
 * 为什么要单独抽这一层：原 C# 的 `AdsController` 直接调 `Usdk.CallService(...)`（原生 SDK）
 * 和 `WX.CreateRewardedVideoAd(...)`（微信小游戏），靠 `#if UNITY_WEBGL || WECHAT_MINI`
 * 把两套实现塞进同一个 partial class。
 *
 * TypeScript 没有 `#if`，而且 **DogSave 目前没有接入任何广告 SDK**（全工程搜不到
 * `wx.` / 任何广告桥）。所以把「平台怎么播广告」抽成接口，`AdsManager` 只负责状态机。
 *
 * 三个实现：
 *   · `AdsBridgeDev`    —— 编辑器 / 预览：不播广告，直接当"看完了"（对应原码 `#if UNITY_EDITOR`）
 *   · `AdsBridgeWechat` —— 微信小游戏（对应 `AdsController.Wechat.cs`）
 *   · `AdsBridgeNative` —— 原生 SDK（对应 `Usdk.Subscribe` / `Usdk.CallService` 那条路）
 */

/** 广告位的加载状态（对应原码里的 `enum AdsStatus`）。 */
export enum AdsStatus
{
    /** 没加载过（原码是"字典里没有这个键"，这里显式给一个值，省得再区分 undefined） */
    None = 0,
    /** 加载中 */
    Loading = 1,
    /** 已加载，可以播 */
    Loaded = 2,
}

/**
 * 一次播放的观察者。
 *
 * ⚠️ **两个事件是分开的**，因为原生 SDK 就是分开给的：
 *   · `onEarnedReward` —— 看完了，该发奖励
 *   · `onClosed`       —— 广告关掉了
 *
 * 原码 `OnShowAdResult` 里这两个是两条独立分支，而且**顺序不保证**。`AdsManager`
 * 的 30 秒兜底逻辑（"关了广告但一直没收到 onEarnedReward"）就依赖这个区分，
 * 所以桥接层必须如实翻译，**不要**在 bridge 里合并成一个回调。
 *
 * 微信小游戏只有一个 `OnClose(isEnded)`，由 `AdsBridgeWechat` 负责拆成两个事件：
 *   `isEnded == true`  → `onEarnedReward()` + `onClosed(true)`
 *   `isEnded == false` → `onClosed(false)`
 */
export interface IAdsShowObserver
{
    /** 看到奖励（原生 `onEarnedReward` / 微信 `OnClose(isEnded=true)`） */
    onEarnedReward(): void;
    /**
     * 广告关闭。
     * @param isEnded 是否看完。原生 SDK 的 `onAdClosed` 不带这个信息（发不发奖励由
     *                `onEarnedReward` 决定），那种情况下传 `true`。
     */
    onClosed(isEnded: boolean): void;
}

/** 平台侧的错误码语义。各平台数值不同，这里只区分"没广告可播"和"其它失败"。 */
export enum AdsErrorKind
{
    None = 0,
    /** 当前没有合适的广告（微信 errCode 1004） */
    NoFill = 1,
    /** 其它失败 */
    Other = 2,
}

/** 广告 SDK 的抽象。实现方只需要管"怎么加载、怎么播、把事件翻成 observer 回调"。 */
export interface IAdsBridge
{
    /** 给日志用的人类可读名字 */
    readonly name: string;

    /**
     * 这个平台上这个 bridge 能不能用。
     * `false` ⇒ `AdsManager` 会跳过广告直接发奖励（编辑器 / 预览就该是这样）。
     */
    readonly available: boolean;

    /**
     * 本平台的广告位 id。
     * ⚠️ 原码里 `AdsIdList` 定义了**两份**（`AdsController.cs` 一份原生 id、
     * `AdsController.Wechat.cs` 一份 `adunit-xxx`），所以这里也让 bridge 自己带。
     * `AdsManager` 会把它复制一份当轮转队列，**不会**改到这里来。
     */
    readonly unitIds: readonly string[];

    /** 初始化（原码 `InitController` 里的订阅 / 预创建） */
    init(): void;

    /** 反初始化（原码 `ClearController` 里的退订 / 清缓存） */
    destroy(): void;

    /**
     * 预加载一个广告位。
     * @param onDone 加载结束。`ok=true` 表示可以播了。
     */
    load(unitId: string, onDone: (ok: boolean, kind: AdsErrorKind, rawCode: number) => void): void;

    /**
     * 播放。结果通过 `observer` 回调（可能异步，可能两个事件都来）。
     * 调用方**已经**确认过这个广告位是 `Loaded` 状态，bridge 不用再判断。
     */
    show(unitId: string, buttonId: string, observer: IAdsShowObserver): void;
}
