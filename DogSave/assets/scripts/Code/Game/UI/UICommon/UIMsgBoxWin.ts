import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnDisable } from "../../../Module/UI/IOnDisable";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { PopupAnim } from "../../../Module/UI/PopupAnim";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { UIButton } from "../../../Module/UIComponent/UIButton";
import { UIText } from "../../../Module/UIComponent/UIText";

export class MsgBoxPara
{
    public content: string;
    public cancelText: string;
    public confirmText: string;
    public cancelCallback:(win:UIBaseView)=> void;
    public confirmCallback:(win:UIBaseView)=> void;
}

@UIView("UIMsgBoxWin")
export class UIMsgBoxWin extends UIBaseView implements IOnCreate,IOnEnable<MsgBoxPara>,IOnDisable
{
    public getConstructor(){
        return UIMsgBoxWin;
    }

    public static readonly PrefabPath:string = "ui/uicommon/prefabs/uiMsgBoxWin";

    public text: UIText;
    public btn_cancel: UIButton;
    public cancelText: UIText;
    public btn_confirm: UIButton;
    public confirmText: UIText;

    private para: MsgBoxPara;

    /**
     * 弹出/收起动画。
     *
     * 预制体里**没有遮罩节点**（根自己就是那块白底板，两个按钮是它的直接子节点），
     * 所以这套动画只有"淡入 + 缩放弹出"两层，没有遮罩那一层 —— PopupAnim 允许 dim 为 null，
     * 底板会退回 `root`。
     */
    private _pop: PopupAnim = null;

    /** 收起动画只允许触发一次：双击不能让 closeSelf() 跑两遍 */
    private _closing: boolean = false;

    public onCreate(){
        this.text = this.addComponent<UIText>(UIText,"Text");
        this.btn_cancel = this.addComponent<UIButton>(UIButton,"btn_cancel");
        this.cancelText = this.addComponent<UIText>(UIText,"btn_cancel/Text");
        this.btn_confirm = this.addComponent<UIButton>(UIButton,"btn_confirm");
        this.confirmText = this.addComponent<UIText>(UIText,"btn_confirm/Text");

        this._pop = new PopupAnim(this.node, {
            // 两个按钮跟着底板一起弹，弹出期间会被禁掉（见 PopupAnim.setButtonsInteractable）
            extraTargets: () => [
                this.btn_cancel != null ? this.btn_cancel.getNode() : null,
                this.btn_confirm != null ? this.btn_confirm.getNode() : null,
            ],
        });
        // 赶在第一次渲染之前把起始姿态摆好：
        // setActive(true) 的顺序是 onEnable() -> afterOnEnable() -> node.active = true，
        // 姿态晚摆一步就会先闪一帧"完整尺寸 + 完整不透明"的成品画面
        this._pop.applyStartPose();
    }

    public onEnable(a: MsgBoxPara){
        this.para = a;
        this._closing = false;
        this.text.setText(a.content);
        this.btn_cancel.setOnClick(this.onClickCancel.bind(this));
        this.btn_confirm.setOnClick(this.onClickConfirm.bind(this));
        this.confirmText.setText(a.confirmText);
        this.cancelText.setText(a.cancelText);

        this._pop.playShow();
    }

    public onDisable(){
        this._pop.stop();
        // 复位到设计态：节点会被对象池复用，不复位的话下次借出来第一帧就是上次停在的半透明/半缩放
        this._pop.resetPose();
        this.btn_cancel.removeOnClick();
        this.btn_confirm.removeOnClick();
    }

    /**
     * 关闭时先播收起动画。
     *
     * 覆盖 `closeSelf()` 而不是另开一个 `closeWithAnim()`，是为了让**所有**关闭路径都带上动画
     * —— 内部取消分支、`onInputKeyBack()`（安卓返回键）、以及外面 `win.closeSelf()`。
     * 工程里关弹窗只有 `UIManager.closeBox()` 这一条路（没有"按层批量关 box"的逻辑，
     * `closeWindowByLayer` / `destroyWindowExceptNames` 处理的都是 window 不是 box），
     * 所以不存在"框架强制关闭时被这段动画拖住"的情况。
     */
    public async closeSelf(): Promise<void> {
        if (this._closing) return;
        this._closing = true;

        // 节点已经被停用时不要再等动画（tween 不会跑，等下去就永远关不掉）
        if (this._pop != null && this.node != null && this.node.activeInHierarchy) {
            await this._pop.playHideAsync();
        }
        return super.closeSelf();
    }

    /** 安卓返回键：走同一套（带收起动画的）关闭 */
    public onInputKeyBack(): Promise<void> {
        return this.closeSelf();
    }

    private onClickConfirm()
    {
        if (this.para?.confirmCallback != null)
        {
            this.para.confirmCallback(this);
        }
    }
    private onClickCancel()
    {
        if (this.para?.cancelCallback != null)
        {
            this.para.cancelCallback(this);
        }
        else
        {
            this.close();
        }
    }

    private close()
    {
        this.closeSelf();
    }
}
