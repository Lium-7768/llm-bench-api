import type { Problem } from "./problems";
import { int, lines, nums, randomText } from "./util";

/**
 * 白金、钻石两档：难点在算法本身，不在数据量。输入规模控制在几百 KB 以内，
 * 但暴力做法（O(n²) 枚举、逐个数、搜索所有子集）在任何语言里都会超时。
 */

const P = 1_000_000_007;
// tsconfig 的目标低于 ES2020，不能写 0n 这样的字面量
const ZERO = BigInt(0);
const ONE = BigInt(1);
const E18 = BigInt("1000000000000000000");

/** a·b mod P，不用 BigInt：把 b 拆成高低 15 位，中间结果都在 2^53 以内 */
const mulmod = (a: number, b: number) => (((a * (b >>> 15)) % P) * 32768 + a * (b & 32767)) % P;

export const HARD_PROBLEMS: Problem[] = [
  // ---------- 白金：字符串算法、图论建模、数位 DP ----------
  {
    id: "platinum-palindrome",
    tier: "platinum",
    title: "最长回文子串",
    tags: ["字符串", "Manacher"],
    statement: `输入一行只含小写字母的字符串 s（长度 1 到 200000）。
求 s 中最长的回文子串：连续的一段，正着读和反着读一样。

输出两行：第一行是它的长度，第二行是这个子串本身。同样长的有多个时，输出起始位置最靠左的那个。`,
    sample: "babad\n",
    solve: (input) => {
      const s = lines(input)[0].trim();
      // 在字符之间插入分隔符后的下标：偶数位是分隔符，奇数位 i 对应 s[i >> 1]
      const m = 2 * s.length + 1;
      const at = (i: number) => (i & 1 ? s.charCodeAt(i >> 1) : 0);
      const radius = new Int32Array(m);
      let center = 0;
      let right = 0;
      let best = 0;
      let start = 0;
      for (let i = 0; i < m; i++) {
        let k = i < right ? Math.min(radius[2 * center - i], right - i) : 0;
        while (i - k - 1 >= 0 && i + k + 1 < m && at(i - k - 1) === at(i + k + 1)) k++;
        radius[i] = k;
        if (i + k > right) [center, right] = [i, i + k];
        // 同样长时中心越靠左起点越靠左，只在严格更长时替换
        if (k > best) [best, start] = [k, (i - k) >> 1];
      }
      return `${best}\n${s.slice(start, start + best)}`;
    },
    inputs: (rand) => {
      const half = randomText(rand, 1500);
      const planted = randomText(rand, 20000) + half + [...half].reverse().join("") + randomText(rand, 20000);
      let fib = ["a", "b"];
      while (fib[1].length < 60000) fib = [fib[1], fib[1] + fib[0]];
      return [
        "a",
        "ab",
        "cbbd",
        "abacdfgdcaba",
        "a".repeat(200000),
        "ab".repeat(100000),
        "aab".repeat(33333),
        fib[1].slice(0, 60000),
        randomText(rand, 60000, "ab"),
        planted,
      ].map((l) => l + "\n");
    },
  },
  {
    id: "platinum-gems",
    tier: "platinum",
    title: "收集宝石",
    tags: ["图", "强连通分量", "DAG 动态规划"],
    statement: `地下城有 n 个房间（编号 1 到 n）和 m 条单向通道。房间 i 里有 w_i 颗宝石。
你可以从任意一个房间出发，沿通道走任意多步（房间和通道都可以重复经过），也可以随时停下。
每个房间的宝石只能拿一次，走到就拿走。最多能拿到多少颗宝石？

输入：第一行 n m（1 ≤ n ≤ 10000，0 ≤ m ≤ 100000）；第二行 n 个整数 w_1…w_n（0 ≤ w_i ≤ 1000）；
接下来 m 行，每行两个整数 u v，表示从 u 到 v 有一条单向通道（可能有自环和重复的通道）。

输出：最多的宝石数。`,
    sample: "5 6\n1 2 3 4 5\n1 2\n2 1\n2 3\n3 4\n4 3\n1 5\n",
    solve: (input) => {
      const [n, m, ...rest] = nums(input);
      const w = [0, ...rest.slice(0, n)];
      const from = rest.slice(n).filter((_, i) => i % 2 === 0);
      const to = rest.slice(n).filter((_, i) => i % 2 === 1);
      // 邻接表压成数组
      const start = new Int32Array(n + 2);
      for (let i = 0; i < m; i++) start[from[i] + 1]++;
      for (let v = 1; v <= n + 1; v++) start[v] += start[v - 1];
      const adj = new Int32Array(m);
      const fill = start.slice();
      for (let i = 0; i < m; i++) adj[fill[from[i]]++] = to[i];

      // Tarjan，用显式栈，避免深递归
      const index = new Int32Array(n + 1).fill(-1);
      const low = new Int32Array(n + 1);
      const comp = new Int32Array(n + 1).fill(-1);
      const onStack = new Uint8Array(n + 1);
      const edge = new Int32Array(n + 1);
      const stack: number[] = [];
      const order: number[][] = [];
      let counter = 0;
      for (let s = 1; s <= n; s++) {
        if (index[s] >= 0) continue;
        const call = [s];
        index[s] = low[s] = counter++;
        stack.push(s);
        onStack[s] = 1;
        edge[s] = start[s];
        while (call.length) {
          const v = call[call.length - 1];
          if (edge[v] < start[v + 1]) {
            const u = adj[edge[v]++];
            if (index[u] < 0) {
              index[u] = low[u] = counter++;
              stack.push(u);
              onStack[u] = 1;
              edge[u] = start[u];
              call.push(u);
            } else if (onStack[u]) low[v] = Math.min(low[v], index[u]);
            continue;
          }
          call.pop();
          if (call.length) low[call[call.length - 1]] = Math.min(low[call[call.length - 1]], low[v]);
          if (low[v] === index[v]) {
            const members: number[] = [];
            let x: number;
            do {
              x = stack.pop()!;
              onStack[x] = 0;
              comp[x] = order.length;
              members.push(x);
            } while (x !== v);
            order.push(members);
          }
        }
      }
      // Tarjan 先完成的分量在拓扑序的末尾：按完成顺序算，后继分量一定已经算好
      const best = new Array<number>(order.length).fill(0);
      let answer = 0;
      order.forEach((members, c) => {
        let next = 0;
        let own = 0;
        for (const v of members) {
          own += w[v];
          for (let e = start[v]; e < start[v + 1]; e++)
            if (comp[adj[e]] !== c) next = Math.max(next, best[comp[adj[e]]]);
        }
        best[c] = own + next;
        answer = Math.max(answer, best[c]);
      });
      return String(answer);
    },
    inputs: (rand) => {
      const graph = (n: number, edges: Array<[number, number]>, maxW = 1000) =>
        `${n} ${edges.length}\n${Array.from({ length: n }, () => int(rand, 0, maxW)).join(" ")}\n${edges.map(([u, v]) => `${u} ${v}`).join("\n")}`;
      const chain = (n: number, back: boolean) => {
        const edges: Array<[number, number]> = Array.from({ length: n - 1 }, (_, i) => [i + 1, i + 2]);
        if (back) edges.push([n, 1]);
        return graph(n, edges);
      };
      // 若干个小环，环与环之间按随机顺序只往「后面」连，缩点后是一张 DAG
      const clusters = (count: number, size: number, forward: number) => {
        const n = count * size;
        const perm = Array.from({ length: n }, (_, i) => i + 1).sort(() => rand() - 0.5);
        const node = (c: number, k: number) => perm[c * size + k];
        const edges: Array<[number, number]> = [];
        for (let c = 0; c < count; c++)
          for (let k = 0; k < size; k++) edges.push([node(c, k), node(c, (k + 1) % size)]);
        for (let i = 0; i < forward; i++) {
          const a = int(rand, 0, count - 2);
          edges.push([node(a, int(rand, 0, size - 1)), node(int(rand, a + 1, count - 1), int(rand, 0, size - 1))]);
        }
        return graph(n, edges);
      };
      const random = (n: number, m: number) =>
        graph(
          n,
          Array.from({ length: m }, (): [number, number] => [int(rand, 1, n), int(rand, 1, n)]),
        );
      return [
        "1 0\n5",
        "3 3\n1 2 3\n1 2\n2 3\n3 1",
        "4 3\n1 10 1 1\n1 2\n1 3\n3 4",
        "3 4\n4 4 4\n1 1\n1 2\n1 2\n3 2",
        "4 0\n0 0 0 7",
        chain(10000, false),
        chain(10000, true),
        clusters(2000, 5, 20000),
        clusters(300, 3, 3000),
        random(5000, 6000),
      ].map((l) => l + "\n");
    },
  },
  {
    id: "platinum-digits",
    tier: "platinum",
    title: "不吉利的数字",
    tags: ["数位 DP", "大整数"],
    statement: `第一行一个整数 T（1 ≤ T ≤ 100），接下来 T 行，每行三个整数 L R K（1 ≤ L ≤ R ≤ 10^18，1 ≤ K ≤ 100）。
对每一行，统计区间 [L, R] 里同时满足下面两个条件的整数 x 有多少个：
1. x 的十进制写法里没有数字 4；
2. x 的各位数字之和是 K 的倍数。

输出：T 行，每行一个答案。注意 L、R 和答案都可能超过 32 位整数的范围，也可能超过 2^53。`,
    sample: "3\n1 20 1\n1 100 10\n40 49 1\n",
    solve: (input) => {
      const rows = lines(input)
        .slice(1)
        .map((l) => l.trim().split(/\s+/))
        .filter((r) => r.length === 3);
      const tables = new Map<number, bigint[][]>();
      // ways[r][s]：长度为 r、不含 4、数字和 ≡ s (mod K) 的数字串个数（允许前导零）
      const waysOf = (K: number) => {
        let ways = tables.get(K);
        if (!ways) {
          ways = [Array.from({ length: K }, (_, s) => (s === 0 ? ONE : ZERO))];
          for (let r = 1; r <= 19; r++) {
            const row = new Array<bigint>(K).fill(ZERO);
            for (let s = 0; s < K; s++) for (let d = 0; d <= 9; d++) if (d !== 4) row[(s + d) % K] += ways[r - 1][s];
            ways.push(row);
          }
          tables.set(K, ways);
        }
        return ways;
      };
      /** [0, N] 里满足条件的个数（0 也算，在两次相减时抵消） */
      const upTo = (N: bigint, K: number) => {
        const ways = waysOf(K);
        const digits = N.toString();
        let count = ZERO;
        let sum = 0;
        for (let i = 0; i < digits.length; i++) {
          const d = Number(digits[i]);
          const rest = digits.length - 1 - i;
          for (let x = 0; x < d; x++) if (x !== 4) count += ways[rest][(K - ((sum + x) % K)) % K];
          if (d === 4) return count;
          sum += d;
        }
        return sum % K === 0 ? count + ONE : count;
      };
      return rows.map(([L, R, K]) => String(upTo(BigInt(R), Number(K)) - upTo(BigInt(L) - ONE, Number(K)))).join("\n");
    },
    inputs: (rand) => {
      const big = (digits: number) => {
        let s = String(int(rand, 1, 9));
        for (let i = 1; i < digits; i++) s += int(rand, 0, 9);
        return BigInt(s);
      };
      const queries = (count: number, make: () => [bigint, bigint, number]) =>
        `${count}\n${Array.from({ length: count }, () => make().join(" ")).join("\n")}`;
      const range = (lo: bigint, hi: bigint): [bigint, bigint] => (lo <= hi ? [lo, hi] : [hi, lo]);
      return [
        "1\n1 1 1",
        "1\n4 4 1",
        "2\n1 1000000000000000000 1\n1 1000000000000000000 100",
        "3\n999999999999999999 1000000000000000000 1\n444444444444444444 444444444444444445 1\n1000000000000000000 1000000000000000000 1",
        queries(100, () => [...range(big(int(rand, 1, 18)), big(int(rand, 1, 18))), int(rand, 1, 100)]),
        queries(100, () => {
          const L = big(18);
          return [L, L + BigInt(int(rand, 0, 1000)), int(rand, 1, 30)];
        }),
        queries(100, () => [ONE, big(int(rand, 15, 18)), int(rand, 1, 9)]),
      ].map((l) => l + "\n");
    },
  },

  // ---------- 钻石：后缀自动机、最小割建模、矩阵快速幂 ----------
  {
    id: "diamond-common",
    tier: "diamond",
    title: "最长公共子串",
    tags: ["字符串", "后缀自动机"],
    statement: `输入两行，各一个只含小写字母的字符串 s 和 t（长度都在 1 到 100000 之间）。
「公共子串」指同时是 s 和 t 的连续子串的字符串。

输出两行：第一行是最长公共子串的长度 L；第二行是长度恰好为 L 的「不同」公共子串一共有几种（同一个字符串出现多次只算一种）。
没有任何公共字符时，两行都输出 0。`,
    sample: "abab\nbaba\n",
    solve: (input) => {
      const [s, t] = lines(input).map((l) => l.trim());
      // 对 s 建后缀自动机
      const max = 2 * s.length + 2;
      const len = new Int32Array(max);
      const link = new Int32Array(max).fill(-1);
      const next = new Int32Array(max * 26).fill(-1);
      let size = 1;
      let last = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i) - 97;
        const cur = size++;
        len[cur] = len[last] + 1;
        let p = last;
        while (p !== -1 && next[p * 26 + c] === -1) {
          next[p * 26 + c] = cur;
          p = link[p];
        }
        if (p === -1) link[cur] = 0;
        else {
          const q = next[p * 26 + c];
          if (len[p] + 1 === len[q]) link[cur] = q;
          else {
            const clone = size++;
            len[clone] = len[p] + 1;
            next.copyWithin(clone * 26, q * 26, q * 26 + 26);
            link[clone] = link[q];
            while (p !== -1 && next[p * 26 + c] === q) {
              next[p * 26 + c] = clone;
              p = link[p];
            }
            link[q] = link[cur] = clone;
          }
        }
        last = cur;
      }
      // 用 t 在自动机上走：当前匹配的那段一定属于所在的状态，同一状态里同一长度的字符串只有一个
      let v = 0;
      let l = 0;
      let best = 0;
      let states = new Set<number>();
      for (let i = 0; i < t.length; i++) {
        const c = t.charCodeAt(i) - 97;
        while (v !== 0 && next[v * 26 + c] === -1) {
          v = link[v];
          l = len[v];
        }
        if (next[v * 26 + c] !== -1) {
          v = next[v * 26 + c];
          l++;
        }
        if (l > best) [best, states] = [l, new Set([v])];
        else if (l === best && best > 0) states.add(v);
      }
      return `${best}\n${best ? states.size : 0}`;
    },
    inputs: (rand) => {
      const shared = randomText(rand, 3000);
      return [
        "a\na",
        "abc\nxyz",
        "banana\nananas",
        "aaaa\naa",
        `${randomText(rand, 100000, "ab")}\n${randomText(rand, 100000, "ab")}`,
        `${randomText(rand, 50000)}\n${randomText(rand, 50000)}`,
        `${randomText(rand, 20000)}${shared}${randomText(rand, 20000)}\n${randomText(rand, 10000)}${shared}${randomText(rand, 30000)}`,
        `${"a".repeat(100000)}\n${"a".repeat(99999)}`,
        `${"abc".repeat(10000)}\n${"bca".repeat(10000)}`,
        `${randomText(rand, 30000, "abcd")}\n${randomText(rand, 30000, "abcd")}`,
      ].map((l) => l + "\n");
    },
  },
  {
    id: "diamond-projects",
    tier: "diamond",
    title: "项目取舍",
    tags: ["图论建模", "最小割", "网络流"],
    statement: `公司有 n 个可选项目，编号 1 到 n。做项目 i 的净收益是 p_i，可能是负数（亏钱，比如基础设施）。
有 m 条依赖关系 a b：要做项目 a，就必须同时做项目 b。依赖会传递，也可能互相依赖。
选出一些项目来做，满足所有依赖，使总净收益最大。可以一个都不做，收益为 0。

输入：第一行 n m（1 ≤ n ≤ 1000，0 ≤ m ≤ 20000）；第二行 n 个整数 p_1…p_n（|p_i| ≤ 10^9）；
接下来 m 行，每行两个整数 a b（1 ≤ a, b ≤ n）。

输出：最大的总净收益。注意答案可能超过 32 位整数的范围。`,
    sample: "4 3\n10 -4 -5 3\n1 2\n1 3\n4 3\n",
    solve: (input) => {
      const [n, m, ...rest] = nums(input);
      // 最大权闭合子图：源点连正收益，负收益连汇点，依赖连无穷大；答案 = 正收益之和 − 最小割
      const S = 0;
      const T = n + 1;
      const head = new Array<number>(n + 2).fill(-1);
      const to: number[] = [];
      const cap: number[] = [];
      const nxt: number[] = [];
      const add = (u: number, v: number, c: number) => {
        for (const [a, b, w] of [
          [u, v, c],
          [v, u, 0],
        ]) {
          to.push(b);
          cap.push(w);
          nxt.push(head[a]);
          head[a] = to.length - 1;
        }
      };
      let positive = 0;
      for (let i = 1; i <= n; i++) {
        const p = rest[i - 1];
        if (p > 0) {
          positive += p;
          add(S, i, p);
        } else if (p < 0) add(i, T, -p);
      }
      for (let k = 0; k < m; k++) add(rest[n + 2 * k], rest[n + 2 * k + 1], Infinity);

      // Dinic
      const level = new Int32Array(n + 2);
      const iter = new Array<number>(n + 2);
      const bfs = () => {
        level.fill(-1);
        level[S] = 0;
        const queue = [S];
        for (let h = 0; h < queue.length; h++)
          for (let e = head[queue[h]]; e !== -1; e = nxt[e])
            if (cap[e] > 0 && level[to[e]] < 0) {
              level[to[e]] = level[queue[h]] + 1;
              queue.push(to[e]);
            }
        return level[T] >= 0;
      };
      const dfs = (v: number, f: number): number => {
        if (v === T) return f;
        for (; iter[v] !== -1; iter[v] = nxt[iter[v]]) {
          const e = iter[v];
          if (cap[e] > 0 && level[to[e]] === level[v] + 1) {
            const d = dfs(to[e], Math.min(f, cap[e]));
            if (d > 0) {
              cap[e] -= d;
              cap[e ^ 1] += d;
              return d;
            }
          }
        }
        return 0;
      };
      let flow = 0;
      while (bfs()) {
        for (let v = 0; v <= T; v++) iter[v] = head[v];
        for (let f = dfs(S, Infinity); f > 0; f = dfs(S, Infinity)) flow += f;
      }
      return String(positive - flow);
    },
    inputs: (rand) => {
      const build = (n: number, profit: () => number, deps: Array<[number, number]>) =>
        `${n} ${deps.length}\n${Array.from({ length: n }, profit).join(" ")}\n${deps.map(([a, b]) => `${a} ${b}`).join("\n")}`;
      const randomDeps = (n: number, m: number) =>
        Array.from({ length: m }, (): [number, number] => [int(rand, 1, n), int(rand, 1, n)]);
      // 经典结构：前一半是产品（赚钱），后一半是工具（花钱），每个产品依赖几个工具
      const bipartite = (half: number, per: number, cost: number) => {
        const deps: Array<[number, number]> = [];
        for (let a = 1; a <= half; a++) for (let k = 0; k < per; k++) deps.push([a, half + int(rand, 1, half)]);
        let i = 0;
        return build(2 * half, () => (++i <= half ? int(rand, 1, 1e9) : -int(rand, 1, cost)), deps);
      };
      return [
        "1 0\n5",
        "1 0\n-5",
        "2 1\n5 -3\n1 2",
        "2 1\n3 -5\n1 2",
        "3 3\n4 4 -7\n1 3\n2 3\n3 1",
        build(1000, () => int(rand, 1, 1e9), []),
        build(12, () => int(rand, -20, 20), randomDeps(12, 15)),
        bipartite(500, 3, 1e9),
        bipartite(400, 8, 2e8),
        build(1000, () => int(rand, -1e9, 1e9), randomDeps(1000, 1500)),
        build(1000, () => int(rand, -1e9, 1e9) * (rand() < 0.5 ? 1 : 0), randomDeps(1000, 20000)),
      ].map((l) => l + "\n");
    },
  },
  {
    id: "diamond-recurrence",
    tier: "diamond",
    title: "递推数列求和",
    tags: ["矩阵快速幂", "取模", "大整数"],
    statement: `数列 a 的前 k 项 a_1…a_k 已知；从第 k+1 项起，a_i = c_1·a_(i−1) + c_2·a_(i−2) + … + c_k·a_(i−k)。
求前 n 项之和 S(n) = a_1 + a_2 + … + a_n 除以 1000000007 的余数。

输入：第一行 k n（1 ≤ k ≤ 20，1 ≤ n ≤ 10^18）；第二行 k 个整数 c_1…c_k；第三行 k 个整数 a_1…a_k。
c 和 a 都在 0 到 10^9 之间。

输出：S(n) mod 1000000007。注意 n 可能超过 2^53，两个余数相乘可能超过 2^53。`,
    sample: "2 10\n1 1\n1 1\n",
    solve: (input) => {
      const ls = lines(input);
      const [kStr, nStr] = ls[0].trim().split(/\s+/);
      const k = Number(kStr);
      const n = BigInt(nStr);
      const c = nums(ls[1]).map((x) => x % P);
      const a = nums(ls[2]).map((x) => x % P);
      if (n <= BigInt(k)) return String(a.slice(0, Number(n)).reduce((s, x) => (s + x) % P, 0));

      // 状态 [a_i, a_(i−1), …, a_(i−k+1), S(i)]，一次转移得到 i+1
      const size = k + 1;
      const M = Array.from({ length: size }, () => new Array<number>(size).fill(0));
      for (let j = 0; j < k; j++) M[0][j] = M[k][j] = c[j];
      for (let r = 1; r < k; r++) M[r][r - 1] = 1;
      M[k][k] = 1;
      const mul = (X: number[][], Y: number[][]) =>
        X.map((row) =>
          Y[0].map((_, j) => {
            let s = 0;
            for (let t = 0; t < size; t++) if (row[t] && Y[t][j]) s = (s + mulmod(row[t], Y[t][j])) % P;
            return s;
          }),
        );
      let R = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j): number => (i === j ? 1 : 0)));
      let B = M;
      for (let e = n - BigInt(k); e > ZERO; e >>= ONE) {
        if ((e & ONE) === ONE) R = mul(R, B);
        B = mul(B, B);
      }
      const state = [...a.slice().reverse(), a.reduce((s, x) => (s + x) % P, 0)];
      return String(state.reduce((s, x, j) => (s + mulmod(R[k][j], x)) % P, 0));
    },
    inputs: (rand) => {
      const case_ = (k: number, n: bigint | number, c: number[], a: number[]) =>
        `${k} ${n}\n${c.join(" ")}\n${a.join(" ")}`;
      const vec = (k: number, max: number) => Array.from({ length: k }, () => int(rand, 0, max));
      const bigN = () => BigInt(String(int(rand, 1, 9)) + Array.from({ length: 17 }, () => int(rand, 0, 9)).join(""));
      return [
        case_(1, 1, [1], [7]),
        case_(1, E18, [1], [1]),
        case_(1, E18, [2], [1]),
        case_(2, E18, [1, 1], [1, 1]),
        case_(5, 3, [1, 2, 3, 4, 5], [10, 20, 30, 40, 50]),
        case_(3, 100, [0, 0, 0], [5, 6, 7]),
        case_(
          20,
          E18,
          vec(20, 1e9).map(() => 1e9),
          vec(20, 1e9).map(() => 1e9),
        ),
        case_(20, bigN(), vec(20, 1e9), vec(20, 1e9)),
        case_(13, bigN(), vec(13, 1e9), vec(13, 1e9)),
        case_(20, 21, vec(20, 1e9), vec(20, 1e9)),
      ].map((l) => l + "\n");
    },
  },
];
