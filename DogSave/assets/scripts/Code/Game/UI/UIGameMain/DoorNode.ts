import { _decorator, Button, Component, Label, Node, ParticleSystem2D, Sprite } from 'cc';
import { DogColor, DogNode } from './DogNode';
import { ImageLoaderManager } from '../../../Module/Resource/ImageLoaderManager';
import { GameDataManager, LevelState } from '../../GameDataManager';
import { close } from '../../../../../../extensions/taowu-editor/source/panel';
const { ccclass, property } = _decorator;

export enum DoorState {
    None, //空白
    Lock, //等待广告解锁
    Idle, //等待完成（绑定了制定颜色）
    Open, //飞向车门的过程中
}

@ccclass('DoorNode')
export class DoorNode extends Component {
      
    @property(Sprite)
    public dogIcon: Sprite;
       
    @property(Sprite)
    public openCarIcon: Sprite;

    @property(Sprite)
    public closeCarIcon: Sprite;

    @property(Button)
    public adsBtn: Button;

    /**
     * 狗狗飞入时的光波（DoorNode.prefab 上的 LightWave 子节点，位置对齐 doorClose）。
     * 一圈从暗心向外炸开的金色射线：粒子全部从同一点、同一瞬间出发，
     * 于是任意时刻都落在同一个半径附近 => 形成环；环内是空的 => 中心自然是暗的。
     */
    @property(ParticleSystem2D)
    private _lightWave: ParticleSystem2D = null;

    public waitDogColor:DogColor;

    public doorState:DoorState = DoorState.Lock;

    public doorIndex:number;

    start() {
        // 「看广告解锁门」的点击入口。
        //
        // ⚠️ 全工程原先**没有任何地方**给 adsBtn 挂过监听 —— 三个 adsBtn（门 / 狗窝 / 椅子）
        //    里只有这里和狗窝那两个真的会显示出来（`RefreshLock` 按 state 开合），
        //    但点了毫无反应 ⇒ 整条"看广告解锁"流程是空的。这里把它接上。
        //
        // 真正接广告 SDK 时，把 `onAdsUnlock()` 换成"播广告 → 成功回调里再调 onAdsUnlock"；
        // 现在直接解锁，好处是流程在没接 SDK 的情况下也能跑通、能被人工验收。
        //
        // `start()` 一辈子只跑一次，但仍按工程惯例先 off 再 on（幂等，将来被手动调也不怕）。
        this.adsBtn.node.off(Button.EventType.CLICK, this.onAdsUnlock, this);
        this.adsBtn.node.on(Button.EventType.CLICK, this.onAdsUnlock, this);
    }

    /**
     * 广告看完之后解锁这道门：给它一个"在等的颜色"，让 FlyToCar 能命中它。
     *
     * 取色用的是和开局 Idle 门**同一个**函数（`GetFirstChairBottomColor`）——
     * 不另发明一套规则，否则"解锁出来的门"和"开局的门"行为会不一致。
     */
    private onAdsUnlock()
    {
        // 结算弹窗弹出后盘面是冻住的（只有 Playing 才接受操作），这时不该还能解锁。
        // 和 GameDataManager.SetSelectChairId 用同一条判据。
        if (GameDataManager.instance == null) return;
        if (GameDataManager.instance.levelState != LevelState.Playing) return;
        // 幂等：只有锁着的门才需要解锁（连点两下 / 状态已经被别处改过）
        if (this.doorState != DoorState.Lock) return;

        let doorColor:DogColor = GameDataManager.instance.gameMainObj.GetFirstChairBottomColor();
        // CreateWithColor 内部会把 doorState 置成 Idle 并刷新 dogIcon / 车门开合，
        // 顺带把 adsBtn 关掉（走 RefreshLock 的那条判据）—— 这里不用再手动摆状态。
        this.CreateWithColor(doorColor);

        // ⚠️ 必须补一次盘面扫描：解锁可能让某根**已经集满、却一直等不到门**的椅子立刻能飞。
        // 不补的话要等玩家下一步棋才动（`CheckDogFlyToCar` 只有两个调用点，
        // 见 level_tools/verify_level_loop.py 第 14 项那段注释）。
        GameDataManager.instance.CheckDogFlyToCar();
    }

    update(deltaTime: number) {
        
    }

    CreateWithColor(color:DogColor) 
    {
        this.waitDogColor = color;
        // 赋值，不是判等。新一只待救的狗进来了，门回到 Idle
        // （RfreshDogSprite 里 Idle 走 dogface_sad_<色>，Open 才走 dogface_<色>）。
        // 原先写成 `==` 是个空语句：doorState 停在旧值，
        // 紧跟着的 RfreshDogSprite() 读到的是过期状态，新狗的表情/车门开合都是错的。
        this.doorState = DoorState.Idle;
        this.dogIcon.node.active = this.waitDogColor != DogColor.None;
        this.RfreshDogSprite();
    }

    public async RfreshDogSprite()
    {
        let imgPath:string = "ui/uigamemain/atlas/";   
        let icon:string = "battle_alpha"; 
        this.openCarIcon.node.active = this.doorState == DoorState.Open;
        this.closeCarIcon.node.active = this.doorState != DoorState.Open;
        if (this.doorState == DoorState.Idle || this.doorState == DoorState.Open)
        {
            switch(this.waitDogColor)
            {
                case DogColor.Orange:
                    icon = this.doorState == DoorState.Open ? "dogface_orange" : "dogface_orange";
                    break;
                case DogColor.Pink:
                    icon = this.doorState == DoorState.Open ? "dogface_pink" : "dogface_pink";
                    break;
                case DogColor.Blue:
                    icon = this.doorState == DoorState.Open ? "dogface_blue" : "dogface_blue";
                    break;
                case DogColor.Green:
                    icon = this.doorState == DoorState.Open ? "dogface_green" : "dogface_green";
                    break;
                case DogColor.Purple:
                    icon = this.doorState == DoorState.Open ? "dogface_purple" : "dogface_purple";
                    break;
                case DogColor.Yellow:
                    icon = this.doorState == DoorState.Open ? "dogface_yellow" : "dogface_yellow";
                    break;
                case DogColor.Mint:
                    icon = this.doorState == DoorState.Open ? "dogface_mint" : "dogface_mint";
                    break;
                case DogColor.Grey:
                    icon = this.doorState == DoorState.Open ? "dogface_grey" : "dogface_grey";
                    break;
                case DogColor.None:
                    icon = "battle_alpha";  
                    break
            } 
        }
        var sprite = await ImageLoaderManager.instance.loadSpriteAsync(imgPath + icon);      
        this.dogIcon.spriteFrame = sprite;
    }

    /** 狗狗飞入时播放。由 DogNode.FlyToCarDoor 的 tween 完成回调调用。 */
    PlayHitEff() 
    {
        if (!this._lightWave || !this._lightWave.isValid) return;
        // FlyToCar 里一批狗是错开 0.1s 飞的，每只到位都会调进来一次。
        // 光波整体只有 0.35s，若无脑 resetSystem 会变成"一炸一炸"的抽搐 ——
        // 上一波还没放完就直接忽略，一批狗只放一次。
        // 想让每只狗各放一次的话，把下面这行判断删掉即可。
        if (this._lightWave.particleCount > 0) return;
        this._lightWave.resetSystem();
    }

    RefreshLock()
    {
        this.adsBtn.node.active = this.doorState == DoorState.Lock;
        if (this.doorState == DoorState.Lock)
            this.dogIcon.node.active = false;
        // ⚠️ 车门的开合也要在这里复位 —— 复用这道门时，**可能只有这个函数会跑**。
        //
        // `GameMainObj.start()` 里 Idle 门会走 `CreateWithColor()` → 里面调到
        // RfreshDogSprite()，开合被重画一遍；而 **Lock 门只走这里**。
        // 上一关如果正好在这道门飞进狗的时候结束（倒计时归零），门会停在 Open、
        // openCarIcon 亮着 —— 这一关它变成 Lock，就没人关它了，卡车门一直画成开着的。
        //
        // 这里只同步开合，**不碰 dogIcon 的贴图**：贴图那条是异步的，由
        // CreateWithColor → RfreshDogSprite 负责，两处都去写会打架。
        // 判据见 level_tools/verify_level_loop.py 第 11 项。
        this.openCarIcon.node.active = this.doorState == DoorState.Open;
        this.closeCarIcon.node.active = this.doorState != DoorState.Open;
    }
}
