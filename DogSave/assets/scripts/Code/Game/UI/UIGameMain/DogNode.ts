import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { ImageLoaderManager } from '../../../Module/Resource/ImageLoaderManager';
const { ccclass, property } = _decorator;

// 枚举定义
export enum DogState {
    None, //空白
    Idle, //待机备选
    InSelect, //选中悬浮中
    FlyToFriend, //飞向右方
    FlyToDoor, //飞向车门
}

export enum DogColor {
    None = 0,
    Orange = 1,// 1	橙色	
    Pink = 2, // 2	粉色	
    Blue = 3,// 3	蓝色	
    Green = 4,// 4	绿色	
    Purple = 5,// 5	紫色	
    Yellow = 6,// 6	黄色	
    Mint = 7, // 7	薄荷绿	
    Grey = 8,// 8	灰色	
}

@ccclass('DogNode')
export class DogNode extends Component {
      
    @property(Sprite)
    public dogIcon: Sprite;
    
    public DogState = DogState.None;
    public DogColor = DogColor.None;
    public SlotIdx:number;
   

    start() {

    }

    update(deltaTime: number) {
        
    }

    public CreateDog(color: DogColor)
    {
        this.DogColor = color;
        if (color > DogColor.None)
        {
            this.RefreshDogState(DogState.Idle);
            this.RfreshDogSprite();
        }
        else
        {
            this.DogState = DogState.None;
            this.RfreshDogSprite();
        }
    }

    public async RfreshDogSprite()
    {
        let imgPath:string = "ui/uigamemain/atlas/";   
        let icon:string = "battle_alpha";  
        switch(this.DogColor)
        {
            case DogColor.Orange:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_orange" : "dogface_sad_orange";
                break;
            case DogColor.Pink:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_pink" : "dogface_sad_pink";
                break;
            case DogColor.Blue:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_blue" : "dogface_sad_blue";
                break;
            case DogColor.Green:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_green" : "dogface_sad_green";
                break;
            case DogColor.Purple:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_purple.png" : "dogface_sad_purple.png";
                break;
            case DogColor.Yellow:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_yellow.png" : "dogface_sad_yellow.png";
                break;
            case DogColor.Mint:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_mint.png" : "dogface_sad_mint.png";
                break;
            case DogColor.Grey:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_grey.png" : "dogface_sad_grey.png";
                break;
            case DogColor.None:
                icon = "battle_alpha";  
                break
        } 
        var sprite = await ImageLoaderManager.instance.loadSpriteAsync(imgPath + icon);      
        this.dogIcon.spriteFrame = sprite;
    }


    public RefreshDogState(state:DogState)
    {
        this.DogState = state;
        switch(this.DogState)
        {
            case DogState.Idle:
                break;
            case DogState.InSelect:
                break;
            case DogState.FlyToFriend:
                break;
            case DogState.FlyToDoor:
                break;
        }
    }
}
