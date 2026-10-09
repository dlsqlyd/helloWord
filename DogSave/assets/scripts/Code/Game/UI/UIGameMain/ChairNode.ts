import { _decorator, Button, Component, Label, Node } from 'cc';
import { DogNode, DogColor, DogState } from './DogNode';
import { GameDataManager } from '../../GameDataManager';
const { ccclass, property } = _decorator;

// 同一根椅子上相邻两只狗的出生间隔（秒），让整列自下而上依次弹出
const BORN_STAGGER = 0.06;

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

    /**
     * 椅子的美术节点（预制件里的 `bg`）。
     *
     * 单独拿出来是因为：狗狗飞往车门时要把椅子"收掉"，但**不能关整个 chairNode** ——
     * 被 FlyToCarDoor 动画的狗是椅子的子节点（sortDog → layout/slot1..slot6），
     * 关掉椅子会连狗带拖尾一起不渲染，整段飞行动画看不见。
     * 所以只关 `bg` + `touchNode`，留着 `layout` 让狗继续飞。
     */
    @property(Node)
    public bg:Node

    @property(DogNode)
    public sortDog:DogNode[] = [];

    @property(Button)
    public adsBtn: Button;

    @property(Boolean)
    public isFlip: Boolean;

    public chairState:ChairState = ChairState.None;

    public chairId:number;

    start() {
       
        this.touchNode.on(Node.EventType.TOUCH_END, (event) => {
            console.log('Mouse down');
            // GameDataManager.instance.SetLevelCfgById(GameDataManager.instance.curFightLevelId+1);
            //todo
            GameDataManager.instance.SetSelectChairId(this.chairId);

        }, this);
    }

    public InitFlipSlot()
    {
        if (this.isFlip)
        {
            this.sortDog.reverse(); 
        }
        for (let i = 0; i < this.sortDog.length; i++)
        {
            this.sortDog[i].SlotIdx = i+1;
        }
    }

    update(deltaTime: number) {
        
    }

    public RefreshAllSlot(dogs:number[], chId:number)
    {
        this.adsBtn.node.active = false;
        // 椅子会被下一关复用（GameMainObj.start 里 node.active = true + RefreshAllSlot）。
        // FlyToCar 只收了 bg/touchNode、没关整个节点，所以这里要把它们放回来，
        // 否则复用到的椅子会是一把"看不见的椅子"。
        if (this.bg) this.bg.active = true;
        if (this.touchNode) this.touchNode.active = true;
        this.chairState = ChairState.Idle;
        this.chairId = chId;
        for (let i = 0; i < this.sortDog.length; i++)
        {
            // 按槽位错开 0.14s，整列自下而上依次弹出，而不是 6 只一起蹦
            let bornDelay:number = i * BORN_STAGGER;
            this.sortDog[i].CreateDog(dogs[i], bornDelay);
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

