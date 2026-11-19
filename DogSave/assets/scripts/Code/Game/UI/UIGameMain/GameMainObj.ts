import { _decorator, Button, Component, find, Label, Node, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
import { $ } from '../../../../../../extensions/taowu-editor/source/panel';
import { BattleMode, CrystalPair, GameDataManager, ItemID, LevelConfig, LevelState, SlotFlag } from '../../GameDataManager';
import { ChairNode } from './ChairNode';
import { DogColor, DogNode, DogState, DOG_SFX_HAPPY } from './DogNode';
import { DoorNode, DoorState } from './DoorNode';
import { RoomNode, RoomState } from './RoomNode';
import { SoundManager } from '../../../Module/Resource/SoundManager';
import { load } from '../../../../../../extensions/taowu-editor/source/main';
import { UIManager } from '../../../Module/UI/UIManager';
import { UIGameResultView } from './UIGameResultView';
import { I18NKey } from '../../../Module/Const/I18NKey';
import { I18NManager } from '../../../Module/I18N/I18NManager';
import { UIToast } from '../UICommon/UIToast';
const { ccclass, property } = _decorator;

@ccclass('GameMainObj')
export class GameMainObj extends Component {
      
    @property(Label)
    public levelText: Label;

    /**
     * 顶部倒计时文案（预制体里的 `bg/TopNode/timeBg/time_txt`，设计态写死的是 "120秒"）。
     *
     * 这个 Label 在预制体里一直存在、也一直显示，但**从来没有任何代码写过它** ——
     * 也就是说它显示的是一个和当前关卡无关的假数字。真正的倒计时在
     * GameDataManager.curTime 里，这里只负责把它画出来（见 update / RefreshTimeText）。
     */
    @property(Label)
    public timeText: Label;
    
    @property(Button)
    public settingBtn: Button;
    @property(Button)
    public resetBtn: Button;
    @property(Button)
    public addtimeBtn: Button;

    /**
     * 两个道具按钮右下角的**数量**文案（预制体里 `reset_Button/count_txt`、
     * `add_Button/count_txt`）。
     *
     * 这两块原来是烘在 PNG 里的「+」角标 —— 加号换成数量之后就不能再烘了，
     * 数量是运行时数据（`GameDataManager.GetItemNum(ItemID)`），
     * 所以改成预制体里叠一个 Label，由 `RefreshItemCount()` 写。
     */
    @property(Label)
    public resetCountText: Label;
    @property(Label)
    public addtimeCountText: Label;

    @property(ChairNode)
    public chairNodes:ChairNode[] = [];

    @property(DoorNode)
    public doorNodes:DoorNode[] = [];

    @property(RoomNode)
    public roomNodes:RoomNode[] = [];

    @property(DogNode)
    public NoUsedDogs:DogNode[] = [];

    public UsingdDogs:DogNode[] = [];

    /** 「+20 秒」一次加多少秒 */
    private static readonly ADD_TIME_SECONDS: number = 20;

    /** 重排动画进行中 —— 期间不接受重复点击，也不让盘面被点 */
    private _isShuffling: boolean = false;

    start() {
        GameDataManager.instance.gameMainObj = this;
        // 换关时清掉重排锁：上一关的重排动画可能正好跨过关（结算弹窗盖在盘面上），
        // 那个收尾回调虽然还会跑，但不能指望它 —— 它可能已经被 StopAll 干掉了。
        this._isShuffling = false;
        const i18n = I18NManager.instance;
        if (GameDataManager.instance.gameMode == BattleMode.Main)
            this.levelText.string = i18n != null
                ? i18n.tf(I18NKey.Game_Level_Format, GameDataManager.instance.curFightLevelId)
                : `第${GameDataManager.instance.curFightLevelId}关`;
        else if (GameDataManager.instance.gameMode == BattleMode.Calendar)
            this.levelText.string = i18n != null ? i18n.t(I18NKey.Game_Mode_Daily) : "每日挑战";
        else if (GameDataManager.instance.gameMode == BattleMode.Puzzle)
            this.levelText.string = i18n != null ? i18n.t(I18NKey.Game_Mode_Puzzle) : "拼图挑战";

        this.refreshTips();
        let cfg:LevelConfig = GameDataManager.instance.curLevelConfig;
        for (let i = 0; i < this.chairNodes.length; i++)
        {
            let chairNode:ChairNode = this.chairNodes[i];
            if (i < cfg.chairs.length)
            {
                chairNode.node.active = true;
                chairNode.InitFlipSlot();
                chairNode.RefreshAllSlot(cfg.chairs[i].dogs, i);
            }
            else
                chairNode.node.active = false;
        }


        let levelId = GameDataManager.instance.curFightLevelId;
        let lockIndex = (levelId < 5 || levelId % 5 == 0) ? 2 : 1;
        for (let i = 0; i < this.doorNodes.length; i++)
        {
            let doorNode:DoorNode = this.doorNodes[i];
            doorNode.doorIndex = i + 1;
            doorNode.doorState = i < lockIndex ? DoorState.Idle : DoorState.Lock;
            // ⚠️ 颜色必须跟着一起复位，不能只复位 doorState。
            //
            // `lockIndex` 是**会变小**的：第 5 关是 2（门 0/1 都是 Idle、都被
            // CreateWithColor 赋了色），第 6 关变成 1（门 1 转 Lock）。而
            // `RefreshLock()` 只同步 adsBtn / dogIcon / 车门开合，**不碰 waitDogColor**
            // ⇒ 门 1 带着第 5 关的颜色继续"等"。
            //
            // 后果不是"少一点观感"：`FlyToCar` 找门时**只看 waitDogColor、不看 doorState**，
            //     for (let i = doorNodes.length - 1; i >= 0; i--)
            //         if (doorNodes[i].waitDogColor == color) { toDoor = ...; break; }
            // 找到之后紧接着 `toDoor.doorState = DoorState.Open` ⇒ 狗飞进**锁着的**门，
            // 广告锁被整个绕过；而门还画成锁着的样子（adsBtn 亮着、dogIcon 被 RefreshLock 关掉）。
            // 实测：100 关里 76 关的锁门带着残留色，且这 76 关的残留色**全部**出现在本关盘面上
            // ⇒ 76 关全部可被真的利用。
            //
            // 清掉是安全的：第 8 项已经用严格模型（Lock 门没有颜色）证过 100/100 可解，
            // 所以这一行只会让实机与模型一致，不可能让任何一关变得不可解。
            // 判据见 level_tools/verify_level_loop.py 第 18 项。
            doorNode.waitDogColor = DogColor.None;
            doorNode.RefreshLock();
        }

        for (let i = 0; i < this.doorNodes.length; i++)
        {
            let doorNode:DoorNode = this.doorNodes[i];
            if (doorNode.doorState == DoorState.Idle)
            {
                // 随机一个盘面上有的颜色（不与另一扇门重复）
                let doorColor:DogColor = this.GetRandomDoorColor();
                doorNode.CreateWithColor(doorColor);
            }
        }

        for (let i = 0; i < this.roomNodes.length; i++)
        {
            let roomNode:RoomNode = this.roomNodes[i];
            roomNode.roomIndex = i + 1;
            roomNode.roomState = i < 1 ? RoomState.Free : RoomState.Lock;
            // ⚠️ 同门那边：颜色字段也要复位。狗窝的"里面有没有狗"**完全**由
            // `sleepDogColor != DogColor.None` 决定（见 GameDataManager.SetSelectRoomId）——
            // 非 None 时这个狗窝只能被"悬浮选中"、**收不了狗**。
            //
            // 而 `sleepDogColor` 只在 `RoomNode.start()` 里被置过一次 None，
            // component 的 `start()` **一辈子只跑一次** ⇒ 换关没人清它。
            // 于是：某一关带着狗窝里的狗超时判负（带着狗**不可能过关**：那只狗不在盘面上，
            // 它的颜色永远凑不满一根椅子）⇒ 下一关这个狗窝**看着是空的**
            // （下面那句 dogIcon.node.active = false 把它画没了）却**收不了狗**，
            // 点它还会悬浮一只本关根本不存在的"幽灵狗"。
            // 判据见 level_tools/verify_level_loop.py 第 18 项。
            roomNode.sleepDogColor = DogColor.None;
            roomNode.dogIcon.node.active = false;
            roomNode.RefreshLock();
        }
        // start() 每次换关都会被 GameDataManager.SetLevelCfgById() 重调，
        // 而 Node.on 是**追加**、不去重 ⇒ 不先 off 的话每过一关就多挂一个监听，
        // 玩到第 100 关时点一次 settingBtn 会触发 100 次回调。
        // （同一个坑 UIGameResultView.bindButtons/unbindButtons 是成对写的。）
        this.settingBtn.node.off(Button.EventType.CLICK, this.onClickEvent, this);
        this.settingBtn.node.on(Button.EventType.CLICK, this.onClickEvent, this);

        // ⚠️ 这里原来写的是 `this.onResetEvent` —— 本类**没有**这个方法（只有
        //    onResetClickEvent）。传 undefined 进去，Cocos 不会报错，只是这个按钮
        //    一辈子不响应：点上去连点击音都没有。改成真正的处理函数。
        this.resetBtn.node.off(Button.EventType.CLICK, this.onResetClickEvent, this);
        this.resetBtn.node.on(Button.EventType.CLICK, this.onResetClickEvent, this);

        this.addtimeBtn.node.off(Button.EventType.CLICK, this.onAddTimeClickEvent, this);
        this.addtimeBtn.node.on(Button.EventType.CLICK, this.onAddTimeClickEvent, this);

        // timeText 的 @property 绑定是新增的（预制体里的 "timeText" 字段）。
        // 兜底：万一编辑器没把这条绑定读进来（或有人在编辑器里解绑了），按路径再找一次。
        // 路径取自预制体的实际结构 bg/TopNode/timeBg/time_txt，名字唯一，
        // 不踩"同名子节点只认第一个"的坑（结算弹窗那两个同名 bg 就是被这个坑过的）。
        if (this.timeText == null)
        {
            let timeNode: Node = find("bg/TopNode/timeBg/time_txt", this.node);
            if (timeNode != null) this.timeText = timeNode.getComponent(Label);
        }

        // 数量 Label 的兜底，同上。⚠️ 路径必须带上按钮名 ——
        // 两个按钮下都叫 `count_txt`，只写 "count_txt" 会只认第一个（find 取首个匹配），
        // 加时按钮就永远刷不到数字。
        if (this.resetCountText == null)
        {
            let n: Node = find("bg/bottomNode/reset_Button/count_txt", this.node);
            if (n != null) this.resetCountText = n.getComponent(Label);
        }
        if (this.addtimeCountText == null)
        {
            let n: Node = find("bg/bottomNode/add_Button/count_txt", this.node);
            if (n != null) this.addtimeCountText = n.getComponent(Label);
        }
        // start() 每次换关都会被重调 ⇒ 顺带把数量刷一遍（数量是跨关的，换关后可能已经变了）
        this.RefreshItemCount();

        // 倒计时是"这一关"的状态，必须在**铺完盘之后**才启动。
        // start() 每次换关都会被 GameDataManager.SetLevelCfgById 再调一遍，
        // 所以这里同时也是"重开一关时把倒计时重置"的地方。
        GameDataManager.instance.StartLevel();
        this.RefreshTimeText();
        // ⚠️ 必须在**铺完盘之后**：GenerateCrystalPairs 读的是 curLevelConfig.chairs[*].dogs，
        //    而 flags 数组是这里现建的（关卡表里没有这个字段，见 LevelChairData.flags）。
        //    放在 RefreshAllSlot 之前也不会崩，只是会在还没建好的 flags 上写标记。
        this.ApplyCrystalPairs();
        for (let i = 0; i < this.UsingdDogs.length; i++)
        {
            let dog = this.UsingdDogs[i];
            this.NoUsedDogs.unshift(dog);//添加到头部
            dog.StopAnim();
            dog._stopTween();
            dog.node.active = false
        }
        this.UsingdDogs = [];
    }

    private async onClickEvent(button: Button){
        console.log('onClickEvent setting');
        if (SoundManager.instance != null) 
            SoundManager.instance.playSound(SoundManager.SFX_CLICK);
        // await UIManager.instance.openBox(UIGameResultView,UIGameResultView.PrefabPath);
        GameDataManager.instance.FinishLevel(false);
    }

    // ------------------------------------------------------------ 道具（数量 / 扣减）
    /**
     * 把两个道具的**剩余数量**写到按钮右下角。
     *
     * 数据源只有一个：`GameDataManager.GetItemNum()` —— 这里**只读不写**，
     * 扣减走 `ConsumeItem()`。`start()`（每次换关）+ 每次消耗后各刷一次。
     *
     * 空值判断是给"编辑器里有人解绑了 @property、路径兜底也没找到"的情况留的：
     * 少一个数字不该让整个主界面报错。
     */
    private RefreshItemCount(): void
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null) return;
        if (this.resetCountText != null)
            this.resetCountText.string = String(gdm.GetItemNum(ItemID.RefreshLevelItem));
        if (this.addtimeCountText != null)
            this.addtimeCountText.string = String(gdm.GetItemNum(ItemID.AddTimeItem));
    }

    /**
     * 数量够不够用。不够就弹「道具不足」并返回 false ——
     * 调用方拿到 false 直接 return，别再往下走。
     */
    private CheckItem(id: ItemID): boolean
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null) return false;
        if (gdm.GetItemNum(id) > 0) return true;

        const i18n = I18NManager.instance;
        UIToast.showToast(i18n != null ? i18n.t(I18NKey.Game_Toast_NoItem) : "道具不足");
        return false;
    }

    /**
     * 消耗一个道具并刷新角标。
     *
     * ⚠️ 必须**先 CheckItem 再用**，这里不重复判数量：`AddItemNum` 只在 key 存在时生效，
     * 而 key 是 `init()` 里建好的（各 1 个），不会凭空多出来。
     */
    private ConsumeItem(id: ItemID): void
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null) return;
        gdm.AddItemNum(id, -1);
        this.RefreshItemCount();
    }

    /**
     * 「重排」按钮：把当前盘面的狗**打乱重排**，并播放交换动画。
     *
     * 流程刻意分成"先改数据、再播动画"（TODO 里的建议）：
     *   1. `GameDataManager.ShuffleBoard()` 只置换颜色，不动位置 ⇒ 每根椅子的占位数量、
     *      颜色总数都不变，不会写出带空洞的非法盘面；
     *   2. 这里拿洗牌后的数据和 `ChairNode.sortDog[j].DogColor` 逐格比对，
     *      **只给真的变了颜色**的那些格播 `PlayShuffleSwap`；
     *   3. 动画期间把 `isCanClick` 锁住 —— 否则玩家能在狗还是旧颜色的时候点它搬走，
     *      搬完数据是新的、画面是旧的，两边彻底错位；
     *   4. 收尾补一次 `CheckDogFlyToCar()`：重排有可能刚好把某根椅子凑满同色，
     *      和普通走子一样该让它飞向卡车。
     *
     * 有狗悬在半空（选中态）时先让它落回椅子再洗 —— 悬浮的那批是 AnimDog **拷贝**，
     * 数据洗了、拷贝还是旧颜色，会看到"一只颜色对不上的狗飞回去"。
     */
    private onResetClickEvent(button: Button){
        if (SoundManager.instance != null) 
            SoundManager.instance.playSound(SoundManager.SFX_CLICK);

        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null || gdm.levelState != LevelState.Playing) return;
        // 有狗正在飞 / 正在结算，先别动盘面
        if (!gdm.isCanClick || this._isShuffling) return;
        // 道具数量在这里判、**扣减放在 DoShuffleBoard 里**：
        // 洗牌有可能"洗完没变化"（盘面不足 2 格 / 全是同色）而直接 return，
        // 那种情况下不该白扣一个。
        if (!this.CheckItem(ItemID.RefreshLevelItem)) return;

        if (gdm.curSelectChairIdx >= 0 || gdm.curSelectRoomIdx > 0)
        {
            // 椅子是 0 基、狗窝是 1 基（同 SetSelectRoomId 里的说明）
            if (gdm.curSelectChairIdx >= 0) this.PlayEndHover(gdm.curSelectChairIdx);
            if (gdm.curSelectRoomIdx > 0) this.PlayEndHoverByRoomId(gdm.curSelectRoomIdx);
            gdm.curSelectChairIdx = -1;
            gdm.curSelectRoomIdx = -1;
            // PlayEndHover 是 0.1s 的 tween，等它把 AnimDog 还回池子再洗
            this.scheduleOnce(() => this.DoShuffleBoard(), 0.16);
            return;
        }
        this.DoShuffleBoard();
    }

    /** 重排的实际执行（数据已在 ShuffleBoard 里换好，这里只驱动动画与锁） */
    private DoShuffleBoard(): void
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null || gdm.levelState != LevelState.Playing || this._isShuffling) return;

        if (!gdm.ShuffleBoard()) return;   // 盘面不足 2 格 / 洗完没变化，什么都不用做

        // 真的洗了才扣道具（上面那句 return 的情况一个都不扣）
        this.ConsumeItem(ItemID.RefreshLevelItem);

        this._isShuffling = true;
        gdm.isCanClick = false;

        const cfg: LevelConfig = gdm.curLevelConfig;
        let maxDelay: number = 0;
        for (let i = 0; i < cfg.chairs.length && i < this.chairNodes.length; i++)
        {
            const chairNode: ChairNode = this.chairNodes[i];
            if (chairNode == null || !chairNode.node.active) continue;

            const dogs: number[] = cfg.chairs[i].dogs;
            for (let j = 0; j < chairNode.sortDog.length && j < dogs.length; j++)
            {
                const dog: DogNode = chairNode.sortDog[j];
                if (dog == null) continue;
                if (dogs[j] <= 0) continue;              // 空位不参与
                if (dog.DogColor == dogs[j]) continue;   // 颜色没变就别白抖一下

                // 错峰：按椅子铺开、再按槽位细错开，看起来像"一波波洗过去"
                const delay: number = i * 0.03 + j * 0.02;
                if (delay > maxDelay) maxDelay = delay;
                dog.PlayShuffleSwap(dogs[j], delay);
            }
        }

        // PlayShuffleSwap 本体 0.34s（0.10 + 0.16 + 0.08）
        // 收尾回调里要防"洗到一半换关"：`SetLevelCfgById` 每次都 Clone 一份新配置，
        // 所以拿引用当"第几关"的令牌就够了。换关时 `start()` 已经清过 _isShuffling，
        // 这里直接退出，别去动新关的 isCanClick / 别在新关盘面上触发飞行。
        const cfgRef: LevelConfig = cfg;
        this.scheduleOnce(() => {
            if (gdm.curLevelConfig !== cfgRef) return;
            this._isShuffling = false;
            gdm.isCanClick = true;
            // 洗牌途中可能刚好超时判负（FinishLevel 已把状态切走），那就别再起飞了
            if (gdm.levelState != LevelState.Playing) return;
            // 重排后可能刚好凑满一根椅子 —— 交给统一的判定去起飞
            gdm.CheckDogFlyToCar();
        }, maxDelay + 0.36);
    }

    /**
     * 「+20 秒」按钮。
     *
     * 只加时间、不动盘面。加完**立刻**刷新 Label —— `update()` 只在"整秒数变了"才写，
     * 而从 47.6s 加到 67.6s 的下一秒 before=68/after=68 可能相等，那一帧就不写了。
     * 动画照 TODO 的要求：先放大 → 左右摇晃 → 缩回原大小。
     */
    private onAddTimeClickEvent(button: Button){
        if (SoundManager.instance != null) 
            SoundManager.instance.playSound(SoundManager.SFX_CLICK);

        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null || gdm.levelState != LevelState.Playing) return;
        if (!this.CheckItem(ItemID.AddTimeItem)) return;

        gdm.curTime += GameMainObj.ADD_TIME_SECONDS;
        this.RefreshTimeText();
        this.PlayTimeAddAnim();
        this.ConsumeItem(ItemID.AddTimeItem);
    }

    /** 倒计时文字的"+时间"反馈：放大 → 摇晃 → 还原 */
    private PlayTimeAddAnim(): void
    {
        const node: Node = this.timeText != null ? this.timeText.node : null;
        if (node == null) return;

        // 连点不要叠加：先掐掉上一段，再从头播
        Tween.stopAllByTarget(node);
        node.setScale(1, 1, 1);
        node.angle = 0;

        tween(node)
            .to(0.12, { scale: new Vec3(1.5, 1.5, 1) }, { easing: 'backOut' })
            .to(0.06, { angle: 9 })
            .to(0.08, { angle: -9 })
            .to(0.08, { angle: 7 })
            .to(0.08, { angle: -7 })
            .to(0.06, { angle: 0 })
            .to(0.14, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .start();
    }
    

    /**
     * **随机**挑一个颜色，给一扇 Idle 的门当"它在等的颜色"。
     *
     * 规则（按最初那条注释的意图实现 —— 名字和意图终于一致了）：
     *   1) 候选池 = **盘面上出现过的颜色**（同一颜色多只只算一次）。
     *      必须是"盘面上有的颜色"：门等一个谁都凑不出来的颜色就是死局。
     *   2) 避重：剔掉**其它正在收狗的门**（Idle / Open）已经等着的颜色，
     *      于是两扇 Idle 门拿到不同颜色；`lockIndex=1` 时只有一扇门，自然不重复。
     *      Lock 门不参与避重 —— 它的 `waitDogColor` 是 `None`(=0)，不是真实颜色。
     *   3) 剩下的候选里**等概率随机**选一个。
     *
     * ⚠️ 随机之后门色不再确定 ⇒ 离线判据必须按"门色取遍所有可能"来验。
     *    `level_tools/verify_level_loop.py` 第 8 项已改成 for-all 模型
     *    （门色分支展开，任一次抽奖都能赢才算赢），实测结果见该脚本输出。
     */
    GetRandomDoorColor() : DogColor
    {
        // let cfg:LevelConfig = GameDataManager.instance.curLevelConfig;

        // // 1) 盘面上出现过的颜色（去重）
        // let onBoard:number[] = [];
        // for (let i = 0; i < cfg.chairs.length; i++)
        // {
        //     let list = cfg.chairs[i].dogs;
        //     for (let j = 0; j < list.length; j++)
        //     {
        //         let c:number = list[j];
        //         if (c > 0 && onBoard.indexOf(c) < 0) onBoard.push(c);
        //     }
        // }
        // if (onBoard.length <= 0) return DogColor.None;

        // // 2) 避重：剔掉其它"正在收狗"的门已经等着的颜色
        // let candidates:number[] = [];
        // for (let i = 0; i < onBoard.length; i++)
        // {
        //     let used = false;
        //     for (let k = 0; k < this.doorNodes.length; k++)
        //     {
        //         let d = this.doorNodes[k];
        //         if (d == null) continue;
        //         if (d.doorState != DoorState.Idle && d.doorState != DoorState.Open) continue;
        //         if (d.waitDogColor == onBoard[i]) { used = true; break; }
        //     }
        //     if (!used) candidates.push(onBoard[i]);
        // }
        // // 兜底：颜色全被别的门占完了（例如盘面上只有 1 种颜色却有 2 扇门）。
        // // 这时候宁可和别的门重复，也不能返回 None —— None 的门谁都匹配不上，
        // // 玩家就再也飞不走任何一根椅子了。
        // if (candidates.length <= 0) candidates = onBoard;

        // let idx:number = Math.floor(Math.random() * candidates.length);
        // return candidates[idx] as DogColor;
        return this.GetFirstChairBottomColor();
    }


    //不能删除 预留方案
     GetFirstChairBottomColor() : DogColor
    {
        let doorColor:DogColor = DogColor.None;
        let cfg:LevelConfig = GameDataManager.instance.curLevelConfig;
        for (let i = 0; i < cfg.chairs.length; i++)
        {
            let list = cfg.chairs[i].dogs;
            for (let j = 0; j < list.length; j++)
            {
                if (list[j] > 0 && !this.IsHaveSameInDoor(list[j]))
                {
                    return list[j];
                }
            }
        }
        return doorColor;
    }

    IsHaveSameInDoor(color:DogColor) : Boolean
    {
        let isHave = false;
        for (let k = 0; k < this.doorNodes.length; k++)
        {
            if (color == this.doorNodes[k].waitDogColor)
            {
                isHave = true;
                return isHave;
            }
        }
        return isHave
    }

    update(deltaTime: number) {
        let gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null || gdm.levelState != LevelState.Playing) return;

        // 只在"秒数真的变了"的时候写 Label —— 给 Label.string 赋值会触发重新排版，
        // 每帧无脑写等于每帧重排一次文字。
        // 顺带一提 deltaTime 是秒，和关卡表里的 time（秒）同一量纲。
        let before: number = gdm.GetRemainSeconds();
        gdm.TickLevel(deltaTime);
        if (gdm.GetRemainSeconds() != before) this.RefreshTimeText();
    }

    /**
     * 把剩余秒数画到 time_txt 上。格式跟设计态一致："240秒"
     *
     * public 是给**复活**用的：`update()` 只在"秒数变了"的时候才写 Label，
     * 而复活把 curTime 从 0 直接跳到 30 —— 下一帧 before=30、after=ceil(29.98)=30，
     * 前后相等 ⇒ 那一帧不写。不显式补这一下，盘面已经能动了、倒计时还停在"0秒"。
     */
    public RefreshTimeText()
    {
        if (this.timeText == null) return;
        const secs = GameDataManager.instance.GetRemainSeconds();
        const i18n = I18NManager.instance;
        this.timeText.string = i18n != null
            ? i18n.tf(I18NKey.Game_Time_Format, secs)
            : `${secs}秒`;
    }

    /**
     * 关卡底部的操作提示（`bg/bottomNode/tips/Label`）。
     *
     * 这句是**静态文案**，但预制体里没有挂 I18NText（预制体由资源包拆出来，没手改过），
     * 所以在这里按路径找一次、按当前语言写一次。start() 每关都会被重调，
     * 顺手也就把"中途切语言"的情况补上了。
     */
    public refreshTips(): void
    {
        if (this._tipsLabel == null)
        {
            const node = this.node != null ? this.node.getChildByPath("bg/bottomNode/tips/Label") : null;
            this._tipsLabel = node != null ? node.getComponent(Label) : null;

            // 中文那句话是 15 个字、框宽 508；英文同样意思要长得多 ⇒ 放开到 820 并允许缩字
            if (this._tipsLabel != null)
            {
                const ut = this._tipsLabel.node.getComponent(UITransform);
                if (ut != null) ut.width = 820;
                this._tipsLabel.overflow = Label.Overflow.SHRINK;
            }
        }
        if (this._tipsLabel == null) return;

        const i18n = I18NManager.instance;
        if (i18n == null) return;
        const text = i18n.t(I18NKey.Game_Tips_Match);
        if (text != null && text !== String(I18NKey.Game_Tips_Match)) this._tipsLabel.string = text;
    }

    private _tipsLabel: Label = null;

    // ------------------------------------------------------------ 冰晶 / 锤子（第 5 关起）
    /**
     * 开局生成配对并套上覆盖层。`start()` 里**铺完盘之后**调。
     *
     * 数据（谁被冻住、谁抱锤子）在 `GameDataManager.flags` 里，这里只负责画。
     * 少于 3 种颜色的关卡不会出对（见 GenerateCrystalPairs 的分档），
     * 3 色关卡（第 5~14 关）有一半概率是 0 对 —— 这是规则本身决定的，不是没接上。
     */
    public ApplyCrystalPairs(): void
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null) return;
        const n: number = gdm.GenerateCrystalPairs();
        if (n > 0)
        {
            const desc: string = gdm.crystalPairs
                .map(p => `冻${p.crystalColor}(椅${p.crystalChair})/锤${p.holderColor}(椅${gdm.GetChairOfHolder(p)})`)
                .join(' ');
            console.log(`[Crystal] 第${gdm.curFightLevelId}关生成 ${n} 对：${desc}`);
        }
        this.RefreshCrystalOverlays();
    }

    /**
     * 按数据把冰晶 / 锤子覆盖层重画一遍。**幂等**，随时可以调 ——
     * 搬狗、进狗窝、破冰之后都靠它把画面对齐（数据永远是权威）。
     */
    public RefreshCrystalOverlays(): void
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null || gdm.curLevelConfig == null) return;

        for (let i = 0; i < this.chairNodes.length; i++)
        {
            const chairNode: ChairNode = this.chairNodes[i];
            if (chairNode == null) continue;
            const chairId: number = chairNode.chairId;
            for (let j = 0; j < chairNode.sortDog.length; j++)
            {
                const dog: DogNode = chairNode.sortDog[j];
                if (dog == null) continue;
                const hasDog: boolean = dog.DogColor > DogColor.None;
                const flag: number = gdm.GetSlotFlag(chairId, j);
                dog.ShowCrystal(hasDog && flag == SlotFlag.Crystal);

                if (hasDog && flag == SlotFlag.Hammer)
                {
                    const pair: CrystalPair = gdm.GetUnbrokenPairByHolderColor(dog.DogColor);
                    if (pair != null) dog.ShowHammer(pair.crystalColor);
                    else dog.HideHammer();
                }
                else dog.HideHammer();
            }
        }

        // 锤子被停进狗窝的那段时间，锤子画在窝上
        for (let i = 0; i < this.roomNodes.length; i++)
        {
            const room: RoomNode = this.roomNodes[i];
            if (room == null) continue;
            const hammerColor: number = gdm.GetHammerColorInRoom(room.roomIndex);
            if (hammerColor >= 0 && room.sleepDogColor > DogColor.None)
            {
                room.ShowHammer(hammerColor);
            }
            else room.HideHammer();
        }
    }

    private GetDogNodeBySlot(chairId: number, slot: number): DogNode
    {
        const chairNode: ChairNode = this.GetChairNodeByChairId(chairId);
        if (chairNode == null) return null;
        if (slot < 0 || slot >= chairNode.sortDog.length) return null;
        return chairNode.sortDog[slot];
    }

    /**
     * 某一根椅子上、某个槽位的狗被消除之后，把它的锤子甩出去砸冰晶。
     *
     * 由 `GameDataManager.CheckDogFlyToCar()` 在 `FlyToCar` 返回 true **之后**调，
     * 而且必须赶在清 `dogs / flags` 之前 —— 那只狗一旦从数据里消失，
     * 这里就再也算不出它的世界坐标了。
     */
    public PlayHammerBreakFromChair(chairId: number, slot: number): void
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null) return;
        const dog: DogNode = this.GetDogNodeBySlot(chairId, slot);
        if (dog == null || dog.DogColor <= DogColor.None) return;

        const pair: CrystalPair = gdm.GetUnbrokenPairByHolderColor(dog.DogColor);
        if (pair == null) return;

        // 狗**先带着锤子飞一段**（FlyToCar 里 0.3s 后才真正起飞），锤子再脱手。
        // 立刻收掉的话，画面上是"狗跑了、锤子凭空消失"，玩家根本看不到"它抱着锤子"。
        // 这里先留一份备用坐标：万一 0.34s 后那只狗已经被回收，仍然要能把冰晶敲开 ——
        // 敲不开这一对就永久锁死，那根椅子永远飞不了。
        const fallback: Vec3 = gdm.LocalToWorld(dog.node.parent, dog.node.position);
        const cfgRef: LevelConfig = gdm.curLevelConfig;
        this.scheduleOnce(() => {
            // 0.34s 内换关的话，盘面已经换了一批节点 —— 别拿旧关卡的一对去砸新关卡
            if (gdm.curLevelConfig !== cfgRef) return;
            const alive: boolean = dog != null && dog.node != null && dog.node.active;
            const fromWorld: Vec3 = alive
                ? gdm.LocalToWorld(dog.node.parent, dog.node.position)
                : fallback;
            if (alive) dog.HideHammer();
            this.PlayHammerBreak(pair, fromWorld);
        }, 0.34);
    }

    /**
     * 抱锤子的狗被消除（跟着椅子飞向卡车）之后：锤子从原地飞向冰晶狗，砸碎冰晶。
     *
     * 用一个**临时节点**当锤子，而不是复用狗身上的那个 —— 那只狗正在飞、马上要被
     * `chairNode.node.active = false` 一起关掉，锤子挂在它身上会跟着消失。
     */
    private async PlayHammerBreak(pair: CrystalPair, fromWorld: Vec3): Promise<void>
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (gdm == null || pair == null || pair.broken) return;

        const crystalDog: DogNode = this.GetDogNodeBySlot(pair.crystalChair, pair.crystalSlot);
        const sf: SpriteFrame = await DogNode.LoadHammerFrame(pair.crystalColor);
        // 等图期间可能已经换关（crystalPairs 会被重建）—— 旧关卡的一对就别再动了
        if (gdm.crystalPairs.indexOf(pair) < 0) return;
        if (crystalDog == null || !crystalDog.node.active || sf == null)
        {
            // 冰晶狗不在了（理论上不该发生）也别把这一对卡住：直接按已破处理
            gdm.BreakCrystal(pair);
            this.RefreshCrystalOverlays();
            return;
        }

        // 锤子挂在一个"握柄轴"节点上：Sprite 放进子节点、整体挪开 grip 偏移，
        // 旋转轴就搬到了**手握的位置**。
        // 为什么不能直接转贴图中心：锤头离贴图中心只有 14px，绕着中心转等于让锤子
        // 原地打转（头几乎不动、柄在甩）—— 这正是上一版"没有往下砸的感觉"的原因。
        // 绕握柄转，锤头离轴 45px，才会扫出一道真正的圆弧。
        const fly: Node = new Node("hammerFly");
        fly.layer = this.node.layer;
        this.node.addChild(fly);
        fly.setSiblingIndex(this.node.children.length - 1);

        const spNode: Node = new Node("hammerSprite");
        spNode.layer = fly.layer;
        fly.addChild(spNode);
        spNode.setPosition(-GameMainObj.HAMMER_GRIP_X, -GameMainObj.HAMMER_GRIP_Y, 0);
        // 与 DogNode.prefab 里 hammer 覆盖层的尺寸一致（84×84，见 ice_src/add_overlay_nodes.py）
        spNode.addComponent(UITransform).setContentSize(84, 84);
        const sp: Sprite = spNode.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = sf;

        const from: Vec3 = gdm.WorldToLocal(this.node, fromWorld);
        const toWorld: Vec3 = gdm.LocalToWorld(crystalDog.node.parent, crystalDog.node.position);
        const to: Vec3 = gdm.WorldToLocal(this.node, toWorld);

        // 起点 = 狗身上覆盖层的中心 (14,-26) + 握柄偏移 —— 脱手的那一帧锤子不会"跳"。
        fly.setPosition(from.x + GameMainObj.HAMMER_HOLD_X + GameMainObj.HAMMER_GRIP_X,
                        from.y + GameMainObj.HAMMER_HOLD_Y + GameMainObj.HAMMER_GRIP_Y, 0);

        // 抱在怀里的姿态 = 覆盖层的 -10°（prefab 里就是这么歪着放的）
        fly.angle = GameMainObj.HAMMER_ANG_HELD;

        // 轨迹：抛到两点上方 → 滑到冰晶正上方 → **举起来蓄力** → 抡下去 → 触底回弹。
        // 总时长约 1.03s（旧版 0.4s，用户反馈"飞得太快"）。
        //
        // ⚠️ 这里摆的是**握柄**，但玩家看的是**锤头**落在哪。所以每个关键帧都先定
        // "锤头要到哪"，再反算握柄该放哪（PivotForHead）—— 直接按握柄摆的话，
        // 锤头会永远差一个锤身，砸不到冰晶上。
        const arc: Vec3 = new Vec3((from.x + to.x) / 2, Math.max(from.y, to.y) + 110, 0);
        const pAbove: Vec3 = GameMainObj.PivotForHead(to.x, to.y + 118, GameMainObj.HAMMER_ANG_ABOVE, new Vec3());
        const pWind: Vec3 = GameMainObj.PivotForHead(to.x + 6, to.y + 152, GameMainObj.HAMMER_ANG_WIND, new Vec3());
        const pHit: Vec3 = GameMainObj.PivotForHead(to.x, to.y + 20, GameMainObj.HAMMER_ANG_HIT, new Vec3());
        const pRest: Vec3 = GameMainObj.PivotForHead(to.x, to.y + 32, GameMainObj.HAMMER_ANG_HIT + 5, new Vec3());

        tween(fly)
            .to(0.46, { position: arc, angle: GameMainObj.HAMMER_ANG_FLY }, { easing: 'sineOut' })
            .to(0.24, { position: pAbove, angle: GameMainObj.HAMMER_ANG_ABOVE }, { easing: 'sineInOut' })
            // 举起来：握柄再往上抬 30 多像素、锤头朝天 —— 给玩家"要砸了"的预告
            .to(0.16, { position: pWind, angle: GameMainObj.HAMMER_ANG_WIND }, { easing: 'sineOut' })
            // 抡下去：0.11s 转 176°（-34° → -210°），锤头从朝天一路扫到朝下
            .to(0.11, { position: pHit, angle: GameMainObj.HAMMER_ANG_HIT - 6, scale: new Vec3(1.12, 1.12, 1) },
                { easing: 'quadIn' })
            // 触底回弹：角度收 5°、锤头抬 12px，砸下去那一下才有"吃到力"的手感
            .to(0.06, { position: pRest, angle: GameMainObj.HAMMER_ANG_HIT + 2, scale: new Vec3(1, 1, 1) },
                { easing: 'sineOut' })
            .call(() => {
                fly.destroy();
                gdm.BreakCrystal(pair);
                this.PlayCrystalBreak(crystalDog);
            })
            .start();
    }

    // ------------------------------------------------------------ 锤子飞行动画的几何
    //
    // 锤子图是"头朝上、柄朝下"再整体歪 **-24°** 烘出来的（见 ice_src/build_assets.py
    // 里那句 `rotate(-24 64 64)`），所以锤头**不在正上方**，而是偏左上 24°：
    // 角度为 0 时锤头方向是 114°。按"锤头朝上 = 90°"去算角度，锤子会整把歪 24°，
    // 这就是上一版"砸下去朝向没对"的根因。
    /** 角度 0 时锤头方向（度） */
    private static readonly HAMMER_HEAD_BASE: number = 114;
    /**
     * 握柄轴 → 锤头中心的距离（px）。
     * 84×84 显示尺寸下按贴图 alpha 实测：锤头中心在轴 +13.7px、握柄在轴 -31.5px，
     * 所以两者相距 45px。见 ice_src/preview_hammer_swing.py。
     */
    private static readonly HAMMER_HEAD_DIST: number = 45;

    /**
     * 贴图中心 → 握柄（旋转轴）的偏移。Sprite 挂在子节点上时往反方向挪这么多，
     * 就等于把轴搬到手握的位置。
     */
    private static readonly HAMMER_GRIP_X: number = 12.8;
    private static readonly HAMMER_GRIP_Y: number = -28.8;

    /** 覆盖层相对狗的位置 */
    private static readonly HAMMER_HOLD_X: number = 14;
    private static readonly HAMMER_HOLD_Y: number = -26;

    /** 抱在怀里（= prefab 里 hammer 节点的角度） */
    private static readonly HAMMER_ANG_HELD: number = -10;
    /** 飞行途中：略微前倾，看得出是被"带着走"的 */
    private static readonly HAMMER_ANG_FLY: number = 14;
    /** 悬在冰晶正上方：锤头基本朝天 */
    private static readonly HAMMER_ANG_ABOVE: number = -2;
    /** 蓄力：锤头朝天并往右后仰 */
    private static readonly HAMMER_ANG_WIND: number = -34;
    /**
     * 砸中：-210° ⇒ 锤头方向 114-210 = -96°，即**几乎垂直朝下**。
     * 用 -210 而不是 +150（两者视觉等价），是为了让 tween 从 -34 一路**递减**过去，
     * 旋转方向始终一致（顺时针抡下来）；跨 ±180 回绕会让中间帧反向抽一下。
     */
    private static readonly HAMMER_ANG_HIT: number = -210;

    /** 角度 a 时，锤头中心相对**握柄轴**的偏移 */
    private static HeadOffset(a: number, out: Vec3): Vec3
    {
        const rad: number = (GameMainObj.HAMMER_HEAD_BASE + a) * Math.PI / 180;
        return out.set(GameMainObj.HAMMER_HEAD_DIST * Math.cos(rad),
                       GameMainObj.HAMMER_HEAD_DIST * Math.sin(rad), 0);
    }

    /** 想让**锤头**落在 (x, y)，握柄轴该放哪 */
    private static PivotForHead(x: number, y: number, a: number, out: Vec3): Vec3
    {
        const off: Vec3 = GameMainObj.HeadOffset(a, new Vec3());
        return out.set(x - off.x, y - off.y, 0);
    }

    /** 冰晶碎裂：弹一下 + 淡出，然后按数据重画（这时冰晶格已经恢复成普通格） */
    private PlayCrystalBreak(dog: DogNode): void
    {
        // 砸中的这一帧就解冻：玩家要看到"冰一碎，狗立刻又开始喘气"。
        // 不能等 0.24s 淡出结束后的 RefreshCrystalOverlays —— 那样会晚半拍。
        if (dog != null) dog.Unfreeze();

        const c: Sprite = dog != null ? dog.crystalIcon : null;
        const n: Node = c != null ? c.node : null;
        if (n == null)
        {
            this.RefreshCrystalOverlays();
            return;
        }
        let op: UIOpacity = n.getComponent(UIOpacity);
        if (op == null) op = n.addComponent(UIOpacity);
        op.opacity = 255;
        n.setScale(1, 1, 1);

        Tween.stopAllByTarget(n);
        Tween.stopAllByTarget(op);
        tween(n)
            .to(0.08, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'backOut' })
            .to(0.16, { scale: new Vec3(1.04, 1.04, 1) })
            .start();
        tween(op)
            .to(0.24, { opacity: 0 })
            .call(() => {
                n.active = false;
                n.setScale(1, 1, 1);
                op.opacity = 255;
                this.RefreshCrystalOverlays();
            })
            .start();
    }

    /**
     * 把"这只狗抱不抱锤子"复制到它的**动画拷贝**（AnimDog）上。
     *
     * 为什么要单独做：选中椅子时抬起来的是 `NoUsedDogs` 池子里的另一只节点，
     * 它跟槽位上的那只**不是同一个对象**，锤子是挂在槽位那只身上的。
     * 不复制的话，玩家会看到"槽位上的狗抱着锤子，抬到半空的那只却空着手"，
     * 接着飞向别的椅子、落地之后锤子又冒出来 —— 中间断了一截。
     */
    private CopyHammerOverlay(animDog: DogNode, chairId: number, slot: number, color: DogColor): void
    {
        const gdm: GameDataManager = GameDataManager.instance;
        if (animDog == null || gdm == null) return;
        if (gdm.GetSlotFlag(chairId, slot) != SlotFlag.Hammer)
        {
            animDog.HideHammer();
            return;
        }
        const pair: CrystalPair = gdm.GetUnbrokenPairByHolderColor(color);
        if (pair != null) animDog.ShowHammer(pair.crystalColor);
        else animDog.HideHammer();
    }

    PlayHoverUpByRoomId(roomId:number) 
    {
        let roomNode = this.GetRoomNode(roomId);
        let dogColor = roomNode.sleepDogColor;
        // 先把 AnimDog 借到手再动 dogIcon。借不到就整个返回 —— 反过来写（先隐 dogIcon
        // 再借）一旦池子空了，狗窝的图标被藏起来却没有人再放回来。
        let freeDog:DogNode = this.GetUnusedAnimDog();
        if (freeDog == null) return;
        roomNode.dogIcon.node.active = false;
        roomNode.AnimDog = freeDog;
        freeDog.AnimDog = roomNode.dogNode;
        let out:Vec3 = GameDataManager.instance.LocalToWorld(roomNode.dogIcon.node.parent, roomNode.dogIcon.node.position);
        let newpos:Vec3 = GameDataManager.instance.WorldToLocal(freeDog.node.parent, out);
        freeDog.node.position = newpos;
        freeDog.CreateDog(roomNode.sleepDogColor, -1);
        // 窝里这只如果抱着锤子，悬浮的拷贝也得抱上（见 CopyHammerOverlay）
        const roomHammer: number = GameDataManager.instance.GetHammerColorInRoom(roomId);
        if (roomHammer >= 0) freeDog.ShowHammer(roomHammer);
        else freeDog.HideHammer();
        freeDog.PlayHoverUp();
    }

    //悬浮椅子上的狗狗
    PlayHoverUp(chairId:number) {

        let chairNode:ChairNode = this.GetChairNodeByChairId(chairId);
        let len = chairNode.sortDog.length;
        let firstColor = DogColor.None;
        for (let i = len - 1; i >= 0; i--)
        {
            // 被冰晶封住的那只**抬不起来** —— 它下面压着的狗自然也出不来。
            // 少了这一句，玩家会看到冰晶狗连同冰晶一起飘在半空（而 IsCanChange
            // 又拒绝这次搬动），看起来像"点了没反应 + 一只浮空的狗"。
            if (GameDataManager.instance.IsSlotCrystal(chairId, i)) break;
            let dogNode = chairNode.sortDog[i];
            if (dogNode.DogState == DogState.None)
                continue;
            if (firstColor == DogColor.None)
                firstColor = dogNode.DogColor;
            if (firstColor == dogNode.DogColor)
            {
                // 先借再隐。反过来写（先 `active = false` 再借）一旦借不到，这只狗会被
                // 藏起来却没有悬浮拷贝 —— 凭空少一只。
                let freeDog:DogNode = this.GetUnusedAnimDog();
                if (freeDog == null) break;
                dogNode.node.active = false;
                dogNode.AnimDog = freeDog;
                freeDog.AnimDog = dogNode;
                let out:Vec3 = GameDataManager.instance.LocalToWorld(dogNode.node.parent, dogNode.node.position);
                let newpos:Vec3 = GameDataManager.instance.WorldToLocal(freeDog.node.parent, out);
                freeDog.node.position = newpos;
                freeDog.CreateDog(dogNode.DogColor, -1);
                // 抱锤子的狗被抬起来时，锤子也要跟到这只拷贝上
                this.CopyHammerOverlay(freeDog, chairId, i, dogNode.DogColor);
                freeDog.PlayHoverUp();
            }
            else
                break;
        }
       
    }

    PlayEndHoverByRoomId(roomId:number) 
    {
        let roomNode = this.GetRoomNode(roomId);
        let animDog:DogNode = roomNode.AnimDog;
        if (animDog != null)
        {
            // 立刻把字段摘下来。PlayEndHover 是个 0.1s 的 tween，回调要等动画跑完；
            // 若把 `= null` 留在回调里，这 0.1s 内再点一次这个狗窝会**重新领一只并
            // 覆盖字段**，旧动画回来时读到的就是新那只 —— 把一只正在悬浮的狗塞回池子，
            // 随后被别人借走（两只共用一个节点），而旧那只永远回不来。
            // 见 level_tools/verify_level_loop.py 第 9 项。
            roomNode.AnimDog = null;
            animDog.PlayEndHover( ()=>{
                this.PutAnimEndDog(animDog);
                roomNode.dogIcon.node.active = true;
            });
            
        }
    }

    //结束悬浮 狗狗回到椅子上
    PlayEndHover(chairId:number) 
    {
        let chairNode:ChairNode = this.GetChairNodeByChairId(chairId);
        let len = chairNode.sortDog.length;
        let firstColor = DogColor.None;
        for (let i = len - 1; i >= 0; i--)
        {
            let dogNode = chairNode.sortDog[i];
            if (dogNode.DogState == DogState.None)
                continue;
            if (firstColor == DogColor.None)
                firstColor = dogNode.DogColor;
            if (firstColor == dogNode.DogColor)
            {
                let animDog:DogNode = dogNode.AnimDog;
                if (animDog != null)
                {
                    // 同 PlayEndHoverByRoomId：先摘字段再进动画。否则这 0.1s 内重新选中
                    // 同一根椅子会借走新的一只，而旧回调把**新那只**还回池子。
                    dogNode.AnimDog = null;
                    animDog.PlayEndHover( ()=>{
                        this.PutAnimEndDog(animDog);
                    });
                   
                }
            }
        }
    }


    GetRoomNode(roomId:number):RoomNode
    {
        for (let i = this.roomNodes.length - 1; i >= 0; i--)
        {
            if (this.roomNodes[i].roomIndex == roomId)
            {
                return this.roomNodes[i];
            }
        }
        return null;
    }

    FlyToSameColorChairFromRoomId(roomId:number, toChairId:number)
    {
        GameDataManager.instance.isCanClick = false;
        let roomNode = this.GetRoomNode(roomId);
        let toChairNode:ChairNode = this.GetChairNodeByChairId(toChairId); 

        let reciveNode:DogNode[] = [];
        for (let i = 0; i < toChairNode.sortDog.length; i++)
        {
            if (toChairNode.sortDog[i].DogColor == DogColor.None)
            {
                reciveNode.push(toChairNode.sortDog[i]);
            }
        }


        let animDog:DogNode = roomNode.AnimDog;
        if (animDog != null)
        {
            // 同 PlayEndHoverByRoomId：FlyToNear 要飞 dis/2500 秒，这期间字段必须已经
            // 是 null，否则重入时旧回调会把**新领的那只**还给池子。
            roomNode.AnimDog = null;
            animDog.FlyToNear(reciveNode[0], ()=>{
                this.PutAnimEndDog(animDog);
                GameDataManager.instance.isCanClick = true;
                roomNode.CreateWithColor(DogColor.None);
                // 窝里那只（可能抱着锤子）刚落到椅子上 —— 按数据把覆盖层重画一遍
                this.RefreshCrystalOverlays();
            });   
        }
    }

    //飞入同色椅子
    FlyToSameColorChair(fromChairId:number, toChairId:number, callback: () => void)
    {
        GameDataManager.instance.isCanClick = false;
        let fromChairNode:ChairNode = this.GetChairNodeByChairId(fromChairId);   
        let toChairNode:ChairNode = this.GetChairNodeByChairId(toChairId); 
        let toColor = 0;
        let reciveNum = 0;
        let sendNum = 0
        for (let i = toChairNode.sortDog.length - 1; i >= 0; i--)
        {
            if (toChairNode.sortDog[i].DogColor > DogColor.None)
            {
                toColor = toChairNode.sortDog[i].DogColor;
                break;
            }
        }

        if (toColor == 0)
        {
            for (let i = fromChairNode.sortDog.length - 1; i >= 0; i--)
            {
                if (fromChairNode.sortDog[i].DogColor > DogColor.None)
                {
                    toColor = fromChairNode.sortDog[i].DogColor;
                    break;
                }
            }
        }

        let reciveNode:DogNode[] = [];
        for (let i = 0; i < toChairNode.sortDog.length; i++)
        {
            if (toChairNode.sortDog[i].DogColor == DogColor.None)
            {
                reciveNum++;
                reciveNode.push(toChairNode.sortDog[i]);
            }
        }

       
        let sendNode:DogNode[] = [];
        for (let i = fromChairNode.sortDog.length - 1; i >= 0; i--)
        {
            if (fromChairNode.sortDog[i].DogColor > DogColor.None)
            {
                if (toColor == fromChairNode.sortDog[i].DogColor)
                {
                    sendNode.push(fromChairNode.sortDog[i])
                    sendNum++;
                }
                else
                    break;
            }
        }

        for (let i = 0; i < sendNode.length; i++)
        {
            let animDog:DogNode = sendNode[i].AnimDog;
            if (animDog != null)
            {
                // 先摘字段再进动画（FlyToNear 要飞 dis/2500 秒）。顺带把两个分支的归还
                // 都统一成"只还局部量" —— 第 9 项那条笨规则（实参必须是裸标识符）
                // 才能管住整份文件，不用做控制流分析去分辨哪个分支在回调里。
                sendNode[i].AnimDog = null;
                if (i < reciveNode.length)
                {
                    animDog.FlyToNear(reciveNode[i], ()=>{
                        this.PutAnimEndDog(animDog);
                        sendNode[i].DogColor = DogColor.None;
                        sendNode[i].DogState = DogState.None;
                        GameDataManager.instance.isCanClick = true;
                        // 落地的这只狗刚被 CreateDog 清过覆盖层（见 DogNode.CreateDog）——
                        // 它要是抱锤子的那只，锤子得马上补回来，否则会空手到下次重画
                        this.RefreshCrystalOverlays();
                        if (i == 0)
                        {
                            callback();
                        }
                    });
                }
                else
                {
                    sendNode[i].node.active = true;
                    this.PutAnimEndDog(animDog);
                }
            }
        }
    }

    IsHaveFlyAllDog() : boolean
    {
        for (let i = 0; i < this.chairNodes.length; i++)
        {
            let chairNode:ChairNode = this.chairNodes[i];
            for (let i = chairNode.sortDog.length - 1; i >= 0; i--)
            {
                if (chairNode.node.active && chairNode.sortDog[i].node.active)
                    return false;
            }
        }
        return true;
    }

    //飞入到指定颜色的汽车
    FlyToCar(color:DogColor, chairId:number, callback: () => void) : Boolean
    {
        GameDataManager.instance.isCanClick = false;
        let toDoor:DoorNode = null;
        for (let i = this.doorNodes.length - 1; i >= 0; i--)
        {
            if (this.doorNodes[i].waitDogColor == color)
            {
                toDoor = this.doorNodes[i];
                break;
            }
        }
        if (toDoor == null)
            return false;
        // 狗狗要飞向卡车了 —— 高兴地叫一声。
        //
        // 位置很关键：必须在 `toDoor == null` 的早退**之后**。
        // 上面这段是在找"有没有一根门正好在等这个颜色"，找不到就直接 return false、
        // 整个飞行动画都不会发生；把叫声写在前面就会在"其实没飞"的情况下白叫一声。
        SoundManager.instance.playSound(DOG_SFX_HAPPY);
        // 赋值，不是判等。狗要飞进来了，门切成 Open —— 紧接着的 RfreshDogSprite()
        // 靠 doorState 决定 openCarIcon/closeCarIcon 以及 dogface_<色> 还是 dogface_sad_<色>。
        // 原先写成 `==` 是空语句，门一直停在旧状态（表情不会变开心、车门也不开）。
        toDoor.doorState = DoorState.Open;
        toDoor.RfreshDogSprite();
        let chairNode:ChairNode = this.GetChairNodeByChairId(chairId);   
        for (let i = chairNode.sortDog.length - 1; i >= 0; i--)
        {
            chairNode.sortDog[i].DogState = DogState.FlyToDoor;
            chairNode.sortDog[i].RfreshDogSprite();
            chairNode.sortDog[i].PlayHoverUp();
        }
        this.scheduleOnce(() => {
            for (let i = chairNode.sortDog.length - 1; i >= 0; i--)
            {
                chairNode.sortDog[i].FlyToCarDoor(i*0.1, toDoor);
            }
            chairNode.touchNode.active = false;
        }, 0.3);
        // ⚠️ 这里**原来**还有一个 scheduleOnce(0.3) 把 chairNode.bg / chairNode.touchNode
        //    关掉 —— 那是原版 Cat Sort 的行为：一根椅子把狗全送走之后整根**消失**，
        //    这一关之内既看不见也点不着（点击监听挂在 touchNode 上，见 ChairNode.ts:56）。
        //    ⚠️ 注意**不能**改成关 `chairNode.node.active`：正在飞的那批狗是椅子的子节点
        //    （sortDog → layout/slot1..slot6），关掉父节点会连狗带粒子拖尾一起不渲染。
        //
        // 现在**整块删掉**：送完狗的椅子留在原地，当成一个**额外的空位**继续可用。
        // 理由：盘面上"一根椅子空了"本来就是合法状态（开局就可能有空椅），
        // 让它消失反而把玩家的可用空间偷偷收走了 —— 而且**观感上像 bug**。
        //
        // 可解性没受影响：第 5 项用的就是"椅子留着当额外空位"的模型（100/100 可解），
        // 第 13 项用"飞过的椅子直接摘掉"的模型也证了 100/100 —— 两种都过，所以这个改动
        // 只会让实机**更宽松**，不会让任何一关变得不可解。
        // 判据见 level_tools/verify_level_loop.py 第 5 / 13 项。
        //
        // 副作用（有意为之）：`ChairNode.RefreshAllSlot()` 换关时那句"把 bg/touchNode 放回来"
        // 现在是空转 —— 它们从来没被关过。留着不动，幂等。
        this.scheduleOnce(() => {
            chairNode.node.active = false;
            let doorColor:DogColor = this.GetRandomDoorColor();
            toDoor.CreateWithColor(doorColor);
            GameDataManager.instance.isCanClick = true;
        }, 1);
        this.scheduleOnce(() => {
            GameDataManager.instance.isCanClick = true;
            callback();
        }, 2.0);
        return true;
    }

    //飞到任意狗窝
    FlyToRoom(fromChairId:number, roomid:number, callback?: () => void)
    {
        GameDataManager.instance.isCanClick = false;
        let fromChairNode:ChairNode = this.GetChairNodeByChairId(fromChairId);   
        let roomNode:RoomNode = this.GetRoomNode(roomid); 
        let toColor = 0;
        if (toColor == 0)
        {
            for (let i = fromChairNode.sortDog.length - 1; i >= 0; i--)
            {
                if (fromChairNode.sortDog[i].DogColor > DogColor.None)
                {
                    toColor = fromChairNode.sortDog[i].DogColor;
                    break;
                }
            }
        }

       
       
        let sendNode:DogNode[] = [];
        for (let i = fromChairNode.sortDog.length - 1; i >= 0; i--)
        {
            if (fromChairNode.sortDog[i].DogColor > DogColor.None)
            {
                if (toColor == fromChairNode.sortDog[i].DogColor)
                {
                    sendNode.push(fromChairNode.sortDog[i])
                }
                else
                    break;
            }
        }

        for (let i = 0; i < sendNode.length; i++)
        {
            let animDog:DogNode = sendNode[i].AnimDog;
            if (animDog != null)
            {
                // 同 FlyToSameColorChair：先摘字段再进动画，且两个分支都只还局部量。
                sendNode[i].AnimDog = null;
                if (i == 0)
                {
                    animDog._FlyToRoom(roomNode, ()=>{
                        this.PutAnimEndDog(animDog);
                        GameDataManager.instance.isCanClick = true;
                        sendNode[i].DogColor = DogColor.None;
                        sendNode[i].DogState = DogState.None;
                        // 狗（可能抱着锤子）已经落进窝里，窝的 sleepDogColor 此刻才是新的
                        if (callback != null) callback();
                    });
                }
                else
                {
                    sendNode[i].node.active = true;
                    this.PutAnimEndDog(animDog);
                }
            }
        }
    }

    GetUnusedAnimDog() : DogNode
    {
        let freeDog:DogNode = this.NoUsedDogs.pop(); //从末尾拿出来
        if (freeDog == null)
        {
            // 池子只有 12 只（uiGameMainView.prefab 的 NoUsedDogs 数组，12 个
            // cc.TargetOverrideInfo 接进去），正常玩法同时最多借 6 只（PlayHoverUp
            // 一次借走选中椅子整列同色的狗）。走到这里说明有 AnimDog 借出去没还回来。
            // 别硬闯 `freeDog.node` —— 那会在某个 tween 回调里抛 TypeError，
            // 栈上看不出是谁借漏了。留一条能指路的日志。
            console.error("[AnimDog] 池子空了：有 AnimDog 借出未归还。"
                          + "检查 PlayHoverUp / PlayEndHover / FlyToNear / _FlyToRoom "
                          + "这几处的重入路径（见 level_tools/verify_level_loop.py 第 9 项）");
            return null;
        }
        this.UsingdDogs.unshift(freeDog);//添加到头部
        freeDog.node.active = true;
        return freeDog;
    }

    PutAnimEndDog(dog:DogNode)
    {      
        this.NoUsedDogs.unshift(dog);//添加到头部
        dog.StopAnim();
        dog._stopTween();
        dog.node.active = false
        for (let i = 0; i < this.UsingdDogs.length; i++)
        {
            if (this.UsingdDogs[i] == dog)
            {
                // `splice(i)` 是"从 i 删到末尾"，会把后面还在飞的狗一起踢出记录；
                // 这里只该摘掉这一只。这张表目前没人读，所以一直没暴露，
                // 但它记的是"正在飞的那些狗"，留着错的迟早会咬人。
                this.UsingdDogs.splice(i, 1);
                break;
            }
        }
        // if (this.UsingdDogs.length <= 0)
        //     GameDataManager.instance.isCanClick = true;
    }


    GetChairNodeByChairId(chairId:number) : ChairNode
    {
        for (let i = 0; i < this.chairNodes.length; i++)
        {
            let chairNode:ChairNode = this.chairNodes[i];
            if (chairId == chairNode.chairId)
            {
                return chairNode;
            }
        }
        return null;
    }
}

