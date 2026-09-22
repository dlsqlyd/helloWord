import { _decorator, Button, Component, Label, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('RoomNode')
export class RoomNode extends Component {
      
    @property(Label)
    public levelText: Label;
    
    @property(Button)
    public settingBtn: Button;

    start() {

    }

    update(deltaTime: number) {
        
    }
}
