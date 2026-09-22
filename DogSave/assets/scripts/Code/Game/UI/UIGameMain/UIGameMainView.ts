import { Label, Node, find, math, RichText, Tween, tween } from "cc";
import { LoopGridView } from "../../../../ThirdParty/SuperScrollView/GridView/LoopGridView";
import { LoopGridViewItem } from "../../../../ThirdParty/SuperScrollView/GridView/LoopGridViewItem";
import { LoopListView2 } from "../../../../ThirdParty/SuperScrollView/ListView/LoopListView2";
import { LoopListViewItem2 } from "../../../../ThirdParty/SuperScrollView/ListView/LoopListViewItem2";
import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { IOnWidthPaddingChange } from "../../../Module/UI/IOnWidthPaddingChange";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { UIEmptyView } from "../../../Module/UIComponent/UIEmptyView";
import { UIImage } from "../../../Module/UIComponent/UIImage";
import { UILoopGridView } from "../../../Module/UIComponent/UILoopGridView";
import { UILoopListView2 } from "../../../Module/UIComponent/UILoopListView2";
import { UIText } from "../../../Module/UIComponent/UIText";
import { MenuPara, UIMenu } from "../UICommon/UIMenu";
import { CellItem } from "./CellItem";
import { DateItem } from "./DateItem";



@UIView("UIGameMainView")
export class UIGameMainView extends UIBaseView implements IOnCreate, IOnEnable, IOnWidthPaddingChange{

    public static readonly PrefabPath:string = "ui/uigamemain/prefabs/uiGameMainView";

    public getConstructor()
    {
        return UIGameMainView;
    }

    get isOnWidthPaddingChange(){
        return true;
    }

    // public image: UIImage;
	// public text: UIText;
    // public menu: UIMenu
     
    public loopGridView: UILoopGridView;
    public loopListView2: UILoopListView2;
    public welcome: UIEmptyView;

    public curId: number;
  

    private config: Map<number,string> =new Map<number,string>([
        [1, "欢迎"],
        [2, "网格列表"],
        [3, "无限循环滚动列表"],
    ]);

    public onCreate()
    {
        let tempNode = find("bg/TopNode/levelBg/level_txt", this.node);
        this.levelText = tempNode.getComponent<Label>(Label);
        this.levelText.string = "第XX关";
    }


    public onEnable()
    {
        // this.menu.setActiveIndex(0,true);
    }

    public onMenuIndexChanged(para: MenuPara){
        // this.curId = para.id;
		// this.refreshItemSpaceShow();
    }

   

   
    public refreshItemSpaceShow()
    {
    }      
}