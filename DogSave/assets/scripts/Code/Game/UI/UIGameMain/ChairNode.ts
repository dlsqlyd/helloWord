import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { UIBaseContainer } from "../../../Module/UI/UIBaseContainer";
import { UIText } from "../../../Module/UIComponent/UIText";

export class ChairNode extends UIBaseContainer implements IOnCreate{

    public getConstructor()
    {
        return ChairNode;
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