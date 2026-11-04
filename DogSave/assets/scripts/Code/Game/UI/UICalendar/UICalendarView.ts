import { Button, Color, Label, Node, Sprite, UITransform } from "cc";
import { IOnCreate } from "../../../Module/UI/IOnCreate";
import { IOnDisable } from "../../../Module/UI/IOnDisable";
import { IOnEnable } from "../../../Module/UI/IOnEnable";
import { UIBaseView, UIView } from "../../../Module/UI/UIBaseView";
import { UIManager } from "../../../Module/UI/UIManager";
import { CacheManager } from "../../../Module/Player/CacheManager";
import { CacheKeys } from "../../../Module/Const/CacheKeys";
import { UIGameMainView } from "../UIGameMain/UIGameMainView";
import { UIToast } from "../UICommon/UIToast";
import { CalendarMath, DayState } from "./CalendarMath";
import { BattleMode, GameDataManager } from "../../GameDataManager";

// ---------------------------------------------------------------------------
// 日历界面（每日挑战日历）
// ---------------------------------------------------------------------------
// 版式来自原生 1080x1920 的效果图（`screens/07-daily-challenge.png`），
// 预制体由 `uicalendar_src/gen_prefab2.py` 生成，
// 结构校验 + 离线渲染见 `uicalendar_src/preview_prefab2.py`，
// 量测口径见 `uicalendar_src/cal2_lib.py` 文件头。
//
// ## 结构
//
//   整屏页，根下 `bg` + `content` —— 和设置界面（mask + panel，命中 PopupAnim 判据）
//   不一样，本界面**故意不挂 PopupAnim**。
//   ⚠️ 名字是 `bg` 而不是 `mask`：以后真要加弹出动画，PopupAnim 的 dimNames 里有 `bg`，
//      会先命中它，把整屏底色当成底板去缩放，内容反而不动。要加就先把 `bg` 改名。
//
//   标题牌和开始按钮是**美术字**（资源包里就是烘好文字的整图），所以那两处没有 Label。
//   月份/星期/日期必须是 Label —— 内容随翻页变。
//
// ## 42 个格子是常驻的
//
//   翻页区间 2026-11 .. 2036-12 共 122 个月。翻页只改数字/颜色/尺寸/位置/active，
//   不 destroy/instantiate —— 每翻一次建 42 个节点在低端机上有可感知的卡顿，
//   而且节点一换，上一页挂的监听很容易残留。
//
// ## 5 行 / 6 行两档几何
//
//   预制体按 6 行（格高 98 / 行距 106）烘，`applyGridLayout()` 在每次 render 时
//   按 `CalendarMath.usedRows()` 选档：5 行及以下切回 roomy（106 / 121.5，和效果图 1:1）。
//   **第 0 行位置固定**，只改行距和格高 —— 否则翻页时数字会整体跳。
//
// ## 五种状态
//
//   用户要的五种：选中 / 未到期 / 到期未完成 / 到期可以完成 / 到期已经完成。
//   实现上拆成**两层**（理由见 CalendarMath.ts 里 DayState 的注释）：
//
//     底板（四选一，由 CalendarMath.stateOf 决定）
//       Locked  未到期      薄荷白底 + 灰字
//       Missed  到期未完成  薄荷白底 + 近黑字
//       Ready   到期可以完成 绿色块 + 白字（字号大一档 55 vs 46，效果图就是这样）
//       Done    到期已经完成 浅绿块 + 深绿对勾（贴图自带，格子里没有数字）
//
//     叠加层（与底板正交）
//       Selected 选中       金色描边环，叠在任意底板之上
//
//   这样"选中的已完成日"仍然是浅绿底 + 对勾 + 金环，不会因为被选中就丢掉完成的样子。
//
// ## 月度奖杯
//
//   `content/banner/trophy` 下常驻 24 个节点（12 个月 x lit/unlit），同时只亮一个。
//   点不点亮由 `CalendarMath.monthDone()` 决定：整月过完 + 每天都做过。
//   ⚠️ 24 个节点是**预制体里就有**的，不是运行时 load —— 图集在 bundle
//      `ui_uicalendar` 里，运行时按路径加载要先 loadBundle，翻页时异步换图会闪。
//
// ## 哪些是真接通的
//
//   返回        关掉自己（closeSelf）
//   左右箭头    翻月，到边界禁用并置灰
//   日期格      选中/取消选中（只画环，**没有消费方**，见下面"待定"）
//   开始今日挑战 打开关卡界面（工程里没有"每日挑战"玩法，这是唯一真能玩的东西）
//
// ## 待定（没有擅自决定）
//
//   · 选中之后做什么：工程里没有"每日挑战内容"，所以现在选中只画环，
//     对外留了 `onDaySelected` 回调和 `getSelectedDate()`，有玩法了再接。
//   · 完成数据从哪来：没有每日挑战系统，`CacheKeys.DailyDone` 只会被
//     `setDayDone()` 写入。真系统接进来时调它即可，界面不用改。
//   · 要不要"回到今天"：`jumpToToday()` 已经写好，但**没有挂按钮**（产品决策）。
export class UICalendarView extends UIBaseView implements IOnCreate, IOnEnable, IOnDisable
{
    public static readonly PrefabPath: string = "ui/uicalendar/prefabs/uiCalendarView";

    /** 已完成的格子里要不要保留日期数字。效果图里是不保留（只有对勾） */
    public static readonly SHOW_NUMERAL_WHEN_DONE: boolean = false;

    private static readonly PATH_MONTH: string = "content/panel/pill_month/Text";
    private static readonly PATH_ARROW_PREV: string = "content/panel/arrow_prev";
    private static readonly PATH_ARROW_NEXT: string = "content/panel/arrow_next";
    private static readonly PATH_BACK: string = "content/btn_back";
    private static readonly PATH_START: string = "content/btn_start";
    private static readonly PATH_TROPHY: string = "content/banner/trophy";

    /** `content/panel/grid/cell_{i}` 和它下面四个子节点 */
    private static readonly PATH_CELL: string = "content/panel/grid/cell_";
    private static readonly PATH_NUMERAL: string = "/Text";
    private static readonly PATH_PLATE_TODAY: string = "/today";
    private static readonly PATH_PLATE_DONE: string = "/done";
    private static readonly PATH_SEL: string = "/sel";

    // ---- 版面常量（和 gen_prefab2.py / cal2_lib.py 一致）----
    /** 日期格容器 `grid` 节点的中心（屏幕 px）。预制体里烘死的，运行时不改 */
    private static readonly GRID_CY: number = CalendarMath.ROW0_CY
        + CalendarMath.PITCH_ROOMY * 2.5;
    private static readonly COL0: number = 155.5;
    private static readonly COL_PITCH: number = 128.33;
    private static readonly PANEL_CX: number = 540;

    private static readonly CELL_W: number = 113;
    private static readonly SEL_W: number = 121;
    private static readonly SEL_H: number = 114;

    /** 字号：普通 46，今天 55（效果图的「30」比别的数字大一档，实测 42px vs 35px） */
    private static readonly FONT_DAY: number = 46;
    private static readonly FONT_TODAY: number = 55;

    // 文字颜色，和 gen_prefab2.py / preview_prefab2.py 保持一致
    private static readonly C_READY: Color = new Color(255, 255, 255, 255);
    private static readonly C_LOCKED: Color = new Color(165, 168, 166, 255);
    private static readonly C_MISSED: Color = new Color(35, 3, 3, 255);
    /** 今天格的数字描边。⚠️ 只比底色深一档 —— 效果图外沿最暗 (41,159,46)，底色 (48,176,53)。
     *  原来是 (4,110,20)，一圈近黑绿，55 号字下会把「0」的内孔糊死。 */
    private static readonly C_OL_TODAY: Color = new Color(38, 155, 44, 255);
    private static readonly C_ARROW_ON: Color = new Color(255, 255, 255, 255);
    private static readonly C_ARROW_OFF: Color = new Color(150, 150, 150, 255);

    // ---- 节点 ----
    private _monthLabel: Label = null;
    private _arrowPrev: Button = null;
    private _arrowNext: Button = null;
    private _btnBack: Button = null;
    private _btnStart: Button = null;

    private _cellNodes: Node[] = null;          // 42
    private _cellButtons: Button[] = null;      // 42
    private _cellNumerals: Label[] = null;      // 42
    private _cellToday: Node[] = null;          // 42
    private _cellDone: Node[] = null;           // 42
    private _cellSel: Node[] = null;            // 42

    /** 布局要改尺寸的四个 UITransform（cell / today / done / sel），和 _cellNodes 同序 */
    private _cellTrans: UITransform[] = null;
    private _todayTrans: UITransform[] = null;
    private _doneTrans: UITransform[] = null;
    private _selTrans: UITransform[] = null;

    /** [月份 0..11][0=unlit, 1=lit] */
    private _trophyNodes: Node[][] = null;

    // ---- 监听（onDisable 要用同一份引用摘掉，所以存起来而不是现场 new）----
    private _cellHandlers: (() => void)[] = null;
    private _arrowHandlers: (() => void)[] = null;
    private _btnHandlers: (() => void)[] = null;

    // ---- 数据 ----
    private _monthIndex: number = 0;
    private _today: Date = null;
    private _done: Set<string> = null;
    private _selectedKey: string = null;
    /** 当前月 42 个格子里的日期（null = 不属于本月） */
    private _gridDays: (number | null)[] = null;

    private _openingGame: boolean = false;

    /**
     * 选中某一天时触发。没有消费方（工程里没有每日挑战内容），
     * 留给以后接"选中后显示当天任务"用。
     */
    public onDaySelected: (date: Date, state: DayState) => void = null;

    public getConstructor()
    {
        return UICalendarView;
    }

    // -----------------------------------------------------------------------
    // 生命周期
    // -----------------------------------------------------------------------

    public onCreate()
    {
        this._monthLabel = this.findLabel(UICalendarView.PATH_MONTH);
        this._arrowPrev = this.findButton(UICalendarView.PATH_ARROW_PREV);
        this._arrowNext = this.findButton(UICalendarView.PATH_ARROW_NEXT);
        this._btnBack = this.findButton(UICalendarView.PATH_BACK);
        this._btnStart = this.findButton(UICalendarView.PATH_START);

        this._cellNodes = [];
        this._cellButtons = [];
        this._cellNumerals = [];
        this._cellToday = [];
        this._cellDone = [];
        this._cellSel = [];
        this._cellTrans = [];
        this._todayTrans = [];
        this._doneTrans = [];
        this._selTrans = [];
        this._cellHandlers = [];
        this._gridDays = new Array(CalendarMath.CELL_COUNT);

        for (let i = 0; i < CalendarMath.CELL_COUNT; i++)
        {
            const base = `${UICalendarView.PATH_CELL}${i}`;
            const cell = this.findNode(base);
            const today = this.findNode(base + UICalendarView.PATH_PLATE_TODAY);
            const done = this.findNode(base + UICalendarView.PATH_PLATE_DONE);
            const sel = this.findNode(base + UICalendarView.PATH_SEL);

            this._cellNodes.push(cell);
            this._cellButtons.push(cell != null ? cell.getComponent(Button) : null);
            this._cellNumerals.push(this.findLabel(base + UICalendarView.PATH_NUMERAL));
            this._cellToday.push(today);
            this._cellDone.push(done);
            this._cellSel.push(sel);

            this._cellTrans.push(cell != null ? cell.getComponent(UITransform) : null);
            this._todayTrans.push(today != null ? today.getComponent(UITransform) : null);
            this._doneTrans.push(done != null ? done.getComponent(UITransform) : null);
            this._selTrans.push(sel != null ? sel.getComponent(UITransform) : null);

            // 闭包捕获 i，不能直接用循环变量
            this._cellHandlers.push(() => this.onClickCell(i));
            this._gridDays[i] = null;
        }

        this._trophyNodes = [];
        const trophyRoot = this.findNode(UICalendarView.PATH_TROPHY);
        for (let m = 1; m <= 12; m++)
        {
            const pair: Node[] = [];
            pair.push(this.findChild(trophyRoot, `m${this.pad2(m)}_unlit`));
            pair.push(this.findChild(trophyRoot, `m${this.pad2(m)}_lit`));
            this._trophyNodes.push(pair);
        }

        this._arrowHandlers = [
            () => this.onClickPrevMonth(),
            () => this.onClickNextMonth(),
        ];
        this._btnHandlers = [
            () => this.onClickBack(),
            () => this.onClickStart(),
        ];
    }

    public onEnable()
    {
        this._openingGame = false;
        this._selectedKey = null;

        // ⚠️ 每次打开都重新取"今天"：游戏挂后台过了零点再回来，
        //    缓存里的旧日期会让今天还停在昨天，整页状态全错。
        this._today = CalendarMath.startOfDay(new Date());
        this._done = CalendarMath.parseDone(
            CacheManager.instance.getString(CacheKeys.DailyDone, ""));
        this.setDayDone(this._today, true);
        this._monthIndex = CalendarMath.indexOfDate(this._today);
        this.render();
        this.bindButtons();
    }

    public onDisable()
    {
        this.unbindButtons();
        this._openingGame = false;
    }

    // -----------------------------------------------------------------------
    // 对外
    // -----------------------------------------------------------------------

    /** 当前显示的年 / 月 */
    public get year(): number
    {
        return CalendarMath.fromIndex(this._monthIndex).year;
    }

    public get month(): number
    {
        return CalendarMath.fromIndex(this._monthIndex).month;
    }

    /** 当前选中日，没选中返回 null */
    public getSelectedDate(): Date
    {
        if (this._selectedKey == null) return null;
        const p = this._selectedKey.split("-");
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }

    public isSelected(date: Date): boolean
    {
        return date != null && this._selectedKey === CalendarMath.dateKey(date);
    }

    /**
     * 某一天的底板状态（Locked / Missed / Ready / Done）。
     * 「选中」是叠在上面的环，用 `isSelected()` 查，不在这里返回。
     */
    public getCellState(date: Date): DayState
    {
        if (date == null) return DayState.Empty;
        return CalendarMath.stateOf(date.getFullYear(), date.getMonth() + 1, date.getDate(),
                                    this._today, this._done);
    }

    /** 当前显示月份的月度奖杯是否已点亮 */
    public isTrophyLit(): boolean
    {
        return CalendarMath.monthDone(this.year, this.month, this._today, this._done);
    }

    /** 标记某天已完成/未完成，会写存档并刷新当前页 */
    public setDayDone(date: Date, done: boolean): void
    {
        if (date == null) return;
        const key = CalendarMath.dateKey(date);
        if (done) this._done.add(key);
        else this._done.delete(key);

        CacheManager.instance.setString(CacheKeys.DailyDone,
                                        CalendarMath.serializeDone(this._done));

        if (date.getFullYear() === this.year && date.getMonth() + 1 === this.month)
        {
            this.renderCells();
            this.refreshTrophy();
        }
    }

    /** 跳到指定月份（超出区间会被夹到边界） */
    public jumpToMonth(year: number, month: number): void
    {
        const idx = CalendarMath.clampIndex(CalendarMath.monthIndex(year, month));
        if (idx === this._monthIndex) return;
        this._monthIndex = idx;
        this.render();
    }

    /** 回到"今天"所在的月份并选中今天。目前没有按钮入口（产品决策，见文件头） */
    public jumpToToday(): void
    {
        this._today = CalendarMath.startOfDay(new Date());
        this._monthIndex = CalendarMath.indexOfDate(this._today);
        this._selectedKey = CalendarMath.dateKey(this._today);
        this.render();
    }

    // -----------------------------------------------------------------------
    // 渲染
    // -----------------------------------------------------------------------

    private render(): void
    {
        const year = this.year;
        const month = this.month;

        if (this._monthLabel != null) this._monthLabel.string = `${year}年${month}月`;

        this._gridDays = CalendarMath.buildMonth(year, month);
        this.applyGridLayout(CalendarMath.usedRows(year, month));
        this.renderCells();
        this.refreshTrophy();
        this.refreshArrows();
    }

    /**
     * 按行数重排 42 个格子。
     *
     * 只改位置和高度，不改结构 —— 42 个格子和它们的四个子节点永远是同一批。
     * 第 0 行固定在 `CalendarMath.ROW0_CY`，所以 5 行 / 6 行翻页时数字不会上下跳。
     *
     * 格子的父节点是 `grid`，它的中心烘在 `GRID_CY`（按 roomy 算的），运行时不移动；
     * 所以这里用"屏幕 y -> grid 局部 y"换算，而不是直接写死局部坐标。
     */
    private applyGridLayout(rows: number): void
    {
        const layout = CalendarMath.gridLayout(rows);
        const selH = Math.round(UICalendarView.SEL_H * layout.cellH / CalendarMath.CELL_H_ROOMY);

        for (let i = 0; i < CalendarMath.CELL_COUNT; i++)
        {
            const r = Math.floor(i / CalendarMath.COLS);
            const c = i % CalendarMath.COLS;

            const cell = this._cellNodes[i];
            if (cell != null)
            {
                cell.setPosition(UICalendarView.COL0 + UICalendarView.COL_PITCH * c
                                 - UICalendarView.PANEL_CX,
                                 UICalendarView.GRID_CY
                                 - (CalendarMath.ROW0_CY + layout.pitch * r));
            }

            this.setSize(this._cellTrans[i], UICalendarView.CELL_W, layout.cellH);
            this.setSize(this._todayTrans[i], UICalendarView.CELL_W, layout.cellH);
            this.setSize(this._doneTrans[i], UICalendarView.CELL_W, layout.cellH);
            this.setSize(this._selTrans[i], UICalendarView.SEL_W, selH);
        }
    }

    private setSize(t: UITransform, w: number, h: number): void
    {
        if (t == null) return;
        if (t.width === w && t.height === h) return;
        t.setContentSize(w, h);
    }

    private renderCells(): void
    {
        for (let i = 0; i < CalendarMath.CELL_COUNT; i++)
        {
            this.renderCell(i);
        }
    }

    private renderCell(index: number): void
    {
        const cell = this._cellNodes[index];
        if (cell == null) return;

        const year = this.year;
        const month = this.month;

        // 整行都没有日期的行（5 行月份的第 6 行）整行藏掉；
        // 行内的留白格（月初那几个空格）保留 —— 效果图里它们是画着的。
        const row = Math.floor(index / CalendarMath.COLS);
        if (row >= CalendarMath.usedRows(year, month))
        {
            cell.active = false;
            return;
        }
        cell.active = true;

        const numeral = this._cellNumerals[index];
        const plateToday = this._cellToday[index];
        const plateDone = this._cellDone[index];
        const sel = this._cellSel[index];

        const day = this._gridDays[index];
        if (day == null)
        {
            if (numeral != null) numeral.node.active = false;
            if (plateToday != null) plateToday.active = false;
            if (plateDone != null) plateDone.active = false;
            if (sel != null) sel.active = false;
            return;
        }

        const state = CalendarMath.stateOf(year, month, day, this._today, this._done);

        if (plateToday != null) plateToday.active = state === DayState.Ready;
        if (plateDone != null) plateDone.active = state === DayState.Done;

        if (numeral != null)
        {
            numeral.string = `${day}`;
            // Done 的贴图自带对勾，数字要让位；想保留数字改 SHOW_NUMERAL_WHEN_DONE
            numeral.node.active = state !== DayState.Done
                || UICalendarView.SHOW_NUMERAL_WHEN_DONE;

            const ready = state === DayState.Ready;
            numeral.fontSize = ready ? UICalendarView.FONT_TODAY : UICalendarView.FONT_DAY;
            numeral.color = ready ? UICalendarView.C_READY
                : state === DayState.Locked ? UICalendarView.C_LOCKED
                    : UICalendarView.C_MISSED;

            // 今天的白字带深绿描边（效果图就是这样，否则压在绿块上边缘发糊）。
            // ⚠️ 预制体里是关着的，只有 Ready 打开 —— 灰字/黑字加绿描边会很脏。
            numeral.enableOutline = ready;
            if (ready)
            {
                numeral.outlineColor = UICalendarView.C_OL_TODAY;
                numeral.outlineWidth = 4;
            }
        }

        if (sel != null)
        {
            sel.active = this._selectedKey != null
                && this._selectedKey === CalendarMath.dayKey(year, month, day);
        }
    }

    /** 24 个奖杯节点里只点亮当前月、对应状态的那一个 */
    private refreshTrophy(): void
    {
        if (this._trophyNodes == null) return;

        const month = this.month;                    // 1..12
        const lit = this.isTrophyLit();
        const want = lit ? 1 : 0;

        for (let m = 0; m < 12; m++)
        {
            const pair = this._trophyNodes[m];
            if (pair == null) continue;
            const isThis = (m + 1) === month;
            for (let s = 0; s < 2; s++)
            {
                const n = pair[s];
                if (n == null) continue;
                n.active = isThis && s === want;
            }
        }
    }

    private refreshArrows(): void
    {
        this.setArrowEnabled(this._arrowPrev, this._monthIndex > CalendarMath.START_INDEX);
        this.setArrowEnabled(this._arrowNext, this._monthIndex < CalendarMath.END_INDEX);
    }

    /** 到区间尽头就把箭头禁掉并置灰 —— 只置灰不禁用的话点了没反应，像卡住了 */
    private setArrowEnabled(btn: Button, on: boolean): void
    {
        if (btn == null) return;
        btn.interactable = on;
        const sp = btn.node.getComponent(Sprite);
        if (sp != null) sp.color = on ? UICalendarView.C_ARROW_ON : UICalendarView.C_ARROW_OFF;
    }

    // -----------------------------------------------------------------------
    // 按钮
    // -----------------------------------------------------------------------

    private bindButtons()
    {
        this.unbindButtons();

        for (let i = 0; i < this._cellButtons.length; i++)
        {
            const btn = this._cellButtons[i];
            if (btn == null) continue;
            btn.node.on(Button.EventType.CLICK, this._cellHandlers[i], this);
        }
        this.bindOne(this._arrowPrev, this._arrowHandlers[0]);
        this.bindOne(this._arrowNext, this._arrowHandlers[1]);
        this.bindOne(this._btnBack, this._btnHandlers[0]);
        this.bindOne(this._btnStart, this._btnHandlers[1]);
    }

    private unbindButtons()
    {
        if (this._cellButtons == null) return;

        for (let i = 0; i < this._cellButtons.length; i++)
        {
            const btn = this._cellButtons[i];
            if (btn == null) continue;
            btn.node.off(Button.EventType.CLICK, this._cellHandlers[i], this);
        }
        this.unbindOne(this._arrowPrev, this._arrowHandlers != null ? this._arrowHandlers[0] : null);
        this.unbindOne(this._arrowNext, this._arrowHandlers != null ? this._arrowHandlers[1] : null);
        this.unbindOne(this._btnBack, this._btnHandlers != null ? this._btnHandlers[0] : null);
        this.unbindOne(this._btnStart, this._btnHandlers != null ? this._btnHandlers[1] : null);
    }

    private bindOne(btn: Button, handler: () => void)
    {
        if (btn == null || handler == null) return;
        btn.node.on(Button.EventType.CLICK, handler, this);
    }

    private unbindOne(btn: Button, handler: () => void)
    {
        if (btn == null || handler == null) return;
        btn.node.off(Button.EventType.CLICK, handler, this);
    }

    private onClickCell(index: number): void
    {
        const day = this._gridDays[index];
        if (day == null) return;

        const year = this.year;
        const month = this.month;
        const key = CalendarMath.dayKey(year, month, day);
        // 再点一次同一个日期 = 取消选中
        this._selectedKey = this._selectedKey === key ? null : key;
        this.renderCells();

        if (this._selectedKey != null && this.onDaySelected != null)
        {
            const date = new Date(year, month - 1, day);
            GameDataManager.instance.curSelectDate = date;
            this.onDaySelected(date, CalendarMath.stateOf(year, month, day, this._today, this._done));
        }
    }

    private onClickPrevMonth(): void
    {
        if (this._monthIndex <= CalendarMath.START_INDEX) return;
        this._monthIndex--;
        this.render();
    }

    private onClickNextMonth(): void
    {
        if (this._monthIndex >= CalendarMath.END_INDEX) return;
        this._monthIndex++;
        this.render();
    }

    private onClickBack(): void
    {
        this.closeSelf();
    }

    private async onClickStart(): Promise<void>
    {
        // 工程里没有"每日挑战"这套玩法（没有每日任务表、没有次数、没有奖励），
        // 唯一真能玩的是普通关卡，所以这里打开关卡界面 —— 和门口「开始游戏」一致。
        // ⚠️ 以后真有每日挑战了，这里要换成打开当天挑战，别让它继续走普通关卡。
        if (this._openingGame) return;
        this._openingGame = true;
        try
        {
            await GameDataManager.instance.SetGameMode(BattleMode.Calendar);
            await UIManager.instance.openWindow(UIGameMainView, UIGameMainView.PrefabPath);
            GameDataManager.instance.OnResultButton(false);
        }
        finally
        {
            this._openingGame = false;
        }
    }

    // -----------------------------------------------------------------------
    // 解析
    // -----------------------------------------------------------------------

    private pad2(v: number): string
    {
        return v < 10 ? `0${v}` : `${v}`;
    }

    /**
     * ⚠️ 不用 `addComponent<Label>(Label, "path")`：路径解析失败时它只打一条 Log
     *    然后返回 null，界面看起来就是"文字永远是预制体里那个值"。
     *    自己取 + 显式判空，改预制体时能立刻发现。
     */
    private findNode(path: string): Node
    {
        if (this.node == null) return null;
        const n = this.node.getChildByPath(path);
        if (n == null)
        {
            console.warn(`[UICalendarView] 找不到节点: ${path}（预制体改过层级？）`);
        }
        return n;
    }

    private findChild(parent: Node, name: string): Node
    {
        if (parent == null) return null;
        const n = parent.getChildByName(name);
        if (n == null)
        {
            console.warn(`[UICalendarView] 找不到子节点: ${parent.name}/${name}`);
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
}
