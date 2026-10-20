import { _decorator, Button, Component, Label, Node } from 'cc';
import { DogNode, DogColor, DogState } from './DogNode';
import { GameDataManager, LevelState, LevelChairData } from '../../GameDataManager';
const { ccclass, property } = _decorator;

// 同一根椅子上相邻两只狗的出生间隔（秒），让整列自下而上依次弹出
const BORN_STAGGER = 0.06;

export enum ChairState {
    None, //空白
    Lock, //等待广告解锁
    Idle, //等待选择状态
    InSelect, //选中悬浮中
    FlyToFriend, //飞向右方
    FlyToDoor, //飞向车门
}

@ccclass('ChairNode')
export class ChairNode extends Component {
      
    @property(Node)
    public touchNode:Node

    /**
     * 椅子的美术节点（预制件里的 `bg`）。
     *
     * 单独拎出来是为了说清一条**不能犯**的错：狗狗飞往车门时**绝不能关整个 chairNode** ——
     * 被 FlyToCarDoor 动画的狗是椅子的子节点（sortDog → layout/slot1..slot6），
     * 关掉椅子会连狗带拖尾一起不渲染，整段飞行动画看不见。
     *
     * ⚠️ 现状（10-14 改）：`FlyToCar` **不再**收 `bg` / `touchNode` 了 ——
     * 送完狗的椅子留在原地当额外空位（见 GameMainObj.FlyToCar 那段注释）。
     * 所以下面 `RefreshAllSlot()` 里"把 bg/touchNode 放回来"现在是空转；
     * 留着不动（幂等），也留着这条 @property 绑定，将来要重新"收椅子"还用得上。
     */
    @property(Node)
    public bg:Node

    @property(DogNode)
    public sortDog:DogNode[] = [];

    @property(Button)
    public adsBtn: Button;

    @property(Boolean)
    public isFlip: Boolean;

    public chairState:ChairState = ChairState.None;

    public chairId:number;

    /**
     * `sortDog` 的「预制体原始顺序」备份，只在第一次 InitFlipSlot 时抓一次。
     * 见 InitFlipSlot 的注释：那个函数每次换关都会跑，而 reverse() 是原地操作。
     */
    private _sortDogSource: DogNode[] = null;

    start() {
       this.touchNode.active = true;
        this.touchNode.on(Node.EventType.TOUCH_END, (event) => {
            console.log('Mouse down');
            // GameDataManager.instance.SetLevelCfgById(GameDataManager.instance.curFightLevelId+1);
            //todo
            let isHaveDog = false;
            let chairDatas = GameDataManager.instance.curLevelConfig.chairs[this.chairId];
            for (let i = 0; i < chairDatas.dogs.length; i++)
            {
                if (chairDatas.dogs[i] > 0)
                    isHaveDog = true;
            }
            if (!isHaveDog && GameDataManager.instance.curSelectChairIdx <= 0 && GameDataManager.instance.curSelectRoomIdx <= 0)
            {
                 console.log('no dog');
                return;
            }
            GameDataManager.instance.SetSelectChairId(this.chairId);

        }, this);

        // 「看广告解锁椅子」的点击入口。
        //
        // ⚠️ 现状：`ShowAdsBtn()` 全工程**没有调用者**，而 `ChairState.Lock` 除了这里
        //    也没人写过 —— 也就是说椅子**从来不会真的变成锁着的**（换关时
        //    `RefreshAllSlot()` 一律置 Idle）。所以这个按钮目前不会出现在屏幕上。
        //    还是把入口接上：将来谁调了 `ShowAdsBtn()`，流程立刻是通的，
        //    不用再回来补这一刀。`start()` 一辈子只跑一次，仍按惯例先 off 再 on。
        this.adsBtn.node.off(Button.EventType.CLICK, this.onAdsUnlock, this);
        this.adsBtn.node.on(Button.EventType.CLICK, this.onAdsUnlock, this);
    }

    /** 广告看完之后解锁这根椅子（见 start() 里关于"现状不会触发"的说明） */
    private onAdsUnlock()
    {
        if (GameDataManager.instance == null) return;
        if (GameDataManager.instance.levelState != LevelState.Playing) return;
        // 幂等：只有锁着的椅子才需要解锁
        if (this.chairState != ChairState.Lock) return;

        this.chairState = ChairState.Idle;
        this.adsBtn.node.active = false;
    }

    /**
     * 按 `isFlip` 归一化槽位顺序，并给每个槽位编号（SlotIdx 从 1 起）。
     *
     * ⚠️ 这个函数**每次换关都会被调一遍** —— `GameMainObj.start()` 会被
     * `GameDataManager.SetLevelCfgById()` 重调，而 start() 里就调它。
     * 而 `Array.reverse()` 是**原地**改数组，不是返回副本 ——
     * 直接 reverse 会让顺序在关卡之间来回颠倒：奇数关反着、偶数关正着。
     *
     * 顺序在这里是有语义的：`sortDog[0]` 被当作**椅底**，
     * 各处（GameMainObj 找空位 / 取顶部颜色 / 挑要搬的狗）都靠"从 length-1 往 0 扫"
     * 来读椅顶。顺序一颠倒，整套读写就上下反了。
     *
     * 所以先留一份「预制体原始顺序」，每次都从它重新推导 —— 幂等，
     * 第 1 关的表现和改动前完全一致，之后每一关也都能拿到同样的方向。
     */
    public InitFlipSlot()
    {
        if (this._sortDogSource == null)
            this._sortDogSource = this.sortDog.slice();

        this.sortDog = this.isFlip
            ? this._sortDogSource.slice().reverse()
            : this._sortDogSource.slice();

        for (let i = 0; i < this.sortDog.length; i++)
        {
            this.sortDog[i].SlotIdx = i+1;
            this.sortDog[i].ResetPosition();
        }
    }

    update(deltaTime: number) {
        
    }

    public RefreshAllSlot(dogs:number[], chId:number)
    {
        this.adsBtn.node.active = false;
        // 椅子会被下一关复用（GameMainObj.start 里 node.active = true + RefreshAllSlot）。
        // ⚠️ 这两行现在是**空转**：10-14 起 `FlyToCar` 不再收 bg/touchNode
        // （送完狗的椅子留在原地当额外空位），所以它们从来没被关过。
        // 留着是为了幂等 + 将来要重新"收椅子"时不用回来补。
        if (this.bg) this.bg.active = true;
        if (this.touchNode) this.touchNode.active = true;
        this.chairState = ChairState.Idle;
        this.chairId = chId;
        for (let i = 0; i < this.sortDog.length; i++)
        {
            // ⚠️ 槽位**节点本身**也要一起放回来 —— 和上面 bg/touchNode 是同一件事的另一半。
            //
            // FlyToCar 是把 `sortDog[i]` **自己**派去飞车门的（不是 AnimDog 拷贝），
            // 而 DogNode.FlyToCarDoor 的 onComplete 里写了 `this.node.active = false`。
            // 上一关飞走过狗的槽位节点就一直是关着的。
            // 麻烦在于 Cocos 的 node.active **不向子节点传播**（子节点只看自己的 active，
            // 父节点关掉时靠 activeInHierarchy 屏蔽渲染，父节点再打开子节点原来的 false 还在），
            // 而 CreateDog 只动 dogIcon **子节点**、从不碰根节点
            // ⇒ 不显式打开的话，复用到的椅子会整根空着（第 2 关起丢狗）。
            this.sortDog[i].node.active = true;
            // 同一件事的第三半：拖尾粒子还停在"开着"的状态。
            //
            // PlayTrail 调的是 resetSystem()（_stopped = false），而引擎的
            // ParticleSystem2D **只覆写了 onEnable、没有 onDisable**
            // （particle-2d/particle-system-2d.ts:757，_canRender 只要求 !_stopped:1228）
            // ⇒ 关掉节点并不会把它停掉。节点一被放回来 emitter 就地复活，
            // 新一关开局会在槽位上先炸出一坨上一条命的拖尾。
            // StopAnim() 里的 StopTrail() 走的是 stopSystem()（_stopped = true），把这条路堵死。
            this.sortDog[i].StopAnim();
            // 按槽位错开 0.06s（BORN_STAGGER），整列自下而上依次弹出，而不是 6 只一起蹦
            let bornDelay:number = i * BORN_STAGGER;
            this.sortDog[i].CreateDog(dogs[i], bornDelay);
        }
    }

    public RefreshOneSlotColor(slotIndx:Number, color:DogColor)
    {
        
    }

    public RefreshOneSlotState(slotIndx:Number, state:DogState)
    {
        
    }

    public ShowAdsBtn()
    {
        this.adsBtn.node.active = true;
        this.chairState = ChairState.Lock;
    }
}

