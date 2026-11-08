import { sys } from "cc";
import { IManager } from "../../../Mono/Core/Manager/IManager"
import { Event } from "../../../Mono/Core/Object/Event";
import { I18NBridge } from "../../../Mono/Module/I18N/I18NBridge";
import { Log } from "../../../Mono/Module/Log/Log";
import { CacheKeys } from "../Const/CacheKeys";
import { LangType } from "../Const/LangType";
import { CacheManager } from "../Player/CacheManager";
import { I18NKey } from "../Const/I18NKey";
import { II18N } from "./II18N";
import * as string from "../../../Mono/Helper/StringHelper"
import { ConfigManager } from "../Config/ConfigManager";
import { I18NConfig, I18NConfigCategory } from "./I18NConfigCategory";
import { JsonHelper } from "../../../Mono/Helper/JsonHelper";
export class I18NManager implements IManager {

    private static _instance: I18NManager;

    public static get instance(): I18NManager {
        return I18NManager._instance;
    }

    public onLanguageChangeEvt: Event = new Event();

    private _curLangType: LangType;
    public get curLangType():LangType{
        return this._curLangType;
    }

    private _i18nTextKeyDic: Map<number, string>
    private _addFonts: boolean

    /**
     * 文案表加载完成的信号。
     *
     * ⚠️ `init()` 里的 `initAsync()` 是**不 await** 的（要等 `config` bundle 加载完）。
     * 界面可能比它先 onEnable —— 那时字典还是空的，按 key 取文本只会拿到 key 本身。
     * 需要"一开界面就是对的"的地方（启动首个界面、语言切换后）先 await 这个。
     * 同时 initAsync 结束时也会广播一次语言变更事件，让已经订阅的 Label 自己补一次。
     */
    private _ready: Promise<void> = null;
    private _markReady: () => void = null;
    public get Ready(): Promise<void> {
        return this._ready;
    }

    public init() {
        I18NManager._instance = this;

        this._ready = new Promise<void>((resolve) => { this._markReady = resolve; });

        var lang = CacheManager.instance.getInt(CacheKeys.CurLangType, -1);
        if (lang < 0)
        {
            this._curLangType = I18NManager.detectLangType();
        }
        else
        {
            this._curLangType = lang;
        }
        I18NBridge.instance.getValueByKey = this.i18NGetText.bind(this);
        this._i18nTextKeyDic = new Map<number, string>();
        this.initAsync();
    }

    /**
     * 按设备语言决定初始语言。
     *
     * ⚠️ 不能写 `sys.language == "zh"`：各平台给的值不一样（`zh` / `zh-Hans` / `zh_CN` /
     * `zh-Hant` 都见过），全等判断会让安卓中文机掉进英文。按前缀 `zh` 认，
     * 其余语言（ja / ko / fr …）一律回落到英文 —— 目前只出了中英两套。
     */
    private static detectLangType(): LangType
    {
        const code = String(sys.language || "").toLowerCase();
        return code.indexOf("zh") === 0 ? LangType.Chinese : LangType.English;
    }
    public destroy() {
        this.onLanguageChangeEvt.clear();
        I18NManager._instance = null;
        this._i18nTextKeyDic.clear();
        this._i18nTextKeyDic = null;
    }

    private async initAsync()
    {
        JsonHelper.registerClass(I18NConfigCategory,'I18NConfigCategory');
        JsonHelper.registerClass(I18NConfig,'I18NConfig');
        var res = await ConfigManager.instance.loadOneConfig(I18NConfigCategory,LangType[this.curLangType]);

        if (res == null)
        {
            Log.error("[I18N] 文案表加载失败: " + LangType[this.curLangType]);
        }
        else
        {
            for (let i = 0; i <res.getAllList().length; i++)
            {
                var item = res.getAllList()[i];
                this._i18nTextKeyDic.set(item.id, item.value);
            }
        }

        // 先 resolve 再广播：等 Ready 的地方拿到的就是填好的字典
        if (this._markReady != null)
        {
            this._markReady();
            this._markReady = null;
        }

        // 界面可能已经 onEnable 过了（那时字典是空的），补一次刷新
        I18NBridge.instance.onLanguageChangeEvt?.emit();
        this.onLanguageChangeEvt?.emit();
    }

    /** 取文本。等价于 i18NGetText，写法短一点 */
    public t(key: string | I18NKey | number): string
    {
        return this.i18NGetText(key);
    }

    /** 取带参数的文本，如 t("Game_Level_Format", 3) -> "第3关" */
    public tf(key: string | I18NKey | number, ...paras: any[]): string
    {
        return this.i18NGetParamText(key, ...paras);
    }

    /**
     * 根据key取多语言取不到返回key
     * @param key 
     * @returns 
     */
    public i18NGetText(key: string| I18NKey| number): string
    {
        let i18nKey: number;
        if(typeof key != "number") {
            i18nKey = I18NKey[key as keyof typeof I18NKey] as number;
        } else {
            i18nKey = key
        }
        if (!!i18nKey)
        {
            const result = this._i18nTextKeyDic.get(i18nKey);
            if(!!result)
            {
                return result;
            }
        }
        Log.error("多语言key未添加！ " + key);
        if(typeof key == "string") {
            return key;
        } else {
            return String(key);
        }
    }

    /**
     * 根据key取带参数多语言取不到返回key
     * @param key 
     * @param paras 
     * @returns 
     */
    public i18NGetParamText(key: string| I18NKey| number, ...paras: any[]){
        let i18nKey: number;
        if(typeof key != "number") {
            i18nKey = I18NKey[key as keyof typeof I18NKey] as number;
        } else {
            i18nKey = key
        }
        
        if (!!i18nKey)
        {
            const result = this._i18nTextKeyDic.get(i18nKey);
            if(!!result)
            {
                return string.format(result, ...paras);
            }
        }
        Log.error("多语言key未添加！ " + key);
        if(typeof key == "string") {
            return key;
        } else {
            return String(key);
        }
    }

    /**
     * 切换语言,外部接口
     * @param langType 
     */
    public async switchLanguage(langType: number|LangType)
    {
        const next = langType as LangType;
        if (next === this._curLangType && this._i18nTextKeyDic.size > 0)
        {
            return;
        }

        // ⚠️ 先加载到**临时字典**再整体替换：直接 clear() 会让加载期间所有 Label
        //    取不到值、短暂显示成 key 名（一次网络/磁盘慢就能看见闪一下）。
        var res = await ConfigManager.instance.loadOneConfig(I18NConfigCategory, LangType[next]);
        if (res == null)
        {
            Log.error("[I18N] 切换语言失败，保持原语言: " + LangType[next]);
            return;
        }

        const dict = new Map<number, string>();
        for (let i = 0; i < res.getAllList().length; i++)
        {
            const item = res.getAllList()[i];
            dict.set(item.id, item.value);
        }

        this._i18nTextKeyDic = dict;
        this._curLangType = next;
        CacheManager.instance.setInt(CacheKeys.CurLangType, next);

        I18NBridge.instance.onLanguageChangeEvt?.emit();
        this.onLanguageChangeEvt?.emit();
    }

    /** 旧名字，保留兼容（typo）。新代码用 switchLanguage */
    public wwitchLanguage(langType: number|LangType)
    {
        return this.switchLanguage(langType);
    }

    /** 当前语言是否中文 */
    public get isChinese(): boolean
    {
        return this._curLangType === LangType.Chinese;
    }

    /** 取"另一种语言"，用于设置界面的语言开关 */
    public get otherLangType(): LangType
    {
        return this._curLangType === LangType.Chinese ? LangType.English : LangType.Chinese;
    }

    public registerI18NEntity(entity: II18N)
    {
        this.onLanguageChangeEvt.subscribe(entity.onLanguageChange, entity);
    }

    public removeI18NEntity(entity: II18N)
    {
        this.onLanguageChangeEvt.unsubscribe(entity.onLanguageChange, entity);
    }
}