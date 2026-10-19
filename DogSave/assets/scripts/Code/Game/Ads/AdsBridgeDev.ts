import { AdsErrorKind, IAdsBridge, IAdsShowObserver } from './IAdsBridge';

/**
 * 编辑器 / 预览用的假 bridge：**不播广告，直接当"看完了"**。
 *
 * 对应原码 `#if UNITY_EDITOR` 那一支（`rewardCallback?.Invoke()`）。
 *
 * ⚠️ 与原码的差别：原码在编辑器里是**绕过** `adsShowCallbackDic` 直接调回调的；
 *    这里走正常的 observer 回调。好处是 `AdsManager` 的状态机（加载状态、回调字典、
 *    30 秒兜底、收尾补货）在编辑器里也会被真正执行一遍 —— 而不是"编辑器全绿、
 *    真机上才炸"。这是有意的，见 `AdsManager` 类注释第 3 条。
 */
export class AdsBridgeDev implements IAdsBridge
{
    public readonly name: string = "dev";

    /** 永远可用：编辑器里就该直接给奖励，不然没法测玩法 */
    public readonly available: boolean = true;

    /**
     * 占位广告位。留一个是为了让 `AdsManager.showRewardAds()` 的轮转循环能跑起来 ——
     * 一个广告位都没有的话循环体一次都不进，会走到"所有广告位都没准备好"那条路上去。
     */
    public readonly unitIds: readonly string[] = ["__dev__"];

    public init(): void
    {
        // 没有 SDK 要初始化
    }

    public destroy(): void
    {
        // 没有资源要释放
    }

    public load(unitId: string, onDone: (ok: boolean, kind: AdsErrorKind, rawCode: number) => void): void
    {
        // 同步就绪：玩家点下去立刻有反馈
        onDone(true, AdsErrorKind.None, 0);
    }

    public show(unitId: string, buttonId: string, observer: IAdsShowObserver): void
    {
        // 同步给两个事件，顺序按原生 SDK 的常见顺序：先发奖励，再收尾。
        observer.onEarnedReward();
        observer.onClosed(true);
    }
}
