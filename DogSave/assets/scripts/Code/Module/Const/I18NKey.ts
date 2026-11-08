export enum I18NKey
{
    Global_Unknow = 0,
    Btn_Enter_Game = 1,
    Btn_Create_Role = 2,
    Global_Btn_Confirm = 3,
    Global_Btn_Cancel = 4,
    Global_Btn_Back = 5,
    Global_Btn_Login = 6,
    Global_Btn_Register = 7,
    Text_Enter_Account = 8,
    Text_Enter_Psw = 9,
    Text_Name_Not_Null = 10,
    Text_Choose_Role = 11,
    Text_Create_Role_Suc = 12,
    Text_Enter_Nick = 13,
    Btn_Out_Stuck = 14,
    Btn_Quit_Game = 15,
    Btn_Reture_Login = 16,
    Text_Quit_Game = 17,
    Btn_Exit = 18,
    Text_Normal_Attack = 19,
    Notice_Login_By_Others = 20,
    Notice_Link_Close = 21,
    Update_Get_Fail = 22,
    Update_ReTry = 23,
    Update_Download_Fail = 24,
    Update_Info = 25,
    Update_White = 26,
    Update_ReDownload = 27,
    Update_SuDownload = 28,
    Global_AutoPlay = 29,
    Global_QuickPlay = 30,
    Global_Record = 31,
    GalGame_Stop = 32,
    RoleName_Unknow = 33,
    Update_Skip = 34,
    Help_Info = 35,
    Help_Test = 36,
    Help_Setting = 37,
    Btn_Enter_Map = 38,
    Intee_Chest = 39,
    Login_Notice = 40,
    Net_Error = 41,
    Global_Fail_ReTry = 42,
    Login_Text_Account = 43,
    Login_Text_Psd = 44,
    Login_Text_Send = 45,
    Login_Text_CodeLogin = 46,
    Login_Text_Code = 47,
    Login_Text_Phone = 48,
    Login_Text_PswLogin = 49,
    Login_Text_LoginFail = 50,
    Login_Text_LoginSuccess = 51,

    // -----------------------------------------------------------------------
    // 玩法文案（52 起）。⚠️ 只允许在**末尾追加**，不要改已有 id ——
    // 配置表是按 id 取值的，改号等于把旧文本换到别的 key 上。
    // -----------------------------------------------------------------------

    /** "第{0}关" / "Level {0}" */
    Game_Level_Format = 52,
    /** "{0}秒" / "{0}s" */
    Game_Time_Format = 53,
    /** 关卡底部操作提示 */
    Game_Tips_Match = 54,
    /** 顶部关卡牌：每日挑战模式 */
    Game_Mode_Daily = 55,
    /** 顶部关卡牌：拼图模式 */
    Game_Mode_Puzzle = 56,

    /** 大门：每日挑战卡片标题 */
    Gate_Card_Daily = 57,
    /** 大门：拼图活动卡片标题 */
    Gate_Card_Puzzle = 58,
    /** 大门：今日任务胶囊 */
    Gate_Pill_Today = 59,
    /** 大门：开始 */
    Gate_Btn_Start = 60,
    /** 大门：参与 */
    Gate_Btn_Join = 61,
    /** 大门：开始游戏 */
    Gate_Btn_Play = 62,
    /** 大门：商店占位提示 */
    Gate_Toast_Shop = 63,

    /** 日历："{0}年{1}月" / "{1}/{0}" */
    Calendar_Month_Format = 64,
    Calendar_Week_Sun = 65,
    Calendar_Week_Mon = 66,
    Calendar_Week_Tue = 67,
    Calendar_Week_Wed = 68,
    Calendar_Week_Thu = 69,
    Calendar_Week_Fri = 70,
    Calendar_Week_Sat = 71,
    /** 日历：没选日期就点开始 */
    Calendar_Toast_Select = 72,
    /** 日历：这天已经做过 */
    Calendar_Toast_Done = 73,
    /** 日历：还没到这天 */
    Calendar_Toast_Future = 74,

    /** 设置：标题 */
    Setting_Title = 75,
    Setting_Music = 76,
    Setting_Sound = 77,
    Setting_Vibrate = 78,
    Setting_Hint = 79,
    Setting_Language = 80,
    Setting_Save = 81,
    Setting_Contact = 82,
    Setting_Privacy = 83,
    Setting_Terms = 84,
    /** 设置：二级页还没做 */
    Setting_Toast_ComingSoon = 85,
    /** 设置：切语言后的提示，"{0}" = 语言名 */
    Setting_Lang_Switched = 86,

    /** 结算：标题（过关）—— 目前标题行显示的是关卡号，这两个是给美术字替换/后续文案用的 */
    Result_Title_Win = 87,
    Result_Title_Fail = 88,

    /** 广告 */
    Ads_NotReady = 89,
    Ads_NoFill = 90,
    Ads_PlayFail = 91,

    /** 热更新弹窗。⚠️ 「重试」「跳过」直接用表里已有的 `Update_ReTry`(23) / `Update_Skip`(34) */
    Update_Exit = 92,
    Update_EnterGame = 93,
    Update_NeedRedownload = 94,
    Update_NewVersion = 95,
    Update_Confirm = 96,
    Update_Fail = 97,
    /** "发现 {0} 个资源包需要更新，是否立即下载？" */
    Update_BundleAsk = 98,
}
