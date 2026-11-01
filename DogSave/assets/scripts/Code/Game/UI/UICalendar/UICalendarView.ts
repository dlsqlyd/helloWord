import { Button, Color, Label, Node, Sprite } from "cc";
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

// ---------------------------------------------------------------------------
// 日历界面（每日挑战日历）
// ---------------------------------------------------------------------------
// 版式来自效果图（1080x1920），预制体由 `uicalendar_src/gen_prefab.py` 生成，
// 结构校验 + 离线渲染见 `uicalendar_src/preview_prefab.py`，量测口径见 `uicalendar_src/cal_lib.py` 文件头。
//
// ## 结构
//
//   整屏页，根下 `bg` + `content` —— 和设置界面（mask + panel，命中 PopupAnim 判据）
//   不一样，本界面**故意不挂 PopupAnim**。
//   ⚠️ 名字是 `bg` 而不是 `mask`：以后真要加弹出动画，PopupAnim 的 dimNames 里有 `bg`，
//      会先命中它，把整屏底色当成底板去缩放，内容反而不动。要加就先把 `bg` 改名。
//
// ## 42 个格子是常驻的
//
//   翻页区间 2026-11 .. 2036-12 共 122 个月。翻页只改数字/颜色/active，
//   不 destroy/instantiate —— 每翻一次建 42 个节点在低端机上有可感知的卡顿，
//   而且节点一换，上一页挂的监听很容易残留。
//
// ## 五种状态
//
//   用户要的五种：选中 / 未到期 / 到期未完成 / 到期可以完成 / 到期已经完成。
//   实现上拆成**两层**（理由见 CalendarMath.ts 里 DayState 的注释）：
//
//     底板（四选一，由 CalendarMath.stateOf 决定）
//       Locked  未到期      薄荷底 + 灰字
//       Missed  到期未完成  薄荷底 + 近黑字
//       Ready   到期可以完成 绿色渐变块 + 白字
//       Done    到期已经完成 浅绿块 + 深绿对勾（贴图自带，格子里没有数字）
//
//     叠加层（与底板正交）
//       Selected 选中       金色描边环，叠在任意底板之上
//
//   这样"选中的已完成日"仍然是浅绿底 + 对勾 + 金环，不会因为被选中就丢掉完成的样子。
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

    /** `content/panel/grid/cell_{i}` 和它下面四个子节点 */
    private static readonly PATH_CELL: string = "content/panel/grid/cell_";
    private static readonly PATH_NUMERAL: string = "/Text";
    private static readonly PATH_PLATE_TODAY: string = "/today";
    private static readonly PATH_PLATE_DONE: string = "/done";
    private static readonly PATH_SEL: string = "/sel";

    // 文字颜色，和 gen_prefab.py / preview_prefab.py 保持一致
    private static readonly C_READY: Color = new Color(255, 255, 255, 255);
    private static readonly C_LOCKED: Color = new Color(155, 160, 154, 255);
    private static readonly C_MISSED: Color = new Color(0, 0, 0, 255);
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
        this._cellHandlers = [];
        this._gridDays = new Array(CalendarMath.CELL_COUNT);

        for (let i = 0; i < CalendarMath.CELL_COUNT; i++)
        {
            const base = `${UICalendarView.PATH_CELL}${i}`;
            const cell = this.findNode(base);
            this._cellNodes.push(cell);
            this._cellButtons.push(cell != null ? cell.getComponent(Button) : null);
            this._cellNumerals.push(this.findLabel(base + UICalendarView.PATH_NUMERAL));
            this._cellToday.push(this.findNode(base + UICalendarView.PATH_PLATE_TODAY));
            this._cellDone.push(this.findNode(base + UICalendarView.PATH_PLATE_DONE));
            this._cellSel.push(this.findNode(base + UICalendarView.PATH_SEL));

            // 闭包捕获 i，不能直接用循环变量
            this._cellHandlers.push(() => this.onClickCell(i));
            this._gridDays[i] = null;
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
        this.renderCells();
        this.refreshArrows();
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
            numeral.color = state === DayState.Ready ? UICalendarView.C_READY
                : state === DayState.Locked ? UICalendarView.C_LOCKED
                    : UICalendarView.C_MISSED;
        }

        if (sel != null)
        {
            sel.active = this._selectedKey != null
                && this._selectedKey === CalendarMath.dayKey(year, month, day);
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
            await UIManager.instance.openWindow(UIGameMainView, UIGameMainView.PrefabPath);
        }
        finally
        {
            this._openingGame = false;
        }
    }

    // -----------------------------------------------------------------------
    // 解析
    // -----------------------------------------------------------------------

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
