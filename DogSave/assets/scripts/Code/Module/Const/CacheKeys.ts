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
}