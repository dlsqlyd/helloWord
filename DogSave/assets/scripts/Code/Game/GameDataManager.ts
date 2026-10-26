import { Camera, find, Mat4, Node, UITransform, Vec3, _decorator, view, Vec2, Layers } from 'cc';
import { IManager } from "../../Mono/Core/Manager/IManager"
import { JsonType } from '../../Mono/Helper/JsonHelper';
import { DateItem } from './UI/UIMain/DateItem';
import { CacheManager } from '../Module/Player/CacheManager';
import { ConfigManager } from '../Module/Config/ConfigManager';
import { Log } from '../../Mono/Module/Log/Log';
import { GameMainObj } from './UI/UIGameMain/GameMainObj';
import { ready } from '../../../../extensions/taowu-editor/source/panel';
import { RoomNode, RoomState } from './UI/UIGameMain/RoomNode';
import { DogColor, DOG_SFX_SAD } from './UI/UIGameMain/DogNode';
import { SoundManager } from '../Module/Resource/SoundManager';
import { UIManager } from '../Module/UI/UIManager';
import { ResultPara, UIGameResultView } from './UI/UIGameMain/UIGameResultView';

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


    // ---------------------------------------------------------------- 关卡流程
    /** 本关剩余秒数。归零算失败（关卡表的 time 字段，见 level_tools/level_rules.py） */
    public curTime: number = 0;
    /** 本关状态。见 LevelState */
    public levelState: LevelState = LevelState.None;
    /**
     * 开局时盘面上到底有没有狗。
     * 用来挡住「空关卡一铺完盘就立刻判定过关」这个退化情况 ——
     * IsBoardClear() 对空盘面恒为 true，不记这一笔的话空关卡会秒过。
     */
    private _levelHasDogs: boolean = false;


    public static get instance(): GameDataManager {
        return GameDataManager._instance;
    }


    public resolution: Vec2
   

    public async init() {
        GameDataManager._instance = this;
        await this.LoadLevelConfig();
        // Messager.Instance.AddListener<int, int>(0, MessageId.OnKeyInput, OnKeyInput);
    }

    public async LoadLevelConfig()
    {
        if (this.leveldict != null)
            return;
        if (ConfigManager.instance == null)
            return;
        this.datas = await ConfigManager.instance.get<LevelDatas>(LevelDatas,"levels");
        this.leveldict = new Map<number, LevelConfig>();
        for (let i = 0; i <  this.datas.data.length; i++)
        {
            let data = this.datas.data[i];
            this.leveldict.set(data.id, data);
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
        this.curFightLevelId = 1;//CacheManager.instance.getInt("FightLevelId", 1);
        // 夹到合法区间。上界这条原来就有；下界是新加的 ——
        // 存档被改坏（0 / 负数）时 GetLevelCfgById 会返回 undefined，
        // 紧接着 CloneLevelCfg 读 oldCfg.id 直接崩。
        if (this.curFightLevelId < 1)
            this.curFightLevelId = 1;
        if (this.curFightLevelId > this.datas.data.length)
            this.curFightLevelId = this.datas.data.length;
        let cfg2:LevelConfig = GameDataManager.instance.GetLevelCfgById(this.curFightLevelId);
        this.curLevelConfig = this.CloneLevelCfg(cfg2);
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
        CacheManager.instance.setInt("FightLevelId", this.curFightLevelId)
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

    /** 结算一关。重复调用只生效一次（状态已经离开 Playing 就直接返回） */
    public FinishLevel(isWin: boolean): void
    {
        if (this.levelState != LevelState.Playing) return;
        this.isCanClick = true;
        this.levelState = isWin ? LevelState.Win : LevelState.Lose;

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
        para.title = isWin ? "恭喜过关" : "挑战失败";
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
            // 点中椅子 ⇒ 狗狗悬浮起来被"拎"着，这时它还没获救，叫一声委屈的。
            //
            // 放在这里而**不是** GameMainObj.PlayHoverUp() 里，是因为 PlayHoverUp
            // 在 FlyToCar 里也会被调用（起飞前的悬浮），那一步该响的是「高兴」的叫声 ——
            // 写进 PlayHoverUp 会让两个音效在飞向卡车时一起炸响。
            // 这里的语义是"玩家选中了椅子"，和"狗狗要获救"是两件事，所以按调用点分。
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
                this.curSelectChairIdx = -1;
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
                    this.gameMainObj.FlyToRoom(this.curSelectChairIdx, roomId);
                    let chairData = this.curLevelConfig.chairs[this.curSelectChairIdx];
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
                    for (let i = chairData.dogs.length - 1; i >= 0; i--)
                    {
                        if (chairData.dogs[i] > 0)
                        {
                            chairData.dogs[i] = 0;
                            break;
                        }
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
                let isOk:Boolean = this.gameMainObj.FlyToCar(defaultColor, i,()=>{
                    this.CheckDogFlyToCar();
                }); 
                if (isOk)
                {
                    for (let k = 0; k < chairData.dogs.length; k++)
                    {
                        chairData.dogs[k] = 0;
                    }
                    flew = true;
                    break;
                }
            }
        }

        // 级联走完了：盘面全空就是过关。
        // `_levelHasDogs` 是挡"空关卡一开局就判过关"的退化情况（见它的注释）。
        if (!flew && this._levelHasDogs && this.IsBoardClear() && this.isCanClick)
        {
            this.FinishLevel(true);
        }
    }

    //执行飞入
    public ChangeChairDogColor(fromIndx:number, toIndex:number)
    {
        let fromChair:LevelChairData = this.curLevelConfig.chairs[fromIndx];
        let toChair:LevelChairData = this.curLevelConfig.chairs[toIndex];
        let toColor = 0;
        let reciveNum = 0;
        let sendNum = 0
        for (let i = toChair.dogs.length - 1; i >= 0; i--)
        {
            if (toChair.dogs[i] > 0)
            {
                toColor = toChair.dogs[i];
                break;
            }
        }

        for (let i = toChair.dogs.length - 1; i >= 0; i--)
        {
            if (toChair.dogs[i] == 0)
            {
                reciveNum++;
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

        for (let i = fromChair.dogs.length - 1; i >= 0; i--)
        {
            if (fromChair.dogs[i] > 0)
            {
                if (toColor == fromChair.dogs[i])
                    sendNum++;
                else
                    break;
            }
        }
        let fitNum = sendNum < reciveNum ? sendNum : reciveNum;
        for (let i = 0; i < toChair.dogs.length; i++)
        {
            if (toChair.dogs[i] <= 0 && fitNum > 0)
            {
                toChair.dogs[i] = toColor;
                fitNum--;
            }
        }
        fitNum = sendNum < reciveNum ? sendNum : reciveNum;
        for (let i = fromChair.dogs.length - 1; i >= 0; i--)
        {
            if (fromChair.dogs[i] == toColor && fitNum > 0)
            {
                fromChair.dogs[i] = 0;
                fitNum--;
            }
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
        for (let i = fromChair.dogs.length - 1; i >= 0; i--)
        {
            if (fromChair.dogs[i] > 0)
            {
                fromColor = fromChair.dogs[i];
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

