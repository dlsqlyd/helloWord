import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { DogColor, DogNode } from './DogNode';
import { ImageLoaderManager } from '../../../Module/Resource/ImageLoaderManager';
import { GameDataManager } from '../../GameDataManager';
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

    public sleepDogColor:DogColor;

    public roomIndex:number;

    public roomState:RoomState;
    
    public AnimDog:DogNode; //拷贝出来的动画狗狗

    start() {
        this.touchNode.on(Node.EventType.TOUCH_END, (event) => {
            console.log('room node touch down : roomIndex = ' + this.roomIndex);
            if ( this.roomState == RoomState.Free)
                GameDataManager.instance.SetSelectRoomId(this.roomIndex);
        }, this);
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
        this.dogIcon.node.active = this.sleepDogColor == DogColor.None;
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
    }

    PlayReciveAnim() 
    {
        
    }
}
