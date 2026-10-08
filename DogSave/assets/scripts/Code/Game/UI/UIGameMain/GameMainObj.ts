import { _decorator, Button, Component, Label, Node, Vec3 } from 'cc';
import { $ } from '../../../../../../extensions/taowu-editor/source/panel';
import { GameDataManager, LevelConfig } from '../../GameDataManager';
import { ChairNode } from './ChairNode';
import { DogColor, DogNode, DogState } from './DogNode';
import { ANDROID } from '../../../../../../temp/declarations/cc.env';
import { DoorNode, DoorState } from './DoorNode';
import { RoomNode } from './RoomNode';
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
    FlyToCar(chairId:number, callback: () => void) {
        let toDoor:DoorNode = this.doorNodes[0];
        let chairNode:ChairNode = this.GetChairNodeByChairId(chairId);   
        for (let i = chairNode.sortDog.length - 1; i >= 0; i--)
        {
            chairNode.sortDog[i].FlyToCarDoor(toDoor);
        }
        this.scheduleOnce(() => {
            chairNode.node.active = false;
            callback();
        }, 0.3);
    }

    //飞到任意狗窝
    FlyToRoom(roomid:number)
    {

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

