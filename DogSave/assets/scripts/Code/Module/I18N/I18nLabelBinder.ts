import { Label, Node, RichText, UITransform } from "cc";
import { I18NKey } from "../Const/I18NKey";
import { Log } from "../../../Mono/Module/Log/Log";
import { I18NManager } from "./I18NManager";

/**
 * 一条绑定：预制体里节点的路径 -> 多语言 key。
 * 路径相对视图根节点，和 `getChildByPath` 的写法一致。
 */
export interface I18nTextBinding
{
    path: string;
    key: I18NKey;
    /**
     * 可用宽度（设计像素）。给了就把节点宽度设成它、并把 Label 改成 `SHRINK`。
     *
     * 为什么需要：预制体里这些 Label 的宽度是**按中文**auto-size 出来的
     * （"服务条款" 228px、"每日挑战" 314px），英文同样意思要宽 1.5~2 倍。
     * 不放开宽度，英文会直接溢出框外压到图标/开关上。
     * 给 `SHRINK` 而不是写死字号：英文短的时候字号不变，太长才等比缩小。
     */
    maxWidth?: number;
}

/**
 * 把一组静态 Label 绑到多语言表上。
 *
 * 为什么不用 `I18NText` 组件（框架里本来就有）：
 *   `ui/uisetting`、`ui/uigate`、`ui/uicalendar` 三个预制体是 `*_src/gen_prefab.py`
 *   **生成**的（工程约定：别手改这些 prefab JSON）。往预制体里塞组件，
 *   下次重跑生成器就全没了，而且不会有任何报错。
 *   所以这里改成"在视图代码里按路径绑定"—— 生成器怎么重出都不影响。
 *
 * 用法：
 *   onCreate: this._i18n = new I18nLabelBinder(this.node, [
 *       { path: "panel/title/Text", key: I18NKey.Setting_Title }, ...]);
 *   onEnable: this._i18n.enable();      // 立即刷一遍 + 订阅语言切换
 *   onDisable: this._i18n.disable();    // 摘订阅
 */
export class I18nLabelBinder
{
    private _items: { label: Label, rich: RichText, key: I18NKey }[] = [];
    private _subscribed: boolean = false;

    /** 语言变更回调。Event.subscribe 用同一个引用才能 unsubscribe，所以存成字段 */
    private _onLanguageChange = () => this.apply();

    /**
     * 刷完之后再跑一次的回调。
     * 给"动态文案"用：日历的月份牌是 `${year}年${month}月` 这种拼出来的，
     * 不在绑定表里，切语言时得让界面自己重渲染一次。
     */
    private _afterApply: () => void = null;

    constructor(root: Node, bindings: I18nTextBinding[], afterApply?: () => void)
    {
        this._afterApply = afterApply != null ? afterApply : null;
        if (root == null || bindings == null) return;

        for (let i = 0; i < bindings.length; i++)
        {
            const b = bindings[i];
            const node = root.getChildByPath(b.path);
            if (node == null)
            {
                // 路径写错就是"这条文案永远不翻译"，而且界面上看不出来 —— 必须报出来
                Log.error("[I18n] 绑定路径不存在: " + b.path + " (key=" + I18NKey[b.key] + ")");
                continue;
            }

            const label = node.getComponent(Label);
            const rich = label == null ? node.getComponent(RichText) : null;
            if (label == null && rich == null)
            {
                Log.error("[I18n] 节点上没有 Label/RichText: " + b.path);
                continue;
            }

            // 放开可用宽度 + 允许缩字（只在超宽时才缩，短文本字号不变）
            if (b.maxWidth != null && b.maxWidth > 0 && label != null)
            {
                const ut = node.getComponent(UITransform);
                if (ut != null) ut.width = b.maxWidth;
                label.overflow = Label.Overflow.SHRINK;
            }

            this._items.push({ label: label, rich: rich, key: b.key });
        }
    }

    /** 立刻按当前语言刷一遍 */
    public apply(): void
    {
        const mgr = I18NManager.instance;
        if (mgr == null) return;

        for (let i = 0; i < this._items.length; i++)
        {
            const it = this._items[i];
            const text = mgr.t(it.key);

            // ⚠️ 文案表还没加载完时 `t()` 会把 key 名原样返回。这时候**不要写**，
            //    否则界面上会先闪一下 "Gate_Card_Daily"，等表加载好才变回来。
            //    保持预制体里的原文（中文），加载完成后 initAsync 会广播一次补刷。
            if (text == null || text.length === 0 || text === String(it.key)) continue;

            if (it.label != null) it.label.string = text;
            if (it.rich != null) it.rich.string = text;
        }

        if (this._afterApply != null) this._afterApply();
    }

    /** onEnable 调：刷一遍 + 订阅 */
    public enable(): void
    {
        this.apply();

        if (this._subscribed) return;
        const mgr = I18NManager.instance;
        if (mgr == null) return;
        mgr.onLanguageChangeEvt.subscribe(this._onLanguageChange);
        this._subscribed = true;
    }

    /** onDisable 调：摘订阅（节点会被池子复用，不摘会重复订阅） */
    public disable(): void
    {
        if (!this._subscribed) return;
        const mgr = I18NManager.instance;
        if (mgr != null) mgr.onLanguageChangeEvt.unsubscribe(this._onLanguageChange);
        this._subscribed = false;
    }
}
