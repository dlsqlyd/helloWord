import { _decorator, Button, Component, Label, Node } from 'cc';
import { DogNode, DogColor, DogState } from './DogNode';
import { GameDataManager } from '../../GameDataManager';
const { ccclass, property } = _decorator;

export enum ChairState {
    None, //空白
    Lock, //等待广告解锁
    Idle, //等待选择状态
    InSelect, //选中悬浮中
    FlyToFriend, //飞向右方
    FlyToDoor, //飞向车门
}

@ccclass('ChairNode')
export class ChairNode extends Component {
      
    @property(Node)
    public touchNode:Node

    @property(Node)
    public sortlist:Node[] = [];

    @property(DogNode)
    public sortDog:DogNode[] = [];

    @property(Button)
    public adsBtn: Button;

    @property(Boolean)
    public isFlip: Boolean;

    public chairState:ChairState = ChairState.None;

    start() {
        for (let i = 0; i < this.sortDog.length; ++i)
        {
            if (this.isFlip)
                this.sortDog[this.sortDog.length - i - 1].SlotIdx = i+1;
            else
                this.sortDog[i].SlotIdx = i+1;
        }
        this.touchNode.on(Node.EventType.TOUCH_END, (event) => {
            console.log('Mouse down');
            GameDataManager.instance.SetLevelCfgById(GameDataManager.instance.curFightLevelId+1);

        }, this);
    }

    public FlyAir()
    {}

    public FlyToNear()
    {}

    public FlyToDoor()
    {}

    update(deltaTime: number) {
        
    }

    public RefreshAllSlot(dogs:number[])
    {
        this.adsBtn.node.active = false;
        this.chairState = ChairState.Idle;
        for (let i = 0; i < this.sortDog.length; i++)
        {
            if (this.isFlip)
                this.sortDog[this.sortDog.length - i - 1].CreateDog(dogs[i]);
            else
                this.sortDog[i].CreateDog(dogs[i]);
        }
    }

    public RefreshOneSlotColor(slotIndx:Number, color:DogColor)
    {
        
    }

    public RefreshOneSlotState(slotIndx:Number, state:DogState)
    {
        
    }

    public ShowAdsBtn()
    {
        this.adsBtn.node.active = true;
        this.chairState = ChairState.Lock;
    }
}

