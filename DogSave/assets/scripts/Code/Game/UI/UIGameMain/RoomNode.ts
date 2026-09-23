import { _decorator, Button, Component, Label, Node } from 'cc';
import { DogColor } from './DogNode';
const { ccclass, property } = _decorator;

export enum RoomState {
    None, //空白
    Lock, //等待广告解锁
    Free, //可以使用
}


@ccclass('RoomNode')
export class RoomNode extends Component {
      
    @property(Label)
    public levelText: Label;
    
    @property(Button)
    public settingBtn: Button;

    public sleepDogColor:DogColor;

    start() {

    }

    update(deltaTime: number) {
        
    }
}
