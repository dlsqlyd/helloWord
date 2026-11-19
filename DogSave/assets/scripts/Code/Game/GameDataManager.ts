import { Camera, find, Mat4, Node, UITransform, Vec3, _decorator, view, Vec2, Layers, game } from 'cc';
import { IManager } from "../../Mono/Core/Manager/IManager"
import { JsonType } from '../../Mono/Helper/JsonHelper';
import { DateItem } from './UI/UIMain/DateItem';
import { CacheManager } from '../Module/Player/CacheManager';
import { CacheKeys } from '../Module/Const/CacheKeys';
import { ConfigManager } from '../Module/Config/ConfigManager';
import { Log } from '../../Mono/Module/Log/Log';
import { GameMainObj } from './UI/UIGameMain/GameMainObj';
import { ready } from '../../../../extensions/taowu-editor/source/panel';
import { RoomNode, RoomState } from './UI/UIGameMain/RoomNode';
import { DogColor, DOG_SFX_SAD } from './UI/UIGameMain/DogNode';
import { SoundManager } from '../Module/Resource/SoundManager';
import { UIManager } from '../Module/UI/UIManager';
import { ResultPara, UIGameResultView } from './UI/UIGameMain/UIGameResultView';
import { PuzzleProgress } from './UI/UIPuzzle/PuzzleProgress';
import { CalendarMath, DailyMarkResult, DayState } from './UI/UICalendar/CalendarMath';
import { I18NKey } from '../Module/Const/I18NKey';
import { I18NManager } from '../Module/I18N/I18NManager';

// 坐标转换用的临时矩阵。这两个函数在飞行动画里会逐帧调用，
// 每次 new Mat4 会白白产生垃圾，所以复用。
const _matWorld: Mat4 = new Mat4();
const _matInv: Mat4 = new Mat4();


@JsonType("LevelDatas")
class LevelDatas {
    public data: LevelConfig[];
    public endInit()
    {
                    
    }
}

@JsonType("LevelConfig")
export class LevelConfig {
    /** Id*/
    public id: number;
    /** 时间*/
    public time: number;
    /** 椅子*/
    public chairs: LevelChairData[];
   
}

@JsonType("LevelChairData")
export class LevelChairData {
    public dogs: number[];
    /**
     * 与 `dogs` 等长的槽位标记（冰晶玩法，见 `SlotFlag`）。
     *
     * ⚠️ 关卡表里**没有**这个字段 —— 它是运行时生成的，读出来是 undefined，
     * 所以所有读的地方都要走 `GetSlotFlag()`（内部按 Normal 兜底），别直接下标。
     */
    public flags: number[];
}

/**
 * 槽位标记。冰晶玩法（第 5 关起）用它区分"普通 / 被冻住 / 抱着锤子"三种狗。
 *
 * 为什么挂在**槽位**上而不是挂在颜色上：同一颜色可能有好几只狗，而"被冻住的是哪一只"
 * 是有意义的（同一根椅子上其它同色狗还能动）。反过来，锤子会跟着狗在椅子之间搬来搬去，
 * 所以标记必须跟着槽位一起搬（见 ChangeChairDogColor）。
 */
export enum SlotFlag
{
    Normal = 0,
    /** 被冰晶封住：不能移动、不能被消除、所在椅子不能飞向卡车 */
    Crystal = 1,
    /** 抱着锤子：锤子颜色 = 与它配对的那只冰晶狗的颜色 */
    Hammer = 2,
}

/** 一对「冰晶狗 + 抱锤子的狗」。颜色在两对之间保证互不相同。 */
export class CrystalPair
{
    public crystalChair: number = -1;
    public crystalSlot: number = -1;
    /** 被冻住那只狗的颜色 —— 也就是**锤子的颜色** */
    public crystalColor: number = 0;
    /** 抱锤子那只狗自己的颜色（必然 ≠ crystalColor） */
    public holderColor: number = 0;
    public broken: boolean = false;
}

/**
 * 一关的进行状态。
 *
 * 只有 `Playing` 期间才倒计时、才接受点击 —— 结算弹窗弹出来之后盘面必须冻住，
 * 否则玩家还能继续搬狗，搬完又会触发一次过关判定（弹窗叠弹窗）。
 */
export enum LevelState
{
    /** 还没开始（或已经结算完关掉了） */
    None,
    /** 进行中 */
    Playing,
    /** 已过关，等玩家选「下一关 / 重玩」 */
    Win,
    /** 已超时，等玩家选「重玩」 */
    Lose,
}

// 枚举定义
export enum BattleMode {
    Main, //主线模式
    Calendar, //日历模式
    Puzzle, //拼图模式
}

export enum ItemID {
    RefreshLevelItem = 1, //刷新道具
    AddTimeItem = 2,//时间道具
}

export class GameDataManager implements IManager {
    private static _instance: GameDataManager;
    private datas: LevelDatas;
    private leveldict: Map<number, LevelConfig>
    public curFightLevelId:number = 1;
    public curSelectChairIdx:number = -1;
    public curSelectRoomIdx:number = -1;
    public curLevelConfig:LevelConfig;
    public gameMainObj:GameMainObj;
    public isCanClick:boolean = true;
    public itemdict: Map<number, number> = new Map<number, number>();

    /**
     * 上一次过关解锁的拼图碎片下标，-1 = 没有（没赢 / 已经集满 / 已经被取走）。
     *
     * 只是一个"刚刚发生了什么"的提示位，**不是**存档 —— 存档在
     * `CacheKeys.PuzzleUnlocked` 里，由 `UnlockPuzzlePiece()` 写。
     * 拼图界面打开时把它当 `UIPuzzlePara.highlight` 传进去弹一下，取完置 -1。
     */
    public lastUnlockedPiece:number = -1;


    // ---------------------------------------------------------------- 关卡流程
    /** 本关剩余秒数。归零算失败（关卡表的 time 字段，见 level_tools/level_rules.py） */
    public curTime: number = 0;
    /** 本关状态。见 LevelState */
    public levelState: LevelState = LevelState.None;
    public gameMode:BattleMode = BattleMode.Main;
    /**
     * 开局时盘面上到底有没有狗。
     * 用来挡住「空关卡一铺完盘就立刻判定过关」这个退化情况 ——
     * IsBoardClear() 对空盘面恒为 true，不记这一笔的话空关卡会秒过。
     */
    private _levelHasDogs: boolean = false;
    public curSelectDate:Date;

    // ---------------------------------------------------------------- 冰晶玩法
    /** 从第几关开始出现冰晶 / 锤子（想调整玩法登场节奏改这里） */
    public static readonly CRYSTAL_START_LEVEL: number = 5;

    /** 本关的配对。每关开局由 `GenerateCrystalPairs()` 重算 */
    public crystalPairs: CrystalPair[] = [];

    /**
     * 抱着锤子的狗被停进狗窝时，锤子跟着进窝。
     *
     * key = 狗窝序号（1 基），value = **抱锤子那只狗自己的颜色**（不是锤子颜色）。
     * 从窝里再搬回椅子时按它把标记放回去（见 SetSelectChairId）。
     *
     * ⚠️ 必须是 Map 而不是单个 int：一关最多 3 对 ⇒ 最多 3 只抱锤子的狗，
     * 它们完全可能先后被停进**不同**的狗窝。原先用 `hammerInRoomId: number` 只记得住
     * 最后一个，前面那只的锤子会在窝里凭空消失、而且再也搬不回去（那一对直接死锁）。
     */
    public hammerInRoom: Map<number, number> = new Map<number, number>();


    public static get instance(): GameDataManager {
        return GameDataManager._instance;
    }


    public resolution: Vec2
   

    public async init() {
        GameDataManager._instance = this;
        this.SetItemNum(ItemID.RefreshLevelItem, 1);
        this.SetItemNum(ItemID.AddTimeItem, 1);
        // Messager.Instance.AddListener<int, int>(0, MessageId.OnKeyInput, OnKeyInput);
    }

    public GetItemNum(itemid:number):number
    {
        if (this.itemdict.has(itemid))
            return this.itemdict.get(itemid);
        return 0;
    }

    public SetItemNum(itemid:number, num:number)
    {
        this.itemdict.set(itemid, num);
    }

    public AddItemNum(itemid:number, num:number)
    {
        if (this.itemdict.has(itemid))
            this.itemdict.set(itemid, this.GetItemNum(itemid) + num);
    }


    public async SetGameMode(mode:BattleMode)
    {
        this.gameMode = mode;
        // 只有日历模式才有"选中日期"这回事。切到别的模式必须清掉，
        // 否则上一次在日历里选的日期会一直挂着，下次进日历前就被当成"当前挑战日"。
        if (mode != BattleMode.Calendar)
            this.curSelectDate = null;
        await this.LoadLevelConfig();
         if (this.gameMode == BattleMode.Calendar || this.gameMode == BattleMode.Puzzle)
        {
            // 日历 / 拼图模式从"后半段"里随机抽一关（前 99 关留给主线推进）。
            // ⚠️ 原来写的是 `num + 99`（num = 1..100）⇒ 上界只到 199，
            //    关卡表扩到 200 之后第 200 关**永远抽不到**。
            //    现在按表长算上界，表再扩也不用改这里。
            const minId = 100;
            const maxId = Math.max(minId, this.datas.data.length);
            this.curFightLevelId = minId + Math.floor(Math.random() * (maxId - minId + 1));
        }
        else
            this.curFightLevelId = CacheManager.instance.getInt("FightLevelId", 1);
        // 夹到合法区间。上界这条原来就有；下界是新加的 ——
        // 存档被改坏（0 / 负数）时 GetLevelCfgById 会返回 undefined，
        // 紧接着 CloneLevelCfg 读 oldCfg.id 直接崩。
        if (this.curFightLevelId < 1)
            this.curFightLevelId = 1;
        if (this.curFightLevelId > this.datas.data.length)
            this.curFightLevelId = this.datas.data.length;
        let cfg2:LevelConfig = this.GetLevelCfgById(this.curFightLevelId);
        this.curLevelConfig = this.CloneLevelCfg(cfg2);
    }

    public async LoadLevelConfig()
    {
        if (GameDataManager._instance == null)
            return;
        if (this.leveldict == null)
        {
            this.datas = await ConfigManager.instance.get<LevelDatas>(LevelDatas,"levels");
            this.leveldict = new Map<number, LevelConfig>();
            for (let i = 0; i <  this.datas.data.length; i++)
            {
                let data = this.datas.data[i];
                this.leveldict.set(data.id, data);
            }
        }
        // 进度从缓存读，没有存档就从第 1 关开始。
        //
        // 原先这里是 `this.curFightLevelId = 56;` 且把读取**注释掉了**，
        // 于是「进度只写不读」：SetLevelCfgById() 每关都把关卡号写进缓存，
        // 重启却永远回到第 56 关，1–55 关根本走不到。
        //
        // 这里读缓存是安全的：CacheManager 在 Entry.ts:41 注册、比本管理器(:83)早，
        // 且 ManagerProvider.registerManager 会**同步**调 init()（见那里第 47 行），
        // 所以走到这一行时 CacheManager._instance 一定已经建好了。
        //
        // ⚠️ 调试时想固定从某一关起，把下面这行换成： this.curFightLevelId = 56;
       
    }

    private CloneLevelCfg(oldCfg:LevelConfig):LevelConfig
    {
        let newCfg:LevelConfig = new LevelConfig();
        newCfg.id = oldCfg.id;
        newCfg.time = oldCfg.time;
        newCfg.chairs = new Array<LevelChairData>(oldCfg.chairs.length);
        for (let i = 0; i < oldCfg.chairs.length; i++)
        {
           
            let newChair:LevelChairData = new LevelChairData();
            let oldChair:LevelChairData = oldCfg.chairs[i];
            newChair.dogs = new Array<number>(oldChair.dogs.length);
            for (let i = 0; i < oldChair.dogs.length; i++)
            {
                newChair.dogs[i] = oldChair.dogs[i];
            }
            // 槽位标记也要一份独立副本：关卡表里没有这个字段（undefined），
            // 那就先建成全 0，后面 GenerateCrystalPairs 直接往上写。
            newChair.flags = new Array<number>(oldChair.dogs.length);
            for (let i = 0; i < oldChair.dogs.length; i++)
            {
                newChair.flags[i] = oldChair.flags != null ? (oldChair.flags[i] || 0) : SlotFlag.Normal;
            }
            newCfg.chairs[i] = newChair;
        }
        return newCfg;
    }

    public destroy() {
        // Messager.Instance.RemoveListener<int, int>(0, MessageId.OnKeyInput, OnKeyInput);
        GameDataManager._instance = null;
        this.leveldict.clear();
        this.leveldict = null;
        this.onDestroyAsync();
    }

    private async onDestroyAsync() {
        Log.info("UIManagerComponent Destroy");
    }

    public GetLevelCfgById(levelId:number):LevelConfig
    {
        this.LoadLevelConfig();
        let cfg = this.leveldict.get(levelId)
        return cfg;
    }

    public SetLevelCfgById(levelId:number)
    {
        this.curFightLevelId = levelId;
        if (this.curFightLevelId > this.datas.data.length)
            this.curFightLevelId = this.datas.data.length;
        this.curLevelConfig = this.CloneLevelCfg(GameDataManager.instance.GetLevelCfgById(this.curFightLevelId));
        // 写的是**夹过之后**的 curFightLevelId，不是入参 levelId。
        // 在最后一关点「下一关」时入参是 101，原先会把 101 存进缓存 —— 存的是个不存在的关卡号。
        if (this.gameMode == BattleMode.Main)
            CacheManager.instance.setInt("FightLevelId", this.curFightLevelId)
        if (this.gameMainObj != null)
            this.gameMainObj.start();
    }

    // ---------------------------------------------------------------- 关卡流程
    //
    // 一关的生命周期：
    //   GameMainObj.start() 铺完盘 -> StartLevel() -> 每帧 TickLevel()
    //   -> 盘面清空(IsBoardClear) 或 倒计时归零 -> FinishLevel() -> 弹结算框
    //   -> 玩家点按钮 -> OnResultButton() -> SetLevelCfgById() -> 回到 start()
    //
    // 过关判定为什么挂在 CheckDogFlyToCar 的"扫完没得飞"这一步：
    //   狗是"同色聚满一根椅子 -> 飞向卡车 -> 椅子清空"这样一波波走的，
    //   整个级联走完的标志就是"这一轮扫下来没有任何椅子能起飞"。
    //   那一刻盘面若已全空，就是过关。不需要另开定时器去轮询。

    /** 开一关：重置倒计时与选中态。GameMainObj.start() 里调（每次铺盘都会走一遍） */
    public StartLevel(): void
    {
        this.curTime = this.curLevelConfig != null ? this.curLevelConfig.time : 0;
        this.curSelectChairIdx = -1;
        this.curSelectRoomIdx = -1;
        this._levelHasDogs = !this.IsBoardClear();
        this.levelState = LevelState.Playing;
    }

    // ---------------------------------------------------------------- 冰晶玩法
    //
    // 一关的配对是**开局随机**的（不是关卡表里写死的），规则：
    //   · 从第 CRYSTAL_START_LEVEL 关开始才生成；
    //   · 盘面颜色总数 ≥3 / ≥5 / ≥7 时，分别随机 0~1 / 1~2 / 2~3 对；
    //   · 每一对 = 一只被冰晶盖住的狗 + 一只抱锤子的狗：
    //       锤子颜色 == 冰晶狗的颜色，而抱锤子那只狗**自己的颜色 ≠ 冰晶狗的颜色**；
    //   · 所有对之间颜色互不重复（两两取色，天然不撞）；
    //   · 两只狗**不能在同一根椅子上** —— 同一根椅子被冰晶挡住飞不了，
    //     抱锤子那只就永远等不到"被消除"，这一对会死锁。

    public GetSlotFlag(chairIdx: number, slotIdx: number): number
    {
        let cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null || chairIdx < 0 || chairIdx >= cfg.chairs.length) return SlotFlag.Normal;
        let chair: LevelChairData = cfg.chairs[chairIdx];
        if (chair == null || chair.flags == null) return SlotFlag.Normal;
        return chair.flags[slotIdx] || SlotFlag.Normal;
    }

    public SetSlotFlag(chairIdx: number, slotIdx: number, flag: number): void
    {
        let cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null || chairIdx < 0 || chairIdx >= cfg.chairs.length) return;
        let chair: LevelChairData = cfg.chairs[chairIdx];
        if (chair == null) return;
        if (chair.flags == null)
        {
            chair.flags = new Array<number>(chair.dogs.length);
            for (let i = 0; i < chair.flags.length; i++) chair.flags[i] = SlotFlag.Normal;
        }
        chair.flags[slotIdx] = flag;
    }

    public IsSlotCrystal(chairIdx: number, slotIdx: number): boolean
    {
        return this.GetSlotFlag(chairIdx, slotIdx) == SlotFlag.Crystal;
    }

    public IsSlotHammer(chairIdx: number, slotIdx: number): boolean
    {
        return this.GetSlotFlag(chairIdx, slotIdx) == SlotFlag.Hammer;
    }

    /**
     * 这根椅子上有没有还没被敲碎的冰晶。
     * 有 ⇒ 整根椅子**不许飞向卡车**（"六个同色里有一个被盖住，整椅都不能消除"）。
     */
    public IsChairBlockedByCrystal(chairIdx: number): boolean
    {
        let cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null || chairIdx < 0 || chairIdx >= cfg.chairs.length) return false;
        let chair: LevelChairData = cfg.chairs[chairIdx];
        if (chair == null || chair.flags == null) return false;
        for (let i = 0; i < chair.flags.length; i++)
        {
            if (chair.flags[i] == SlotFlag.Crystal) return true;
        }
        return false;
    }

    /** 这根椅子最顶上那只狗在哪个槽位（-1 = 空椅）。下标越大越靠上，见 SetSelectRoomId 的长注释 */
    public GetTopDogSlot(chairIdx: number): number
    {
        let cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null || chairIdx < 0 || chairIdx >= cfg.chairs.length) return -1;
        let ch: LevelChairData = cfg.chairs[chairIdx];
        if (ch == null || ch.dogs == null) return -1;
        for (let i = ch.dogs.length - 1; i >= 0; i--)
        {
            if (ch.dogs[i] > 0) return i;
        }
        return -1;
    }

    /** 这根椅子上抱锤子的狗在第几格（-1 = 没有） */
    public GetHammerSlot(chairIdx: number): number
    {
        let cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null || chairIdx < 0 || chairIdx >= cfg.chairs.length) return -1;
        let chair: LevelChairData = cfg.chairs[chairIdx];
        if (chair == null || chair.flags == null) return -1;
        for (let i = 0; i < chair.flags.length; i++)
        {
            if (chair.flags[i] == SlotFlag.Hammer) return i;
        }
        return -1;
    }

    /**
     * 这一对里"抱锤子那只狗"现在在哪根椅子上（-1 = 不在任何椅子上，比如被停进了狗窝）。
     *
     * 只按 `holderColor` 找是不够的：同一颜色在一根椅子上可能有好几只，
     * 真正的判据是**槽位标记**。配对本身只记了冰晶那一侧，锤子这一侧是会跟着狗
     * 在椅子之间搬来搬去的（见 ChangeChairDogColor），所以这里现扫一遍标记。
     */
    public GetChairOfHolder(pair: CrystalPair): number
    {
        if (pair == null) return -1;
        let cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null) return -1;
        for (let i = 0; i < cfg.chairs.length; i++)
        {
            let ch: LevelChairData = cfg.chairs[i];
            if (ch == null || ch.flags == null) continue;
            for (let j = 0; j < ch.flags.length; j++)
            {
                if (ch.flags[j] != SlotFlag.Hammer) continue;
                if (ch.dogs[j] == pair.holderColor) return i;
            }
        }
        return -1;
    }

    /** 这个狗窝里停着的那只狗是不是抱着锤子（是 ⇒ 返回锤子颜色，否则 -1） */
    public GetHammerColorInRoom(roomId: number): number
    {
        if (!this.hammerInRoom.has(roomId)) return -1;
        let holderColor: number = this.hammerInRoom.get(roomId);
        let pair: CrystalPair = this.GetUnbrokenPairByHolderColor(holderColor);
        return pair != null ? pair.crystalColor : -1;
    }

    /** 清掉本关所有冰晶 / 锤子标记（换关时调） */
    public ClearCrystalPairs(): void
    {
        this.crystalPairs = [];
        this.hammerInRoom.clear();
        let cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null) return;
        for (let i = 0; i < cfg.chairs.length; i++)
        {
            let ch: LevelChairData = cfg.chairs[i];
            if (ch.flags == null) continue;
            for (let j = 0; j < ch.flags.length; j++) ch.flags[j] = SlotFlag.Normal;
        }
    }

    /**
     * 开局随机配对。**铺完盘之后**调（GameMainObj.start 里），读的是 `curLevelConfig`。
     * 返回生成出来的对数，方便日志 / 测试。
     */
    public GenerateCrystalPairs(): number
    {
        this.ClearCrystalPairs();
        let cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null) return 0;
        if (this.curFightLevelId < GameDataManager.CRYSTAL_START_LEVEL) return 0;

        // 1) 颜色 -> 这只颜色所有狗的位置
        let spots: Map<number, { chair: number, slot: number }[]> = new Map();
        for (let i = 0; i < cfg.chairs.length; i++)
        {
            let dogs: number[] = cfg.chairs[i].dogs;
            for (let j = 0; j < dogs.length; j++)
            {
                if (dogs[j] <= 0) continue;
                if (!spots.has(dogs[j])) spots.set(dogs[j], []);
                spots.get(dogs[j]).push({ chair: i, slot: j });
            }
        }
        let colors: number[] = Array.from(spots.keys());
        let n: number = colors.length;

        // 2) 颜色总数决定"这一关出几对"（判据是 **≥**，不是 >）
        //    ≥7 色 → 2~3 对   ≥5 色 → 1~2 对   ≥3 色 → 0~1 对
        //    也就是说第 5 关（3 色）起就有机会见到，只是 50% 概率是 0 对。
        let minPair: number = 0, maxPair: number = 0;
        if (n >= 7) { minPair = 2; maxPair = 3; }
        else if (n >= 5) { minPair = 1; maxPair = 2; }
        else if (n >= 3) { minPair = 0; maxPair = 1; }
        else return 0;   // 1~2 色的关卡凑不出一对（一只要冻、一只要抱锤子，还得不同色）

        let want: number = minPair + Math.floor(Math.random() * (maxPair - minPair + 1));
        // 一对要吃掉两个颜色，别超过颜色总数的一半
        let cap: number = Math.floor(n / 2);
        if (want > cap) want = cap;
        if (want <= 0) return 0;

        // 3) 颜色洗一遍，两两取 ⇒ 天然满足"每对之间颜色不重复"
        let pool: number[] = colors.slice();
        for (let i = pool.length - 1; i > 0; i--)
        {
            let k: number = Math.floor(Math.random() * (i + 1));
            let t: number = pool[i]; pool[i] = pool[k]; pool[k] = t;
        }

        let made: number = 0;
        // ⚠️ 已经用掉的椅子。**冰晶椅和抱锤子椅都算**，而且跨对共享。
        //
        // 不共享会锁死，举个真实会发生的例子（两对）：
        //   对A：冰晶在椅 X、锤子在椅 Y     对B：冰晶在椅 Y、锤子在椅 X
        //   ⇒ X 被对A的冰晶挡着、飞不了，对B的锤子（在 X）永远等不到被消除；
        //     Y 被对B的冰晶挡着、飞不了，对A的锤子（在 Y）也一样 ⇒ 两根椅子互锁，死局。
        // 顺带也排掉了"同一根椅子上蹲着两只抱锤子的狗"（那种情况下
        // `GetHammerSlot` 只能报一只，另一把锤子会被漏掉、那一对永远敲不碎）。
        const usedChairs: Set<number> = new Set<number>();

        for (let p = 0; p + 1 < pool.length && made < want; p += 2)
        {
            let crystalColor: number = pool[p];
            let holderColor: number = pool[p + 1];

            // 冰晶狗：这只颜色里、椅子还没被占用的任意一只
            let cSpots = spots.get(crystalColor);
            if (cSpots == null || cSpots.length <= 0) continue;
            let cCand = cSpots.filter(s => !usedChairs.has(s.chair));
            if (cCand.length <= 0) continue;
            let cs = cCand[Math.floor(Math.random() * cCand.length)];

            // 抱锤子的狗：椅子也不能已被占用（含 cs 自己那根）
            let hSpots = spots.get(holderColor);
            if (hSpots == null) continue;
            let candidates = hSpots.filter(s => s.chair != cs.chair && !usedChairs.has(s.chair));
            if (candidates.length <= 0) continue;
            let hs = candidates[Math.floor(Math.random() * candidates.length)];

            this.SetSlotFlag(cs.chair, cs.slot, SlotFlag.Crystal);
            this.SetSlotFlag(hs.chair, hs.slot, SlotFlag.Hammer);
            usedChairs.add(cs.chair);
            usedChairs.add(hs.chair);

            let pair: CrystalPair = new CrystalPair();
            pair.crystalChair = cs.chair;
            pair.crystalSlot = cs.slot;
            pair.crystalColor = crystalColor;
            pair.holderColor = holderColor;
            this.crystalPairs.push(pair);
            made++;
        }
        return made;
    }

    /** 按"抱锤子那只狗的颜色"找还没被敲碎的那一对 */
    public GetUnbrokenPairByHolderColor(holderColor: number): CrystalPair
    {
        for (let i = 0; i < this.crystalPairs.length; i++)
        {
            let p: CrystalPair = this.crystalPairs[i];
            if (!p.broken && p.holderColor == holderColor) return p;
        }
        return null;
    }

    /** 敲碎：把冰晶格恢复成普通格，并标记这一对已经完成（幂等） */
    public BreakCrystal(pair: CrystalPair): void
    {
        if (pair == null || pair.broken) return;
        pair.broken = true;
        if (this.IsSlotCrystal(pair.crystalChair, pair.crystalSlot))
            this.SetSlotFlag(pair.crystalChair, pair.crystalSlot, SlotFlag.Normal);
    }

    /**
     * 每帧倒计时。只有 Playing 期间才走。
     *
     * ⚠️ 归零时**先看盘面清没清空**，不能无条件判失败。
     * 清盘是异步的：最后一批狗「飞向卡车」时，CheckDogFlyToCar 会**先把数据置 0、
     * 再播飞行动画**（见那里的注释），而过关要等动画播完、回调再进一次
     * CheckDogFlyToCar 才宣布。这段窗口里 IsBoardClear() 已经是 true、levelState 还停在
     * Playing —— 无条件判失败，就会让**已经把狗清完**的玩家在最后一秒吃败仗。
     *
     * 这里补判一次：盘面已空 ⇒ 直接判过关。FinishLevel 是幂等的，
     * 随后那次回调再判也不会翻盘。
     */
    public TickLevel(deltaTime: number): void
    {
        if (this.levelState != LevelState.Playing) return;
        this.curTime -= deltaTime;
        if (this.curTime <= 0)
        {
            this.curTime = 0;
            // `_levelHasDogs` 与 CheckDogFlyToCar 的过关钩子用同一判据，
            // 一起挡掉「空关卡开局就过关」那种退化情况。
            this.FinishLevel(this._levelHasDogs && this.IsBoardClear());
        }
        else if (this._levelHasDogs && this.IsBoardClear() && this.gameMainObj.IsHaveFlyAllDog() && this.gameMainObj.UsingdDogs.length <= 0)
        {
            this.FinishLevel(true);
        }
    }

    /** 剩余秒数（向上取整）。time_txt 显示的是 "240秒" 这种整数 */
    public GetRemainSeconds(): number
    {
        return this.curTime > 0 ? Math.ceil(this.curTime) : 0;
    }

    /** 盘面是否已清空 —— 所有椅子上的狗都被卡车接走了 */
    public IsBoardClear(): boolean
    {
        if (this.curLevelConfig == null) return false;
        for (let i = 0; i < this.curLevelConfig.chairs.length; i++)
        {
            let dogs: number[] = this.curLevelConfig.chairs[i].dogs;
            for (let j = 0; j < dogs.length; j++)
            {
                if (dogs[j] > 0) return false;
            }
        }
        return true;
    }

    /**
     * 重排盘面：把**所有已占用槽位**上的颜色做一次全局洗牌（位置不动，只换颜色）。
     *
     * 只动数据，不碰界面 —— 界面那边（`GameMainObj.onResetClickEvent`）拿洗牌后的
     * `curLevelConfig` 和 `ChairNode.sortDog[j].DogColor` 逐格比对，只给**真的变了**的
     * 那些格播换色动画。
     *
     * 三条不变量：
     *   1. **只置换已占用的槽位** ⇒ 每根椅子的占位数量不变、仍然是"从椅底往上连续"，
     *      不会写出 `dogs[0] == 0` 这种带空洞的非法盘面（IsCanChange / ChangeChairDogColor
     *      都假设没有空洞）。
     *   2. **颜色总数不变** ⇒ 盘面不会凭空多出/少掉某个颜色，不会出现"这个颜色永远凑不满"。
     *   3. 空位（`dogs[j] == 0`）保持 0，不参与洗牌。
     *
     * @returns 真的换掉了至少一格返回 true；盘面少于 2 格、或者洗完和原来完全一样
     *          （例如整盘只有一种颜色）返回 false —— 调用方据此决定要不要播动画。
     */
    public ShuffleBoard(): boolean
    {
        if (this.levelState != LevelState.Playing) return false;
        const cfg: LevelConfig = this.curLevelConfig;
        if (cfg == null || cfg.chairs == null) return false;

        // 1) 收集所有占用槽位。
        //    ⚠️ 带冰晶 / 锤子的格子**不参与**洗牌：冰晶狗本身不能动，颜色一变
        //    "锤子该配哪只狗"就说不清了；锤子跟着狗的颜色走，换色等于换了把锤子。
        const slots: { chair: number, slot: number, color: number }[] = [];
        for (let i = 0; i < cfg.chairs.length; i++)
        {
            const dogs: number[] = cfg.chairs[i].dogs;
            for (let j = 0; j < dogs.length; j++)
            {
                if (dogs[j] <= 0) continue;
                if (this.GetSlotFlag(i, j) != SlotFlag.Normal) continue;
                slots.push({ chair: i, slot: j, color: dogs[j] });
            }
        }
        if (slots.length < 2) return false;

        // 2) Fisher-Yates 洗颜色序列
        const colors: number[] = [];
        for (let k = 0; k < slots.length; k++) colors.push(slots[k].color);
        for (let k = colors.length - 1; k > 0; k--)
        {
            const r: number = Math.floor(Math.random() * (k + 1));
            const t: number = colors[k];
            colors[k] = colors[r];
            colors[r] = t;
        }

        // 3) 写回；全同色时洗了等于没洗，报 false 让界面别白播一遍动画
        let moved: boolean = false;
        for (let k = 0; k < slots.length; k++)
        {
            if (slots[k].color != colors[k]) moved = true;
            cfg.chairs[slots[k].chair].dogs[slots[k].slot] = colors[k];
        }
        return moved;
    }

    /** 结算一关。重复调用只生效一次（状态已经离开 Playing 就直接返回） */
    public FinishLevel(isWin: boolean): void
    {
        if (this.levelState != LevelState.Playing) return;
        this.isCanClick = true;
        this.levelState = isWin ? LevelState.Win : LevelState.Lose;

        // 过关 / 失败音效。
        // 挂在这里而不是 ShowResult 里：FinishLevel 是**所有**关卡出口（超时 / 清盘 /
        // 调试入口）的唯一汇合点，且函数开头已经做了 `levelState != Playing` 的早退
        // ⇒ 天然幂等，连点或重复回调都不会把音效叠两遍。
        // 先出声再弹窗：结算框有 0.2s 左右的弹出动画，声音跟着动画一起起才有反馈感。
        if (SoundManager.instance != null)
        {
            SoundManager.instance.playSound(isWin ? SoundManager.SFX_WIN : SoundManager.SFX_FAIL);
        }

        // ⚠️ 先把还悬着的狗放回椅子，**再**清选中态 —— 顺序不能反。
        //    下面两行把 curSelectChairIdx / curSelectRoomIdx 清成 -1 之后，
        //    就再也说不出"哪根椅子在悬浮"了，那批 AnimDog 就永远回不了池子。
        //
        // 为什么必须在这里做：悬浮中的狗是从 AnimDog 池**借**出来的（PlayHoverUp），
        // 只有 PlayEndHover / PlayEndHoverByRoomId 会还。而换关时 RefreshAllSlot 走的
        // DogNode.StopAnim() **不还**（它只停 one-shot / 拖尾 / 剪辑，见 DogNode.ts:480）——
        // 也就是说这个漏**不会自愈**。
        // 于是：倒计时归零时玩家正选中一根椅子（狗悬在半空）⇒ 最多 6 只 AnimDog 漏掉，
        // 它们 node.active 还是 true（GetUnusedAnimDog 打开过），下一关就变成骑在椅子上的
        // 幽灵狗；池子一共 12 只，**两次**就把悬浮功能整个搞停（GetUnusedAnimDog 会返回
        // null 并打日志，之后选中椅子不再有悬浮）。
        //
        // 放在 FinishLevel 是因为**所有**关卡出口都汇到这里（超时 / 清盘 / 调试用的
        // onClickEvent），所以这一处就够，不用在每个出口各写一遍。
        // 判据见 level_tools/verify_level_loop.py 第 15 项。
        if (this.gameMainObj != null)
        {
            if (this.curSelectChairIdx >= 0)
                this.gameMainObj.PlayEndHover(this.curSelectChairIdx);
            if (this.curSelectRoomIdx > 0)
                this.gameMainObj.PlayEndHoverByRoomId(this.curSelectRoomIdx);
        }

        this.curSelectChairIdx = -1;
        this.curSelectRoomIdx = -1;
        this.ShowResult(isWin);
        this.gameMainObj.unscheduleAllCallbacks();

        // 赢了就解锁一片拼图。放在 ShowResult 之后是**故意的**：
        // 结算弹窗的弹出动画和这里的读写没有依赖，先弹窗让玩家更快看到反馈；
        // 而拼图界面只在窗口重新可见时才刷新，晚这几毫秒没有影响。
        if (isWin) 
        {
            if (this.gameMode == BattleMode.Puzzle)
                this.UnlockPuzzlePiece();
            else if (this.gameMode == BattleMode.Calendar && this.curSelectDate != null)
            {
                // 每日挑战：把选中的那一格记成已完成。
                // 数据归 GameDataManager 所有（见 MarkDailyDone），界面只负责读来渲染 ——
                // 原先这里自己 parse 一遍缓存、再写回去，等于同一份数据有两个写入口，
                // 和界面里的副本互相覆盖。
                this.MarkDailyDone(this.curSelectDate);
            }
        }
    }

    // ---------------------------------------------------------------- 拼图活动
    //
    // 拼图活动**没有独立的系统**（没有活动配置、没有次数、没有奖励表），
    // 这里只实现需求里那一句："胜利回来就可以随机解锁一个碎片"。
    // 所以规则极简：过关 -> 从还没解锁的碎片里随机挑一片 -> 写缓存。
    //
    // 为什么挂在 FinishLevel 而不是结算弹窗里：FinishLevel 是**所有**关卡出口
    // （超时 / 清盘 / 调试入口）的唯一汇合点，而且开头就有 `levelState != Playing`
    // 的早退，天然幂等 —— 连点、重复回调都不会解锁两片。

    /**
     * 随机解锁一片拼图，返回下标；已经集满时返回 -1（不写缓存）。
     *
     * ⚠️ 解锁口径是"每赢一局一片"，所以刷同一个关卡 16 次也能集满。
     *    要限制（例如每天一次 / 只在新关卡首胜解锁），改这一个函数即可，
     *    界面和缓存格式都不用动。
     */
    public UnlockPuzzlePiece(): number
    {
        const raw: string = CacheManager.instance.getString(CacheKeys.PuzzleUnlocked, "");
        const flags: boolean[] = PuzzleProgress.parse(raw);

        const idx: number = PuzzleProgress.pickRandom(flags);
        if (idx < 0)
        {
            // 集满了。把提示位清掉，否则界面会一直高亮最后一片
            this.lastUnlockedPiece = -1;
            return -1;
        }

        flags[idx] = true;
        CacheManager.instance.setString(CacheKeys.PuzzleUnlocked, PuzzleProgress.serialize(flags));
        this.lastUnlockedPiece = idx;
        return idx;
    }

    /** 已解锁的碎片数量（0..16） */
    public GetPuzzleUnlockedCount(): number
    {
        const raw: string = CacheManager.instance.getString(CacheKeys.PuzzleUnlocked, "");
        return PuzzleProgress.count(PuzzleProgress.parse(raw));
    }

    /** 取走"刚解锁"的提示位（取完置 -1）。界面打开时用，避免同一片被高亮两次 */
    public ConsumeLastUnlockedPiece(): number
    {
        const idx: number = this.lastUnlockedPiece;
        this.lastUnlockedPiece = -1;
        return idx;
    }

    // ---------------------------------------------------------------- 每日挑战
    //
    // 每日挑战**没有独立玩法**：点「开始挑战」走的还是普通关卡（见
    // UICalendarView.onClickStart），所以这里只负责一件事 —— 记住哪几天过了。
    //
    // 数据归属：`CacheKeys.DailyDone` 是唯一真值，`_dailyDone` 是它的内存副本。
    // **只在打开每日玩法界面时解析一次**（`LoadDailyProgress`），之后读写都走这里。
    //
    // ⚠️ 别让界面自己 parse 一份。之前就是三份数据（缓存 / 界面副本 / 这里各 parse
    //    一次）互相覆盖，而且 `UICalendarView.onEnable` 里还有一句
    //    `setDayDone(today, true)` —— **每打开一次日历就把今天记成已完成**，
    //    玩家根本没打，格子已经打上对勾，连带月度奖杯全勤判定也是错的。

    /** `2026-11-05` 形式的完成集合。null = 还没解析过 */
    private _dailyDone: Set<string> = null;

    /**
     * 从存档解析每日挑战进度。
     *
     * 调用点只有一个：`UICalendarView.onEnable()`（打开每日玩法界面时触发）。
     * 故意不放在 `init()` 里 —— 这份数据只有那个界面用得上，早读只是多一次 IO。
     */
    public LoadDailyProgress(): void
    {
        this._dailyDone = CalendarMath.parseDone(
            CacheManager.instance.getString(CacheKeys.DailyDone, ""));
    }

    /**
     * 完成集合（返回**内部实例**，只读使用）。
     *
     * 不复制是故意的：界面每次渲染要逐格查 42 次，复制一份纯属浪费。
     * 反过来，外部**不要**往里 add/delete —— 写入请走 `MarkDailyDone`。
     */
    public GetDailyDone(): Set<string>
    {
        if (this._dailyDone == null) this.LoadDailyProgress();
        return this._dailyDone;
    }

    /** 某一天是否已完成 */
    public IsDailyDone(date: Date): boolean
    {
        if (date == null) return false;
        return this.GetDailyDone().has(CalendarMath.dateKey(date));
    }

    /**
     * 某一天的日历状态（Locked / Missed / Ready / Done）。
     * 「选中」不在这里 —— 它是叠在底板上的环，属于界面。
     */
    public GetDailyState(date: Date): DayState
    {
        if (date == null) return DayState.Empty;
        return CalendarMath.stateOf(date.getFullYear(), date.getMonth() + 1, date.getDate(),
                                    CalendarMath.startOfDay(new Date()),
                                    this.GetDailyDone());
    }

    /**
     * 标记某天已完成并落盘。返回 true = 这次是**新增**（之前没做过）。
     *
     * 判据全在 `CalendarMath.markDone()`（纯逻辑，有离线单测）：
     *   非法日期 / 未来日期 / 已记过 都不写，只有 Added 才落盘。
     * 幂等：同一天赢两次只写一次缓存。
     */
    public MarkDailyDone(date: Date): boolean
    {
        if (date == null) return false;

        const done = this.GetDailyDone();
        const res = CalendarMath.markDone(done,
                                          date.getFullYear(), date.getMonth() + 1, date.getDate(),
                                          new Date());

        if (res === DailyMarkResult.Future)
        {
            console.warn(`[GameDataManager] 拒绝把未来日期记为已完成: ${CalendarMath.dateKey(date)}`);
            return false;
        }
        if (res !== DailyMarkResult.Added) return false;

        CacheManager.instance.setString(CacheKeys.DailyDone, CalendarMath.serializeDone(done));
        return true;
    }

    /**
     * 结算弹窗的按钮回调。
     *
     * 弹窗自己不认识关卡（它连 curFightLevelId 都不该知道），所以「下一步是什么」
     * 交给这一层 —— 只有这里同时握着当前关卡号和关卡总数。
     * 最后一关再点「下一关」就重玩最后一关：SetLevelCfgById 内部会把号夹到最大值。
     */
    public OnResultButton(isNext: boolean): void
    {
        this.SetLevelCfgById(isNext ? this.curFightLevelId + 1 : this.curFightLevelId);
    }

    /** 复活一次补多少秒。纯平衡参数，随时可调（正式值等策划定） */
    public static readonly REVIVE_EXTRA_SECONDS: number = 30;

    /**
     * 复活：把**同一盘棋继续下去**，只补时间，不重铺。
     *
     * 和「重玩」是两条不同的路：
     *   · 重玩 = `OnResultButton(false)` → `SetLevelCfgById(当前关)` → 重新铺盘（进度全丢）
     *   · 复活 = 这一支 → 盘面原样保留，`levelState` 回到 Playing，倒计时重新给一段
     * 原先是同一个函数（`onClickRevive` 直接调 `onResultButton(false)`），
     * 玩家看到「复活」、拿到「重玩」—— 那是个**功能缺口**，不是动画问题。
     *
     * 只有 `Lose` 才允许复活：赢了没有"复活"这一说，而 `Playing` 期间这个弹窗根本不存在。
     * 这个早退同时也是**幂等保护** —— 连点两下只补一次时间。
     */
    public ReviveLevel(): void
    {
        if (this.levelState != LevelState.Lose) return;

        this.curTime = GameDataManager.REVIVE_EXTRA_SECONDS;
        this.levelState = LevelState.Playing;

        // 盘面**不重铺** ⇒ `_levelHasDogs` 不用动（它记的是"这一关开局有没有狗"，
        // 复活不改这个事实）。`FinishLevel` 里清掉的 curSelectChairIdx/curSelectRoomIdx
        // 也保持 -1：复活后没有选中任何东西，玩家要重新点。
        //
        // 倒计时 Label 必须显式刷一次，理由见 GameMainObj.RefreshTimeText 的注释。
        if (this.gameMainObj != null) this.gameMainObj.RefreshTimeText();
    }

    private async ShowResult(isWin: boolean): Promise<void>
    {
        let para: ResultPara = new ResultPara();
        para.isWin = isWin;
        // ⚠️ 预制体里 titlebg/Text 写死的是「恭喜过关」，而且这一行在 win_node / fail_node
        //    **之外**、两种结果共用 —— 也就是说失败时它照样显示「恭喜过关」。
        //    预制体里没有失败版文案，所以失败标题必须由这里传。
        //    「挑战失败」是占位文案，正式文案定了改这一行即可。
        para.title = I18NManager.instance != null
            ? I18NManager.instance.t(isWin ? I18NKey.Result_Title_Win : I18NKey.Result_Title_Fail)
            : (isWin ? "恭喜过关" : "挑战失败");
        await UIManager.instance.openBox<UIGameResultView, ResultPara>(UIGameResultView, UIGameResultView.PrefabPath, para);
    }

    public SetSelectChairId(chairId:number)
    {
        // 结算弹窗弹出后盘面必须冻住（否则还能继续搬狗、搬完再弹一次结算）。见 LevelState
        if (this.levelState != LevelState.Playing) return;
        if (this.curSelectRoomIdx > 0)
        {
            let roomNode:RoomNode = this.gameMainObj.GetRoomNode(this.curSelectRoomIdx);
            let chairData = this.curLevelConfig.chairs[chairId];
            for (let i = 0; i < chairData.dogs.length; i++)
            {
                if ((i == 0 && chairData.dogs[i] <= 0) || (i > 0 && chairData.dogs[i] <= 0 && chairData.dogs[i-1] == roomNode.sleepDogColor))
                {
                    chairData.dogs[i] = roomNode.sleepDogColor;
                    // 从窝里搬回椅子的这只如果抱着锤子，标记也要放回这个槽位
                    if (this.hammerInRoom.has(this.curSelectRoomIdx))
                    {
                        this.SetSlotFlag(chairId, i, SlotFlag.Hammer);
                        this.hammerInRoom.delete(this.curSelectRoomIdx);
                    }
                    roomNode.CreateWithColor(DogColor.None);
                    this.gameMainObj.FlyToSameColorChairFromRoomId(this.curSelectRoomIdx, chairId);
                    this.curSelectRoomIdx = -1;
                    // ⚠️ 这条路上也可能把椅子**集满** —— 椅子已有 5 只同色、狗窝那只
                    // 正好补上第 6 只（穷举合法盘面下来这是**唯一**能集满的形态，
                    // 见 level_tools/verify_level_loop.py 第 14 项）。而"集满就飞向卡车"
                    // 的触发原先只挂在椅子→椅子那条路末尾（本函数下面那个 scheduleOnce）。
                    //
                    // 漏掉这一条 ⇒ 椅子明明集满了却不飞，玩家再走一步**无关**的棋它才飞；
                    // 盘面要是再也走不出椅子→椅子的步子，就只能干等超时判负。
                    // 延迟 1s 与那条路保持一致：数据是同步写好的，等的是飞行动画。
                    this.gameMainObj.scheduleOnce(() => {
                        this.CheckDogFlyToCar();
                    }, 1);
                    break;
                }
            }
            return;
        }
        if (this.curSelectChairIdx < 0)
        {
            this.curSelectChairIdx = chairId;
            SoundManager.instance.playSound(DOG_SFX_SAD);
            this.gameMainObj.PlayHoverUp(chairId);
        }
        else if (this.curSelectChairIdx == chairId)
        {
            this.curSelectChairIdx = -1;
            this.gameMainObj.PlayEndHover(chairId);
        }
        else
        {
            if (this.IsCanChange(this.curSelectChairIdx, chairId))
            {
                //todo 创建拷贝狗狗 先刷新数据
                this.ChangeChairDogColor(this.curSelectChairIdx, chairId);
                this.gameMainObj.FlyToSameColorChair(this.curSelectChairIdx, chairId, () => {
                    this.CheckDogFlyToCar();
                });
                // 搬完之后按数据重画覆盖层：锤子的槽位跟着狗换了，画面上得跟过去。
                // ⚠️ 用延迟而不是上面那个回调 —— 回调只在 i==0 那只落地时触发，
                //    而抱锤子的可能是 i>0 的某一只，它落地更晚（飞行时长 = dis/4000 各不相同）。
                //    早画的话，后落地那只的 `CreateDog` 会 ClearOverlays 把锤子又擦掉。
                this.gameMainObj.scheduleOnce(() => {
                    this.gameMainObj.RefreshCrystalOverlays();
                }, 0.8);
                this.curSelectChairIdx = -1;
            }
            else
            {
                this.gameMainObj.PlayEndHover(this.curSelectChairIdx );
                this.curSelectChairIdx = chairId;
                SoundManager.instance.playSound(DOG_SFX_SAD);
                this.gameMainObj.PlayHoverUp(chairId);
            }
        }

    }

    public SetSelectRoomId(roomId:number)
    {
        // 同上：结算后不再接受操作
        if (this.levelState != LevelState.Playing) return;
        let roomNode:RoomNode = this.gameMainObj.GetRoomNode(roomId);
        if (this.curSelectRoomIdx < 0)
        {
            if (roomNode.sleepDogColor == DogColor.None)
            {
                // ⚠️ 判据是 `>= 0`，不是 `> 0`。椅子的 chairId 是 **0 基**的
                // （GameMainObj.start 里 `RefreshAllSlot(cfg.chairs[i].dogs, i)` 传的就是 i），
                // 而 roomIndex / doorIndex 是 **1 基**的（`roomIndex = i + 1`）——
                // 两套编号混在同一个文件里，很容易顺手写错。
                // 写成 `> 0` 的后果：**选中第 1 根椅子再点狗窝，什么都发生不了**（死点击）。
                // 空选中态用的是 -1（见 StartLevel / FinishLevel），所以 `>= 0` 才是
                // "有椅子被选中"。上面 SetSelectChairId 用的也是 `< 0` 判空，两处要对齐。
                if (this.curSelectChairIdx >= 0) //飞到room
                {
                    const fromChairId: number = this.curSelectChairIdx;

                    // ⚠️ 冰晶狗**不能进狗窝**。搬进狗窝也是"移动"，而冰晶狗不许移动。
                    //
                    // 这条判据不能省：椅子顶上压着冰晶时，玩家仍然**能选中**这根椅子
                    // （PlayHoverUp 会拒绝抬起它，但 curSelectChairIdx 已经置上了），
                    // 这时再点狗窝就会把冰晶狗送走 —— 冰晶跟着狗进了窝，那一对
                    // 再也敲不碎，那根椅子永远飞不了（而且窝里的冰晶没有任何 UI 表示）。
                    const topSlot: number = this.GetTopDogSlot(fromChairId);
                    if (topSlot >= 0 && this.IsSlotCrystal(fromChairId, topSlot))
                        return;

                    // 回调在狗真的落进窝里之后才跑 —— 那时狗窝的 `sleepDogColor` 才是新的，
                    // 覆盖层重画才不会把锤子画到一个还空着的窝上。
                    this.gameMainObj.FlyToRoom(fromChairId, roomId, () => {
                        this.gameMainObj.RefreshCrystalOverlays();
                    });
                    let chairData = this.curLevelConfig.chairs[fromChairId];
                    // ⚠️ 从**顶部**摘一只，不是从底部 —— 循环方向必须是末尾往 0 扫。
                    //
                    // 盘面数据的约定是「下标越大越靠上」：下标 0 = 椅底，末尾 = 椅顶。
                    // 三条独立佐证：① RefreshAllSlot 用 `bornDelay = i * BORN_STAGGER`
                    // 让整列"自下而上依次弹出"；② 上面 room→椅子 那段的插入条件是
                    // `dogs[i-1] == 房间颜色`（i-1 在 i 的下面）；③ ChangeChairDogColor
                    // 装填时从下标 0 往上、摘除时从末尾往下。
                    //
                    // 而视图侧 FlyToRoom 送走的是 `sendNode[0]` —— 从 length-1 往下扫出的
                    // 第一个非空，也就是**最顶上那只**。原先这里是从 0 往上找"第一个非空"，
                    // 摘掉的是**最底下那只** ⇒ 数据与画面对不上；更糟的是会写出
                    // `dogs[0] == 0` 这种非法盘面（椅子底下空着、上面还压着狗），
                    // 之后 IsCanChange / ChangeChairDogColor 会把它当成"底部有空位"
                    // 一路错下去（R1：椅子不许有空洞）。
                    if (topSlot >= 0)
                    {
                        // ⚠️ 标记必须**跟着这只狗一起走**。原先只清了 dogs[i]，
                        // flags[i] 留在原地 —— 那个槽位从此带着一个"幽灵锤子"：
                        // 下一只搬进来的狗会凭空抱起锤子（`GetUnbrokenPairByHolderColor`
                        // 按颜色找不到对 ⇒ 画面上又没有），而真正抱锤子的那只已经进了窝、
                        // 窝里却没有任何记录 ⇒ 这一对永远敲不碎，冰晶那根椅子永远飞不了。
                        const movedColor: number = chairData.dogs[topSlot];
                        const movedFlag: number = this.GetSlotFlag(fromChairId, topSlot);
                        chairData.dogs[topSlot] = 0;
                        this.SetSlotFlag(fromChairId, topSlot, SlotFlag.Normal);
                        if (movedFlag == SlotFlag.Hammer)
                            this.hammerInRoom.set(roomId, movedColor);
                    }
                    this.curSelectChairIdx = -1;
                }
            }
            else
            {
                if (this.curSelectChairIdx < 0) //悬浮
                {
                    this.curSelectRoomIdx = roomId;
                    this.gameMainObj.PlayHoverUpByRoomId(roomId);
                }
            }
        }
        else if (this.curSelectRoomIdx == roomId)
        {
            this.curSelectRoomIdx = -1;
            this.gameMainObj.PlayEndHoverByRoomId(roomId);
        }
        else
        {
            this.gameMainObj.PlayEndHoverByRoomId(this.curSelectRoomIdx);
             if (this.curSelectChairIdx < 0) //悬浮
            {
                this.curSelectRoomIdx = roomId;
                this.gameMainObj.PlayHoverUpByRoomId(roomId);
            }
        }
    }

    public CheckDogFlyToCar()
    {
        if (this.levelState != LevelState.Playing) return;
        // 这一轮有没有椅子真的起飞。飞了的话飞完会回调回来再扫一遍，
        // 所以"扫完一遍一只都没飞"才是整个级联的终点。
        let flew: boolean = false;
        for (let i = 0; i < this.curLevelConfig.chairs.length; i++)
        {
            let chairData:LevelChairData = this.curLevelConfig.chairs[i];
            let defaultColor:number = chairData.dogs[0];
            let isSameColor = true;
            for (let j = 0; j < chairData.dogs.length; j++)
            {
                if (defaultColor != chairData.dogs[j])
                {
                    isSameColor = false;
                    break;
                }
            }
            if (isSameColor && defaultColor != 0)
            { 
                // 冰晶还没敲碎 ⇒ 这根椅子**不许飞**。
                // 这就是"六个同色狗狗站在一个桌子上、有一个被水晶盖住，整椅都不能消除"。
                if (this.IsChairBlockedByCrystal(i)) continue;

                // 这一椅里有没有抱锤子的狗（最多一只：一对里只有一个锤子）
                const hammerSlot: number = this.GetHammerSlot(i);
                const hammerColor: number = hammerSlot >= 0 ? chairData.dogs[hammerSlot] : 0;

                let isOk:Boolean = this.gameMainObj.FlyToCar(defaultColor, i,()=>{
                    this.CheckDogFlyToCar();
                }); 
                if (isOk)
                {
                    // 抱锤子的狗被消除 ⇒ 锤子飞向同色的冰晶狗、把它砸开。
                    // 必须在**清数据之前**把槽位号交给界面：清完 dogs/flags 就找不到这只狗了。
                    if (hammerSlot >= 0)
                    {
                        const pair: CrystalPair = this.GetUnbrokenPairByHolderColor(hammerColor);
                        if (pair != null) this.gameMainObj.PlayHammerBreakFromChair(i, hammerSlot);
                    }
                    for (let k = 0; k < chairData.dogs.length; k++)
                    {
                        chairData.dogs[k] = 0;
                        // 标记也要一起清：椅子虽然被关掉了，但 flags 留着就是脏数据
                        // （换关时 ClearCrystalPairs 才清，而这根椅子的槽位可能已被下一关复用）
                        this.SetSlotFlag(i, k, SlotFlag.Normal);
                    }
                    flew = true;
                    break;
                }
                else
                    this.isCanClick = true;
            }
        }

        // 级联走完了：盘面全空就是过关。
        // `_levelHasDogs` 是挡"空关卡一开局就判过关"的退化情况（见它的注释）。
        // if (!flew && this._levelHasDogs && this.IsBoardClear() && this.isCanClick)
        // {
        //     this.FinishLevel(true);
        // }
    }

    //执行飞入
    public ChangeChairDogColor(fromIndx:number, toIndex:number)
    {
        let fromChair:LevelChairData = this.curLevelConfig.chairs[fromIndx];
        let toChair:LevelChairData = this.curLevelConfig.chairs[toIndex];
        let toColor = 0;
        for (let i = toChair.dogs.length - 1; i >= 0; i--)
        {
            if (toChair.dogs[i] > 0)
            {
                toColor = toChair.dogs[i];
                break;
            }
        }
        if (toColor == 0)
        {
            for (let i = fromChair.dogs.length - 1; i >= 0; i--)
            {
                if (fromChair.dogs[i] > 0)
                {
                    toColor = fromChair.dogs[i];
                    break;
                }
            }
        }

        // 源椅：从顶往下取"同色、且不是冰晶"的连续一段。
        // 遇到冰晶就停 —— 冰晶狗搬不动，它下面的狗也就出不来。
        const sendSlots: number[] = [];
        for (let i = fromChair.dogs.length - 1; i >= 0; i--)
        {
            if (fromChair.dogs[i] <= 0) continue;
            if (fromChair.dogs[i] != toColor) break;
            if (this.GetSlotFlag(fromIndx, i) == SlotFlag.Crystal) break;
            sendSlots.push(i);
        }
        // 目标椅：从下往上数空位
        const holes: number[] = [];
        for (let i = 0; i < toChair.dogs.length; i++)
        {
            if (toChair.dogs[i] <= 0) holes.push(i);
        }

        // ⚠️ 标记（冰晶 / 锤子）必须**跟着槽位一起搬**：
        // 抱锤子的狗被搬走，锤子得跟过去；冰晶狗不会出现在 sendSlots 里（上面已经 break）。
        const fitNum: number = Math.min(sendSlots.length, holes.length);
        for (let k = 0; k < fitNum; k++)
        {
            const src: number = sendSlots[k];
            const dst: number = holes[k];
            toChair.dogs[dst] = fromChair.dogs[src];
            this.SetSlotFlag(toIndex, dst, this.GetSlotFlag(fromIndx, src));
            fromChair.dogs[src] = 0;
            this.SetSlotFlag(fromIndx, src, SlotFlag.Normal);
        }
    }

     //判断是否可以飞入
     //
     // 这里必须与关卡求解器 level_tools/level_rules.py 的 _moves() 完全一致，
     // 否则「100 关全部可解」这个结论在实机上就不成立 —— 求解器是按下面三条枚举走法的：
     //
     //     for f in range(n):
     //         dog = chair_top(state[f])
     //         if dog is None:                      continue   # ① 源椅不能是空的
     //         for t in range(n):
     //             if t == f or chair_free(state[t]) == 0: continue   # ② 目标椅要有空位
     //             dt = chair_top(state[t])
     //             if dt is not None and dt != dog:        continue   # ③ 目标顶为空或同色
     //
     // 原先只判了 ③：目标椅满了仍然放行（ChangeChairDogColor 里 fitNum 会是 0，
     // 于是什么都没搬、白白播一次飞行动画），源椅为空时也会放行。
     public IsCanChange(fromIndx:number, toIndex:number):boolean
    {
        let fromChair:LevelChairData = this.curLevelConfig.chairs[fromIndx];
        let toChair:LevelChairData = this.curLevelConfig.chairs[toIndex];
        let fromColor = 0;
        let toColor = 0;
        let fromTopSlot = -1;
        for (let i = fromChair.dogs.length - 1; i >= 0; i--)
        {
            if (fromChair.dogs[i] > 0)
            {
                fromColor = fromChair.dogs[i];
                fromTopSlot = i;
                break;
            }
        }
        for (let i = toChair.dogs.length - 1; i >= 0; i--)
        {
            if (toChair.dogs[i] > 0)
            {
                toColor = toChair.dogs[i];
                break;
            }
        }

        // ① 源椅不能是空的 —— 没有狗可搬
        if (fromColor == 0)
            return false;

        // ①-b 椅子顶上压着冰晶 ⇒ 整根椅子搬不动。
        //     注意判的是**最顶上那只**：冰晶狗下面的狗本来也搬不出来（被它压着），
        //     所以只要顶上是冰晶，这一手就完全走不了。
        if (fromTopSlot >= 0 && this.IsSlotCrystal(fromIndx, fromTopSlot))
            return false;

        // ② 目标椅至少要有 1 个空位。
        //    判空用 `<= 0` 而不是 `== 0`，是为了和 ChangeChairDogColor 里
        //    真正找空位的那句 `toChair.dogs[i] <= 0` 保持同一个口径。
        let freeNum = 0;
        for (let i = 0; i < toChair.dogs.length; i++)
        {
            if (toChair.dogs[i] <= 0)
                freeNum++;
        }
        if (freeNum == 0)
            return false;

        // ③ 目标椅顶部为空（整根空椅）或与源椅顶部同色
        if (toColor == 0 || toColor == fromColor)
            return true;
        return false;
    }

    public ClearSelectChairId()
    {
        this.curSelectChairIdx = -1;
    }

    // ---------------------------------------------------------------- 坐标转换
    //
    // 这两个函数互为逆运算，参考系都由【parentNode 这个节点自己的局部坐标系】给出 ——
    // 也就是它的子节点 position 所在的那套坐标（原点落在 parentNode 的锚点上）。
    //
    // 参数特意取成「坐标系节点」而不是「被转换的那个节点」，是为了避免歧义：
    // 如果内部偷偷用 node.parent 当坐标系，那么调用方一旦传错层级不会报错，
    // 只会拿到一个看起来正常、实际错位的结果。现在传谁就是谁，写错一眼能看出来。
    //
    // 引擎侧对应的 API 是 UITransform.convertToWorldSpaceAR / convertToNodeSpaceAR，
    // 名字里的 AR = anchor relative。不过看引擎实现（2d/framework/ui-transform.ts）
    // 其实就一句 Vec3.transformMat4(out, p, node.worldMatrix)，AR 只是 Cocos2d
    // 留下来的历史命名，并没有额外的锚点偏移 —— 所以下面这套逻辑对
    // UI 节点和普通 3D 节点都成立。
    //
    // 典型用法（把一只狗从 A 椅挪到 B 椅，屏幕上位置不动）：
    //     let wp = GameDataManager.instance.LocalToWorld(dogNode.parent, dogNode.position);
    //     dogNode.setParent(targetSlot);
    //     dogNode.setPosition(GameDataManager.instance.WorldToLocal(targetSlot, wp));

    /**
     * 局部坐标 → 世界坐标。
     *
     * @param parentNode 参考坐标系所在的节点；localPos 就是「在它下面的相对坐标」
     * @param localPos   在 parentNode 坐标系下的点（父节点锚点为原点）
     * @param out        可选，复用的输出向量；不传则新建一个
     */
    public LocalToWorld(parentNode: Node, localPos: Vec3, out?: Vec3): Vec3
    {
        let res: Vec3 = out || new Vec3();
        // 没有参考坐标系（节点挂在场景根上）时，局部坐标本身就是世界坐标
        if (parentNode == null)
        {
            return Vec3.copy(res, localPos);
        }

        let ui: UITransform = parentNode.getComponent(UITransform);
        if (ui != null)
        {
            return ui.convertToWorldSpaceAR(localPos, res);
        }
        // 普通节点（没有 UITransform）：自己乘世界矩阵，和上面完全等价。
        // getWorldMatrix 内部会先 updateWorldTransform，拿到的不会是不脏的旧矩阵。
        return Vec3.transformMat4(res, localPos, parentNode.getWorldMatrix(_matWorld));
    }

    /**
     * 世界坐标 → 局部坐标。
     *
     * 和 LocalToWorld 互为逆运算：WorldToLocal(n, LocalToWorld(n, p)) === p。
     *
     * @param parentNode 参考坐标系所在的节点；返回值就是「在它下面的相对坐标」
     * @param worldPos   世界坐标
     * @param out        可选，复用的输出向量；不传则新建一个
     */
    public WorldToLocal(parentNode: Node, worldPos: Vec3, out?: Vec3): Vec3
    {
        let res: Vec3 = out || new Vec3();
        // 没有参考坐标系时（parentNode 传 null），世界坐标就是它自己的局部坐标
        if (parentNode == null)
        {
            return Vec3.copy(res, worldPos);
        }

        let ui: UITransform = parentNode.getComponent(UITransform);
        if (ui != null)
        {
            return ui.convertToNodeSpaceAR(worldPos, res);
        }
        // 分开两个临时矩阵，避免 out 和入参是同一个矩阵时的别名问题
        parentNode.getWorldMatrix(_matWorld);
        Mat4.invert(_matInv, _matWorld);
        return Vec3.transformMat4(res, worldPos, _matInv);
    }
}

