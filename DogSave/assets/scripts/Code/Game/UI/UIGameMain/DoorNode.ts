import { _decorator, Button, Component, Label, Node } from 'cc';
import { DogColor } from './DogNode';
const { ccclass, property } = _decorator;

export enum ChairState {
    None, //空白
    Lock, //等待广告解锁
    Idle, //等待完成（绑定了制定颜色）
    Open, //飞向车门的过程中
}

@ccclass('DoorNode')
export class DoorNode extends Component {
      
    @property(Label)
    public levelText: Label;
    
    @property(Button)
    public settingBtn: Button;

    public waitDogColor:DogColor;

    start() {

    }

    update(deltaTime: number) {
        
    }
}
