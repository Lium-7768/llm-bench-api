import type { ArenaTier } from "../../types";

/**
 * 前端赛道的逻辑题：模型实现一个 JS 函数，交给 Judge0 的 Node 运行。
 * 提交的程序 = 前置代码（读输入、静音 console、需要时装假时钟）+ 模型的代码 + 测试脚本（隐藏）。
 * 期望输出不手写：服务端用同样的拼法把参考实现放进 node:vm 跑一遍得到（见 expected.ts）。
 */

export interface LogicProblem {
  id: string;
  tier: ArenaTier;
  kind: "function";
  title: string;
  tags: string[];
  /** 要实现的函数名，写进提示 */
  name: string;
  statement: string;
  /** 是否装假时钟（setTimeout、Date.now 等由测试控制） */
  clock?: boolean;
  /** 测试脚本：定义 async function __arena_main(input)，用 __arena_print 输出 */
  harness: string;
  /** 每组测试的输入（JSON） */
  cases: unknown[];
  /** 参考实现，只用来生成期望输出 */
  reference: string;
}

/** 读输入、收集输出；模型代码里的 console.log 被静音，避免干扰判题 */
export const PRELUDE = String.raw`
const __arena_raw = typeof __arena_input === "string" ? __arena_input : require("fs").readFileSync(0, "utf8");
const __arena_log = console.log.bind(console);
const __arena_out = [];
const __arena_show = (v) => {
  if (v === undefined) return "undefined";
  if (typeof v === "number" && Number.isNaN(v)) return "NaN";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
};
const __arena_print = (...v) => __arena_out.push(v.map(__arena_show).join(" "));
const __arena_flush = async () => { for (let i = 0; i < 100; i++) await null; };
console.log = console.info = console.warn = console.error = console.debug = () => {};
`;

/** 假时钟：setTimeout / setInterval / Date.now / performance.now 都由测试推进 */
export const CLOCK = String.raw`
const __arena_clock = (() => {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const add = (fn, ms, args, every) => {
    const id = ++seq;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { id, at: now + delay, fn, args, every: every ? Math.max(1, delay) : 0 });
    return id;
  };
  globalThis.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  globalThis.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  globalThis.clearTimeout = globalThis.clearInterval = (id) => { timers.delete(id); };
  Date.now = () => now;
  Object.defineProperty(globalThis, "performance", { value: { now: () => now }, configurable: true, writable: true });
  return {
    now: () => now,
    /** 推进到时刻 t：按到期时间、再按创建顺序依次触发 */
    async advanceTo(t) {
      await __arena_flush();
      for (;;) {
        let next = null;
        for (const timer of timers.values())
          if (timer.at <= t && (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) next = timer;
        if (!next) break;
        now = next.at;
        if (next.every) next.at += next.every;
        else timers.delete(next.id);
        if (typeof next.fn === "function") next.fn(...next.args);
        await __arena_flush();
      }
      now = Math.max(now, t);
      await __arena_flush();
    },
  };
})();
`;

export const EPILOGUE = String.raw`
;(async () => {
  try {
    await __arena_main(JSON.parse(__arena_raw));
  } catch (e) {
    __arena_print("THROWN", String(e && e.message));
  }
  __arena_log(__arena_out.join("\n"));
})();
`;

/** 拼出交给 Judge0 的程序。模型可能写了 export，去掉，按普通脚本运行 */
export function assemble(p: LogicProblem, code: string): string {
  const body = code
    .replace(/^\s*export\s+default\s+(?=(async\s+)?function|class)/gm, "")
    .replace(/^\s*export\s+/gm, "");
  return [PRELUDE, p.clock ? CLOCK : "", body, ";", p.harness, EPILOGUE].join("\n");
}

export const LOGIC_PROBLEMS: LogicProblem[] = [
  // ---------------------------------------------------------------- 青铜
  {
    id: "fe-bronze-classnames",
    tier: "bronze",
    kind: "function",
    title: "拼 class 名",
    tags: ["工具函数", "递归"],
    name: "classNames",
    statement: `实现函数 classNames(...args)，把参数拼成 HTML 的 class 字符串（类似常用的 clsx 库）。规则：
- 非空字符串：原样加入，不拆分、不去空格；
- 数字：不是 0、并且是有限数时，转成字符串加入（0、NaN、Infinity 都忽略）；
- 数组：按顺序递归处理里面的每一项，可以多层嵌套；
- 普通对象：按 Object.keys 的顺序，值为真值的键名加入（只看对象自身的键）；
- 其他值（null、undefined、true、false、函数、Symbol）忽略；
- 用一个空格把所有项连起来；什么都没有时返回空字符串；重复的名字保留。

例：classNames("a", { b: true, c: false }, ["d", 0, ["e"]]) 返回 "a b d e"。`,
    harness: String.raw`
const __cases = {
  basic: () => classNames("a", "b"),
  falsy: () => classNames("a", null, undefined, false, true, "", 0, "b"),
  numbers: () => classNames(1, 0, -2, 3.5, NaN, Infinity, -Infinity, "x"),
  object: () => classNames({ a: true, b: false, c: 1, d: 0, e: "yes", f: "", g: null, h: [] }),
  nested: () => classNames("a", ["b", ["c", { d: true, e: false }], [[["f"]]]], { g: [] }),
  order: () => classNames({ z: 1, 10: 1, y: 1, 2: 1 }),
  dupes: () => classNames("a", "a", ["a"], { a: true }),
  spaces: () => classNames(" a ", "b  c"),
  empty: () => classNames(),
  emptyNested: () => classNames([], {}, [[]], [null, [false]]),
  ignored: () => classNames(() => "x", "y", Symbol("s"), true),
  own: () => {
    const o = Object.create({ inherited: true });
    o.own = true;
    return classNames(o);
  },
  deep: () => {
    let x = ["leaf"];
    for (let i = 0; i < 2000; i++) x = [x, i % 500 ? null : "n" + i];
    return classNames(x);
  },
  many: () => classNames(Array.from({ length: 3000 }, (_, i) => (i % 3 ? ["c" + i] : { ["k" + i]: i % 2 }))).length,
};
async function __arena_main(names) {
  for (const name of names) {
    let r;
    try {
      r = __cases[name]();
    } catch (e) {
      r = "THROWN";
    }
    __arena_print(name, typeof r, r);
  }
}`,
    cases: [
      ["basic", "falsy"],
      ["numbers"],
      ["object", "order"],
      ["nested", "emptyNested"],
      ["dupes", "spaces", "empty"],
      ["ignored", "own"],
      ["deep", "many"],
    ],
    reference: String.raw`
function classNames(...args) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") { if (v) out.push(v); }
    else if (typeof v === "number") { if (v !== 0 && Number.isFinite(v)) out.push(String(v)); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") { for (const k of Object.keys(v)) if (v[k]) out.push(k); }
  };
  args.forEach(walk);
  return out.join(" ");
}`,
  },

  // ---------------------------------------------------------------- 白银
  {
    id: "fe-silver-debounce",
    tier: "silver",
    kind: "function",
    title: "防抖",
    tags: ["定时器", "闭包"],
    name: "debounce",
    clock: true,
    statement: `实现 debounce(fn, wait, options)，返回防抖后的函数 debounced。options 可省略，默认 { leading: false, trailing: true }。

把「最后一次调用之后 wait 毫秒内没有新调用」称为一轮结束。规则：
- 每次调用 debounced 都会把计时重新开始，从这次调用起算 wait 毫秒；
- leading 为 true：调用发生时如果没有正在进行的一轮（第一次调用，或上一轮已经结束），立即调用 fn；
- trailing 为 true：一轮结束时，如果这一轮里有「没被立即调用消耗掉的调用」，就用其中最后一次的参数和 this 调用 fn。
  所以 leading 和 trailing 都为 true 时，一轮里只调用过一次的话，只在开头调用 fn 一次；
- debounced 的返回值是最近一次 fn 调用的返回值（还没调用过时是 undefined）；
- debounced.cancel()：结束当前这一轮，丢掉待执行的调用，不调用 fn；
- debounced.flush()：如果有待执行的尾部调用，立即执行它并结束这一轮，返回 fn 的返回值；否则返回最近一次 fn 的返回值；
- 计时恰好到期的那一刻有新调用时，先结束旧的一轮，再处理新调用。

用 setTimeout / clearTimeout 计时（测试会控制时间）。`,
    harness: String.raw`
async function __arena_main(c) {
  const calls = [];
  const fn = function (...args) {
    calls.push(["fn@" + __arena_clock.now(), args, (this && this.tag) || null]);
    return (args[0] || 0) * 10;
  };
  const d = c.options === undefined ? debounce(fn, c.wait) : debounce(fn, c.wait, c.options);
  const ctx = { tag: "ctx" };
  for (const step of c.steps) {
    await __arena_clock.advanceTo(step.t);
    if (step.call) __arena_print("call@" + step.t, step.self ? d.apply(ctx, step.call) : d(...step.call));
    if (step.cancel) { d.cancel(); __arena_print("cancel@" + step.t); }
    if (step.flush) __arena_print("flush@" + step.t, d.flush());
  }
  await __arena_clock.advanceTo(c.end);
  for (const [at, args, self] of calls) __arena_print(at, args, self);
}`,
    cases: [
      {
        wait: 100,
        steps: [
          { t: 0, call: [1] },
          { t: 30, call: [2] },
          { t: 60, call: [3] },
          { t: 200, call: [4] },
        ],
        end: 500,
      },
      {
        wait: 100,
        steps: [
          { t: 0, call: [1] },
          { t: 150, call: [2] },
          { t: 260, call: [3] },
          { t: 400, call: [4] },
        ],
        end: 800,
      },
      {
        wait: 100,
        options: { leading: true, trailing: false },
        steps: [
          { t: 0, call: [1] },
          { t: 50, call: [2] },
          { t: 120, call: [3] },
          { t: 260, call: [4] },
          { t: 300, call: [5] },
        ],
        end: 600,
      },
      {
        wait: 100,
        options: { leading: true, trailing: true },
        steps: [
          { t: 0, call: [1] },
          { t: 300, call: [2] },
          { t: 340, call: [3] },
          { t: 380, call: [4] },
        ],
        end: 900,
      },
      {
        wait: 100,
        steps: [
          { t: 0, call: [1] },
          { t: 50, call: [2] },
          { t: 80, cancel: true },
          { t: 300, call: [3] },
          { t: 350, cancel: true },
          { t: 360, cancel: true },
        ],
        end: 800,
      },
      {
        wait: 100,
        steps: [
          { t: 0, call: [1] },
          { t: 20, call: [2] },
          { t: 50, flush: true },
          { t: 60, flush: true },
          { t: 400, call: [5] },
          { t: 401, call: [6] },
        ],
        end: 900,
      },
      {
        wait: 100,
        steps: [
          { t: 0, call: [1], self: true },
          { t: 10, call: [2, "x"], self: true },
        ],
        end: 300,
      },
      {
        wait: 100,
        steps: [
          { t: 0, call: [1] },
          { t: 100, call: [2] },
          { t: 200, call: [3] },
        ],
        end: 500,
      },
      {
        wait: 100,
        options: { leading: true },
        steps: [
          { t: 0, call: [1] },
          { t: 100, call: [2] },
          { t: 150, call: [3] },
          { t: 250, flush: true },
        ],
        end: 600,
      },
    ],
    reference: String.raw`
function debounce(fn, wait, options = {}) {
  const leading = !!options.leading;
  const trailing = options.trailing === undefined ? true : !!options.trailing;
  let timer = null;
  let pendingArgs = null;
  let pendingThis = null;
  let result;
  const end = () => {
    timer = null;
    if (trailing && pendingArgs) {
      const a = pendingArgs;
      const t = pendingThis;
      pendingArgs = pendingThis = null;
      result = fn.apply(t, a);
    }
    pendingArgs = pendingThis = null;
  };
  function debounced(...args) {
    const fresh = timer === null;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(end, wait);
    if (fresh && leading) {
      pendingArgs = pendingThis = null;
      result = fn.apply(this, args);
    } else {
      pendingArgs = args;
      pendingThis = this;
    }
    return result;
  }
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingArgs = pendingThis = null;
  };
  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      end();
    }
    return result;
  };
  return debounced;
}`,
  },

  // ---------------------------------------------------------------- 黄金
  {
    id: "fe-gold-deepequal",
    tier: "gold",
    kind: "function",
    title: "深度相等",
    tags: ["递归", "循环引用", "内置对象"],
    name: "deepEqual",
    statement: `实现 deepEqual(a, b)，判断两个值是否「深度相等」，返回 true 或 false。规则：
- 基本类型：用 SameValueZero 比较，即 NaN 等于 NaN，+0 等于 -0，其余按 ===；
- 函数、Symbol：只有同一个才相等；
- 两个对象的原型（Object.getPrototypeOf）不同就不相等，所以数组不等于普通对象，Object.create(null) 创建的对象不等于 {}；
- 数组和普通对象：比较自身可枚举的字符串键（Object.keys）。键的集合必须相同（顺序无关），对应的值递归深度相等。
  因此稀疏数组的空位和 undefined 不相等，{ a: 1 } 和 { a: 1, b: undefined } 不相等；Symbol 键忽略；
- Date：时间戳相同就相等（两个无效日期也相等）；
- RegExp：source 和 flags 都相同；
- Map：大小相同，并且 a 的每个键在 b 里也存在（键按 SameValueZero，对象键要是同一个对象），对应的值深度相等；
- Set：大小相同，并且元素能一一对应：基本类型按 SameValueZero，对象元素要在另一边找到一个深度相等、且还没被配对的元素；
- 要能处理循环引用（对象直接或间接引用自己），不能死循环或栈溢出。`,
    harness: String.raw`
const __sym = Symbol("k");
const __fn = () => 1;
class __Point { constructor(x) { this.x = x; } }
const __pairs = {
  prim1: () => [1, 1], prim2: () => ["1", 1], prim3: () => [NaN, NaN], prim4: () => [0, -0], prim5: () => [null, undefined], prim6: () => [null, null],
  arr1: () => [[1, [2, 3]], [1, [2, 3]]], arr2: () => [[1, 2], [2, 1]], arr3: () => [[, 1], [undefined, 1]], arr4: () => [[1], { 0: 1 }], arr5: () => [[], []],
  obj1: () => [{ a: 1, b: 2 }, { b: 2, a: 1 }], obj2: () => [{ a: 1 }, { a: 1, b: undefined }], obj3: () => [{ a: { b: { c: [1, { d: 2 }] } } }, { a: { b: { c: [1, { d: 2 }] } } }],
  obj4: () => [{ a: { b: { c: [1, { d: 2 }] } } }, { a: { b: { c: [1, { d: 3 }] } } }], obj5: () => [{ [__sym]: 1, a: 1 }, { a: 1 }],
  proto1: () => { const o = Object.create(null); o.a = 1; return [o, { a: 1 }]; }, proto2: () => [new __Point(1), { x: 1 }], proto3: () => [new __Point(1), new __Point(1)],
  fn1: () => [__fn, __fn], fn2: () => [() => 1, () => 1], fn3: () => [{ f: __fn }, { f: __fn }],
  date1: () => [new Date(5), new Date(5)], date2: () => [new Date(5), new Date(6)], date3: () => [new Date(NaN), new Date(NaN)], date4: () => [new Date(0), {}],
  re1: () => [/a+/g, /a+/g], re2: () => [/a/g, /a/i], re3: () => [/a/, "/a/"],
  map1: () => [new Map([[1, { x: 1 }], ["k", [2]]]), new Map([["k", [2]], [1, { x: 1 }]])], map2: () => [new Map([[1, { x: 1 }]]), new Map([[1, { x: 2 }]])],
  map3: () => [new Map([[{}, 1]]), new Map([[{}, 1]])], map4: () => [new Map([[NaN, 1]]), new Map([[NaN, 1]])], map5: () => [new Map([[1, 1]]), new Map([[1, 1], [2, 2]])],
  set1: () => [new Set([1, 2, NaN]), new Set([NaN, 2, 1])], set2: () => [new Set([{ a: 1 }, { b: [2] }]), new Set([{ b: [2] }, { a: 1 }])],
  set3: () => [new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }])], set4: () => [new Set([1]), new Set([1, 2])], set5: () => [new Set([1]), [1]],
  cyc1: () => { const a = { x: 1 }; a.self = a; const b = { x: 1 }; b.self = b; return [a, b]; },
  cyc2: () => { const a = { x: 1 }; a.self = a; const b = { x: 1, self: { x: 1 } }; return [a, b]; },
  cyc3: () => { const a = [1]; a.push(a); const b = [1]; b.push(b); return [a, b]; },
  cyc4: () => { const a = { n: 1 }; const b = { n: 2, a }; a.b = b; const c = { n: 1 }; const d = { n: 2, a: c }; c.b = d; return [a, c]; },
  cyc5: () => { const a = { n: 1 }; const b = { n: 2, a }; a.b = b; const c = { n: 1 }; const d = { n: 3, a: c }; c.b = d; return [a, c]; },
  big1: () => { const mk = () => Array.from({ length: 5000 }, (_, i) => ({ i, tags: ["t" + (i % 7)], m: new Map([[i, i]]) })); return [mk(), mk()]; },
  big2: () => { const mk = (last) => Array.from({ length: 5000 }, (_, i) => ({ i, v: i === 4999 ? last : 0 })); return [mk(1), mk(2)]; },
  deepChain: () => { const mk = () => { let x = { end: true }; for (let i = 0; i < 1500; i++) x = { next: x }; return x; }; return [mk(), mk()]; },
};
async function __arena_main(names) {
  for (const name of names) {
    let r;
    try {
      const [a, b] = __pairs[name]();
      r = deepEqual(a, b);
    } catch (e) {
      r = "THROWN";
    }
    __arena_print(name, r);
  }
}`,
    cases: [
      ["prim1", "prim2", "prim3", "prim4", "prim5", "prim6"],
      ["arr1", "arr2", "arr3", "arr4", "arr5"],
      ["obj1", "obj2", "obj3", "obj4", "obj5"],
      ["proto1", "proto2", "proto3", "fn1", "fn2", "fn3"],
      ["date1", "date2", "date3", "date4", "re1", "re2", "re3"],
      ["map1", "map2", "map3", "map4", "map5"],
      ["set1", "set2", "set3", "set4", "set5"],
      ["cyc1", "cyc2", "cyc3", "cyc4", "cyc5"],
      ["big1", "big2", "deepChain"],
    ],
    reference: String.raw`
function deepEqual(a, b) {
  const onStack = new Map();
  const same = (x, y) => x === y || (x !== x && y !== y);
  const eq = (x, y) => {
    if (same(x, y)) return true;
    if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false;
    let seen = onStack.get(x);
    if (seen && seen.has(y)) return true;
    if (!seen) onStack.set(x, (seen = new Set()));
    seen.add(y);
    const result = compare(x, y);
    if (!result) seen.delete(y);
    return result;
  };
  const compare = (x, y) => {
    if (x instanceof Date) return same(x.getTime(), y.getTime());
    if (x instanceof RegExp) return x.source === y.source && x.flags === y.flags;
    if (x instanceof Map) {
      if (x.size !== y.size) return false;
      for (const [k, v] of x) if (!y.has(k) || !eq(v, y.get(k))) return false;
      return true;
    }
    if (x instanceof Set) {
      if (x.size !== y.size) return false;
      const pool = [...y];
      for (const v of x) {
        let i = pool.findIndex((w) => same(v, w));
        if (i < 0 && typeof v === "object" && v !== null) i = pool.findIndex((w) => eq(v, w));
        if (i < 0) return false;
        pool.splice(i, 1);
      }
      return true;
    }
    const kx = Object.keys(x);
    const ky = Object.keys(y);
    if (kx.length !== ky.length) return false;
    for (const k of kx) if (!Object.prototype.hasOwnProperty.call(y, k) || !eq(x[k], y[k])) return false;
    return true;
  };
  return eq(a, b);
}`,
  },

  // ---------------------------------------------------------------- 白金
  {
    id: "fe-platinum-pool",
    tier: "platinum",
    kind: "function",
    title: "并发请求池",
    tags: ["Promise", "并发控制"],
    name: "runPool",
    clock: true,
    statement: `实现 runPool(tasks, limit)：tasks 是一组函数，每个调用后返回 Promise（也可能直接返回普通值，或者同步抛错）；limit 是正整数。
按数组顺序启动任务，同时在进行中的不超过 limit 个，返回一个 Promise：
- 一开始立即启动前 limit 个；每当有任务成功结束，立即按顺序启动下一个还没启动的任务；
- 全部成功：以结果数组 resolve，结果按 tasks 的原顺序排列，和完成先后无关；
- 任何一个任务失败（返回的 Promise 被拒绝，或调用任务时同步抛错）：返回的 Promise 立即以这个错误 reject，并且之后不再启动任何新任务（已经在进行的不用管）；
- 任务直接返回普通值时，当作立即成功；
- tasks 为空数组时，resolve 为 []。`,
    harness: String.raw`
async function __arena_main(c) {
  let running = 0;
  let peak = 0;
  const starts = [];
  const tasks = c.tasks.map((spec, i) => () => {
    starts.push(i + "@" + __arena_clock.now());
    if (spec.sync) throw new Error("sync" + i);
    if (spec.ms === undefined) return spec.value;
    running++;
    peak = Math.max(peak, running);
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        running--;
        if (spec.fail) reject(new Error("fail" + i));
        else resolve(spec.value === undefined ? i * 10 : spec.value);
      }, spec.ms),
    );
  });
  let settled = ["pending"];
  let p;
  try {
    p = runPool(tasks, c.limit);
  } catch (e) {
    settled = ["sync-throw", String(e && e.message)];
  }
  if (p && typeof p.then === "function")
    p.then(
      (v) => { settled = ["ok@" + __arena_clock.now(), v]; },
      (e) => { settled = ["err@" + __arena_clock.now(), String(e && e.message)]; },
    );
  await __arena_clock.advanceTo(c.end);
  __arena_print("starts", starts);
  __arena_print("peak", peak);
  __arena_print("settled", settled);
}`,
    cases: [
      { limit: 2, tasks: [{ ms: 100 }, { ms: 50 }, { ms: 30 }, { ms: 80 }], end: 1000 },
      { limit: 1, tasks: [{ ms: 30 }, { ms: 10 }, { ms: 20 }], end: 1000 },
      { limit: 10, tasks: [{ ms: 30 }, { ms: 10 }, { ms: 20 }], end: 1000 },
      { limit: 3, tasks: [], end: 10 },
      { limit: 2, tasks: [{ ms: 100 }, { ms: 50, fail: true }, { ms: 30 }, { ms: 30 }], end: 1000 },
      { limit: 2, tasks: [{ ms: 50 }, { ms: 50 }, { sync: true }, { ms: 40 }], end: 1000 },
      { limit: 2, tasks: [{ value: "a" }, { value: "b" }, { ms: 10 }, { value: "c" }], end: 1000 },
      {
        limit: 3,
        tasks: [{ ms: 90, value: "slow" }, { ms: 10, value: "fast" }, { ms: 50 }, { ms: 5 }, { ms: 5 }, { ms: 200 }],
        end: 1000,
      },
      {
        limit: 7,
        tasks: Array.from({ length: 300 }, (_, i) => ({ ms: ((i * 37) % 91) + 1 })),
        end: 100000,
      },
      { limit: 2, tasks: [{ ms: 10, fail: true }, { ms: 5, fail: true }, { ms: 50 }], end: 1000 },
    ],
    reference: String.raw`
function runPool(tasks, limit) {
  return new Promise((resolve, reject) => {
    const results = new Array(tasks.length);
    let next = 0;
    let done = 0;
    let failed = false;
    if (tasks.length === 0) return resolve([]);
    const launch = () => {
      if (failed || next >= tasks.length) return;
      const i = next++;
      let p;
      try {
        p = Promise.resolve(tasks[i]());
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        (v) => {
          if (failed) return;
          results[i] = v;
          if (++done === tasks.length) resolve(results);
          else launch();
        },
        (e) => {
          if (!failed) {
            failed = true;
            reject(e);
          }
        },
      );
    };
    for (let k = 0; k < Math.min(limit, tasks.length); k++) launch();
  });
}`,
  },

  // ---------------------------------------------------------------- 钻石
  {
    id: "fe-diamond-selector",
    tier: "diamond",
    kind: "function",
    title: "CSS 选择器引擎",
    tags: ["解析", "CSS 选择器", "树"],
    name: "select",
    statement: `实现 select(root, selector)：在一棵用普通对象表示的树里，按 CSS 选择器找出所有匹配的节点。
节点的形状：{ tag: "div", id?: "main", class?: "a b", attrs?: { "data-x": "1" }, children?: [节点...] }。tag 都是小写。

返回所有匹配的节点（就是树里的那些对象），包括 root 本身，按文档顺序（先序遍历）排列，不重复。要支持：
- 类型选择器 div，通配 *；
- #id 看节点的 id 字段，.name 看 class 字段（空格分隔），可以连写：div#main.a.b；
- 属性选择器只看 attrs 字段：[name]、[name=value]、[name^=value]、[name$=value]、[name*=value]，值可以加单引号或双引号；
- 伪类：:first-child、:last-child、:nth-child(参数)，参数可以是 odd、even、整数、或 an+b 形式（如 2n+1、-n+3、3n，可能带空格）；
  :not(...)，括号里是一个不含组合符的复合选择器（如 :not(.a)、:not(p[data-x])），也可能再嵌套 :not；
- 组合符：后代（空格）、子（>）、相邻兄弟（+）、通用兄弟（~），组合符两边的空格可有可无；
- 逗号分隔的选择器列表，取并集。
兄弟和 :nth-child 的位置都按父节点 children 里的顺序算，root 没有父节点，也没有兄弟（:first-child 对 root 不成立）。`,
    harness: String.raw`
let __n = 0;
const __el = (tag, props, ...children) => Object.assign({ tag, key: tag + "#" + __n++ }, props || {}, children.length ? { children } : {});
const __doc = () => {
  __n = 0;
  return __el("html", null,
    __el("head", null, __el("title", null), __el("meta", { attrs: { charset: "utf-8" } })),
    __el("body", { class: "page dark" },
      __el("header", { id: "top", class: "bar" }, __el("h1", { class: "title big" }), __el("nav", null,
        __el("a", { class: "link active", attrs: { href: "/home", "data-x": "1" } }),
        __el("a", { class: "link", attrs: { href: "/about", target: "_blank" } }),
        __el("a", { class: "link", attrs: { href: "https://x.com/a b", "data-x": "two words" } }))),
      __el("main", { id: "main" },
        __el("section", { class: "card" }, __el("h2", null), __el("p", { class: "lead" }), __el("p", null), __el("p", { class: "note" })),
        __el("section", { class: "card wide" }, __el("p", { class: "lead" }), __el("ul", null,
          __el("li", null), __el("li", { class: "on" }), __el("li", null), __el("li", { class: "on" }), __el("li", null), __el("li", null), __el("li", { class: "on last" }))),
        __el("div", { class: "card" }, __el("div", { class: "inner" }, __el("div", { class: "inner" }, __el("span", { attrs: { lang: "en-US" } }))))),
      __el("footer", { class: "bar" }, __el("p", { class: "note" }), __el("p", null))));
};
const __big = () => {
  __n = 0;
  const mk = (depth, i) => depth === 0 ? __el("span", { class: i % 3 ? "x" : "x y", attrs: { "data-i": String(i) } })
    : __el(depth % 2 ? "div" : "section", { class: "d" + depth }, ...Array.from({ length: 4 }, (_, j) => mk(depth - 1, i * 4 + j)));
  return mk(6, 0);
};
async function __arena_main(c) {
  const root = c.tree === "big" ? __big() : __doc();
  for (const s of c.selectors) {
    let r;
    try {
      const found = select(root, s);
      r = Array.isArray(found) ? (c.tree === "big" ? found.length + ":" + found.slice(0, 5).map((n) => n && n.key).join(",") : found.map((n) => n && n.key).join(",")) : "not-array";
    } catch (e) {
      r = "THROWN";
    }
    __arena_print(s + " =>", r);
  }
}`,
    cases: [
      { tree: "doc", selectors: ["p", "*.bar", "#main", "a.link.active", "section.card.wide", "html"] },
      { tree: "doc", selectors: ["main p", "body > p", "section > p", "header a", "#main > .card > p.lead"] },
      { tree: "doc", selectors: ["h2 + p", "h2 ~ p", "p + p", ".lead ~ *", "li.on + li"] },
      {
        tree: "doc",
        selectors: [
          "[href]",
          "[href^='https']",
          "a[href$=about]",
          '[data-x="two words"]',
          "[data-x*=wo]",
          "[lang^=en]",
        ],
      },
      {
        tree: "doc",
        selectors: [
          "li:first-child",
          "p:last-child",
          "li:nth-child(2n+1)",
          "li:nth-child(odd)",
          "li:nth-child(even)",
          "li:nth-child(3)",
          "li:nth-child(-n+3)",
          "li:nth-child( 3n )",
        ],
      },
      {
        tree: "doc",
        selectors: [
          "li:not(.on)",
          "p:not(.lead):not(.note)",
          "a:not([data-x])",
          ":not(:not(.inner))",
          "section :not(p)",
        ],
      },
      {
        tree: "doc",
        selectors: [
          "h1, h2",
          "p.note, .lead, p.note",
          "div div span",
          ".card .inner > span",
          "body>main>section+section>ul>li:last-child",
        ],
      },
      {
        tree: "doc",
        selectors: [
          "*:first-child",
          "html:first-child",
          "main~footer",
          "header nav>a:nth-child(2)",
          "  ul   >   li.on  ",
        ],
      },
      {
        tree: "big",
        selectors: [
          "span",
          "div > section > span.y",
          "section span:nth-child(4n+2)",
          "div :not(span)",
          ".d6 .d5 .d1 > .x:not(.y)",
          "[data-i$='7']",
        ],
      },
    ],
    reference: String.raw`
function select(root, selector) {
  const parent = new Map();
  const order = [];
  const walk = (n, p) => { parent.set(n, p); order.push(n); for (const c of n.children || []) walk(c, n); };
  walk(root, null);
  const siblings = (n) => { const p = parent.get(n); return p ? p.children : null; };

  let s, i;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const ident = () => { const m = /^[\w-]+/.exec(s.slice(i)); if (!m) throw new Error("bad selector at " + i); i += m[0].length; return m[0]; };
  const parseCompound = () => {
    const parts = [];
    if (s[i] === "*") { i++; parts.push(() => true); }
    else if (/[\w-]/.test(s[i] || "")) { const t = ident(); parts.push((n) => n.tag === t); }
    for (;;) {
      const ch = s[i];
      if (ch === "#") { i++; const v = ident(); parts.push((n) => n.id === v); }
      else if (ch === ".") { i++; const v = ident(); parts.push((n) => (n.class || "").split(/\s+/).includes(v)); }
      else if (ch === "[") {
        i++; ws(); const name = ident(); ws();
        let op = null, val = null;
        const m = /^([\^$*]?=)/.exec(s.slice(i));
        if (m) {
          op = m[1]; i += op.length; ws();
          if (s[i] === '"' || s[i] === "'") { const q = s[i++]; const j = s.indexOf(q, i); val = s.slice(i, j); i = j + 1; }
          else { const mm = /^[^\]\s]+/.exec(s.slice(i)); val = mm[0]; i += val.length; }
          ws();
        }
        if (s[i] !== "]") throw new Error("bad attr");
        i++;
        parts.push((n) => {
          const attrs = n.attrs || {};
          if (!Object.prototype.hasOwnProperty.call(attrs, name)) return false;
          const a = String(attrs[name]);
          return op === null || (op === "=" ? a === val : op === "^=" ? val !== "" && a.startsWith(val) : op === "$=" ? val !== "" && a.endsWith(val) : val !== "" && a.includes(val));
        });
      } else if (ch === ":") {
        i++; const name = ident();
        if (name === "first-child") parts.push((n) => { const sib = siblings(n); return !!sib && sib[0] === n; });
        else if (name === "last-child") parts.push((n) => { const sib = siblings(n); return !!sib && sib[sib.length - 1] === n; });
        else if (name === "nth-child") {
          i++; const j = s.indexOf(")", i); const arg = s.slice(i, j).replace(/\s+/g, ""); i = j + 1;
          let a = 0, b = 0;
          if (arg === "odd") { a = 2; b = 1; } else if (arg === "even") { a = 2; b = 0; }
          else if (/^[+-]?\d+$/.test(arg)) b = Number(arg);
          else { const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(arg); a = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]); b = m[2] ? Number(m[2]) : 0; }
          parts.push((n) => {
            const sib = siblings(n); if (!sib) return false;
            const pos = sib.indexOf(n) + 1;
            if (a === 0) return pos === b;
            const k = (pos - b) / a;
            return Number.isInteger(k) && k >= 0;
          });
        } else if (name === "not") {
          i++; ws(); const inner = parseCompound(); ws();
          if (s[i] !== ")") throw new Error("bad not"); i++;
          parts.push((n) => !inner(n));
        } else throw new Error("unknown pseudo " + name);
      } else break;
    }
    if (!parts.length) throw new Error("empty compound");
    return (n) => parts.every((f) => f(n));
  };
  const parseComplex = () => {
    const seq = [parseCompound()];
    const combs = [];
    for (;;) {
      const start = i; ws();
      if (i >= s.length || s[i] === ",") break;
      let comb = " ";
      if (s[i] === ">" || s[i] === "+" || s[i] === "~") { comb = s[i++]; ws(); }
      else if (i === start) break;
      combs.push(comb);
      seq.push(parseCompound());
    }
    return { seq, combs };
  };
  const matches = (n, sel, k) => {
    if (!sel.seq[k](n)) return false;
    if (k === 0) return true;
    const comb = sel.combs[k - 1];
    if (comb === ">") { const p = parent.get(n); return !!p && matches(p, sel, k - 1); }
    if (comb === " ") { for (let p = parent.get(n); p; p = parent.get(p)) if (matches(p, sel, k - 1)) return true; return false; }
    const sib = siblings(n); if (!sib) return false;
    const idx = sib.indexOf(n);
    if (comb === "+") return idx > 0 && matches(sib[idx - 1], sel, k - 1);
    for (let j = idx - 1; j >= 0; j--) if (matches(sib[j], sel, k - 1)) return true;
    return false;
  };
  s = selector; i = 0;
  const list = [];
  ws();
  for (;;) {
    list.push(parseComplex());
    ws();
    if (s[i] === ",") { i++; ws(); continue; }
    break;
  }
  return order.filter((n) => list.some((sel) => matches(n, sel, sel.seq.length - 1)));
}`,
  },

  // ---------------------------------------------------------------- 王者
  {
    id: "fe-king-reactive",
    tier: "king",
    kind: "function",
    title: "响应式系统",
    tags: ["Proxy", "依赖收集", "调度"],
    name: "reactive / effect / computed / batch",
    statement: `实现一个迷你响应式系统，提供四个函数：reactive(obj)、effect(fn)、computed(getter)、batch(fn)。

- reactive(obj)：返回 obj 的响应式代理，读写都通过代理进行。对同一个 obj 多次调用返回同一个代理；对代理再调用 reactive 返回它自己。
  读到的属性值是对象（非 null）时，返回那个对象的响应式代理（同一个对象每次读到的是同一个代理）。
- effect(fn)：立即执行一次 fn，并记下这次执行中读取了哪些响应式属性；以后其中任何一个被修改，fn 重新执行。
  每次执行都重新收集依赖：上一次读了、这一次没读的属性，之后再改也不会触发。返回 stop 函数，调用后这个副作用不再执行。
- 「修改」包括：给属性赋值（新值和旧值用 Object.is 判断相等时不算修改）、新增属性、删除已有属性。
  读取一个不存在的属性也算依赖，以后新增它会触发。新增或删除属性还会触发「遍历过这个对象」的副作用（用 Object.keys、for...in、Object.entries 等读过它的键）。
  只需要支持普通对象，不需要支持数组、Map、Set。
- computed(getter)：返回一个对象，读它的 .value 时才调用 getter（惰性），结果缓存；getter 依赖的数据变化后，下次读 .value 才重新计算。
  副作用读了某个 computed 的 .value，就依赖这个 computed：computed 的依赖变化时，这些副作用重新执行（即使算出来的值没变也要执行）。computed 可以依赖别的 computed。
- 调度：一次修改触发多个副作用时，按副作用创建的先后顺序执行，每个只执行一次。
  副作用执行过程中（包括 effect 刚创建时的首次执行）又修改了数据：不会触发正在执行的它自己；被触发的其他副作用不会插进来立即执行，
  而是这一批里还没执行到的照常执行一次，已经执行过的（或首次执行时触发的）排到当前这一批之后再执行，同样按创建顺序。
- batch(fn)：执行 fn，期间的修改先不触发副作用；fn 结束后，把被触发的副作用按创建顺序各执行一次。batch 可以嵌套，最外层结束时才执行。
- 不需要支持在副作用里再创建副作用。`,
    harness: String.raw`
const __cases = {
  basic(log) {
    const s = reactive({ a: 1, b: 2 });
    effect(() => log("e", s.a));
    s.a = 2; s.b = 3; s.a = 2; s.a = 5;
  },
  branch(log) {
    const s = reactive({ ok: true, a: 1, b: 10 });
    effect(() => log("v", s.ok ? s.a : s.b));
    s.b = 11; s.ok = false; s.a = 2; s.b = 12; s.ok = true; s.b = 13; s.a = 3;
  },
  nested(log) {
    const raw = { user: { name: "x" } };
    const s = reactive(raw);
    effect(() => log("name", s.user.name));
    s.user.name = "y";
    s.user = { name: "z" };
    s.user.name = "w";
    log("same", reactive(raw) === s, reactive(s) === s, s.user === s.user);
  },
  keys(log) {
    const s = reactive({});
    effect(() => log("keys", Object.keys(s).join("|")));
    effect(() => log("c", s.c));
    s.a = 1; s.c = 3; s.a = 2; delete s.a; delete s.zz; s.c = 3;
    effect(() => { let n = 0; for (const k in s) n++; log("forin", n); });
    s.d = 4;
  },
  computed(log) {
    const s = reactive({ a: 1 });
    let calls = 0;
    const c = computed(() => { calls++; return s.a * 2; });
    log("calls", calls);
    log("v", c.value, c.value, "calls", calls);
    s.a = 5;
    log("calls", calls);
    log("v", c.value, "calls", calls);
    effect(() => log("eff", c.value));
    s.a = 6; s.a = 6;
    const parity = computed(() => s.a % 2);
    effect(() => log("parity", parity.value));
    s.a = 8;
    const quad = computed(() => c.value * 2);
    effect(() => log("quad", quad.value));
    s.a = 1;
  },
  order(log) {
    const s = reactive({ x: 0, y: 0 });
    effect(() => log("e1", s.x));
    effect(() => log("e2", s.x, s.y));
    effect(() => log("e3", s.y));
    s.x++; s.y++;
  },
  batch(log) {
    const s = reactive({ a: 0, b: 0 });
    effect(() => log("sum", s.a + s.b));
    effect(() => log("b", s.b));
    batch(() => { s.a = 1; s.b = 2; batch(() => { s.a = 3; }); log("inner done"); });
    batch(() => { s.a = 4; s.a = 3; });
    log("end");
  },
  writes(log) {
    const s = reactive({ x: 0, y: 1 });
    effect(() => log("reader", s.x));
    effect(() => { s.x = s.y * 2; log("writer", s.y); });
    s.y = 5;
    const t = reactive({ x: 0, y: 0 });
    effect(() => log("both", t.x, t.y));
    effect(() => { t.x = t.y + 100; log("w2", t.y); });
    t.y = 1;
  },
  self(log) {
    const s = reactive({ n: 0 });
    effect(() => { s.n = s.n + 1; log("n", s.n); });
    s.n = 10;
    log("final", s.n);
  },
  stop(log) {
    const s = reactive({ a: 1 });
    const stop = effect(() => log("a", s.a));
    s.a = 2; stop(); s.a = 3;
    log("stopped");
  },
  many(log) {
    const s = reactive({});
    for (let i = 0; i < 1000; i++) s["k" + i] = i;
    let runs = 0;
    for (let i = 0; i < 1000; i++) effect(() => { runs++; return s["k" + i]; });
    runs = 0;
    s.k500 = -1; s.k999 = -1;
    log("runs", runs);
  },
};
async function __arena_main(names) {
  for (const name of names) {
    const lines = [];
    try {
      __cases[name]((...v) => lines.push(v.map(__arena_show).join(" ")));
    } catch (e) {
      lines.push("THROWN " + (e && e.message));
    }
    __arena_print(name + ": " + lines.join(" / "));
  }
}`,
    cases: [
      ["basic", "stop"],
      ["branch"],
      ["nested"],
      ["keys"],
      ["computed"],
      ["order", "batch"],
      ["writes"],
      ["self"],
      ["many"],
    ],
    reference: String.raw`
const __proxies = new WeakMap();
const __isProxy = new WeakSet();
const __deps = new WeakMap();
const __ITERATE = Symbol("iterate");
let __active = null;
let __ids = 0;
let __depth = 0;
let __flushing = false;
let __queue = new Set();
let __pending = null;
function __track(target, key) {
  if (!__active) return;
  let m = __deps.get(target);
  if (!m) __deps.set(target, (m = new Map()));
  let set = m.get(key);
  if (!set) m.set(key, (set = new Set()));
  set.add(__active);
  __active.deps.add(set);
}
function __trigger(target, key, kind) {
  const m = __deps.get(target);
  if (!m) return;
  const subs = new Set(m.get(key) || []);
  if (kind === "add" || kind === "delete") for (const e of m.get(__ITERATE) || []) subs.add(e);
  // 先把这次修改触发的副作用都排进队列，再按创建顺序一起执行
  __depth++;
  try { for (const e of subs) __schedule(e); } finally { __depth--; }
  if (!__depth && !__flushing && __queue.size) __flush();
}
function __schedule(e) {
  if (e.computed) {
    if (!e.dirty) { e.dirty = true; __trigger(e, "value"); }
    return;
  }
  if (e === __active || e.stopped) return;
  if (__pending && __pending.has(e)) return;
  __queue.add(e);
}
function __cleanup(e) { for (const set of e.deps) set.delete(e); e.deps.clear(); }
function __run(e) {
  __cleanup(e);
  const prev = __active;
  __active = e;
  try { return e.fn(); } finally { __active = prev; }
}
function __flush() {
  __flushing = true;
  try {
    while (__queue.size) {
      const list = [...__queue].sort((a, b) => a.id - b.id);
      __queue = new Set();
      __pending = new Set(list);
      for (const e of list) { __pending.delete(e); if (!e.stopped) __run(e); }
      __pending = null;
    }
  } finally { __flushing = false; __pending = null; }
}
function reactive(obj) {
  if (__isProxy.has(obj)) return obj;
  if (__proxies.has(obj)) return __proxies.get(obj);
  const p = new Proxy(obj, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof k !== "symbol") __track(t, k);
      return v !== null && typeof v === "object" ? reactive(v) : v;
    },
    has(t, k) { if (typeof k !== "symbol") __track(t, k); return Reflect.has(t, k); },
    ownKeys(t) { __track(t, __ITERATE); return Reflect.ownKeys(t); },
    set(t, k, v, r) {
      const had = Object.prototype.hasOwnProperty.call(t, k);
      const old = t[k];
      const ok = Reflect.set(t, k, v, r);
      if (!had) __trigger(t, k, "add");
      else if (!Object.is(old, v)) __trigger(t, k, "set");
      return ok;
    },
    deleteProperty(t, k) {
      const had = Object.prototype.hasOwnProperty.call(t, k);
      const ok = Reflect.deleteProperty(t, k);
      if (had && ok) __trigger(t, k, "delete");
      return ok;
    },
  });
  __proxies.set(obj, p);
  __isProxy.add(p);
  return p;
}
function effect(fn) {
  const e = { id: ++__ids, fn, deps: new Set(), stopped: false };
  // 首次执行和重新执行一样：期间触发的其他副作用等它执行完再执行
  if (__flushing || __depth) __run(e);
  else {
    __flushing = true;
    try { __run(e); } finally { __flushing = false; }
    if (__queue.size) __flush();
  }
  return () => { e.stopped = true; __cleanup(e); };
}
function computed(getter) {
  const runner = { id: ++__ids, computed: true, dirty: true, deps: new Set(), fn: getter, value: undefined };
  return {
    get value() {
      __track(runner, "value");
      if (runner.dirty) {
        runner.value = __run(runner);
        runner.dirty = false;
      }
      return runner.value;
    },
  };
}
function batch(fn) {
  __depth++;
  try { fn(); } finally {
    __depth--;
    if (!__depth && !__flushing && __queue.size) __flush();
  }
}`,
  },
];
