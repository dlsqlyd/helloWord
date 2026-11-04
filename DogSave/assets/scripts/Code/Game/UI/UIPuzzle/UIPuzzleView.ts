import { Button, Label, Node, Tween, tween, Vec3 } from "cc";
import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnDisable } from "../../../Module/UI/IOnDisable";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { UIManager } from "../../../Module/UI/UIManager";
import { CacheManager } from "../../../Module/Player/CacheManager";
import { CacheKeys } from "../../../Module/Const/CacheKeys";
import { UIGameMainView } from "../UIGameMain/UIGameMainView";
import { PuzzleProgress } from "./PuzzleProgress";

// ---------------------------------------------------------------------------
// 拼图活动界面（Puzzle Event）
// ---------------------------------------------------------------------------
// 版式来自效果图 `screens/08-puzzle-event.png`（1080x1920），
// 预制体由 `uipuzzle_src/gen_prefab.py` 生成，
// 结构校验 + 离线渲染见 `uipuzzle_src/preview_prefab.py`，
// 量测口径见 `uipuzzle_src/puzzle_lib.py` 文件头。
//
// ## 结构
//
//   整屏页，根下 `bg` + `content` —— 和设置界面（mask + panel，正好命中 PopupAnim
//   的默认判据）不一样，本界面**故意不挂 PopupAnim**。
//   ⚠️ 名字是 `bg` 而不是 `mask`：以后真要加弹出动画，PopupAnim 的 dimNames 里有 `bg`，
//      会先命中它，把整屏底色当成底板去缩放，内容反而不动。要加就先把 `bg` 改名。
//
//   标题「拼图活动」和「开始游戏」都是**美术字**（资源包里就是烘好文字的整图），
//   所以那两处没有 Label。倒计时里的「天/时/分」也是中文烘焙，只有数字是 Label。
//
// ## 4x4 格子的绘制顺序（改预制体之前必读）
//
//   这套资源里每块砖只有**一种形状**：方形本体 + 右凸起 + 下凹口，上边和左边都是直边。
//   所以 4x4 不是"拼"出来的，是**叠**出来的：
//     · 列倒序 —— 本砖的右凸起要盖住右邻，右邻先画；
//     · 行倒序 —— 本砖的下凹口是个洞，洞里垫的是下邻的内容，下邻先画。
//   节点名仍然是行主序 `cell_{r*4+c}`，本文件按名字取，不依赖兄弟顺序。
//
// ## 凹口里那 46px 垫什么（`fill` / `fill_pic` 两个节点）
//
//   凹口是砖身上的洞，透下去看到的是**下邻砖的顶部** —— 而那块内容在拼图上正好错开一行。
//   所以洞里必须另垫一张补丁，两张预置好、只切 active：
//
//     下邻还锁着   -> `fill`      = `patch_col_<下邻砖色>`（竖渐变，横向拉伸自砖身一列）
//     下邻已解锁   -> `fill_pic`  = `patch_XX`（拼图底图在**本格**该处的切片，画面才连续）
//
//   ⚠️ 补丁用的是**本格**的切片（`patch_{r*4+c}`），不是下邻的 —— 洞在本格的矩形里。
//      写成下邻的下标会让整张图错开一行，而且看起来"差不多"，很容易漏掉。
//
//   ⚠️ 为什么预置两个节点、不运行时换 spriteFrame：图集在 bundle 里，换图要先 loadBundle
//      + 异步 load，会闪一帧空补丁（洞里露出奶油板底）。日历界面 24 个奖杯节点也是
//      同样的处理（见 UICalendarView 文件头）。
//
// ## 四格交界那 9 颗星（`joint_0..8`）
//
//   每块砖四个角都是圆角，四块凑在一起时，四个圆角之间会留一个星形小洞（约 10px）。
//   全锁时它露的是奶油板底，看起来就是"砖缝"，没问题；但解锁之后洞里应该是**画面**，
//   否则狗脸上会浮出 9 颗奶油色小星星。
//   所以预制体里预置了 9 张 44x44 的画面切片（`joint_XX`），垫在砖下面、默认隐藏，
//   只要四格里**任意一块**解锁就打开。规则与 `preview_prefab.apply_flags` 一致。
//
//   为什么按交界切 9 小张、不铺一整张 876x856 底图：一整张会多占一个图集页（约 200KB），
//   9 张 44x44 加起来不到 20KB。
//
// ## 哪些是真接通的
//
//   返回        关掉自己（closeSelf，继承自 UIBaseView；安卓返回键也走它）
//   开始游戏    打开关卡界面（UIGameMainView），**不关自己** —— 关卡关掉后回到这里
//   进度 `n/16` 读 CacheKeys.PuzzleUnlocked，真数据
//   倒计时      见下面「倒计时为什么不会自己走」
//
// ## 解锁规则（写在 GameDataManager，不在这里）
//
//   过关 -> `GameDataManager.FinishLevel(true)` -> `UnlockPuzzlePiece()` 随机挑一片还没解锁的
//   写进缓存。本界面只负责"把缓存画出来"，**不自己改解锁状态** ——
//   否则"解锁"就有两个入口，以后加活动次数/看广告解锁时会对不上。
//
// ## 倒计时为什么不会自己走
//
//   工程里**没有活动系统**：没有活动配置、没有开始/结束时间、没有奖励表。
//   所以默认 `_deadline == null`，三个数字保持预制体里效果图的那组静态值（02/23/47），
//   而不是编一个假截止时间去倒计。
//   有活动系统之后调 `setDeadline(毫秒时间戳)` 即可算出真实的 天/时/分。
//   ⚠️ 现在**没有逐秒跳动**：`UIBaseContainer` 不是 `cc.Component`，没有 `schedule`；
//      要跳动得挂一个小组件或走 `director.getScheduler()`。等真有活动了再补这一处，
//      不然就是为一段假数据挂一个常驻定时器。
//
// ## 待定（没有擅自决定）
//
//   · 回主页去哪：结算界面的「回主页」仍然固定回大门（UIGateView），不会回到本界面。
//     玩家要走 大门 -> 拼图卡 再看新碎片。这是**导航改动**（谁先出现、结算完回哪），
//     不属于换皮，所以没动。
//   · 每赢一局解锁一片：按需求实现。副作用是刷第 1 关 16 次也能集满 ——
//     要限制的话在 `GameDataManager.UnlockPuzzlePiece()` 一处加条件即可。
export class UIPuzzlePara
{
    /**
     * 本次要**高亮**的碎片下标（刚解锁的那片），-1 / 不传 = 不高亮。
     * 只影响一次弹跳动画，不改任何数据。
     */
    public highlight?: number;
}

/** 一个格子的五个节点。底行没有 `fill` / `fill_pic`（它们的砖没有下凹口） */
class PuzzleCell
{
    public root: Node = null;
    public fill: Node = null;
    public fillPic: Node = null;
    public locked: Node = null;
    public unlocked: Node = null;
}

@UIView("UIPuzzleView")
export class UIPuzzleView extends UIBaseView implements IOnCreate, IOnEnable<UIPuzzlePara>, IOnDisable
{
    public static readonly PrefabPath: string = "ui/uipuzzle/prefabs/uiPuzzleView";

    /** 预制体里的节点路径。改预制体要同步改这里（路径错了会静默失效，只留一条 Log） */
    private static readonly PATH_BTN_BACK: string = "content/btn_back";
    private static readonly PATH_BTN_START: string = "content/btn_start";
    private static readonly PATH_LBL_PROGRESS: string = "content/badge/lbl_progress";
    private static readonly PATH_LBL_DAY: string = "content/countdown/lbl_day";
    private static readonly PATH_LBL_HOUR: string = "content/countdown/lbl_hour";
    private static readonly PATH_LBL_MIN: string = "content/countdown/lbl_min";
    /** 后面接 0..15 */
    private static readonly PATH_CELL: string = "content/grid/cell_";
    /** 四格交界补丁，后面接 0..8（3x3 个内部交界） */
    private static readonly PATH_JOINT: string = "content/grid/joint_";

    /** 列数。格子下标是行主序：`i = r * COLS + c`，和预制体 `cell_{i}` 一致 */
    private static readonly COLS: number = 4;
    private static readonly ROWS: number = 4;

    /** 连点「开始游戏」的去抖窗口（毫秒）。见 onClickStart 的注释 */
    private static readonly START_DEBOUNCE_MS: number = 600;

    private _cells: PuzzleCell[] = null;
    /** 9 个内部交界补丁（3x3）。下标 `r * (COLS-1) + c`，和预制体 `joint_{j}` 一致 */
    private _joints: Node[] = null;
    private _lblProgress: Label = null;
    private _lblDay: Label = null;
    private _lblHour: Label = null;
    private _lblMin: Label = null;

    private _btnBack: Button = null;
    private _btnStart: Button = null;

    /** 上一次点「开始游戏」的时刻，只用来去抖 —— 不是"是否正在打开"的标志 */
    private _lastStartAt: number = 0;

    /**
     * 活动截止时间（毫秒时间戳）。`null` = 没有活动系统 ⇒ 保持预制体里的静态数字。
     * 见文件头「倒计时为什么不会自己走」。
     */
    private _deadline: number = null;

    public getConstructor()
    {
        return UIPuzzleView;
    }

    // -----------------------------------------------------------------------
    // 生命周期
    // -----------------------------------------------------------------------

    public onCreate()
    {
        this._lblProgress = this.findLabel(UIPuzzleView.PATH_LBL_PROGRESS);
        this._lblDay = this.findLabel(UIPuzzleView.PATH_LBL_DAY);
        this._lblHour = this.findLabel(UIPuzzleView.PATH_LBL_HOUR);
        this._lblMin = this.findLabel(UIPuzzleView.PATH_LBL_MIN);

        this._btnBack = this.findButton(UIPuzzleView.PATH_BTN_BACK);
        this._btnStart = this.findButton(UIPuzzleView.PATH_BTN_START);

        // 16 个格子只在 onCreate 解析一次：节点是池子复用的，不会随打开次数变多
        this._cells = new Array<PuzzleCell>(PuzzleProgress.TOTAL);
        for (let i = 0; i < PuzzleProgress.TOTAL; i++)
        {
            const cell = new PuzzleCell();
            cell.root = this.findNode(UIPuzzleView.PATH_CELL + i);
            if (cell.root != null)
            {
                cell.fill = cell.root.getChildByName("fill");
                cell.fillPic = cell.root.getChildByName("fill_pic");
                cell.locked = cell.root.getChildByName("locked");
                cell.unlocked = cell.root.getChildByName("unlocked");
                if (cell.locked == null || cell.unlocked == null)
                {
                    console.warn(`[UIPuzzleView] cell_${i} 缺 locked / unlocked 子节点（预制体改过结构？）`);
                }
            }
            this._cells[i] = cell;
        }

        // 3x3 个内部交界。缺了不报错（旧预制体没有），只是全解锁时四角会露奶油星
        this._joints = new Array<Node>((UIPuzzleView.ROWS - 1) * (UIPuzzleView.COLS - 1));
        for (let j = 0; j < this._joints.length; j++)
        {
            this._joints[j] = this.node != null
                ? this.node.getChildByPath(UIPuzzleView.PATH_JOINT + j)
                : null;
        }
    }

    public onEnable(para?: UIPuzzlePara)
    {
        this._lastStartAt = 0;

        // 先刷数据再挂按钮：反过来的话，刷新期间玩家点一下会读到上一局的结果
        this.refresh();
        this.refreshCountdown();

        this.bindButtons();

        // 高亮放最后：先把锁定/解锁的 active 全部摆好，再动缩放，
        // 否则弹跳动画会从"上一局的样子"开始，看起来像闪了一下。
        if (para != null && para.highlight != null && para.highlight >= 0)
        {
            this.playUnlockPop(para.highlight);
        }
    }

    public onDisable()
    {
        this.unbindButtons();

        // 池子复用：上一次没播完的弹跳必须停掉并把缩放复位，
        // 不然下次打开会带着 1.1 倍的格子出场（而且那个 tween 的 target 还活着）。
        if (this._cells != null)
        {
            for (let i = 0; i < this._cells.length; i++)
            {
                const cell = this._cells[i];
                if (cell == null || cell.root == null) continue;
                Tween.stopAllByTarget(cell.root);
                cell.root.setScale(1, 1, 1);
            }
        }
    }

    // -----------------------------------------------------------------------
    // 对外
    // -----------------------------------------------------------------------

    /** 当前已解锁的 16 个布尔（行主序）。外部要判断某片时用它，别自己解析字符串 */
    public getUnlockedFlags(): boolean[]
    {
        return PuzzleProgress.parse(CacheManager.instance.getString(CacheKeys.PuzzleUnlocked, ""));
    }

    /** 已解锁数量 */
    public getUnlockedCount(): number
    {
        return PuzzleProgress.count(this.getUnlockedFlags());
    }

    /** 是否集齐 */
    public isComplete(): boolean
    {
        return PuzzleProgress.isComplete(this.getUnlockedFlags());
    }

    /**
     * 设置活动截止时间（毫秒时间戳，`Date.now()` 口径）。传 <= 0 / null 恢复静态数字。
     * 见文件头「倒计时为什么不会自己走」。
     */
    public setDeadline(deadlineMs: number): void
    {
        this._deadline = (deadlineMs != null && deadlineMs > 0) ? deadlineMs : null;
        this.refreshCountdown();
    }

    /** 按缓存重画 16 个格子 + 进度数字。数据变了（例如刚解锁一片）调它 */
    public refresh(): void
    {
        const flags = this.getUnlockedFlags();
        let done = 0;

        for (let i = 0; i < PuzzleProgress.TOTAL; i++)
        {
            const cell = this._cells != null ? this._cells[i] : null;
            const on = flags[i] === true;
            if (on) done++;

            if (cell == null || cell.root == null) continue;

            if (cell.locked != null) cell.locked.active = !on;
            if (cell.unlocked != null) cell.unlocked.active = on;

            // 凹口补丁：看**下邻**解没解锁，不看自己（洞在本格底部，透下去是下邻的内容）
            if (cell.fill != null && cell.fillPic != null)
            {
                const r = Math.floor(i / UIPuzzleView.COLS);
                const c = i % UIPuzzleView.COLS;
                const belowOn = (r + 1 < UIPuzzleView.ROWS)
                    ? flags[(r + 1) * UIPuzzleView.COLS + c] === true
                    : false;
                cell.fill.active = !belowOn;
                cell.fillPic.active = belowOn;
            }
        }

        // 四格交界：四块砖的圆角之间有个星形洞，全锁时那是砖缝（露板底），
        // 但只要四格里**任意一块**已经是画面，洞里就该是画面。
        // 不处理的话，全解锁时狗脸上会多出 9 颗奶油色小星星（实测直径约 10px）。
        if (this._joints != null)
        {
            const jw = UIPuzzleView.COLS - 1;
            for (let r = 0; r < UIPuzzleView.ROWS - 1; r++)
            {
                for (let c = 0; c < jw; c++)
                {
                    const jn = this._joints[r * jw + c];
                    if (jn == null) continue;
                    const anyOn =
                        flags[r * UIPuzzleView.COLS + c] === true ||
                        flags[r * UIPuzzleView.COLS + c + 1] === true ||
                        flags[(r + 1) * UIPuzzleView.COLS + c] === true ||
                        flags[(r + 1) * UIPuzzleView.COLS + c + 1] === true;
                    jn.active = anyOn;
                }
            }
        }

        if (this._lblProgress != null)
        {
            // 空格是有意的：效果图里就是 `0 / 16`，没有空格会挤成 `0/16`
            this._lblProgress.string = `${done} / ${PuzzleProgress.TOTAL}`;
        }
    }

    /** 按 `_deadline` 重算 天/时/分。没有 deadline 时**不动**预制体里的静态数字 */
    public refreshCountdown(): void
    {
        if (this._deadline == null) return;

        const left = this._deadline - Date.now();
        const totalMin = left > 0 ? Math.floor(left / 60000) : 0;

        const days = Math.floor(totalMin / (60 * 24));
        const hours = Math.floor((totalMin - days * 60 * 24) / 60);
        const mins = totalMin % 60;

        // 槽位只有两位宽（"02"），超过 99 天会被裁掉 —— 夹住比显示半个数字强
        if (this._lblDay != null) this._lblDay.string = UIPuzzleView.pad2(Math.min(days, 99));
        if (this._lblHour != null) this._lblHour.string = UIPuzzleView.pad2(hours);
        if (this._lblMin != null) this._lblMin.string = UIPuzzleView.pad2(mins);
    }

    // -----------------------------------------------------------------------
    // 按钮
    // -----------------------------------------------------------------------

    private bindButtons()
    {
        this.unbindButtons();
        if (this._btnBack != null) this._btnBack.node.on(Button.EventType.CLICK, this.onClickBack, this);
        if (this._btnStart != null) this._btnStart.node.on(Button.EventType.CLICK, this.onClickStart, this);
    }

    private unbindButtons()
    {
        if (this._btnBack != null) this._btnBack.node.off(Button.EventType.CLICK, this.onClickBack, this);
        if (this._btnStart != null) this._btnStart.node.off(Button.EventType.CLICK, this.onClickStart, this);
    }

    private onClickBack(): void
    {
        this.closeSelf();
    }

    /**
     * 「开始游戏」：打开关卡界面，**不关自己**。
     *
     * 关掉关卡界面之后要能回到拼图界面，所以这里不能 closeSelf()。
     *
     * ⚠️ 去抖用"时间窗"而不是 `_openingGame` 标志位：
     *    `openWindow` 返回的 Promise 要等窗口**关闭**才 resolve，而玩家赢了之后点
     *    「回主页」是直接打开大门、**不关**关卡窗口 —— 那个 Promise 永远不会 resolve。
     *    用标志位的话它会一直卡在 true，拼图界面的开始按钮从此点不动。
     *    时间窗只挡连点，没有"卡住"的状态。
     */
    private onClickStart(): void
    {
        const now = Date.now();
        if (now - this._lastStartAt < UIPuzzleView.START_DEBOUNCE_MS) return;
        this._lastStartAt = now;

        UIManager.instance.openWindow(UIGameMainView, UIGameMainView.PrefabPath)
            .then(() => {
                // 关卡窗口关掉了 —— 这中间玩家可能赢了一局并解锁了新碎片。
                // 这个 then 只在"窗口真的被关掉"时跑；走「回主页」那条路不会跑，
                // 那种情况下下次打开本界面时 onEnable 里的 refresh() 会补上。
                if (this.node != null && this.node.isValid) this.refresh();
            })
            .catch((e) => {
                console.warn("[UIPuzzleView] 打开关卡界面失败: " + e);
            });
    }

    // -----------------------------------------------------------------------
    // 解锁高亮
    // -----------------------------------------------------------------------

    /**
     * 刚解锁的那片弹一下。纯视觉，不改数据。
     *
     * ⚠️ 结束时**必须**把缩放复位到 1：格子是叠着画的（右凸起盖右邻、下邻垫在洞下），
     *    留一点缩放会让凸起和邻居错开，而且下次打开会继承这个比例。
     */
    private playUnlockPop(index: number): void
    {
        if (this._cells == null || index < 0 || index >= this._cells.length) return;
        const cell = this._cells[index];
        if (cell == null || cell.root == null) return;

        const n = cell.root;
        Tween.stopAllByTarget(n);
        n.setScale(1, 1, 1);

        tween(n)
            .to(0.14, { scale: new Vec3(1.10, 1.10, 1) }, { easing: "quadOut" })
            .to(0.24, { scale: new Vec3(1.00, 1.00, 1) }, { easing: "quadInOut" })
            .call(() => { if (n.isValid) n.setScale(1, 1, 1); })
            .start();
    }

    // -----------------------------------------------------------------------
    // 解析
    // -----------------------------------------------------------------------

    /**
     * 按路径取节点。
     *
     * ⚠️ 这里**不用** `addComponent<UIText>(UIText, "path")` 那一套：
     *    路径解析失败时它只打一条 Log，然后返回 null，界面看起来就是"永远是效果图里那个值"。
     *    自己取 + 显式判空，至少能在改预制体时立刻发现。
     */
    private findNode(path: string): Node
    {
        if (this.node == null) return null;
        const n = this.node.getChildByPath(path);
        if (n == null)
        {
            console.warn(`[UIPuzzleView] 找不到节点: ${path}（预制体改过层级？）`);
        }
        return n;
    }

    private findLabel(path: string): Label
    {
        const n = this.findNode(path);
        return n != null ? n.getComponent(Label) : null;
    }

    private findButton(path: string): Button
    {
        const n = this.findNode(path);
        return n != null ? n.getComponent(Button) : null;
    }

    private static pad2(v: number): string
    {
        const n = v < 0 ? 0 : Math.floor(v);
        return n < 10 ? `0${n}` : `${n}`;
    }
}
