import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { UIBaseContainer } from "../../../Module/UI/UIBaseContainer";
import { UIText } from "../../../Module/UIComponent/UIText";

export class RoomNode extends UIBaseContainer implements IOnCreate{

    public getConstructor()
    {
        return RoomNode;
    }

    private text: UIText
    public onCreate(){
        this.text = this.addComponent(UIText,"Text");
    }

    public setData(time: Date)
    {
        this.text.setText(time.getDate().toString());
    }
}