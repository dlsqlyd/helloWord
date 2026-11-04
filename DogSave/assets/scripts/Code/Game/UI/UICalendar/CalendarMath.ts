// ---------------------------------------------------------------------------
// 日历的纯计算部分（**不 import cc**，可以直接在 Node 里跑单测）
// ---------------------------------------------------------------------------
// 为什么要拆出来：翻页区间、6 行判定、五种状态的判定顺序，全是"算错了不会报错、
// 只会显示成别的样子"的逻辑。留在 View 里就只能开 Cocos 点着看；
// 拆出来以后 `uicalendar_src/test_calendar_math.js` 可以离线跑 122 个月。
//
// 约定：
//   · 全部用**本地日期**（new Date(y, m-1, d)），不用 UTC —— 玩家在哪个时区，
//     "今天"就该是哪个时区的今天。
//   · 星期下标 0 = 周日，和界面第一列「日」对齐。
//   · 比较日期时先归零到当天 00:00，避免"同一天但时分秒不同"被当成不同日期。

/** 某一天在日历上的状态 */
export enum DayState
{
    /** 不属于本月（月初/月末的留白格） */
    Empty = 0,
    /** 未到期：今天之后 */
    Locked = 1,
    /** 到期未完成：今天之前，且没做过 */
    Missed = 2,
    /** 到期可以完成：就是今天 */
    Ready = 3,
    /** 到期已经完成 */
    Done = 4,
}

/**
 * ⚠️ 「选中」**不在**这个枚举里，它是独立的一层。
 *
 * 效果图里没画选中态，补的时候很容易顺手写成"选中是第五种状态"，
 * 但那样一来，一个**已经完成**的日期被选中时就会丢掉浅绿底和对勾
 * （状态被覆盖成"选中"，底板只能画成一种）。
 * 现在的做法是：底板永远按 DayState 画，选中只是在上面叠一个金环，
 * 两者正交。对外仍然提供五种语义，见 `UICalendarView.getCellState()`。
 */

export interface MonthRef
{
    year: number;
    month: number;   // 1..12
}

/** 日期网格的竖向几何（屏幕 px） */
export interface GridLayout
{
    /** 单个格子的高度 */
    cellH: number;
    /** 相邻两行的中心距 */
    pitch: number;
}

export class CalendarMath
{
    /** 可翻页区间：2026-11-01 .. 2036-12-31（共 122 个月） */
    public static readonly START_YEAR: number = 2026;
    public static readonly START_MONTH: number = 1;
    public static readonly END_YEAR: number = 2036;
    public static readonly END_MONTH: number = 12;

    /** 每月固定 6 行 —— 31 天且从周五/周六开始的月份要 6 行，行数不能随月份跳 */
    public static readonly ROWS: number = 6;
    public static readonly COLS: number = 7;
    public static readonly CELL_COUNT: number = 42;

    // -----------------------------------------------------------------------
    // 竖向几何（量自 ref2/cal_ref2.png，见 uicalendar_src/cal2_lib.py 表头）
    // -----------------------------------------------------------------------
    /**
     * 第 0 行中心 y（屏幕 px，从顶部算）。**固定值**：不管这个月是 4 行还是 6 行，
     * 第一行都在这里 —— 否则翻页时数字会整体上下跳，像"闪了一下"。
     */
    public static readonly ROW0_CY: number = 763.5;

    /** 5 行及以下的月份：格高 106 / 行距 121.5（= 效果图那套） */
    public static readonly CELL_H_ROOMY: number = 106;
    public static readonly PITCH_ROOMY: number = 121.5;

    /**
     * 6 行月份：格高 98 / 行距 106。
     *
     * 内芯奶油到 1362，日期格顶 712，下留 12px ⇒ 可用 638px。
     *   6 行用 106 的格高：6*106 = 636，只剩 2px 分给 5 个行距，格子会连成一片；
     *   压到 98/106：6*98 + 5*8 = 628，最后一行下沿 1342，余量 20px。
     * ⚠️ 别把格高统一成 98 —— 5 行月份（效果图就是 5 行）会白矮 8px，和稿子对不上。
     */
    public static readonly CELL_H_TIGHT: number = 98;
    public static readonly PITCH_TIGHT: number = 106;

    /**
     * 按行数选几何档。4/5 行用 roomy（和效果图 1:1），6 行用 tight。
     *
     * 只改格子高度和行距，**不改第 0 行位置**，所以翻页时数字不会跳。
     */
    public static gridLayout(rows: number): GridLayout
    {
        if (rows >= CalendarMath.ROWS)
        {
            return { cellH: CalendarMath.CELL_H_TIGHT, pitch: CalendarMath.PITCH_TIGHT };
        }
        return { cellH: CalendarMath.CELL_H_ROOMY, pitch: CalendarMath.PITCH_ROOMY };
    }

    /** 月份 -> 单调递增的下标，用来做区间夹取 */
    public static monthIndex(year: number, month: number): number
    {
        return year * 12 + (month - 1);
    }

    public static fromIndex(index: number): MonthRef
    {
        const year = Math.floor(index / 12);
        const month = (index % 12) + 1;
        return { year: year, month: month };
    }

    public static get START_INDEX(): number
    {
        return CalendarMath.monthIndex(CalendarMath.START_YEAR, CalendarMath.START_MONTH);
    }

    public static get END_INDEX(): number
    {
        return CalendarMath.monthIndex(CalendarMath.END_YEAR, CalendarMath.END_MONTH);
    }

    /** 122 */
    public static get totalMonths(): number
    {
        return CalendarMath.END_INDEX - CalendarMath.START_INDEX + 1;
    }

    /** 夹到 [START_INDEX, END_INDEX]。翻到边界时箭头会被禁用，这里是第二道保险 */
    public static clampIndex(index: number): number
    {
        if (index < CalendarMath.START_INDEX) return CalendarMath.START_INDEX;
        if (index > CalendarMath.END_INDEX) return CalendarMath.END_INDEX;
        return Math.floor(index);
    }

    public static daysInMonth(year: number, month: number): number
    {
        // 下个月的第 0 天 = 本月最后一天
        return new Date(year, month, 0).getDate();
    }

    /** 1 号是星期几：0 = 周日 */
    public static firstWeekday(year: number, month: number): number
    {
        return new Date(year, month - 1, 1).getDay();
    }

    /**
     * 本月的 42 个格子：`null` 表示不属于本月。
     *
     * 长度恒为 42，不按月份裁短 —— 格子是常驻的，裁短了每次翻页都要改 active，
     * 而且"6 行"这件事在布局上是固定的（见 cal_lib.py 文件头的行距取舍）。
     */
    public static buildMonth(year: number, month: number): (number | null)[]
    {
        const cells: (number | null)[] = new Array(CalendarMath.CELL_COUNT);
        for (let i = 0; i < cells.length; i++) cells[i] = null;

        const lead = CalendarMath.firstWeekday(year, month);
        const total = CalendarMath.daysInMonth(year, month);
        for (let d = 1; d <= total; d++)
        {
            const i = lead + d - 1;
            if (i < cells.length) cells[i] = d;
        }
        return cells;
    }

    /**
     * 这个月实际用到几行（4~6）。
     *
     * 用途：整行都没有日期的行要**整行藏掉**，否则 5 行的月份下面会挂一排空格子。
     * 但行内没日期的格子（月初留白）要留着 —— 效果图第一行前面那 4 个空格是画着的。
     */
    public static usedRows(year: number, month: number): number
    {
        const lead = CalendarMath.firstWeekday(year, month);
        const total = CalendarMath.daysInMonth(year, month);
        return Math.ceil((lead + total) / 7);
    }

    /** 归零到当天 00:00 的本地时间 */
    public static startOfDay(d: Date): Date
    {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    /** `2026-11-01`，用作 Map/Set 的键和存档字符串 */
    public static dayKey(year: number, month: number, day: number): string
    {
        return `${year}-${CalendarMath.pad2(month)}-${CalendarMath.pad2(day)}`;
    }

    public static dateKey(d: Date): string
    {
        return CalendarMath.dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }

    private static pad2(v: number): string
    {
        return v < 10 ? `0${v}` : `${v}`;
    }

    /**
     * 某一天的状态。
     *
     * ⚠️ 判定**顺序**是有意义的，换一下就会出不同的界面：
     *   1. 今天之后            -> Locked（还没到期，哪怕之前标记过完成也不算）
     *   2. 完成集合里有         -> Done（今天做完的也要显示成已完成，而不是"可以做"）
     *   3. 就是今天            -> Ready
     *   4. 其余（今天之前）     -> Missed
     */
    public static stateOf(year: number, month: number, day: number,
                          today: Date, done: Set<string>): DayState
    {
        if (day <= 0) return DayState.Empty;

        const d = new Date(year, month - 1, day);
        const t = CalendarMath.startOfDay(today);

        if (d.getTime() > t.getTime()) return DayState.Locked;
        if (done != null && done.has(CalendarMath.dayKey(year, month, day))) return DayState.Done;
        if (d.getTime() === t.getTime()) return DayState.Ready;
        return DayState.Missed;
    }

    /** `today` 落在可翻页区间里的哪个月；在区间外就夹到最近的边界 */
    public static indexOfDate(d: Date): number
    {
        return CalendarMath.clampIndex(
            CalendarMath.monthIndex(d.getFullYear(), d.getMonth() + 1));
    }

    /**
     * 这个月的月度奖杯是否该点亮（`lit`）。
     *
     * 规则（**在拿到真正的每日挑战系统之前，这是唯一说得通的判定**）：
     *   1. 整月必须**已经过完** —— 月中就点亮会让"这个月还差 10 天"变成已获得；
     *   2. 并且这个月的每一天都在 `done` 里 —— 缺一天就不给。
     *
     * ⚠️ 别改成"这个月没有漏做就点亮"：那样当前月从 1 号起就永远是亮的，
     *    玩家一旦漏了一天又灭掉，体验是"奖杯会消失"，比"月末结算"更糟。
     */
    public static monthDone(year: number, month: number,
                            today: Date, done: Set<string>): boolean
    {
        const last = CalendarMath.daysInMonth(year, month);
        const end = new Date(year, month - 1, last);
        const t = CalendarMath.startOfDay(today);

        // 本月还没过完（含今天就是最后一天）→ 不结算
        if (end.getTime() >= t.getTime()) return false;
        if (done == null) return false;

        for (let d = 1; d <= last; d++)
        {
            if (!done.has(CalendarMath.dayKey(year, month, d))) return false;
        }
        return true;
    }

    /** 这一天是否在可翻页区间内（含首尾） */
    public static inRange(year: number, month: number, day: number): boolean
    {
        const idx = CalendarMath.monthIndex(year, month);
        if (idx < CalendarMath.START_INDEX || idx > CalendarMath.END_INDEX) return false;
        if (idx === CalendarMath.START_INDEX && day < 1) return false;
        if (idx === CalendarMath.END_INDEX && day > CalendarMath.daysInMonth(year, month)) return false;
        return true;
    }

    /** 存档字符串 `2026-11-01,2026-11-03` <-> Set */
    public static parseDone(raw: string): Set<string>
    {
        const set = new Set<string>();
        if (raw == null || raw.length === 0) return set;
        const parts = raw.split(",");
        for (let i = 0; i < parts.length; i++)
        {
            const s = parts[i].trim();
            if (s.length > 0) set.add(s);
        }
        return set;
    }

    public static serializeDone(set: Set<string>): string
    {
        const out: string[] = [];
        set.forEach((k) => out.push(k));
        // 排序只是为了存档好读、diff 稳定，逻辑上不依赖顺序
        out.sort();
        return out.join(",");
    }
}
