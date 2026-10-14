import type { ArenaTier } from "../types";
import { HARD_PROBLEMS } from "./hard";
import { KING_PROBLEMS } from "./king";
import { TIERS } from "./meta";
import { int, lines, nums, rng } from "./util";

/**
 * 编程彩蛋的题库：竞赛格式，模型写完整程序，从标准输入读、向标准输出写，四种语言共用同一组测试。
 * 题目全部原创。隐藏测试由固定种子生成，期望输出由参考解算出，样例输出也来自参考解，避免题面和测试对不上。
 * 改题目、测试或参考解后递增 ARENA_VERSION。
 */
export const ARENA_VERSION = "2026.10.3";

export interface Problem {
  id: string;
  tier: ArenaTier;
  title: string;
  tags: string[];
  /** 题面，不含样例（样例由 sample 和参考解自动补上） */
  statement: string;
  sample: string;
  /** 黄金档给出的「祖传代码」：Python 写的、带 bug 的实现 */
  legacy?: string;
  /** 参考解：输入全文 → 标准输出 */
  solve: (input: string) => string;
  /** 隐藏测试的输入 */
  inputs: (rand: () => number) => string[];
}

// ---------------------------------------------------------------- 题目

const PROBLEMS: Problem[] = [
  // ---------- 青铜：字符串、数组 ----------
  {
    id: "bronze-palindrome",
    tier: "bronze",
    title: "回文句子",
    tags: ["字符串"],
    statement: `输入一行字符串（长度 1 到 1000，由可打印 ASCII 字符组成，可能含空格和标点）。
只看其中的英文字母和数字，忽略大小写，判断它是不是回文。下划线、空格、标点都不算字母或数字。
去掉之后什么都不剩，也算回文。

输出：是回文输出 YES，否则输出 NO。`,
    sample: "A man, a plan, a canal: Panama\n",
    solve: (input) => {
      const s = lines(input)[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      return s === [...s].reverse().join("") ? "YES" : "NO";
    },
    inputs: (rand) => {
      const half = Array.from({ length: 450 }, () => "abcXYZ019"[int(rand, 0, 8)]).join("");
      const noisy = (s: string) => [...s].map((c) => (rand() < 0.2 ? c + ", "[int(rand, 0, 1)] : c)).join("");
      return [
        "race a car",
        "!!! ,,, ...",
        "0P",
        "Was it a car or a cat I saw?",
        "No 'x' in Nixon",
        "ab_a",
        "1a2",
        "z",
        noisy(half + [...half].reverse().join("").toLowerCase()),
        noisy(half + "q" + [...half].reverse().join("").slice(1)),
      ].map((l) => l + "\n");
    },
  },
  {
    id: "bronze-second",
    tier: "bronze",
    title: "第二大的数",
    tags: ["数组"],
    statement: `第一行一个整数 n（1 ≤ n ≤ 100000），第二行 n 个整数，每个绝对值不超过 10^9。
求其中第二大的「不同的值」：相同的数只算一次。

输出：这个值；如果不存在（所有数都相等），输出 NONE。`,
    sample: "5\n3 9 9 4 1\n",
    solve: (input) => {
      const [n, ...a] = nums(input);
      let first = -Infinity;
      let second = -Infinity;
      for (const x of a.slice(0, n)) {
        if (x > first) [first, second] = [x, first];
        else if (x < first && x > second) second = x;
      }
      return second === -Infinity ? "NONE" : String(second);
    },
    inputs: (rand) => {
      const big = Array.from({ length: 20000 }, () => int(rand, -1e9, 1e9));
      return [
        "1\n5",
        "3\n7 7 7",
        "5\n1 2 3 4 5",
        "4\n5 5 4 4",
        "4\n-1 -2 -3 -1",
        "2\n-1000000000 1000000000",
        "6\n9 9 9 9 9 8",
        "3\n0 0 -1",
        `20000\n${big.join(" ")}`,
        `20000\n${big.map(() => 1000000000).join(" ")}`,
      ].map((l) => l + "\n");
    },
  },
  {
    id: "bronze-rle",
    tier: "bronze",
    title: "行程编码",
    tags: ["字符串"],
    statement: `输入一行只含小写字母的字符串（长度 1 到 100000）。
把每一段连续相同的字母写成「字母 + 连续出现的次数」，按原顺序拼起来输出。次数是 1 也要写出来。`,
    sample: "aaabcc\n",
    solve: (input) => lines(input)[0].replace(/([a-z])\1*/g, (run) => run[0] + run.length),
    inputs: (rand) => {
      let long = "";
      while (long.length < 100000) long += "abcdefghij"[int(rand, 0, 9)].repeat(int(rand, 1, 30));
      return ["a", "aaaaaaaaaaaa", "abcdef", "z".repeat(100), "abba", "aab" + "b".repeat(9), long.slice(0, 100000)].map(
        (l) => l + "\n",
      );
    },
  },

  // ---------- 白银：哈希表、排序、双指针 ----------
  {
    id: "silver-pairs",
    tier: "silver",
    title: "两数之和计数",
    tags: ["哈希表"],
    statement: `第一行两个整数 n 和 k（2 ≤ n ≤ 100000，|k| ≤ 2×10^9），第二行 n 个整数 a1…an（|ai| ≤ 10^9）。
统计满足 i < j 且 ai + aj = k 的下标对 (i, j) 有多少个。

输出：对数。注意答案可能超过 32 位整数的范围。`,
    sample: "6 0\n-3 3 -3 3 0 0\n",
    solve: (input) => {
      const [n, k, ...a] = nums(input);
      const seen = new Map<number, number>();
      let count = 0;
      for (const x of a.slice(0, n)) {
        count += seen.get(k - x) ?? 0;
        seen.set(x, (seen.get(x) ?? 0) + 1);
      }
      return String(count);
    },
    inputs: (rand) => {
      const small = Array.from({ length: 50000 }, () => int(rand, -1000, 1000));
      const mid = Array.from({ length: 1000 }, () => int(rand, 0, 50));
      return [
        "2 3\n1 2",
        "4 0\n0 0 0 0",
        "5 2000000000\n1000000000 1000000000 1000000000 -1 3",
        "3 10\n1 2 3",
        "4 -2000000000\n-1000000000 -1000000000 5 -5",
        `1000 50\n${mid.join(" ")}`,
        `50000 17\n${small.join(" ")}`,
        `70000 14\n${Array(70000).fill(7).join(" ")}`,
      ].map((l) => l + "\n");
    },
  },
  {
    id: "silver-intervals",
    tier: "silver",
    title: "合并区间",
    tags: ["排序"],
    statement: `第一行一个整数 n（1 ≤ n ≤ 100000），接下来 n 行，每行两个整数 l r（0 ≤ l ≤ r ≤ 10^9），表示闭区间 [l, r]。
把有重叠的区间合并。只有一个端点相同也算重叠，例如 [1, 3] 和 [3, 5] 合并为 [1, 5]；[1, 3] 和 [4, 5] 不合并。

输出：第一行是合并后的区间个数 m，接下来 m 行按左端点从小到大，每行输出一个区间的 l r。`,
    sample: "4\n8 10\n1 3\n2 6\n15 18\n",
    solve: (input) => {
      const [n, ...rest] = nums(input);
      const items: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) items.push([rest[2 * i], rest[2 * i + 1]]);
      items.sort((x, y) => x[0] - y[0]);
      const merged: Array<[number, number]> = [];
      for (const [l, r] of items) {
        const last = merged[merged.length - 1];
        if (last && l <= last[1]) last[1] = Math.max(last[1], r);
        else merged.push([l, r]);
      }
      return [merged.length, ...merged.map(([l, r]) => `${l} ${r}`)].join("\n");
    },
    inputs: (rand) => {
      const pairs = (count: number, max: number, span: number) =>
        Array.from({ length: count }, () => {
          const l = int(rand, 0, max);
          return `${l} ${Math.min(max, l + int(rand, 0, span))}`;
        }).join("\n");
      return [
        "1\n0 0",
        "2\n1 3\n3 5",
        "2\n1 3\n4 5",
        "3\n1 10\n2 3\n4 5",
        "3\n5 5\n5 5\n5 5",
        "4\n7 9\n0 1\n4 6\n2 3",
        "3\n0 1000000000\n999999999 1000000000\n0 0",
        `1000\n${pairs(1000, 100000, 300)}`,
        `15000\n${pairs(15000, 1000000000, 100000)}`,
      ].map((l) => l + "\n");
    },
  },
  {
    id: "silver-window",
    tier: "silver",
    title: "最长不重复片段",
    tags: ["双指针"],
    statement: `输入一行字符串（长度 1 到 100000），由 ASCII 码 33 到 126 的可见字符组成，不含空格。
求其中最长的一段连续子串，要求子串里没有重复的字符（大小写算不同字符）。

输出：这段子串的长度。`,
    sample: "pwwkew\n",
    solve: (input) => {
      const s = lines(input)[0];
      const last = new Map<string, number>();
      let best = 0;
      let left = 0;
      for (let i = 0; i < s.length; i++) {
        const prev = last.get(s[i]);
        if (prev !== undefined && prev >= left) left = prev + 1;
        last.set(s[i], i);
        best = Math.max(best, i - left + 1);
      }
      return String(best);
    },
    inputs: (rand) => {
      const visible = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));
      const from = (alphabet: string[], n: number) =>
        Array.from({ length: n }, () => alphabet[int(rand, 0, alphabet.length - 1)]).join("");
      return [
        "abcabcbb",
        "bbbbb",
        "abba",
        "a",
        "dvdf",
        "tmmzuxt",
        "aAbBaA",
        visible.join("") + visible.join(""),
        from(visible.slice(0, 10), 100000),
        from(visible, 100000),
      ].map((l) => l + "\n");
    },
  },

  // ---------- 黄金：祖传 bug ----------
  {
    id: "gold-dijkstra",
    tier: "gold",
    title: "祖传最短路",
    tags: ["图", "最短路", "修 bug"],
    statement: `n 个路口、m 条双向道路。第一行两个整数 n 和 m（1 ≤ n ≤ 100000，0 ≤ m ≤ 200000），
接下来 m 行，每行三个整数 u v w（1 ≤ u, v ≤ n，1 ≤ w ≤ 10^9），表示 u 和 v 之间有一条长度为 w 的路（可能有重边）。

输出：从路口 1 到路口 n 的最短距离；到不了输出 -1。注意答案可能超过 32 位整数的范围。`,
    sample: "3 3\n1 2 1\n2 3 1\n1 3 5\n",
    legacy: `import sys, heapq

def main():
    data = sys.stdin.read().split()
    n, m = int(data[0]), int(data[1])
    g = [[] for _ in range(n + 1)]
    idx = 2
    for _ in range(m):
        u, v, w = int(data[idx]), int(data[idx + 1]), int(data[idx + 2])
        idx += 3
        g[u].append((v, w))
        g[v].append((u, w))
    dist = [-1] * (n + 1)
    seen = [False] * (n + 1)
    heap = [(0, 1)]
    seen[1] = True
    while heap:
        d, u = heapq.heappop(heap)
        dist[u] = d
        for v, w in g[u]:
            if not seen[v]:
                seen[v] = True
                heapq.heappush(heap, (d + w, v))
    print(dist[n])

main()`,
    solve: (input) => {
      const [n, m, ...rest] = nums(input);
      const g: Array<Array<[number, number]>> = Array.from({ length: n + 1 }, () => []);
      for (let i = 0; i < m; i++) {
        const [u, v, w] = [rest[3 * i], rest[3 * i + 1], rest[3 * i + 2]];
        g[u].push([v, w]);
        g[v].push([u, w]);
      }
      const dist = new Array<number>(n + 1).fill(Infinity);
      const done = new Uint8Array(n + 1);
      dist[1] = 0;
      // 二叉堆存 [距离, 点]
      const heap: Array<[number, number]> = [[0, 1]];
      const less = (a: [number, number], b: [number, number]) => a[0] < b[0];
      while (heap.length) {
        const top = heap[0];
        const last = heap.pop()!;
        if (heap.length) {
          heap[0] = last;
          for (let i = 0; ;) {
            const l = 2 * i + 1;
            const r = l + 1;
            let min = i;
            if (l < heap.length && less(heap[l], heap[min])) min = l;
            if (r < heap.length && less(heap[r], heap[min])) min = r;
            if (min === i) break;
            [heap[min], heap[i]] = [heap[i], heap[min]];
            i = min;
          }
        }
        const [d, u] = top;
        if (done[u]) continue;
        done[u] = 1;
        for (const [v, w] of g[u]) {
          if (d + w >= dist[v]) continue;
          dist[v] = d + w;
          heap.push([dist[v], v]);
          for (let i = heap.length - 1; i > 0;) {
            const p = (i - 1) >> 1;
            if (!less(heap[i], heap[p])) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
          }
        }
      }
      return dist[n] === Infinity ? "-1" : String(dist[n]);
    },
    inputs: (rand) => {
      const graph = (n: number, m: number, maxW: number) => {
        const edges = Array.from({ length: m }, () => `${int(rand, 1, n)} ${int(rand, 1, n)} ${int(rand, 1, maxW)}`);
        return `${n} ${m}\n${edges.join("\n")}`;
      };
      const chain = Array.from({ length: 9999 }, (_, i) => `${i + 1} ${i + 2} 1000000000`);
      return [
        "1 0",
        "2 0",
        "4 4\n1 2 10\n1 3 1\n3 2 1\n2 4 1",
        "3 3\n1 2 7\n1 2 3\n2 3 4",
        "5 6\n1 2 2\n1 3 9\n2 3 2\n3 4 2\n2 4 9\n4 5 1",
        `10000 ${chain.length}\n${chain.join("\n")}`,
        graph(200, 600, 100),
        graph(5000, 15000, 1000000000),
        graph(5000, 15000, 10),
      ].map((l) => l + "\n");
    },
  },
  {
    id: "gold-lis",
    tier: "gold",
    title: "祖传递增子序列",
    tags: ["动态规划", "二分", "修 bug"],
    statement: `第一行一个整数 n（1 ≤ n ≤ 100000），第二行 n 个整数（绝对值不超过 10^9）。
求最长「严格递增」子序列的长度：从中按原顺序挑出若干个数（不要求连续），后一个必须比前一个大，相等不行。

输出：最长长度。`,
    sample: "6\n1 3 3 2 4 4\n",
    legacy: `import sys
from bisect import bisect_right

def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    a = list(map(int, data[1:1 + n]))
    tails = []
    for x in a:
        i = bisect_right(tails, x)
        if i == len(tails):
            tails.append(x)
        else:
            tails[i] = x
    print(len(tails))

main()`,
    solve: (input) => {
      const [n, ...a] = nums(input);
      const tails: number[] = [];
      for (const x of a.slice(0, n)) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (tails[mid] < x) lo = mid + 1;
          else hi = mid;
        }
        tails[lo] = x;
      }
      return String(tails.length);
    },
    inputs: (rand) => {
      const arr = (count: number, lo: number, hi: number) =>
        `${count}\n${Array.from({ length: count }, () => int(rand, lo, hi)).join(" ")}`;
      return [
        "1\n42",
        "5\n1 1 1 1 1",
        "5\n5 4 3 2 1",
        "6\n-1000000000 -1 0 0 1 1000000000",
        "8\n2 2 3 3 1 1 4 4",
        arr(1000, 0, 30),
        arr(1000, -1e9, 1e9),
        `50000\n${Array.from({ length: 50000 }, (_, i) => Math.floor(i / 3)).join(" ")}`,
        arr(50000, 0, 100000),
      ].map((l) => l + "\n");
    },
  },
  {
    id: "gold-knapsack",
    tier: "gold",
    title: "祖传背包",
    tags: ["动态规划", "修 bug"],
    statement: `n 件物品，每件最多选一次。第一行两个整数 n 和 W（1 ≤ n ≤ 100，0 ≤ W ≤ 10000），
接下来 n 行，每行两个整数 w v（1 ≤ w ≤ 10000，1 ≤ v ≤ 10^9），是这件物品的重量和价值。
选出若干件，使总重量「恰好」等于 W，求总价值的最大值。W 为 0 时什么都不选，价值为 0。

输出：最大总价值；凑不出恰好 W 时输出 -1。注意答案可能超过 32 位整数的范围。`,
    sample: "3 5\n2 3\n3 4\n4 5\n",
    legacy: `import sys

def main():
    data = sys.stdin.read().split()
    n, cap = int(data[0]), int(data[1])
    dp = [0] * (cap + 1)
    for i in range(n):
        w, v = int(data[2 + 2 * i]), int(data[3 + 2 * i])
        for c in range(w, cap + 1):
            dp[c] = max(dp[c], dp[c - w] + v)
    print(dp[cap] if dp[cap] > 0 else -1)

main()`,
    solve: (input) => {
      const [n, W, ...rest] = nums(input);
      const best = new Array<number>(W + 1).fill(-1);
      best[0] = 0;
      for (let i = 0; i < n; i++) {
        const [w, v] = [rest[2 * i], rest[2 * i + 1]];
        for (let c = W; c >= w; c--) if (best[c - w] >= 0) best[c] = Math.max(best[c], best[c - w] + v);
      }
      return String(best[W]);
    },
    inputs: (rand) => {
      const items = (count: number, maxW: number, maxV: number, even = false) =>
        Array.from({ length: count }, () => `${int(rand, 1, maxW) * (even ? 2 : 1)} ${int(rand, 1, maxV)}`).join("\n");
      return [
        "1 5\n5 10",
        "1 5\n3 10",
        "2 6\n3 5\n3 7",
        "3 0\n1 1\n2 2\n3 3",
        "2 4\n2 1000000000\n2 1000000000",
        "3 10\n4 1\n6 1\n5 100",
        `100 10000\n${items(100, 400, 1000000000)}`,
        `100 9999\n${items(100, 200, 1000000000, true)}`,
        `100 7777\n${items(100, 10000, 1000)}`,
      ].map((l) => l + "\n");
    },
  },
];

export function problemsOf(tier: ArenaTier): Problem[] {
  if (!TIERS.includes(tier)) return [];
  return [...PROBLEMS, ...HARD_PROBLEMS, ...KING_PROBLEMS].filter((p) => p.tier === tier);
}

export interface TestCase {
  input: string;
  output: string;
}

const cache = new Map<string, TestCase[]>();

/** 隐藏测试：每题用固定种子生成，同一版本永远相同 */
export function testsOf(p: Problem): TestCase[] {
  let tests = cache.get(p.id);
  if (!tests) {
    let seed = 0;
    for (const ch of p.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    tests = [p.sample, ...p.inputs(rng(seed))].map((input) => ({ input, output: p.solve(input) }));
    cache.set(p.id, tests);
  }
  return tests;
}
