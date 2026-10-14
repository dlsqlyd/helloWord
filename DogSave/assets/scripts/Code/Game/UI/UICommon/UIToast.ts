import { I18NKey } from "../../../Module/Const/I18NKey";
import { GameObjectPoolManager } from "../../../Module/Resource/GameObjectPoolManager";
import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnDisable } from "../../../Module/UI/IOnDisable";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { PopupAnim, PopupAnimStyle } from "../../../Module/UI/PopupAnim";
import { UIText } from "../../../Module/UIComponent/UIText";
import { TimerManager } from "../../../../Mono/Module/Timer/TimerManager";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { UIManager } from "../../../Module/UI/UIManager";
import { I18NManager } from "../../../Module/I18N/I18NManager";

/**
 * Toast 的动画参数。
 *
 * 和消息框 / 结算弹窗的区别：Toast 是个小药丸，**不位移、只在原地弹**，退出时只淡出不缩小。
 * 收起时长保持原来的 500ms（原来是手写的线性 lerp，现在统一走 PopupAnim 的 quadIn）。
 */
class ToastAnimStyle extends PopupAnimStyle
{
    public fromScale: number = 0.72;
    /** 不位移：Toast 弹在原位，飞进来会显得吵 */
    public fromOffsetY: number = 0;
    public peakScale: number = 1.08;
    public panelFade: number = 0.12;
    public panelPopUp: number = 0.16;
    public panelPopSettle: number = 0.12;
    /** 退出只淡出，不缩小 */
    public hideScale: number = 1;
    public hideSink: number = 0;
    public hideDuration: number = 0.5;
    public dimHideDuration: number = 0.5;
}

@UIView("UIToast")
export class UIToast extends UIBaseView implements IOnCreate, IOnEnable<string|I18NKey, number|null>, IOnDisable
{
    public getConstructor(){
        return UIToast;
    }
    public static readonly PrefabPath:string = "ui/uicommon/prefabs/uiToast";

    public text: UIText;

    /** 弹出 + 淡出。预制体根上原来还挂着一个自研 CanvasGroup，见 closeSelf 的注释 */
    private _pop: PopupAnim = null;

    private _closing: boolean = false;

    public onCreate(){
        GameObjectPoolManager.instance.addPersistentPrefabPath(UIToast.PrefabPath);
        this.text = this.addComponent<UIText>(UIText,"Text");

        this._pop = new PopupAnim(this.node, { style: new ToastAnimStyle() });
        // 起始姿态必须在 onEnable 之前就位，否则先闪一帧成品（见 PopupAnim 的时序约束注释）
        this._pop.applyStartPose();
    }

    public onDisable(){
        this._pop.stop();
        this._pop.resetPose();
    }

    public onEnable(content: string|I18NKey,time: number | null) {
        this._closing = false;
        if(typeof content == "string") {
            this.text.setText(content);
        }else{
            this.text.setI18NKey(content);
        }
        this.text.forceUpdateRenderData();
        this._pop.playShow();
        this.onEnableAsync(time);
    }

    private async onEnableAsync(time: number = 1500) {
        await TimerManager.instance.waitAsync(time);
        // 淡出统一交给 closeSelf()，这里不再手写 alpha 循环
        await this.closeSelf();
    }

    /**
     * 先淡出再关。
     *
     * 原来这里是一段 `while(true)` 轮询 + 自研 `CanvasGroup` 改子节点 color.a 的写法。
     * 换成 PopupAnim 之后走的是引擎自带的 `UIOpacity`（**乘法**不透明度，不改素材本身的颜色），
     * 顺带把 `getMonoBehaviour` 那条路也去掉了 —— 那个自研 CanvasGroup 是**破坏性**的
     * （直接把 `UIRenderer.color.a` 改写成 `alpha*255`，不记原值，回不到 1 以外的状态）。
     * 预制体上那个 CanvasGroup 组件留着没删：没有任何代码再调它的 setter，它是惰性的。
     */
    public async closeSelf(): Promise<void> {
        if (this._closing) return;
        this._closing = true;

        if (this._pop != null && this.node != null && this.node.activeInHierarchy) {
            await this._pop.playHideAsync();
        }
        return super.closeSelf();
    }

    public static showToast(content: string|I18NKey, time: number = 1500) {
        if(typeof(content) == "string"){
            UIManager.instance.openBox<UIToast,string,number>(UIToast,UIToast.PrefabPath,content,time);
        }else{
            UIManager.instance.openBox<UIToast,string,number>(UIToast,UIToast.PrefabPath,I18NManager.instance.i18NGetText(content),time);
        }
       
    }
}
