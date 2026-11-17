import { _decorator, Component, Sprite, SpriteFrame, UITransform, Vec2, Vec3 } from "cc";
import { LangType } from "../Const/LangType";
import { I18NManager } from "./I18NManager";

const { ccclass, property, disallowMultiple } = _decorator;

/**
 * 图片多语言。
 *
 * 有些图的文案是**烘在图里**的（Logo、活动标题牌、结算页标题/按钮、拼图倒计时底板），
 * Label 那套文本多语言改不到它们，只能按语言换图。
 *
 * 约定：
 *  - 中文版 = 节点上原本的 `Sprite.spriteFrame`，组件不去碰它（onLoad 时缓存一份）；
 *  - 英文版 = `enFrame`，其余语言（日/韩/…）一律走英文，和文本多语言一致；
 *  - 换图后如果英文图的宽高比和中文不同，用 `enSize` 把节点尺寸改成英文图的比例，
 *    避免 `Sprite` 是 CUSTOM 尺寸时把英文图**拉扁**。宽度一般沿用中文节点，
 *    高度按英文图比例推 —— 这样节点中心不动，子节点（角标、数字 Label）不会错位。
 *  - 纯排版用的节点（例如倒计时那三个数字 Label）可以不配 `enFrame`，
 *    只用 `enSize` / `enPos` 跟着英文底板挪位。
 *
 * 注意：**不要在英文下把节点 active 设成 false** —— 那会触发 onDisable 退订，
 * 再切回中文就收不到事件了。要隐藏请用别的办法。
 */
@ccclass("I18nSprite")
@disallowMultiple
export class I18nSprite extends Component
{
    @property({
        type: SpriteFrame,
        tooltip: "英文版用的图。中文版沿用节点上原本的 Sprite.spriteFrame。",
    })
    public enFrame: SpriteFrame = null;

    @property({
        tooltip: "英文版节点尺寸。0 = 不改。建议宽度沿用中文节点、高度按英文图比例推。",
    })
    public enSize: Vec2 = new Vec2(0, 0);

    @property({
        tooltip: "勾上才会在英文下改节点位置（例如倒计时数字格）。",
    })
    public overridePos: boolean = false;

    @property({
        type: Vec3,
        tooltip: "英文版节点位置，相对父节点。仅 overridePos = true 时生效。",
    })
    public enPos: Vec3 = new Vec3(0, 0, 0);

    private _cached: boolean = false;
    private _zhFrame: SpriteFrame = null;
    private _zhW: number = 0;
    private _zhH: number = 0;
    private _zhPos: Vec3 = new Vec3();

    protected onLoad(): void
    {
        this.cacheZh();
    }

    protected onEnable(): void
    {
        const mgr = I18NManager.instance;
        if (mgr != null)
        {
            mgr.onLanguageChangeEvt.subscribe(this.onLanguageChange, this);
        }
        this.apply();
    }

    protected onDisable(): void
    {
        const mgr = I18NManager.instance;
        if (mgr != null)
        {
            mgr.onLanguageChangeEvt.unsubscribe(this.onLanguageChange, this);
        }
    }

    /** 语言切换回调。 */
    public onLanguageChange(): void
    {
        this.apply();
    }

    /** 立即按当前语言刷新一次（外部改了图/尺寸后可以手动调）。 */
    public refresh(): void
    {
        this.apply();
    }

    private cacheZh(): void
    {
        const spr = this.getComponent(Sprite);
        this._zhFrame = spr != null ? spr.spriteFrame : null;

        const ut = this.getComponent(UITransform);
        if (ut != null)
        {
            this._zhW = ut.width;
            this._zhH = ut.height;
        }

        this._zhPos = this.node.position.clone();
        this._cached = true;
    }

    private apply(): void
    {
        if (!this._cached)
        {
            this.cacheZh();
        }

        const mgr = I18NManager.instance;
        const isEn = mgr != null && mgr.curLangType === LangType.English;

        const spr = this.getComponent(Sprite);
        const ut = this.getComponent(UITransform);

        if (isEn)
        {
            if (this.enFrame != null && spr != null)
            {
                spr.spriteFrame = this.enFrame;
            }
            if (ut != null && this.enSize.x > 0 && this.enSize.y > 0)
            {
                ut.setContentSize(this.enSize.x, this.enSize.y);
            }
            if (this.overridePos)
            {
                this.node.setPosition(this.enPos);
            }
        }
        else
        {
            if (spr != null && this._zhFrame != null)
            {
                spr.spriteFrame = this._zhFrame;
            }
            if (ut != null && this._zhW > 0 && this._zhH > 0)
            {
                ut.setContentSize(this._zhW, this._zhH);
            }
            this.node.setPosition(this._zhPos);
        }
    }
}
