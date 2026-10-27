import { _decorator, Button, Component, find, Label, Node, Vec3 } from 'cc';
import { $ } from '../../../../../../extensions/taowu-editor/source/panel';
import { GameDataManager, LevelConfig, LevelState } from '../../GameDataManager';
import { ChairNode } from './ChairNode';
import { DogColor, DogNode, DogState, DOG_SFX_HAPPY } from './DogNode';
import { DoorNode, DoorState } from './DoorNode';
import { RoomNode, RoomState } from './RoomNode';
import { SoundManager } from '../../../Module/Resource/SoundManager';
import { load } from '../../../../../../extensions/taowu-editor/source/main';
import { UIManager } from '../../../Module/UI/UIManager';
import { UIGameResultView } from './UIGameResultView';
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

    @property(ChairNode)
    public chairNodes:ChairNode[] = [];

    @property(DoorNode)
    public doorNodes:DoorNode[] = [];

    @property(RoomNode)
    public roomNodes:RoomNode[] = [];

    @property(DogNode)
    public NoUsedDogs:DogNode[] = [];

    public UsingdDogs:DogNode[] = [];

    start() {
        GameDataManager.instance.gameMainObj = this;
        this.levelText.string = `第${GameDataManager.instance.curFightLevelId}关`;
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

        // timeText 的 @property 绑定是新增的（预制体里的 "timeText" 字段）。
        // 兜底：万一编辑器没把这条绑定读进来（或有人在编辑器里解绑了），按路径再找一次。
        // 路径取自预制体的实际结构 bg/TopNode/timeBg/time_txt，名字唯一，
        // 不踩"同名子节点只认第一个"的坑（结算弹窗那两个同名 bg 就是被这个坑过的）。
        if (this.timeText == null)
        {
            let timeNode: Node = find("bg/TopNode/timeBg/time_txt", this.node);
            if (timeNode != null) this.timeText = timeNode.getComponent(Label);
        }

        // 倒计时是"这一关"的状态，必须在**铺完盘之后**才启动。
        // start() 每次换关都会被 GameDataManager.SetLevelCfgById 再调一遍，
        // 所以这里同时也是"重开一关时把倒计时重置"的地方。
        GameDataManager.instance.StartLevel();
        this.RefreshTimeText();
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
        // await UIManager.instance.openBox(UIGameResultView,UIGameResultView.PrefabPath);
        GameDataManager.instance.FinishLevel(false);
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
        this.timeText.string = `${GameDataManager.instance.GetRemainSeconds()}秒`;
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
        freeDog.PlayHoverUp();
    }

    //悬浮椅子上的狗狗
    PlayHoverUp(chairId:number) {

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
            // ⚠️ 顺序有讲究：必须**先**把整根椅子提到 centerNode 最上层，**再**放狗。
            //
            // 飞向车门的狗是 `sortDog[i]` 自己（不是 AnimDog 拷贝），所以它挂在
            // `ChairNode/layout/slotN` 下面，渲染顺序被绑死在这根椅子的位置。
            // 而 centerNode 的子节点是「10 根椅子 + 3 个狗窝」后者盖前者 ——
            // 不提的话，下面几排椅子里的狗往车顶飞时会一路被后面的椅子和狗窝盖住，
            // 狗和拖尾被切成一段一段的。见 ChairNode.RaiseFlightLayer() 的注释。
            chairNode.RaiseFlightLayer();
            // 记下"最后一只狗什么时候落地"，用来决定何时关椅子（见下面那段）。
            let lastLand = 0;
            for (let i = chairNode.sortDog.length - 1; i >= 0; i--)
            {
                lastLand = Math.max(lastLand, chairNode.sortDog[i].FlyToCarDoor(i*0.1, toDoor));
            }
            chairNode.touchNode.active = false;
            // 关门：等最后一只狗真的落地，再把整根椅子关掉。
            //
            // 原先这里是写死的 `scheduleOnce(..., 1)`。但最后一只狗的起飞延迟是
            // (n-1)×0.1s（满盘 n=6 ⇒ 0.5s），再飞 dis/4000 秒 —— 落地时间会超过 1s。
            // 于是它在半空中被父节点一起关掉：狗和拖尾当场消失，看起来像"飞一半没了"。
            // 现在按真实落地时间推，+0.12s 是给尾帧留的余量。
            //
            // ⚠️ 遗留矛盾：下面那段长注释说"送完狗的椅子留在原地当额外空位"，
            //    但 10-14 那次改动只删了"收 bg/touchNode"的那一块，1s 的
            //    `chairNode.node.active = false` 并没有一起删 —— 所以椅子**现在仍然会消失**。
            //    本次只修"关得太早"，没有改变这个行为。若确认要按注释那样让椅子留下，
            //    把这一段 scheduleOnce 整个删掉即可（touchNode 已经关了，不会误点）。
            this.scheduleOnce(() => {
                chairNode.node.active = false;
            }, lastLand + 0.12);
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
            // 这里只负责换门的颜色。**关椅子不在这里** —— 原先这里写的是
            // `chairNode.node.active = false` + 换色，但 1s 比最后一只狗的落地时间短，
            // 会把还在飞的狗（连同它的拖尾）一起关掉。关椅子已挪到上面那个
            // scheduleOnce 里，按 lastLand 推。
            let doorColor:DogColor = this.GetRandomDoorColor();
            toDoor.CreateWithColor(doorColor);
        }, 1);
        this.scheduleOnce(() => {
            GameDataManager.instance.isCanClick = true;
            callback();
        }, 2.2);
        return true;
    }

    //飞到任意狗窝
    FlyToRoom(fromChairId:number, roomid:number)
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

