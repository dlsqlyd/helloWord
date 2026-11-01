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
}