import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
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
        this.DogState = DogState.Idle;
    }

    public SetDogState()
    {

    }
}
