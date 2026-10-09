import { _decorator, Button, Component, Label, Node, Vec3 } from 'cc';
import { $ } from '../../../../../../extensions/taowu-editor/source/panel';
import { GameDataManager, LevelConfig } from '../../GameDataManager';
import { ChairNode } from './ChairNode';
import { DogColor, DogNode, DogState, DOG_SFX_HAPPY } from './DogNode';
import { ANDROID } from '../../../../../../temp/declarations/cc.env';
import { DoorNode, DoorState } from './DoorNode';
import { RoomNode, RoomState } from './RoomNode';
import { SoundManager } from '../../../Module/Resource/SoundManager';
import { load } from '../../../../../../extensions/taowu-editor/source/main';
const { ccclass, property } = _decorator;

@ccclass('GameMainObj')
export class GameMainObj extends Component {
      
    @property(Label)
    public levelText: Label;
    
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
            doorNode.RefreshLock();
        }

        for (let i = 0; i < this.doorNodes.length; i++)
        {
            let doorNode:DoorNode = this.doorNodes[i];
            if (doorNode.doorState == DoorState.Idle)
            {
                //根据 现有椅子上的颜色 随机一个画出来，并且不要和另外的椅子上的颜色重复
                let randomColor:DogColor = this.GetRandomDoorColor();
                doorNode.CreateWithColor(randomColor);
            }
        }

         for (let i = 0; i < this.roomNodes.length; i++)
        {
            let roomNode:RoomNode = this.roomNodes[i];
            roomNode.roomIndex = i + 1;
            roomNode.roomState = i < 1 ? RoomState.Free : RoomState.Lock;
            roomNode.RefreshLock();
        }
    }

    GetRandomDoorColor() : DogColor
    {
        let randomColor:DogColor = DogColor.None;
        let cfg:LevelConfig = GameDataManager.instance.curLevelConfig;
        for (let i = 0; i < cfg.chairs.length; i++)
        {
            let list = cfg.chairs[i].dogs;
            for (let j = 0; j < list.length; j++)
            {
                if (list[i] > 0)
                {
                    for (let k = 0; k < this.doorNodes.length; k++)
                    {
                        if (list[i] !=  this.doorNodes[i].waitDogColor)
                        {
                            randomColor = list[i];
                            return randomColor;
                        }
                    }
                }
            }
        }
        return randomColor;
    }



    update(deltaTime: number) {
        
    }

    PlayHoverUpByRoomId(roomId:number) 
    {
        let roomNode = this.GetRoomNode(roomId);
        let dogColor = roomNode.sleepDogColor;
        roomNode.dogIcon.node.active = false;
        let freeDog:DogNode = this.GetUnusedAnimDog();
        roomNode.AnimDog = freeDog;
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
                dogNode.node.active = false;
                let freeDog:DogNode = this.GetUnusedAnimDog();
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
        if (roomNode.AnimDog != null)
        {
            roomNode.AnimDog.PlayEndHover( ()=>{
                this.PutAnimEndDog(roomNode.AnimDog);
                roomNode.AnimDog = null;
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
                if (dogNode.AnimDog != null)
                {
                    dogNode.AnimDog.PlayEndHover( ()=>{
                        this.PutAnimEndDog(dogNode.AnimDog);
                        dogNode.AnimDog = null;
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

    FlyToSameColorChairByRoomId(roomId:number, toChairId:number)
    {
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


        if (roomNode.AnimDog != null)
        {
            roomNode.AnimDog.FlyToNear(reciveNode[0], ()=>{
                this.PutAnimEndDog(roomNode.AnimDog);
                roomNode.AnimDog = null;
                roomNode.CreateWithColor(DogColor.None);
            });   
        }
    }

    //飞入同色椅子
    FlyToSameColorChair(fromChairId:number, toChairId:number)
    {
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
            if (sendNode[i].AnimDog != null)
            {
                if (i < reciveNode.length)
                {
                    sendNode[i].AnimDog.FlyToNear(reciveNode[i], ()=>{
                        this.PutAnimEndDog(sendNode[i].AnimDog);
                        sendNode[i].AnimDog = null;
                        sendNode[i].DogColor = DogColor.None;
                        sendNode[i].DogState = DogState.None;
                    });
                }
                else
                {
                    sendNode[i].node.active = true;
                    this.PutAnimEndDog(sendNode[i].AnimDog);
                    sendNode[i].AnimDog = null;
                }
            }
        }
    }

    //飞入到指定颜色的汽车
    FlyToCar(color:DogColor, chairId:number, callback: () => void) : Boolean
    {
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
        }, 0.3);
        this.scheduleOnce(() => {
            // ⚠️ 这里**不能**写 chairNode.node.active = false。
            // 上面那批正在 FlyToCarDoor 的狗是椅子的子节点（sortDog → layout/slot1..slot6），
            // 关掉整个 chairNode 会连狗带粒子拖尾一起停止渲染 —— 1 秒的飞行动画整个看不见。
            // （Node.isChildOf 要求父节点 active，所以父节点一关子节点就"消失"。）
            // 只收掉椅子的美术和点击，留着 layout 让狗继续飞。
            // 复用：ChairNode.RefreshAllSlot 会把这两个重新打开。
            if (chairNode.bg) chairNode.bg.active = false;
            if (chairNode.touchNode) chairNode.touchNode.active = false;
        }, 0.3);
        this.scheduleOnce(() => {
            let randomColor:DogColor = this.GetRandomDoorColor();
            toDoor.CreateWithColor(randomColor);
            callback();
        }, 2);
        return true;
    }

    //飞到任意狗窝
    FlyToRoom(fromChairId:number, roomid:number)
    {
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
            if (sendNode[i].AnimDog != null)
            {
                if (i == 0)
                {
                    sendNode[i].AnimDog._FlyToRoom(roomNode, ()=>{
                        this.PutAnimEndDog(sendNode[i].AnimDog);
                        sendNode[i].AnimDog = null;
                        sendNode[i].DogColor = DogColor.None;
                        sendNode[i].DogState = DogState.None;
                    });
                }
                else
                {
                    sendNode[i].node.active = true;
                    this.PutAnimEndDog(sendNode[i].AnimDog);
                    sendNode[i].AnimDog = null;
                }
            }
        }
    }

    GetUnusedAnimDog() : DogNode
    {
        let freeDog:DogNode = this.NoUsedDogs.pop(); //从末尾拿出来
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
                this.UsingdDogs.splice(i);
                break;
            }
        }
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

