// ---------------------------------------------------------------------------
// 拼图进度（纯逻辑，**不 import cc**）
// ---------------------------------------------------------------------------
// 这个文件里只有"16 个碎片里哪几个解锁了"的读写与随机抽取，不碰节点、不碰引擎。
// 这么切是为了能在 node 里直接跑断言（`uipuzzle_src/test_puzzle_progress.js`），
// 不用起 Cocos、不用 mock 引擎 —— 存档解析这种"边界一堆、肉眼看不出来"的代码
// 最值得离线测。
//
// 存储格式：逗号分隔的**已解锁下标**，升序，例如 `0,3,7`。
//   · 为什么不用 16 个 0/1：玩家看存档时 `0,3,7` 比 `1001000100000000` 好读；
//   · 为什么用下标不用位掩码：位掩码超过 32 片就要动 BigInt，下标数组不会；
//   · 为什么升序：同一个集合只有一种写法，比对/调试时不会出现"看着不一样其实一样"。
//
// ⚠️ 空字符串 = 一片都没解锁，**不是**"全部解锁"。缺省值必须传 ""。
//    历史上很容易写成 `if (!raw) return allTrue`，那会让新玩家一进来看见拼图全亮。
export class PuzzleProgress
{
    /** 碎片总数。4x4，和预制体 `content/grid/cell_0..15` 一一对应 */
    public static readonly TOTAL: number = 16;

    /**
     * 解析存档串 -> 长度恒为 TOTAL 的布尔数组。
     *
     * 容错（存档是玩家能改的、也会跨版本）：空/非法/越界/重复/负数 一律当"没解锁"，
     * 绝不抛异常 —— 这个函数在界面 onEnable 里同步调用，抛了就是整屏白。
     */
    public static parse(raw: string): boolean[]
    {
        const flags: boolean[] = new Array<boolean>(PuzzleProgress.TOTAL);
        for (let i = 0; i < PuzzleProgress.TOTAL; i++) flags[i] = false;
        if (raw == null || raw.length <= 0) return flags;

        const parts: string[] = raw.split(",");
        for (let i = 0; i < parts.length; i++)
        {
            const s: string = parts[i].trim();
            if (s.length <= 0) continue;
            // 要求整串就是个十进制整数。`Number.parseInt("12abc")` 会返回 12 ——
            // 存档被改坏时宁可整条丢掉，也不要"猜"出一个玩家没解锁的碎片。
            if (!/^-?\d+$/.test(s)) continue;
            const v: number = Number.parseInt(s, 10);
            if (v < 0 || v >= PuzzleProgress.TOTAL) continue;
            flags[v] = true;
        }
        return flags;
    }

    /** 布尔数组 -> 存档串（升序、逗号分隔）。全 false 时返回 "" */
    public static serialize(flags: boolean[]): string
    {
        const out: string[] = [];
        for (let i = 0; i < PuzzleProgress.TOTAL; i++)
        {
            if (flags != null && flags[i] === true) out.push(`${i}`);
        }
        return out.join(",");
    }

    /** 已解锁数量 */
    public static count(flags: boolean[]): number
    {
        let n: number = 0;
        for (let i = 0; i < PuzzleProgress.TOTAL; i++)
        {
            if (flags != null && flags[i] === true) n++;
        }
        return n;
    }

    /** 是否全部解锁 */
    public static isComplete(flags: boolean[]): boolean
    {
        return PuzzleProgress.count(flags) >= PuzzleProgress.TOTAL;
    }

    /**
     * 在**还没解锁**的碎片里随机挑一个，返回下标；全解锁了返回 -1。
     *
     * @param rnd 随机源，默认 Math.random。测试时传一个确定性序列进来。
     *
     * ⚠️ 是"从剩余里挑"，不是"随机挑一个再判重试"：
     *    后者在剩 1 片时平均要抽 16 次，剩 0 片时是死循环。
     */
    public static pickRandom(flags: boolean[], rnd: () => number = Math.random): number
    {
        const pool: number[] = [];
        for (let i = 0; i < PuzzleProgress.TOTAL; i++)
        {
            if (flags == null || flags[i] !== true) pool.push(i);
        }
        if (pool.length <= 0) return -1;

        // rnd() 理论上落在 [0,1)，但测试桩/劣质实现可能返回 1 —— 夹一下，
        // 否则索引会越界取到 undefined，最后把 undefined 当"没解锁"写进存档。
        let r: number = rnd();
        if (!(r >= 0)) r = 0;          // 同时挡掉 NaN
        if (r >= 1) r = 0.999999999;
        return pool[Math.floor(r * pool.length)];
    }
}
