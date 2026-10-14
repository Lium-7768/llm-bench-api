import type { Problem } from "./problems";
import { int, lines, nums } from "./util";

/**
 * 王者档：每题都要把两三种技巧串起来，单会一个模板过不了。
 * 和钻石档一样，输入控制在几百 KB 以内，暴力做法（枚举排列、枚举所有按法、无剪枝搜索）在任何语言里都会超时。
 */

/** 无向 / 有向图的邻接表（压成数组）+ 二叉堆 Dijkstra，距离用 Number（最大约 10^11，在 2^53 以内） */
function dijkstra(n: number, start: Int32Array, to: Int32Array, weight: Float64Array, source: number) {
  const dist = new Float64Array(n + 1).fill(Infinity);
  const heap: Array<[number, number]> = [[0, source]];
  dist[source] = 0;
  while (heap.length) {
    const [d, v] = popMin(heap);
    if (d > dist[v]) continue;
    for (let e = start[v]; e < start[v + 1]; e++) {
      const nd = d + weight[e];
      if (nd < dist[to[e]]) {
        dist[to[e]] = nd;
        pushHeap(heap, [nd, to[e]]);
      }
    }
  }
  return dist;
}

function pushHeap<T extends [number, ...number[]]>(heap: T[], item: T) {
  heap.push(item);
  for (let i = heap.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (heap[p][0] <= heap[i][0]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
}

function popMin<T extends [number, ...number[]]>(heap: T[]): T {
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let min = i;
      if (l < heap.length && heap[l][0] < heap[min][0]) min = l;
      if (r < heap.length && heap[r][0] < heap[min][0]) min = r;
      if (min === i) break;
      [heap[min], heap[i]] = [heap[i], heap[min]];
      i = min;
    }
  }
  return top;
}

/** 边表 → 邻接数组；undirected 时每条边存两次 */
function adjacency(n: number, edges: number[][], undirected: boolean) {
  const all = undirected
    ? edges.flatMap(([u, v, w]) => [
        [u, v, w],
        [v, u, w],
      ])
    : edges;
  const start = new Int32Array(n + 2);
  for (const [u] of all) start[u + 1]++;
  for (let v = 1; v <= n + 1; v++) start[v] += start[v - 1];
  const fill = start.slice();
  const to = new Int32Array(all.length);
  const weight = new Float64Array(all.length);
  for (const [u, v, w] of all) {
    to[fill[u]] = v;
    weight[fill[u]++] = w;
  }
  return { start, to, weight };
}

const edgeLines = (edges: number[][]) => edges.map((e) => e.join(" ")).join("\n");

export const KING_PROBLEMS: Problem[] = [
  {
    id: "king-courier",
    tier: "king",
    title: "快递路线",
    tags: ["最短路", "状压 DP", "先后约束"],
    statement: `城市有 n 个路口（编号 1 到 n）和 m 条双向道路。快递员从路口 1 出发，要送 k 件包裹：
第 i 件要先到路口 a_i 取件，再到路口 b_i 送达，取件之前不能送。可以同时带着多件包裹，路口和道路都可以重复经过。
全部送完后要到路口 n 下班。求最短的总路程；无论怎样都做不到时输出 -1。

输入：第一行 n m k（2 ≤ n ≤ 5000，1 ≤ m ≤ 10000，0 ≤ k ≤ 7）；
接下来 m 行，每行 u v w，表示 u 和 v 之间有一条长度为 w 的双向道路（1 ≤ w ≤ 10^6，可能有重边）；
接下来 k 行，每行 a_i b_i（取件路口和送达路口，可能相同，也可能是 1 或 n）。

输出：最短总路程。注意答案可能超过 32 位整数的范围。`,
    sample: "5 5 2\n1 2 3\n2 3 4\n3 4 2\n4 5 6\n1 5 20\n3 2\n4 3\n",
    solve: (input) => {
      const [n, m, k, ...rest] = nums(input);
      const edges = Array.from({ length: m }, (_, i) => rest.slice(3 * i, 3 * i + 3));
      const pairs = Array.from({ length: k }, (_, i) => rest.slice(3 * m + 2 * i, 3 * m + 2 * i + 2));
      const g = adjacency(n, edges, true);
      // 事件 0..k-1 是取件，k..2k-1 是送达
      const nodes = [...pairs.map((p) => p[0]), ...pairs.map((p) => p[1])];
      const dist = new Map<number, Float64Array>();
      for (const v of [1, ...nodes]) if (!dist.has(v)) dist.set(v, dijkstra(n, g.start, g.to, g.weight, v));
      const E = 2 * k;
      if (E === 0) {
        const d = dist.get(1)![n];
        return d === Infinity ? "-1" : String(d);
      }
      const full = (1 << E) - 1;
      const dp = new Float64Array((full + 1) * E).fill(Infinity);
      for (let e = 0; e < k; e++) dp[(1 << e) * E + e] = dist.get(1)![nodes[e]];
      for (let mask = 1; mask <= full; mask++)
        for (let j = 0; j < E; j++) {
          const cur = dp[mask * E + j];
          if (cur === Infinity) continue;
          const from = dist.get(nodes[j])!;
          for (let e = 0; e < E; e++) {
            if (mask & (1 << e)) continue;
            if (e >= k && !(mask & (1 << (e - k)))) continue;
            const next = mask | (1 << e);
            const cand = cur + from[nodes[e]];
            if (cand < dp[next * E + e]) dp[next * E + e] = cand;
          }
        }
      let best = Infinity;
      for (let j = 0; j < E; j++) best = Math.min(best, dp[full * E + j] + dist.get(nodes[j])![n]);
      return best === Infinity ? "-1" : String(best);
    },
    inputs: (rand) => {
      const make = (n: number, edges: number[][], pairs: number[][]) =>
        `${n} ${edges.length} ${pairs.length}\n${edgeLines(edges)}${pairs.length ? "\n" + edgeLines(pairs) : ""}`;
      const randomPairs = (n: number, k: number) => Array.from({ length: k }, () => [int(rand, 1, n), int(rand, 1, n)]);
      // 随机连通图：先连一棵随机树，再加边
      const connected = (n: number, m: number, maxW: number) => {
        const edges: number[][] = [];
        for (let v = 2; v <= n; v++) edges.push([v, int(rand, 1, v - 1), int(rand, 1, maxW)]);
        while (edges.length < m) edges.push([int(rand, 1, n), int(rand, 1, n), int(rand, 1, maxW)]);
        return edges;
      };
      const grid = (side: number, maxW: number) => {
        const id = (r: number, c: number) => r * side + c + 1;
        const edges: number[][] = [];
        for (let r = 0; r < side; r++)
          for (let c = 0; c < side; c++) {
            if (c + 1 < side) edges.push([id(r, c), id(r, c + 1), int(rand, 1, maxW)]);
            if (r + 1 < side) edges.push([id(r, c), id(r + 1, c), int(rand, 1, maxW)]);
          }
        return edges;
      };
      // 一条长链：顺路送反而要来回跑，贪心按距离走会错
      const chain = Array.from({ length: 199 }, (_, i) => [i + 1, i + 2, 1000000]);
      return [
        make(2, [[1, 2, 5]], []),
        make(3, [[1, 2, 5]], [[2, 2]]),
        make(
          4,
          [
            [1, 2, 1],
            [3, 4, 1],
          ],
          [[2, 3]],
        ),
        make(
          3,
          [
            [1, 2, 1],
            [2, 3, 1],
          ],
          [
            [3, 1],
            [1, 3],
            [2, 2],
          ],
        ),
        make(200, chain, [
          [150, 20],
          [30, 180],
          [100, 5],
          [60, 199],
          [10, 190],
          [120, 40],
          [1, 200],
        ]),
        make(5000, connected(5000, 10000, 1000000), randomPairs(5000, 7)),
        make(4900, grid(70, 100), randomPairs(4900, 7)),
        make(3000, connected(3000, 6000, 10), randomPairs(3000, 7)),
        make(2000, connected(2000, 2500, 1000000), randomPairs(2000, 5)),
      ].map((l) => l + "\n");
    },
  },
  {
    id: "king-kth",
    tier: "king",
    title: "第 k 短路线",
    tags: ["最短路", "k 短路", "优先队列"],
    statement: `有向图有 n 个点、m 条边（1 ≤ n ≤ 1000，0 ≤ m ≤ 10000），边长 1 到 10000，可能有重边和自环。
从 s 到 t 的一条「路线」是首尾相接的一串有向边：从 s 出发、到 t 结束、至少一条边，点和边都可以重复经过。
两条路线只要经过的边的序列不同就算不同（重边算不同的边）。
把所有路线按总长度从小到大排好（长度相同的每一条都要算），求第 k 条的长度；路线不足 k 条时输出 -1。

输入：第一行 n m s t k（1 ≤ s, t ≤ n，1 ≤ k ≤ 100）；接下来 m 行，每行 u v w，表示一条从 u 到 v、长度为 w 的有向边。

输出：第 k 短路线的长度，或 -1。`,
    sample: "4 5 1 4 3\n1 2 1\n2 4 1\n1 3 1\n3 4 2\n4 1 1\n",
    solve: (input) => {
      const [n, m, s, t, k, ...rest] = nums(input);
      const edges = Array.from({ length: m }, (_, i) => rest.slice(3 * i, 3 * i + 3));
      const g = adjacency(n, edges, false);
      // 每个点最多出队 k+1 次：第 j 次出队就是到它的第 j 短路线（含 s 处的空路线）
      const popped = new Int32Array(n + 1);
      const heap: Array<[number, number, number]> = [[0, s, 1]];
      let found = 0;
      while (heap.length) {
        const [d, v, empty] = popMin(heap);
        if (popped[v] > k) continue;
        popped[v]++;
        if (v === t && !empty && ++found === k) return String(d);
        for (let e = g.start[v]; e < g.start[v + 1]; e++) pushHeap(heap, [d + g.weight[e], g.to[e], 0]);
      }
      return "-1";
    },
    inputs: (rand) => {
      const make = (n: number, s: number, t: number, k: number, edges: number[][]) =>
        `${n} ${edges.length} ${s} ${t} ${k}${edges.length ? "\n" + edgeLines(edges) : ""}`;
      const random = (n: number, m: number, maxW: number) =>
        Array.from({ length: m }, () => [int(rand, 1, n), int(rand, 1, n), int(rand, 1, maxW)]);
      // 一张只能往后走的图：路线有限，k 大了要输出 -1
      const dag = (n: number, m: number) =>
        Array.from({ length: m }, () => {
          const u = int(rand, 1, n - 1);
          return [u, int(rand, u + 1, n), int(rand, 1, 20)];
        });
      return [
        make(2, 1, 2, 1, []),
        make(1, 1, 1, 3, [[1, 1, 5]]),
        make(2, 1, 2, 4, [
          [1, 2, 3],
          [1, 2, 3],
          [1, 2, 3],
        ]),
        make(3, 1, 3, 5, [
          [1, 2, 1],
          [2, 3, 1],
        ]),
        make(3, 2, 2, 7, [
          [2, 3, 2],
          [3, 2, 3],
          [2, 1, 1],
          [1, 2, 1],
        ]),
        make(1000, 1, 1000, 100, random(1000, 10000, 10000)),
        make(1000, 7, 7, 100, random(1000, 10000, 3)),
        make(300, 1, 300, 100, dag(300, 450)),
        make(1000, 5, 999, 100, random(1000, 3000, 10000)),
        make(500, 1, 500, 100, dag(500, 3000)),
      ].map((l) => l + "\n");
    },
  },
  {
    id: "king-lights",
    tier: "king",
    title: "三色灯阵",
    tags: ["模 3 线性方程组", "高斯消元", "枚举"],
    statement: `R 行 C 列的灯阵（1 ≤ R, C ≤ 12），每盏灯有三种状态：0、1、2。
按一次某盏灯，它自己和上下左右相邻的灯（存在的话）状态都加 1，2 再加 1 就回到 0。同一盏灯可以按多次。
求把所有灯都变成 0 最少要按几次；无论怎样都做不到时输出 -1。

输入：第一行 R C；接下来 R 行，每行 C 个数字（0、1 或 2），数字之间没有空格。

输出：最少按的次数，或 -1。`,
    sample: "2 3\n222\n222\n",
    solve: (input) => {
      const ls = lines(input);
      const [R, C] = nums(ls[0]);
      let grid = ls.slice(1, R + 1).map((l) => [...l.trim()].map(Number));
      // 按列少的方向逐行推：第一行怎么按枚举 3^W 种，之后每一行的按法被上一行唯一确定
      if (C > R) grid = grid[0].map((_, c) => grid.map((row) => row[c]));
      const H = grid.length;
      const W = grid[0].length;
      const state = new Int8Array(H * W);
      const press = new Int8Array(W);
      let best = Infinity;
      for (let code = 0; code < 3 ** W; code++) {
        state.set(grid.flat());
        for (let c = 0, x = code; c < W; c++, x = Math.floor(x / 3)) press[c] = x % 3;
        let total = 0;
        for (let r = 0; r < H && total < best; r++) {
          if (r > 0) for (let c = 0; c < W; c++) press[c] = (3 - state[(r - 1) * W + c]) % 3;
          for (let c = 0; c < W; c++) {
            const x = press[c];
            if (!x) continue;
            total += x;
            const i = r * W + c;
            state[i] = (state[i] + x) % 3;
            if (c > 0) state[i - 1] = (state[i - 1] + x) % 3;
            if (c + 1 < W) state[i + 1] = (state[i + 1] + x) % 3;
            if (r > 0) state[i - W] = (state[i - W] + x) % 3;
            if (r + 1 < H) state[i + W] = (state[i + W] + x) % 3;
          }
        }
        if (total >= best) continue;
        let clear = true;
        for (let c = 0; c < W && clear; c++) if (state[(H - 1) * W + c]) clear = false;
        if (clear) best = total;
      }
      return best === Infinity ? "-1" : String(best);
    },
    inputs: (rand) => {
      const show = (g: number[][]) => `${g.length} ${g[0].length}\n${g.map((row) => row.join("")).join("\n")}`;
      const random = (R: number, C: number) =>
        Array.from({ length: R }, () => Array.from({ length: C }, () => int(rand, 0, 2)));
      // 从全 0 随机按若干下得到：一定有解
      const solvable = (R: number, C: number, presses: number) => {
        const g = Array.from({ length: R }, () => new Array<number>(C).fill(0));
        for (let i = 0; i < presses; i++) {
          const r = int(rand, 0, R - 1);
          const c = int(rand, 0, C - 1);
          for (const [dr, dc] of [
            [0, 0],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            if (g[r + dr]?.[c + dc] !== undefined) g[r + dr][c + dc] = (g[r + dr][c + dc] + 2) % 3;
        }
        return g;
      };
      return [
        "1 1\n1",
        "1 1\n0",
        "2 2\n12\n21",
        show(random(3, 3)),
        show(random(1, 12)),
        show(solvable(12, 12, 40)),
        show(random(12, 12)),
        show(solvable(11, 12, 60)),
        show(random(7, 10)),
        show(solvable(12, 5, 30)),
      ].map((l) => l + "\n");
    },
  },
];
