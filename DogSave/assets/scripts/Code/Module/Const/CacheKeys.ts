export class CacheKeys{
    public static readonly CurLangType = "CurLangType";

    public static readonly MusicVolume = "MusicVolume";
    public static readonly SoundVolume = "SoundVolume";

    /**
     * 设置界面的两个开关。0 = 关，1 = 开，缺省按 1（开）。
     *
     * ⚠️ 目前**没有消费方**：工程里既没有震动 API，也没有"提示"功能。
     * 设置界面只负责把玩家意愿存下来（见 UISettingView.writeToggle），
     * 真正用到的时候直接读这两个 key 即可，不用再改界面。
     */
    public static readonly Vibrate = "Vibrate";
    public static readonly Hint = "Hint";

    /**
     * 金币余额（大门界面左上角那个"520"）。
     *
     * ⚠️ 工程里**还没有钱包**：没有任何地方加币/扣币，也没有商店。
     * 大门界面只负责"读出来显示"，缺省 0。等真有钱包时直接往这个 key 里写即可，
     * 界面不用改。预制体里写死的 520 只是效果图的示例值，运行时会立刻被覆盖。
     */
    public static readonly Coin = "Coin";

    /**
     * 每日挑战里"已经完成"的日期，逗号分隔的 `yyyy-MM-dd`，例如
     * `2026-11-01,2026-11-03`。
     *
     * ⚠️ 写入方**只有一个**：`GameDataManager.MarkDailyDone()`（在 `FinishLevel`
     * 里，日历模式打赢时调）。读取方是 `GameDataManager.LoadDailyProgress()`
     * （打开日历界面时解析一次），界面通过 `GetDailyDone()` 拿内存副本渲染。
     * 别让界面自己读写这个 key —— 之前界面也 parse 一份，两边互相覆盖。
     */
    public static readonly DailyDone = "DailyDone";

    /**
     * 拼图活动里**已经解锁**的碎片下标，逗号分隔、升序，例如 `0,3,7`。
     * 空串 / 缺省 = 一片都没解锁（**不是**全部解锁）。
     *
     * 写入方：`GameDataManager.UnlockPuzzlePiece()`（过关时随机挑一片还没解锁的）。
     * 读取方：`UIPuzzleView`（画 16 个格子的锁定/解锁）、`UIGateView`（大门拼图卡的 n/16）。
     * 解析/序列化/随机挑片在 `Game/UI/UIPuzzle/PuzzleProgress.ts` 里，**不 import cc**，
     * 可以离线跑断言（`uipuzzle_src/test_puzzle_progress.js`）。
     *
     * ⚠️ 格式不要改成位掩码：16 片没问题，但以后扩到 32 片以上就要动 BigInt，
     *    而存档已经在玩家手机上了，改格式要做迁移。
     */
    public static readonly PuzzleUnlocked = "PuzzleUnlocked";
}