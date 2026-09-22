import { _decorator, Button, Component, Label, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GameMainObj')
export class GameMainObj extends Component {
      
    @property(Label)
    public levelText: Label;
    
    @property(Button)
    public settingBtn: Button;

    start() {

    }

    update(deltaTime: number) {
        
    }
}

