import { _decorator, Button, Component, Label, Node, ParticleSystem2D, Sprite } from 'cc';
import { DogColor, DogNode } from './DogNode';
import { ImageLoaderManager } from '../../../Module/Resource/ImageLoaderManager';
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
                    icon = this.doorState == DoorState.Open ? "dogface_orange" : "dogface_sad_orange";
                    break;
                case DogColor.Pink:
                    icon = this.doorState == DoorState.Open ? "dogface_pink" : "dogface_sad_pink";
                    break;
                case DogColor.Blue:
                    icon = this.doorState == DoorState.Open ? "dogface_blue" : "dogface_sad_blue";
                    break;
                case DogColor.Green:
                    icon = this.doorState == DoorState.Open ? "dogface_green" : "dogface_sad_green";
                    break;
                case DogColor.Purple:
                    icon = this.doorState == DoorState.Open ? "dogface_purple" : "dogface_sad_purple";
                    break;
                case DogColor.Yellow:
                    icon = this.doorState == DoorState.Open ? "dogface_yellow" : "dogface_sad_yellow";
                    break;
                case DogColor.Mint:
                    icon = this.doorState == DoorState.Open ? "dogface_mint" : "dogface_sad_mint";
                    break;
                case DogColor.Grey:
                    icon = this.doorState == DoorState.Open ? "dogface_grey" : "dogface_sad_grey";
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
    }
}
