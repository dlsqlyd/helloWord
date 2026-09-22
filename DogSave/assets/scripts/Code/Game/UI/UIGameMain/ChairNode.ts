import { _decorator, Button, Component, Label, Node } from 'cc';
import { DogNode, DogColor } from './DogNode';
const { ccclass, property } = _decorator;

@ccclass('ChairNode')
export class ChairNode extends Component {
      
    @property(Label)
    public levelText: Label;
    
    @property(Button)
    public settingBtn: Button;

    @property(Node)
    public sortlist:Node[] = [];

    @property(DogNode)
    public sortDog:DogNode[] = [];

    start() {
        for (let i = 0; i < this.sortDog.length; ++i)
        {
            this.sortDog[i].SlotIdx = i+1;
        }
    }

    update(deltaTime: number) {
        
    }

    public RefreshAllSlot()
    {

    }

    public RefreshOneSlot(slotIndx:Number, color:DogColor)
    {
        
    }
}

