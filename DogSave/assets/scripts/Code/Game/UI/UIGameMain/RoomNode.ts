import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { DogColor, DogNode } from './DogNode';
import { ImageLoaderManager } from '../../../Module/Resource/ImageLoaderManager';
import { GameDataManager, LevelState } from '../../GameDataManager';
const { ccclass, property } = _decorator;

export enum RoomState {
    None, //空白
    Lock, //等待广告解锁
    Free, //可以使用
}


@ccclass('RoomNode')
export class RoomNode extends Component {
      
    @property(Node)
    public touchNode:Node

    @property(Button)
    public adsBtn: Button;

    @property(Sprite)
    public dogIcon: Sprite;

    @property(DogNode)
    public dogNode: DogNode;
    

    public sleepDogColor:DogColor;

    public roomIndex:number;

    public roomState:RoomState;
    
    public AnimDog:DogNode; //拷贝出来的动画狗狗

    start() {
        this.sleepDogColor = DogColor.None;
        this.touchNode.on(Node.EventType.TOUCH_END, (event) => {
            console.log('room node touch down : roomIndex = ' + this.roomIndex);
            if ( this.roomState == RoomState.Free)
                GameDataManager.instance.SetSelectRoomId(this.roomIndex);
        }, this);

        // 「看广告解锁狗窝」的点击入口 —— 同 DoorNode.start() 那处：
        // 全工程原先没有任何地方给 adsBtn 挂监听，"看广告解锁"整条流程是空的。
        // 接真广告 SDK 时把 onAdsUnlock() 挪进"广告成功"的回调即可。
        // `start()` 一辈子只跑一次，仍按惯例先 off 再 on。
        this.adsBtn.node.off(Button.EventType.CLICK, this.onAdsUnlock, this);
        this.adsBtn.node.on(Button.EventType.CLICK, this.onAdsUnlock, this);
    }

    /**
     * 广告看完之后解锁这个狗窝。
     *
     * 比门那边简单：狗窝没有"在等的颜色"这回事（`sleepDogColor` 表达的是
     * **里面有没有狗**，不是"在等什么色"），所以只把 state 改成 Free 就够了 ——
     * 之后 `touchNode` 那条 TOUCH_END 判据就会放行、能收狗了。
     */
    private onAdsUnlock()
    {
        // 结算弹窗弹出后盘面冻住，这时不该还能解锁（同 DoorNode.onAdsUnlock）
        if (GameDataManager.instance == null) return;
        if (GameDataManager.instance.levelState != LevelState.Playing) return;
        // 幂等：只有锁着的狗窝才需要解锁
        if (this.roomState != RoomState.Lock) return;

        this.roomState = RoomState.Free;
        this.RefreshLock();     // adsBtn 随之隐藏
    }

    update(deltaTime: number) {
        
    }

    CreateWithColor(color:DogColor) 
    {
        this.sleepDogColor = color;
        // 赋值，不是判等。同 DoorNode.CreateWithColor 那处：原先的 `==` 是空语句，
        // roomState 停在旧值，下面 adsBtn / RfreshDogSprite() 全都读到过期状态 ——
        // 结果是狗窝永远不显示 dogface_sad_<色>，一直停在 battle_alpha。
        this.roomState = RoomState.Free;
        this.dogIcon.node.active = this.sleepDogColor != DogColor.None;
        // roomState 刚在上一行被置为 Free，所以这里恒为 false。
        // 原来写成 `this.roomState == RoomState.Lock` —— 在赋值之后再做比较，
        // tsc 会直接报 TS2367（'RoomState.Free' 与 'RoomState.Lock' 无重叠）。
        // 之前不报错只是因为上面那行是空语句、roomState 还停在旧值。
        // 一个刚接下狗狗的房间不该显示广告按钮，写死 false 把意图说清楚。
        this.adsBtn.node.active = false;
        this.RfreshDogSprite();
    }

    public async RfreshDogSprite()
    {
        let imgPath:string = "ui/uigamemain/atlas/";   
        let icon:string = "battle_alpha"; 
        if (this.roomState == RoomState.Free)
        {
            switch(this.sleepDogColor)
            {
                case DogColor.Orange:
                    icon = "dogface_sad_orange";
                    break;
                case DogColor.Pink:
                    icon = "dogface_sad_pink";
                    break;
                case DogColor.Blue:
                    icon = "dogface_sad_blue";
                    break;
                case DogColor.Green:
                    icon = "dogface_sad_green";
                    break;
                case DogColor.Purple:
                    icon = "dogface_sad_purple";
                    break;
                case DogColor.Yellow:
                    icon = "dogface_sad_yellow";
                    break;
                case DogColor.Mint:
                    icon = "dogface_sad_mint";
                    break;
                case DogColor.Grey:
                    icon = "dogface_sad_grey";
                    break;
                case DogColor.None:
                    icon = "battle_alpha";  
                    break
            } 
        }
        var sprite = await ImageLoaderManager.instance.loadSpriteAsync(imgPath + icon);      
        this.dogIcon.spriteFrame = sprite;
    }

    RefreshLock()
    {
        this.adsBtn.node.active = this.roomState == RoomState.Lock;
        if (this.roomState == RoomState.Lock)
            this.dogIcon.node.active = false;
    }

    PlayReciveAnim() 
    {
        
    }
}
