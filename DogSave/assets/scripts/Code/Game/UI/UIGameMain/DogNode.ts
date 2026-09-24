import { _decorator, Animation, AnimationState, Button, Component, Label, Node, Sprite, Tween, Vec3, tween } from 'cc';
import { ImageLoaderManager } from '../../../Module/Resource/ImageLoaderManager';
const { ccclass, property } = _decorator;

// 动画 clip（assets/assetsPackage/ui/uigamemain/animations/）
//   breathe    呼吸      2.4s   Loop
//   born       出生      0.6s   Normal
//   hover_up   起浮      0.25s  Normal
//   hover      悬浮待机  1.6s   Loop
//
// 四个 clip 写的都是同一个子节点 dog 的 scale / position / eulerAngles，
// 同时播会互相抢轨道 —— 任何时刻只能有一个在播，所以必须靠 FINISHED 串起来：
//     born     播完 -> breathe
//     hover_up 播完 -> hover
// 落回槽位没有单独的 clip，用 tween 补那 0.18s（见 PlayDrop）。
const CLIP_BREATHE = 'breathe';
const CLIP_BORN = 'born';
const CLIP_HOVER_UP = 'hover_up';
const CLIP_HOVER = 'hover';
const ALL_CLIPS = [CLIP_BREATHE, CLIP_BORN, CLIP_HOVER_UP, CLIP_HOVER];

const BREATHE_DURATION = 2.4;

// 落回槽位的时长。比 hover_up（0.25s）短 —— 下落有重力加速，本来就该更快。
const DROP_DURATION = 0.18;

// _oneShot 的取值：正在占着轨道的那些"播完就结束"的动作
const SHOT_BORN = 'born';
const SHOT_HOVER_UP = 'hover_up';
const SHOT_DROP = 'drop';

// 枚举定义
export enum DogState {
    None, //空白
    Idle, //待机备选
    InSelect, //选中悬浮中
    FlyToFriend, //飞向右方
    FlyToDoor, //飞向车门
}

export enum DogColor {
    None = 0,
    Orange = 1,// 1	橙色	
    Pink = 2, // 2	粉色	
    Blue = 3,// 3	蓝色	
    Green = 4,// 4	绿色	
    Purple = 5,// 5	紫色	
    Yellow = 6,// 6	黄色	
    Mint = 7, // 7	薄荷绿	
    Grey = 8,// 8	灰色	
}

@ccclass('DogNode')
export class DogNode extends Component {
      
    @property(Sprite)
    public dogIcon: Sprite;
    
    public DogState = DogState.None;
    public DogColor = DogColor.None;
    public SlotIdx:number;

    @property(Animation)
    private _anim: Animation = null;

    /** 当前占着轨道的一次性动作（born / hover_up / drop），'' 表示轨道空闲 */
    private _oneShot: string = '';

    /**
     * 递增令牌。延迟回调（出生错峰）和 tween 回调都靠它判断自己是否已过期 ——
     * 狗被复用到别的颜色/状态时，旧回调必须安静退出，不能回头再抢轨道。
     */
    private _token: number = 0;

    onLoad() {
        this._anim = this.getComponent(Animation);
        if (this._anim) {
            this._anim.on(Animation.EventType.FINISHED, this.OnAnimFinished, this);
        } else {
            console.warn('[DogNode] 预制件上没有 cc.Animation 组件，动画不会播放');
        }
    }

    onDestroy() {
        if (this._anim) {
            this._anim.off(Animation.EventType.FINISHED, this.OnAnimFinished, this);
        }
        this._token++;  // 作废所有在途回调
        this._stopTween();
    }

    /** 子节点 dog —— 所有 clip 的轨道目标就是它 */
    private get _dogNode(): Node {
        return this.dogIcon ? this.dogIcon.node : null;
    }

    private _stopTween() {
        const dog = this._dogNode;
        if (dog) Tween.stopAllByTarget(dog);
    }

    /**
     * 只播 name，把其余 clip 的状态全部停掉。
     * Animation.play() 不会自动停别的 state，多条 clip 会同时写同一批轨道。
     */
    private _playOnly(name: string) {
        if (!this._anim) return;
        for (const n of ALL_CLIPS) {
            if (n === name) continue;
            const st = this._anim.getState(n);
            if (st) st.stop();
        }
        this._anim.play(name);
    }

    /** 一次性动作播完（或落定）后把轨道标记交还 */
    private _finishOneShot(token: number): boolean {
        if (token !== this._token) return false;
        this._oneShot = '';
        return true;
    }

    private _cancelOneShot() {
        this._token++;
        this._oneShot = '';
        this._stopTween();
    }

    /** born / hover_up 播完之后的接力 —— 见文件头注释 */
    private OnAnimFinished(type: Animation.EventType, state: AnimationState) {
        if (!state || !state.clip) return;
        switch (state.clip.name) {
            case CLIP_BORN:
                this._finishOneShot(this._token);
                // 出生期间可能已经被点中，那就别再起呼吸去抢悬浮的轨道
                if (this.DogState === DogState.Idle) this.PlayBreathe();
                break;
            case CLIP_HOVER_UP:
                this._finishOneShot(this._token);
                if (this.DogState === DogState.InSelect) this.PlayHover();
                break;
        }
    }

    public PlayBreathe() {
        if (!this._anim) return;
        this._oneShot = '';
        this._playOnly(CLIP_BREATHE);
        const st = this._anim.getState(CLIP_BREATHE);
        if (st) {
            // play() 内部会 setTime(0)，所以相位必须在 play 之后设。
            // 满盘 10 椅 x 6 只 = 60 个 DogNode，同相呼吸会变成整块面板在脉动。
            st.setTime(Math.random() * BREATHE_DURATION);
        }
    }

    /** delay: 秒，用于让一列狗自下而上依次弹出 */
    public PlayBorn(delay: number = 0) {
        if (!this._anim) return;
        this.dogIcon.node.active = false;
        this._cancelOneShot();
        this._oneShot = SHOT_BORN;
        const token = this._token;
        if (delay > 0) {
            this.scheduleOnce(() => {
                // 错峰期间狗可能已经被重新赋值/换色，过期的回调直接丢掉
                if (token !== this._token || !this._anim || !this._anim.isValid) return;
                this.dogIcon.node.active = true;
                this._playOnly(CLIP_BORN);
            }, delay);
        } else {
            this.dogIcon.node.active = true;
            this._playOnly(CLIP_BORN);
        }
    }

    /** 选中：从静止位起浮，播完自动接 hover（见 OnAnimFinished） */
    public PlayHoverUp() {
        if (!this._anim) return;
        this._cancelOneShot();
        this._oneShot = SHOT_HOVER_UP;
        this._playOnly(CLIP_HOVER_UP);
    }

    /** 悬浮待机循环。抬升高度是烘焙在 clip 的 y 轨道里的，见 ResetPose */
    public PlayHover() {
        if (!this._anim) return;
        this._oneShot = '';
        this._playOnly(CLIP_HOVER);
    }

    /**
     * 从悬浮姿态落回槽位，落定后自动接呼吸。
     * 没有单独的下落 clip —— hover 的抬升是烘焙在 y 轨道里的，
     * 停掉 clip 只会让姿态僵在原地，所以这段用 tween 补。
     */
    public PlayDrop() {
        const dog = this._dogNode;
        if (!dog) {
            this.PlayBreathe();
            return;
        }
        this._cancelOneShot();
        this._oneShot = SHOT_DROP;
        const token = this._token;
        tween(dog)
            .to(DROP_DURATION, {
                position: new Vec3(0, 0, 0),
                eulerAngles: new Vec3(0, 0, 0),
                scale: new Vec3(1, 1, 1),
            }, { easing: 'sineIn' })
            .call(() => {
                if (!this._finishOneShot(token)) return;  // 期间被别的状态接管了
                this.PlayBreathe();
            })
            .start();
    }

    /**
     * 立刻把子节点 dog 的变换复位。
     * 悬浮的「抬升 29.5px + 倾斜 3.5°」是烘焙进 hover_up / hover 的 y 与 eulerAngles
     * 轨道里的 —— position 轨道写的是绝对局部坐标，代码另外去设节点 y 会被轨道直接覆盖。
     * 代价就是退出 InSelect 时必须显式归位。
     */
    public ResetPose() {
        this._cancelOneShot();
        const dog = this._dogNode;
        if (!dog) return;
        dog.setPosition(0, 0, 0);
        dog.setRotationFromEuler(0, 0, 0);
        dog.setScale(1, 1, 1);
    }

    private StopAnim() {
        this._cancelOneShot();
        if (!this._anim) return;
        this._anim.stop();
        for (const n of ALL_CLIPS) {
            const st = this._anim.getState(n);
            if (st) st.stop();
        }
    }

    /**
     * bornDelay: 秒。同一根椅子上的狗按槽位错开，整列就会自下而上"长出来"。
     */
    public CreateDog(color: DogColor, bornDelay: number = 0)
    {
        this.DogColor = color;
        if (color > DogColor.None)
        {
            // 先置状态再刷贴图 —— RfreshDogSprite 会据此选伤感脸
            this.DogState = DogState.Idle;
            this.RfreshDogSprite();
            this.PlayBorn(bornDelay);
        }
        else
        {
            this.DogState = DogState.None;
            this.RfreshDogSprite();
            this.StopAnim();
            this.ResetPose();
        }
    }

    public async RfreshDogSprite()
    {
        let imgPath:string = "ui/uigamemain/atlas/";   
        let icon:string = "battle_alpha";  
        switch(this.DogColor)
        {
            case DogColor.Orange:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_orange" : "dogface_sad_orange";
                break;
            case DogColor.Pink:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_pink" : "dogface_sad_pink";
                break;
            case DogColor.Blue:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_blue" : "dogface_sad_blue";
                break;
            case DogColor.Green:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_green" : "dogface_sad_green";
                break;
            case DogColor.Purple:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_purple" : "dogface_sad_purple";
                break;
            case DogColor.Yellow:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_yellow" : "dogface_sad_yellow";
                break;
            case DogColor.Mint:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_mint" : "dogface_sad_mint";
                break;
            case DogColor.Grey:
                icon = this.DogState == DogState.FlyToDoor ? "dogface_grey" : "dogface_sad_grey";
                break;
            case DogColor.None:
                icon = "battle_alpha";  
                break
        } 
        var sprite = await ImageLoaderManager.instance.loadSpriteAsync(imgPath + icon);      
        this.dogIcon.spriteFrame = sprite;
    }


    public RefreshDogState(state:DogState)
    {
        if (this.DogState === state) return;
        const prev = this.DogState;
        this.DogState = state;
        switch(this.DogState)
        {
            case DogState.None:
                this.StopAnim();
                this.ResetPose();
                break;
            case DogState.Idle:
                // 出生/起浮/下落还在进行时不要抢轨道
                if (this._oneShot !== '') break;
                if (prev === DogState.InSelect) {
                    // 从悬浮位落回槽位，落定后自动接呼吸
                    this.PlayDrop();
                } else {
                    this.PlayBreathe();
                }
                break;
            case DogState.InSelect:
                // 起浮 0.25s，播完自动接悬浮循环
                this.PlayHoverUp();
                break;
            case DogState.FlyToFriend:
                // TODO 飞行动画（飞行期间姿态归位，免得带着悬浮的抬升飞出去）
                this.ResetPose();
                break;
            case DogState.FlyToDoor:
                // TODO 飞向车门（同时把贴图切成开心脸）
                this.ResetPose();
                break;
        }
    }
}
