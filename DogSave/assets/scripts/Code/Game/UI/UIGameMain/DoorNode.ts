import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { DogColor, DogNode } from './DogNode';
import { ImageLoaderManager } from '../../../Module/Resource/ImageLoaderManager';
import { close } from '../../../../../../extensions/taowu-editor/source/panel';
const { ccclass, property } = _decorator;

export enum DoorState {
    None, //空白
    Lock, //等待广告解锁
    Idle, //等待完成（绑定了制定颜色）
    Open, //飞向车门的过程中
}

@ccclass('DoorNode')
export class DoorNode extends Component {
      
    @property(Sprite)
    public dogIcon: Sprite;
       
    @property(Sprite)
    public openCarIcon: Sprite;

    @property(Sprite)
    public closeCarIcon: Sprite;

    @property(Button)
    public adsBtn: Button;

    public waitDogColor:DogColor;

    public doorState:DoorState = DoorState.Lock;

    public doorIndex:number;

    start() {

    }

    update(deltaTime: number) {
        
    }

    CreateWithColor(color:DogColor) 
    {
        this.waitDogColor = color;
        this.dogIcon.node.active = this.waitDogColor == DogColor.None;
        this.RfreshDogSprite();
    }

      public async RfreshDogSprite()
    {
        let imgPath:string = "ui/uigamemain/atlas/";   
        let icon:string = "battle_alpha";  
        if (this.doorState == DoorState.Idle || this.doorState == DoorState.Open)
        {
            switch(this.waitDogColor)
            {
                case DogColor.Orange:
                    icon = this.doorState == DoorState.Open ? "dogface_orange" : "dogface_sad_orange";
                    break;
                case DogColor.Pink:
                    icon = this.doorState == DoorState.Open ? "dogface_pink" : "dogface_sad_pink";
                    break;
                case DogColor.Blue:
                    icon = this.doorState == DoorState.Open ? "dogface_blue" : "dogface_sad_blue";
                    break;
                case DogColor.Green:
                    icon = this.doorState == DoorState.Open ? "dogface_green" : "dogface_sad_green";
                    break;
                case DogColor.Purple:
                    icon = this.doorState == DoorState.Open ? "dogface_purple" : "dogface_sad_purple";
                    break;
                case DogColor.Yellow:
                    icon = this.doorState == DoorState.Open ? "dogface_yellow" : "dogface_sad_yellow";
                    break;
                case DogColor.Mint:
                    icon = this.doorState == DoorState.Open ? "dogface_mint" : "dogface_sad_mint";
                    break;
                case DogColor.Grey:
                    icon = this.doorState == DoorState.Open ? "dogface_grey" : "dogface_sad_grey";
                    break;
                case DogColor.None:
                    icon = "battle_alpha";  
                    break
            } 
        }
        var sprite = await ImageLoaderManager.instance.loadSpriteAsync(imgPath + icon);      
        this.dogIcon.spriteFrame = sprite;
    }

    PlayOpenAnim() 
    {
        
    }
}
