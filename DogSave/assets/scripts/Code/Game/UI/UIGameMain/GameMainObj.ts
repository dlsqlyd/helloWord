import { _decorator, Button, Component, Label, Node, Vec3 } from 'cc';
import { $ } from '../../../../../../extensions/taowu-editor/source/panel';
import { GameDataManager, LevelConfig } from '../../GameDataManager';
import { ChairNode } from './ChairNode';
import { DogColor, DogNode, DogState } from './DogNode';
import { ANDROID } from '../../../../../../temp/declarations/cc.env';
const { ccclass, property } = _decorator;

@ccclass('GameMainObj')
export class GameMainObj extends Component {
      
    @property(Label)
    public levelText: Label;
    
    @property(Button)
    public settingBtn: Button;

    @property(ChairNode)
    public chairNodes:ChairNode[] = [];

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
            // else if (i == cfg.chairs.length)
            // {
            //     chairNode.node.active = true;
            //     //ads
            // }
            else
                chairNode.node.active = false;
        }
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
                dogNode.node.active = true;
                if (dogNode.AnimDog != null)
                {
                    this.PutAnimEndDog(dogNode.AnimDog);
                    dogNode.AnimDog = null;
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

        for (let i = toChairNode.sortDog.length - 1; i >= 0; i--)
        {
            if (toChairNode.sortDog[i].DogColor == DogColor.None)
            {
                reciveNum++;
            }
        }

        for (let i = fromChairNode.sortDog.length - 1; i >= 0; i--)
        {
            if (fromChairNode.sortDog[i].DogColor > DogColor.None)
            {
                if (toColor == fromChairNode.sortDog[i].DogColor)
                    sendNum++;
                else
                    break;
            }
        }
        let fitNum = sendNum < reciveNum ? sendNum : reciveNum;
        for (let i = 0; i < toChairNode.sortDog.length; i++)
        {
            if (toChairNode.sortDog[i].DogColor == DogColor.None && fitNum > 0)
            {
                toChairNode.sortDog[i].node.active = true;
                toChairNode.sortDog[i].CreateDog(toColor, -1);
                fitNum--;
            }
        }
        fitNum = sendNum < reciveNum ? sendNum : reciveNum;
        for (let i = fromChairNode.sortDog.length - 1; i >= 0; i--)
        {
            if (fromChairNode.sortDog[i].DogColor == toColor && fitNum > 0)
            {
                fromChairNode.sortDog[i].CreateDog(0, -1);
                fitNum--;
                if (fromChairNode.sortDog[i].AnimDog != null)
                {
                    this.PutAnimEndDog(fromChairNode.sortDog[i].AnimDog);
                    fromChairNode.sortDog[i].AnimDog = null;
                }
            }
        }
    }

    //飞入到指定颜色的汽车
    FlyToCar(chairId:number) {
        let chairNode:ChairNode = this.GetChairNodeByChairId(chairId);   
        chairNode.node.active = false;
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

