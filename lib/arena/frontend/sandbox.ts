/**
 * 前端赛道的 UI 题在浏览器里判：模型写的页面放进隔离的 iframe 运行，隐藏测试模拟点击、输入、键盘，检查 DOM。
 *
 * 隔离：
 * - sandbox="allow-scripts allow-forms"，不给 allow-same-origin：页面是独立的不透明源，读不到本站的 localStorage（密钥）
 * - 页面最前面插入 CSP：禁止联网、禁止外部资源、禁止表单提交到别处
 * 测试脚本和页面在同一个文档里运行，理论上页面可以干扰测试；判定结果也在用户的浏览器里得出，可以被篡改。
 * 这是为了能真正跑页面做的取舍，见 AGENTS.md。
 */

export const SANDBOX = "allow-scripts allow-forms";

const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; ` +
  `style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">`;

/**
 * 测试辅助函数，先于页面脚本运行，测试里通过参数 T 使用。
 * 事件都是合成的：浏览器不会为合成事件执行默认行为（如按 Tab 移动焦点、在按钮上按回车触发点击），页面需要自己处理键盘事件。
 */
const PRELUDE = String.raw`(() => {
  const post = window.parent.postMessage.bind(window.parent);
  const nonce = "__NONCE__";
  const later = window.setTimeout.bind(window);
  const raf = window.requestAnimationFrame.bind(window);
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e)));
  window.addEventListener("unhandledrejection", (e) =>
    errors.push("未处理的 Promise 拒绝：" + String((e.reason && e.reason.message) || e.reason)),
  );
  const show = (v) => {
    try {
      return JSON.stringify(v);
    } catch (_) {
      return String(v);
    }
  };
  const codeOf = (key) =>
    key === " " ? "Space" : key.length === 1 ? (/[a-z]/i.test(key) ? "Key" + key.toUpperCase() : /[0-9]/.test(key) ? "Digit" + key : key) : key;
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const mouse = (x, y) => ({ bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true });
  const T = {
    $: (s) => document.querySelector(s),
    $$: (s) => Array.from(document.querySelectorAll(s)),
    wait: (ms) => new Promise((r) => later(r, ms)),
    /** 等两帧；iframe 被节流时 rAF 可能不跑，最多等 100ms */
    frame: () =>
      new Promise((r) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            r();
          }
        };
        raf(() => raf(finish));
        later(finish, 100);
      }),
    text: (el) => (el ? el.textContent : "").replace(/\s+/g, " ").trim(),
    visible(el) {
      if (!el || !el.isConnected || el.closest("[hidden]")) return false;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    },
    active: () => document.activeElement,
    must(el, what) {
      if (!el) throw new Error("找不到 " + what);
      return el;
    },
    assert(ok, message) {
      if (!ok) throw new Error(message);
    },
    eq(actual, expected, what) {
      if (actual !== expected) throw new Error(what + "：期望 " + show(expected) + "，实际 " + show(actual));
    },
    near(actual, expected, tolerance, what) {
      if (!(Math.abs(actual - expected) <= tolerance))
        throw new Error(what + "：期望约 " + expected + "，实际 " + actual);
    },
    /** 聚焦：浏览器没有派发真实的 focus 事件时（如所在窗口没有系统焦点）补一个合成的，保证恰好一次 */
    focus(el) {
      let fired = false;
      const mark = () => (fired = true);
      el.addEventListener("focus", mark, { once: true });
      el.focus();
      el.removeEventListener("focus", mark);
      if (!fired) {
        el.dispatchEvent(new FocusEvent("focus"));
        el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      }
    },
    click(el) {
      const p = center(el);
      const o = mouse(p.x, p.y);
      el.dispatchEvent(new PointerEvent("pointerdown", o));
      el.dispatchEvent(new MouseEvent("mousedown", o));
      if (typeof el.focus === "function") el.focus();
      el.dispatchEvent(new PointerEvent("pointerup", Object.assign({}, o, { buttons: 0 })));
      el.dispatchEvent(new MouseEvent("mouseup", Object.assign({}, o, { buttons: 0 })));
      el.dispatchEvent(new MouseEvent("click", Object.assign({}, o, { buttons: 0 })));
    },
    dblclick(el) {
      T.click(el);
      T.click(el);
      const p = center(el);
      el.dispatchEvent(new MouseEvent("dblclick", Object.assign(mouse(p.x, p.y), { buttons: 0, detail: 2 })));
    },
    /** 设置输入框的值并派发 input 事件（用原型上的 setter，兼容框架） */
    input(el, value) {
      if (typeof el.focus === "function") el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    change(el) {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    /** 失焦：同样保证 blur 恰好派发一次（真实的或合成的），失焦后焦点回到 body */
    blur(el) {
      let fired = false;
      const mark = () => (fired = true);
      el.addEventListener("blur", mark, { once: true });
      if (document.activeElement === el) el.blur();
      el.removeEventListener("blur", mark);
      if (!fired) {
        el.dispatchEvent(new FocusEvent("blur"));
        el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      }
    },
    /** 在元素上按一个键（keydown + keyup），返回 keydown 是否被 preventDefault */
    key(el, key, mods) {
      const o = Object.assign({ key, code: codeOf(key), bubbles: true, cancelable: true, composed: true }, mods || {});
      const down = new KeyboardEvent("keydown", o);
      el.dispatchEvent(down);
      el.dispatchEvent(new KeyboardEvent("keyup", o));
      return down.defaultPrevented;
    },
    /** 在当前焦点上按键 */
    press(key, mods) {
      return T.key(document.activeElement || document.body, key, mods);
    },
    submit(form) {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    },
    /** 用 pointer 事件把 from 拖到坐标 (x, y)：pointermove / pointerup 派发给那个位置下的元素，会冒泡到 document */
    async drag(from, x, y) {
      const p = center(from);
      from.dispatchEvent(new PointerEvent("pointerdown", mouse(p.x, p.y)));
      from.dispatchEvent(new MouseEvent("mousedown", mouse(p.x, p.y)));
      for (let i = 1; i <= 6; i++) {
        const cx = p.x + ((x - p.x) * i) / 6;
        const cy = p.y + ((y - p.y) * i) / 6;
        const target = document.elementFromPoint(cx, cy) || document.body;
        target.dispatchEvent(new PointerEvent("pointermove", mouse(cx, cy)));
        target.dispatchEvent(new MouseEvent("mousemove", mouse(cx, cy)));
        await T.wait(16);
      }
      const end = document.elementFromPoint(x, y) || document.body;
      end.dispatchEvent(new PointerEvent("pointerup", Object.assign(mouse(x, y), { buttons: 0 })));
      end.dispatchEvent(new MouseEvent("mouseup", Object.assign(mouse(x, y), { buttons: 0 })));
      await T.wait(16);
    },
  };
  window.__arenaRun = async (tests) => {
    await T.wait(50);
    let passed = 0;
    let failure = null;
    const results = [];
    post({ nonce, progress: results.slice(), total: tests.length }, "*");
    for (let i = 0; i < tests.length; i++) {
      try {
        await tests[i][1](T);
        passed++;
        results.push(true);
      } catch (e) {
        results.push(false);
        if (!failure) failure = { index: i + 1, name: tests[i][0], message: String((e && e.message) || e) };
      }
      post({ nonce, progress: results.slice(), total: tests.length }, "*");
    }
    post({ nonce, passed, total: tests.length, failure, results, errors: errors.slice(0, 3) }, "*");
  };
})();`;

/** 把脚本插到 <head> 最前面、测试插到 </body> 前；模型的页面可能没写 head / body */
function inject(html: string, head: string, tail: string): string {
  let doc = html;
  const headTag = doc.match(/<head(\s[^>]*)?>/i);
  if (headTag) doc = doc.replace(headTag[0], () => headTag[0] + head);
  else {
    const htmlTag = doc.match(/<html(\s[^>]*)?>/i);
    if (htmlTag) doc = doc.replace(htmlTag[0], () => `${htmlTag[0]}<head>${head}</head>`);
    else {
      const doctype = doc.match(/<!doctype[^>]*>/i);
      doc = doctype
        ? doc.replace(doctype[0], () => `${doctype[0]}<head>${head}</head>`)
        : `<!doctype html><head>${head}</head>${doc}`;
    }
  }
  const close = doc.toLowerCase().lastIndexOf("</body>");
  return close >= 0 ? doc.slice(0, close) + tail + doc.slice(close) : doc + tail;
}

/** 只给人看的预览：加上 CSP，不跑测试 */
export function previewDoc(html: string): string {
  return inject(html, CSP, "");
}

/** 带测试的文档：测试在 load 之后运行，结果用带 nonce 的 postMessage 发回 */
export function testDoc(html: string, test: string, nonce: string): string {
  const prelude = `<script>${PRELUDE.replace("__NONCE__", nonce)}</script>`;
  const run = `<script>window.addEventListener("load", function () { window.__arenaRun(${test}); });</script>`;
  return inject(html, CSP + prelude, run);
}

export interface UiOutcome {
  passed: number;
  total: number;
  failure: { index: number; name: string; message: string } | null;
  /** 每项检查是否通过，按顺序 */
  results: boolean[];
  errors: string[];
}

/** 测试进行中：已经跑完的检查是否通过 */
export interface UiProgress {
  progress: boolean[];
  total: number;
}

/** iframe 的实际尺寸：页面按这个视口布局，展示时再缩放 */
export const FRAME_WIDTH = 1024;
export const FRAME_HEIGHT = 768;

/**
 * 跑一道 UI 题的测试，只能在浏览器里调用。iframe 挂到 host 里按 host 的宽度缩放显示。
 * 必须留在可视区域内：Chrome 会暂停屏幕外跨源 iframe 的 requestAnimationFrame，用 rAF 渲染的页面会卡住。
 */
export function runUiTest(
  html: string,
  test: string,
  host: HTMLElement,
  timeoutMs = 20_000,
  onProgress?: (p: UiProgress) => void,
): Promise<UiOutcome | "timeout"> {
  return new Promise((resolve) => {
    const nonce = crypto.randomUUID();
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", SANDBOX);
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    const scale = host.clientWidth / FRAME_WIDTH || 0.25;
    frame.style.cssText =
      `position:absolute;left:0;top:0;width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;border:0;` +
      `transform:scale(${scale});transform-origin:0 0;pointer-events:none;background:#fff`;
    const done = (result: UiOutcome | "timeout") => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(result);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.data?.nonce !== nonce) return;
      if (Array.isArray(e.data.progress)) onProgress?.(e.data as UiProgress);
      else done(e.data as UiOutcome);
    };
    const timer = setTimeout(() => done("timeout"), timeoutMs);
    window.addEventListener("message", onMessage);
    frame.srcdoc = testDoc(html, test, nonce);
    host.appendChild(frame);
  });
}
