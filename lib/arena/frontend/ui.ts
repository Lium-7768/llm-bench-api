import type { ArenaTier } from "../../types";

/**
 * 前端赛道的 UI 题：模型输出一个完整的 HTML 页面，在浏览器的隔离 iframe 里运行，隐藏测试按 DOM 约定操作页面。
 * test 是一段 JS 数组表达式：[["名称", async (T) => { ... }], ...]，按顺序在同一个页面上执行（有状态）。
 * T 的用法见 sandbox.ts。测试代码里不要用反引号和 ${}，它们会被原样嵌进页面。
 */
export interface UiProblem {
  id: string;
  tier: ArenaTier;
  kind: "ui";
  title: string;
  tags: string[];
  statement: string;
  test: string;
}

export const UI_PROBLEMS: UiProblem[] = [
  // ---------------------------------------------------------------- 青铜
  {
    id: "fe-bronze-counter",
    tier: "bronze",
    kind: "ui",
    title: "计数器",
    tags: ["事件", "表单状态"],
    statement: `做一个计数器页面。必须有这些元素（测试按 id 查找）：
- button#dec（减）、button#inc（加）、button#reset（归零）
- #count：只显示当前数值，如 0
- input#step：步长输入框，默认值 1

规则：
- 初始值 0，取值范围 0 到 10；
- 点加 / 减时按步长变化，超出范围就停在边界（如 9 加 5 得 10）；
- 步长框里的内容不是 1 到 5 之间的整数时（空、0、7、2.5、abc 等），按 1 处理；
- 数值为 0 时 #dec 禁用（disabled），为 10 时 #inc 禁用，其他时候都可用；
- 点归零回到 0。`,
    test: String.raw`[
  ["初始状态", async (T) => {
    T.eq(T.text(T.must(T.$("#count"), "#count")), "0", "初始数值");
    T.eq(T.must(T.$("#dec"), "#dec").disabled, true, "数值为 0 时 #dec 是否禁用");
    T.eq(T.must(T.$("#inc"), "#inc").disabled, false, "#inc 是否禁用");
    T.eq(T.must(T.$("#step"), "#step").value, "1", "步长默认值");
    T.must(T.$("#reset"), "#reset");
  }],
  ["加三次", async (T) => {
    for (let i = 0; i < 3; i++) T.click(T.$("#inc"));
    await T.wait(30);
    T.eq(T.text(T.$("#count")), "3", "点三次加之后");
    T.eq(T.$("#dec").disabled, false, "#dec 是否禁用");
  }],
  ["步长 5，到上限停住", async (T) => {
    T.input(T.$("#step"), "5");
    T.change(T.$("#step"));
    await T.wait(30);
    T.click(T.$("#inc"));
    await T.wait(30);
    T.eq(T.text(T.$("#count")), "8", "3 加 5");
    T.click(T.$("#inc"));
    await T.wait(30);
    T.eq(T.text(T.$("#count")), "10", "8 加 5 应停在上限");
    T.eq(T.$("#inc").disabled, true, "数值为 10 时 #inc 是否禁用");
  }],
  ["按步长减到下限", async (T) => {
    T.click(T.$("#dec"));
    await T.wait(30);
    T.eq(T.text(T.$("#count")), "5", "10 减 5");
    T.click(T.$("#dec"));
    await T.wait(30);
    T.click(T.$("#dec"));
    await T.wait(30);
    T.eq(T.text(T.$("#count")), "0", "减到 0 停住");
    T.eq(T.$("#dec").disabled, true, "数值为 0 时 #dec 是否禁用");
  }],
  ["无效步长按 1 处理", async (T) => {
    for (const v of ["7", "0", "abc", "2.5", ""]) {
      T.click(T.$("#reset"));
      T.input(T.$("#step"), v);
      T.change(T.$("#step"));
      await T.wait(30);
      T.click(T.$("#inc"));
      await T.wait(30);
      T.eq(T.text(T.$("#count")), "1", "步长为 " + JSON.stringify(v) + " 时从 0 加一次");
    }
  }],
  ["归零", async (T) => {
    T.input(T.$("#step"), "3");
    T.change(T.$("#step"));
    T.click(T.$("#inc"));
    await T.wait(30);
    T.click(T.$("#inc"));
    await T.wait(30);
    T.eq(T.text(T.$("#count")), "7", "1 加两次 3");
    T.click(T.$("#reset"));
    await T.wait(30);
    T.eq(T.text(T.$("#count")), "0", "归零后");
    T.eq(T.$("#dec").disabled, true, "归零后 #dec 是否禁用");
    T.eq(T.$("#inc").disabled, false, "归零后 #inc 是否禁用");
  }],
]`,
  },
  {
    id: "fe-bronze-chars",
    tier: "bronze",
    kind: "ui",
    title: "发消息",
    tags: ["输入事件", "Unicode", "XSS"],
    statement: `做一个发消息的小组件。必须有：textarea#text、#count、button#send、ul#sent。

规则：
- #count 显示「已输入 n / 140」，n 按 Unicode 码点计数：一个 emoji 算 1 个字符（即 [...text].length）；
- 每次输入（input 事件）立即更新；
- 超过 140 时 #count 加上 class "over"，不超过时去掉；
- 内容为空、只有空白字符、或者超过 140 时，#send 禁用（disabled），否则可用；
- 点 #send：把输入框里的原文作为纯文本（不能当 HTML 解析）放进一个新的 li，加到 ul#sent 末尾；
  然后清空输入框，计数回到 0，#send 重新禁用。`,
    test: String.raw`[
  ["初始状态", async (T) => {
    const m = T.text(T.must(T.$("#count"), "#count")).match(/(\d+)\s*\/\s*140/);
    T.assert(m && m[1] === "0", "#count 应显示 0 / 140，实际：" + T.text(T.$("#count")));
    T.eq(T.must(T.$("#send"), "#send").disabled, true, "空内容时 #send 是否禁用");
    T.eq(T.must(T.$("#sent"), "#sent").querySelectorAll("li").length, 0, "初始消息条数");
  }],
  ["中文和 emoji 计数", async (T) => {
    const n = () => { const m = T.text(T.$("#count")).match(/(\d+)\s*\/\s*140/); return m ? Number(m[1]) : -1; };
    T.input(T.must(T.$("#text"), "#text"), "你好");
    await T.wait(20);
    T.eq(n(), 2, "输入「你好」后的计数");
    T.eq(T.$("#send").disabled, false, "有内容时 #send 是否禁用");
    T.input(T.$("#text"), "😀👍");
    await T.wait(20);
    T.eq(n(), 2, "输入两个 emoji 后的计数");
  }],
  ["只有空白不能发送", async (T) => {
    const n = () => { const m = T.text(T.$("#count")).match(/(\d+)\s*\/\s*140/); return m ? Number(m[1]) : -1; };
    T.input(T.$("#text"), "   \n ");
    await T.wait(20);
    T.eq(n(), 5, "五个空白字符的计数");
    T.eq(T.$("#send").disabled, true, "只有空白时 #send 是否禁用");
  }],
  ["超长", async (T) => {
    const n = () => { const m = T.text(T.$("#count")).match(/(\d+)\s*\/\s*140/); return m ? Number(m[1]) : -1; };
    T.input(T.$("#text"), "a".repeat(141));
    await T.wait(20);
    T.eq(n(), 141, "141 个字符的计数");
    T.eq(T.$("#count").classList.contains("over"), true, "超过 140 时 #count 是否有 class over");
    T.eq(T.$("#send").disabled, true, "超过 140 时 #send 是否禁用");
    T.input(T.$("#text"), "😀".repeat(140));
    await T.wait(20);
    T.eq(n(), 140, "140 个 emoji 的计数");
    T.eq(T.$("#count").classList.contains("over"), false, "恰好 140 时 #count 是否有 class over");
    T.eq(T.$("#send").disabled, false, "恰好 140 时 #send 是否禁用");
  }],
  ["发送纯文本", async (T) => {
    const n = () => { const m = T.text(T.$("#count")).match(/(\d+)\s*\/\s*140/); return m ? Number(m[1]) : -1; };
    const msg = "<b>hi</b> & <img src=x onerror=alert(1)>";
    T.input(T.$("#text"), msg);
    await T.wait(20);
    T.click(T.$("#send"));
    await T.wait(30);
    const items = T.$("#sent").querySelectorAll("li");
    T.eq(items.length, 1, "发送后的消息条数");
    T.eq(items[0].textContent, msg, "消息内容");
    T.eq(items[0].querySelector("b, img"), null, "消息里不应出现解析出来的 HTML 元素");
    T.eq(T.$("#text").value, "", "发送后输入框");
    T.eq(n(), 0, "发送后的计数");
    T.eq(T.$("#send").disabled, true, "发送后 #send 是否禁用");
  }],
  ["连续发送追加到末尾", async (T) => {
    T.input(T.$("#text"), "第二条");
    await T.wait(20);
    T.click(T.$("#send"));
    await T.wait(30);
    const items = T.$("#sent").querySelectorAll("li");
    T.eq(items.length, 2, "第二次发送后的消息条数");
    T.eq(items[1].textContent, "第二条", "最后一条消息");
  }],
]`,
  },

  // ---------------------------------------------------------------- 白银
  {
    id: "fe-silver-tabs",
    tier: "silver",
    kind: "ui",
    title: "无障碍标签页",
    tags: ["ARIA", "键盘导航"],
    statement: `做一个符合无障碍规范的标签页组件。四个标签依次是：概览、参数、评论、相关，其中「评论」不可用。

DOM 约定：
- 一个 role="tablist" 的容器，里面四个 role="tab" 的元素（建议用 button），按上面的顺序，文字就是标签名；
  每个标签有唯一的 id，aria-controls 指向对应面板的 id；
- 四个 role="tabpanel" 的面板，各有 id，aria-labelledby 指向对应标签的 id；面板文字里包含「面板：标签名」，如「面板：概览」；
- 选中的标签 aria-selected="true"、tabindex="0"；其他标签 aria-selected="false"、tabindex="-1"；
- 只有选中标签对应的面板显示，其他面板加 hidden 属性；
- 「评论」标签 aria-disabled="true"：点击无效，键盘移动时跳过它。

交互：
- 初始选中「概览」；
- 点击标签：选中它；
- 焦点在某个标签上时：→ 选中并聚焦下一个可用标签（最后一个之后回到第一个），← 反方向；
  Home 选中并聚焦第一个可用标签，End 选中并聚焦最后一个可用标签；这些按键要阻止默认行为。`,
    test: String.raw`[
  ["结构", async (T) => {
    T.must(T.$('[role="tablist"]'), 'role="tablist" 的容器');
    const tabs = T.$$('[role="tab"]');
    T.eq(tabs.length, 4, "标签数量");
    T.eq(tabs.map((t) => T.text(t)).join(","), "概览,参数,评论,相关", "标签顺序");
    T.eq(T.$$('[role="tabpanel"]').length, 4, "面板数量");
    tabs.forEach((t) => {
      T.assert(T.$('[role="tablist"]').contains(t), "标签应在 tablist 里");
      const panel = document.getElementById(t.getAttribute("aria-controls") || "");
      T.assert(panel && panel.getAttribute("role") === "tabpanel", "「" + T.text(t) + "」的 aria-controls 应指向一个 tabpanel");
      T.eq(panel.getAttribute("aria-labelledby"), t.id, "「" + T.text(t) + "」面板的 aria-labelledby");
      T.assert(T.text(panel).includes("面板：" + T.text(t)), "面板文字应包含「面板：" + T.text(t) + "」");
    });
    T.eq(tabs[2].getAttribute("aria-disabled"), "true", "「评论」的 aria-disabled");
  }],
  ["初始选中概览", async (T) => {
    const tabs = T.$$('[role="tab"]');
    tabs.forEach((t, i) => {
      T.eq(t.getAttribute("aria-selected"), i === 0 ? "true" : "false", "「" + T.text(t) + "」的 aria-selected");
      T.eq(t.getAttribute("tabindex"), i === 0 ? "0" : "-1", "「" + T.text(t) + "」的 tabindex");
      const panel = document.getElementById(t.getAttribute("aria-controls"));
      T.eq(T.visible(panel), i === 0, "「" + T.text(t) + "」面板是否显示");
      if (i !== 0) T.eq(panel.hidden, true, "「" + T.text(t) + "」面板是否有 hidden 属性");
    });
  }],
  ["点击切换", async (T) => {
    const tabs = T.$$('[role="tab"]');
    T.click(tabs[1]);
    await T.wait(20);
    T.eq(tabs[1].getAttribute("aria-selected"), "true", "点击「参数」后它的 aria-selected");
    T.eq(tabs[0].getAttribute("aria-selected"), "false", "点击「参数」后「概览」的 aria-selected");
    T.eq(T.visible(document.getElementById(tabs[1].getAttribute("aria-controls"))), true, "「参数」面板是否显示");
    T.eq(T.visible(document.getElementById(tabs[0].getAttribute("aria-controls"))), false, "「概览」面板是否显示");
  }],
  ["点击不可用的标签无效", async (T) => {
    const tabs = T.$$('[role="tab"]');
    T.click(tabs[2]);
    await T.wait(20);
    T.eq(tabs[2].getAttribute("aria-selected"), "false", "点击「评论」后它的 aria-selected");
    T.eq(tabs[1].getAttribute("aria-selected"), "true", "点击「评论」后「参数」仍应选中");
  }],
  ["方向键跳过不可用的标签并循环", async (T) => {
    const tabs = T.$$('[role="tab"]');
    tabs[1].focus();
    const prevented = T.press("ArrowRight");
    await T.wait(20);
    T.eq(T.active(), tabs[3], "在「参数」上按 → 后的焦点（应跳过「评论」到「相关」）");
    T.eq(tabs[3].getAttribute("aria-selected"), "true", "按 → 后「相关」的 aria-selected");
    T.eq(prevented, true, "→ 是否阻止了默认行为");
    T.press("ArrowRight");
    await T.wait(20);
    T.eq(T.active(), tabs[0], "在最后一个上按 → 应回到「概览」");
    T.press("ArrowLeft");
    await T.wait(20);
    T.eq(T.active(), tabs[3], "在「概览」上按 ← 应到「相关」");
    T.eq(T.visible(document.getElementById(tabs[3].getAttribute("aria-controls"))), true, "「相关」面板是否显示");
  }],
  ["Home 与 End", async (T) => {
    const tabs = T.$$('[role="tab"]');
    T.press("Home");
    await T.wait(20);
    T.eq(T.active(), tabs[0], "按 Home 后的焦点");
    T.eq(tabs[0].getAttribute("aria-selected"), "true", "按 Home 后「概览」的 aria-selected");
    T.press("End");
    await T.wait(20);
    T.eq(T.active(), tabs[3], "按 End 后的焦点");
    T.eq(tabs[3].getAttribute("tabindex"), "0", "按 End 后「相关」的 tabindex");
    T.eq(tabs[0].getAttribute("tabindex"), "-1", "按 End 后「概览」的 tabindex");
  }],
]`,
  },
  {
    id: "fe-silver-form",
    tier: "silver",
    kind: "ui",
    title: "注册表单校验",
    tags: ["表单", "无障碍", "校验时机"],
    statement: `做一个注册表单。DOM 约定：
- form#signup，里面有 input#email、input#password、input#confirm（确认密码）、input#agree（type="checkbox"，同意条款）、button#submit（type="submit"）；
- 错误提示元素：#email-error、#password-error、#confirm-error、#agree-error；
- 成功提示 #success，一开始不显示。

校验规则与错误文字：
- 邮箱：非空白且非 @ 的字符 + @ + 非空白且非 @ 的字符 + . + 非空白且非 @ 的字符 —— 错误时「请输入有效的邮箱」；
- 密码：至少 8 位，并且同时包含字母和数字 —— 「密码至少 8 位，需包含字母和数字」；
- 确认密码：和密码完全一致 —— 「两次输入的密码不一致」；
- 同意条款：必须勾选 —— 「请先同意条款」。

显示时机：
- 一个字段失去焦点（blur）之后，或者表单提交过一次之后，才显示这个字段的错误；从那以后，每次输入或勾选都立即重新校验，改对了提示立即消失；
- 显示错误时：错误元素里是上面的文字，对应的输入框 aria-invalid="true"；没有错误时错误元素为空，aria-invalid 去掉或设为 "false"；
- 每个输入框用 aria-describedby 关联它的错误元素。

提交：
- 阻止表单的默认提交；不要依赖浏览器内置校验（required、type="email" 的拦截），可以给 form 加 novalidate；
- 有错误：显示所有字段的错误，并把焦点移到第一个有错误的字段；
- 全部正确：显示 #success，内容为「注册成功：」加邮箱地址。`,
    test: String.raw`[
  ["初始状态", async (T) => {
    for (const f of ["email", "password", "confirm", "agree"]) {
      const input = T.must(T.$("#" + f), "#" + f);
      T.eq(T.text(T.must(T.$("#" + f + "-error"), "#" + f + "-error")), "", "#" + f + "-error 初始内容");
      T.assert(input.getAttribute("aria-invalid") !== "true", "#" + f + " 初始不应 aria-invalid");
      T.assert((input.getAttribute("aria-describedby") || "").split(/\s+/).includes(f + "-error"), "#" + f + " 的 aria-describedby 应包含 " + f + "-error");
    }
    T.must(T.$("form#signup"), "form#signup");
    T.eq(T.visible(T.$("#success")), false, "#success 初始是否显示");
  }],
  ["失去焦点后才提示", async (T) => {
    const email = T.$("#email");
    T.input(email, "abc");
    await T.wait(20);
    T.eq(T.text(T.$("#email-error")), "", "还没失去焦点时 #email-error");
    T.blur(email);
    await T.wait(20);
    T.eq(T.text(T.$("#email-error")), "请输入有效的邮箱", "失去焦点后 #email-error");
    T.eq(email.getAttribute("aria-invalid"), "true", "#email 的 aria-invalid");
    T.input(T.$("#password"), "abcdefgh");
    await T.wait(20);
    T.eq(T.text(T.$("#password-error")), "", "密码没失去焦点时不应提示");
  }],
  ["提交时显示全部错误并聚焦第一个", async (T) => {
    T.submit(T.$("#signup"));
    await T.wait(30);
    T.eq(T.text(T.$("#email-error")), "请输入有效的邮箱", "提交后 #email-error");
    T.eq(T.text(T.$("#password-error")), "密码至少 8 位，需包含字母和数字", "提交后 #password-error");
    T.eq(T.text(T.$("#confirm-error")), "两次输入的密码不一致", "提交后 #confirm-error");
    T.eq(T.text(T.$("#agree-error")), "请先同意条款", "提交后 #agree-error");
    T.eq(T.active(), T.$("#email"), "提交后焦点应在第一个有错误的字段");
    T.eq(T.visible(T.$("#success")), false, "有错误时 #success 是否显示");
  }],
  ["改对后立即消失", async (T) => {
    T.input(T.$("#email"), "a@b.co");
    await T.wait(20);
    T.eq(T.text(T.$("#email-error")), "", "邮箱改对后 #email-error");
    T.assert(T.$("#email").getAttribute("aria-invalid") !== "true", "邮箱改对后不应 aria-invalid");
    T.input(T.$("#password"), "abc12345");
    await T.wait(20);
    T.eq(T.text(T.$("#password-error")), "", "密码改对后 #password-error");
    T.input(T.$("#confirm"), "abc1234");
    await T.wait(20);
    T.eq(T.text(T.$("#confirm-error")), "两次输入的密码不一致", "确认密码不一致");
    T.input(T.$("#confirm"), "abc12345");
    await T.wait(20);
    T.eq(T.text(T.$("#confirm-error")), "", "确认密码一致后");
    T.click(T.$("#agree"));
    await T.wait(20);
    T.eq(T.$("#agree").checked, true, "#agree 是否勾选");
    T.eq(T.text(T.$("#agree-error")), "", "勾选后 #agree-error");
  }],
  ["提交成功", async (T) => {
    T.submit(T.$("#signup"));
    await T.wait(30);
    T.eq(T.visible(T.$("#success")), true, "全部正确时 #success 是否显示");
    T.eq(T.text(T.$("#success")), "注册成功：a@b.co", "#success 的内容");
  }],
]`,
  },

  // ---------------------------------------------------------------- 黄金
  {
    id: "fe-gold-combobox",
    tier: "gold",
    kind: "ui",
    title: "可筛选的下拉框",
    tags: ["ARIA combobox", "键盘", "焦点管理"],
    statement: `做一个可以输入筛选的下拉选择框（combobox）。选项是这 12 种水果，顺序固定：
Apple、Apricot、Banana、Blueberry、Cherry、Grape、Lemon、Mango、Orange、Peach、Pear、Watermelon

DOM 约定：
- input#fruit：role="combobox"，aria-controls="fruit-list"，aria-autocomplete="list"，aria-expanded 为 "true" 或 "false"；
- ul#fruit-list：role="listbox"，每个选项是 role="option" 的 li，有唯一的 id，文字就是水果名；
- #fruit-empty：没有匹配项时显示，文字「没有匹配项」，其他时候隐藏；
- #fruit-value：显示当前选中的水果名，初始为空。

交互（焦点一直留在输入框上）：
- 输入（input 事件）：按「包含输入内容、不区分大小写」筛选，保持原顺序，并展开列表；输入为空时显示全部；
- 展开时 aria-expanded="true" 且列表可见；收起时 aria-expanded="false" 且列表隐藏；
- ↓：列表收起时展开（显示当前输入对应的筛选结果，不高亮）；展开时高亮下一项，最后一项之后回到第一项；还没有高亮时高亮第一项；
- ↑：列表收起时展开；展开时高亮上一项，第一项之前回到最后一项；还没有高亮时高亮最后一项；
- 高亮的选项 aria-selected="true"，其他选项为 "false"；输入框的 aria-activedescendant 设为高亮选项的 id，没有高亮时去掉这个属性；
- 筛选结果变化时清除高亮；
- Enter：有高亮项时选中它；
- 选中（Enter 或点击选项）：输入框的值变成水果名，#fruit-value 显示水果名，列表收起；
- Esc：列表展开时收起；已经收起时清空输入框；
- ↑ ↓ Enter Esc 都要阻止默认行为。`,
    test: String.raw`[
  ["初始状态", async (T) => {
    const input = T.must(T.$("#fruit"), "#fruit");
    T.eq(input.getAttribute("role"), "combobox", "#fruit 的 role");
    T.eq(input.getAttribute("aria-controls"), "fruit-list", "#fruit 的 aria-controls");
    T.eq(input.getAttribute("aria-expanded"), "false", "初始 aria-expanded");
    T.eq(T.must(T.$("#fruit-list"), "#fruit-list").getAttribute("role"), "listbox", "#fruit-list 的 role");
    T.eq(T.visible(T.$("#fruit-list")), false, "列表初始是否可见");
    T.eq(T.text(T.must(T.$("#fruit-value"), "#fruit-value")), "", "#fruit-value 初始内容");
  }],
  ["输入筛选", async (T) => {
    const shown = () => T.$$('#fruit-list [role="option"]').filter((o) => T.visible(o)).map((o) => T.text(o)).join(",");
    T.input(T.$("#fruit"), "an");
    await T.wait(30);
    T.eq(T.$("#fruit").getAttribute("aria-expanded"), "true", "输入后 aria-expanded");
    T.eq(T.visible(T.$("#fruit-list")), true, "输入后列表是否可见");
    T.eq(shown(), "Banana,Mango,Orange", "输入 an 的筛选结果");
    T.eq(T.visible(T.$("#fruit-empty")), false, "有结果时 #fruit-empty 是否显示");
  }],
  ["上下键高亮并循环", async (T) => {
    const input = T.$("#fruit");
    const opt = (name) => T.$$('#fruit-list [role="option"]').find((o) => T.visible(o) && T.text(o) === name);
    const prevented = T.key(input, "ArrowDown");
    await T.wait(20);
    T.eq(prevented, true, "↓ 是否阻止默认行为");
    T.eq(input.getAttribute("aria-activedescendant"), opt("Banana").id, "第一次 ↓ 应高亮 Banana");
    T.eq(opt("Banana").getAttribute("aria-selected"), "true", "Banana 的 aria-selected");
    T.key(input, "ArrowDown");
    T.key(input, "ArrowDown");
    await T.wait(20);
    T.eq(input.getAttribute("aria-activedescendant"), opt("Orange").id, "再按两次 ↓ 应高亮 Orange");
    T.eq(opt("Banana").getAttribute("aria-selected"), "false", "Banana 的 aria-selected");
    T.key(input, "ArrowDown");
    await T.wait(20);
    T.eq(input.getAttribute("aria-activedescendant"), opt("Banana").id, "最后一项再按 ↓ 应回到 Banana");
    T.key(input, "ArrowUp");
    await T.wait(20);
    T.eq(input.getAttribute("aria-activedescendant"), opt("Orange").id, "第一项按 ↑ 应到 Orange");
  }],
  ["Enter 选中", async (T) => {
    const input = T.$("#fruit");
    T.eq(T.key(input, "Enter"), true, "Enter 是否阻止默认行为");
    await T.wait(20);
    T.eq(input.value, "Orange", "选中后输入框的值");
    T.eq(T.text(T.$("#fruit-value")), "Orange", "#fruit-value");
    T.eq(input.getAttribute("aria-expanded"), "false", "选中后 aria-expanded");
    T.eq(T.visible(T.$("#fruit-list")), false, "选中后列表是否可见");
  }],
  ["没有匹配项与 Esc", async (T) => {
    const input = T.$("#fruit");
    T.input(input, "zz");
    await T.wait(20);
    T.eq(T.visible(T.$("#fruit-empty")), true, "#fruit-empty 是否显示");
    T.eq(T.text(T.$("#fruit-empty")), "没有匹配项", "#fruit-empty 的文字");
    T.eq(T.$$('#fruit-list [role="option"]').filter((o) => T.visible(o)).length, 0, "可见选项数");
    T.key(input, "Escape");
    await T.wait(20);
    T.eq(input.getAttribute("aria-expanded"), "false", "按 Esc 后 aria-expanded");
    T.eq(input.value, "zz", "第一次 Esc 不应清空输入框");
    T.key(input, "Escape");
    await T.wait(20);
    T.eq(input.value, "", "收起后再按 Esc 应清空输入框");
  }],
  ["不区分大小写，点击选中", async (T) => {
    const input = T.$("#fruit");
    T.input(input, "PE");
    await T.wait(20);
    const shown = T.$$('#fruit-list [role="option"]').filter((o) => T.visible(o));
    T.eq(shown.map((o) => T.text(o)).join(","), "Grape,Peach,Pear", "输入 PE 的筛选结果");
    T.assert(!input.hasAttribute("aria-activedescendant"), "筛选结果变化后不应有 aria-activedescendant");
    T.click(shown[2]);
    await T.wait(20);
    T.eq(input.value, "Pear", "点击 Pear 后输入框的值");
    T.eq(T.text(T.$("#fruit-value")), "Pear", "#fruit-value");
    T.eq(input.getAttribute("aria-expanded"), "false", "点击选中后 aria-expanded");
  }],
  ["收起时 ↓ 展开当前结果，↑ 高亮最后一项", async (T) => {
    const input = T.$("#fruit");
    input.focus();
    T.key(input, "ArrowDown");
    await T.wait(20);
    T.eq(input.getAttribute("aria-expanded"), "true", "收起时按 ↓ 应展开");
    const shown = T.$$('#fruit-list [role="option"]').filter((o) => T.visible(o));
    T.eq(shown.map((o) => T.text(o)).join(","), "Pear", "展开后应显示输入 Pear 对应的结果");
    T.assert(!input.hasAttribute("aria-activedescendant"), "收起时按 ↓ 展开不应高亮");
    T.input(input, "");
    await T.wait(20);
    T.key(input, "ArrowUp");
    await T.wait(20);
    const last = T.$$('#fruit-list [role="option"]').filter((o) => T.visible(o));
    T.eq(last.length, 12, "输入为空时的选项数");
    T.eq(input.getAttribute("aria-activedescendant"), last[11].id, "没有高亮时 ↑ 应高亮最后一项 Watermelon");
  }],
]`,
  },
  {
    id: "fe-gold-todo",
    tier: "gold",
    kind: "ui",
    title: "待办清单",
    tags: ["列表渲染", "编辑态", "筛选"],
    statement: `做一个待办清单。DOM 约定：
- input#new-todo：输入后按 Enter（keydown）添加，去掉首尾空白，为空则不添加；添加后清空输入框；
- ul#todo-list：每条待办是一个 li.todo，里面有 input.toggle（checkbox）、span.title（待办文字，纯文本）、button.delete；
- 三个筛选按钮：button[data-filter="all"]、button[data-filter="active"]、button[data-filter="completed"]，
  当前筛选的按钮 aria-pressed="true"，其他为 "false"；默认 all；不符合当前筛选的条目隐藏或不渲染；
- #todo-count：显示「n 项未完成」；
- button#clear-completed：删除所有已完成的；没有已完成的时禁用（disabled）。

交互：
- 勾选 .toggle 表示完成，完成的 li 加 class "completed"，取消勾选则去掉；
- 点 .delete 删除这一条；
- 双击 .title 进入编辑：这一条里出现 input.edit，值为原文字，并获得焦点；
  在 input.edit 上按 Enter 保存（去首尾空白；为空则删除这一条），按 Esc 放弃修改；退出编辑后 input.edit 消失。`,
    test: String.raw`[
  ["添加", async (T) => {
    const input = T.must(T.$("#new-todo"), "#new-todo");
    T.input(input, "买牛奶");
    T.key(input, "Enter");
    await T.wait(30);
    T.eq(T.$$("#todo-list li.todo").length, 1, "添加一条后的条数");
    T.eq(T.text(T.$("#todo-list li.todo .title")), "买牛奶", "第一条的文字");
    T.eq(input.value, "", "添加后输入框应清空");
    T.input(input, "   ");
    T.key(input, "Enter");
    await T.wait(30);
    T.eq(T.$$("#todo-list li.todo").length, 1, "只有空白时不应添加");
  }],
  ["去空白与纯文本", async (T) => {
    const input = T.$("#new-todo");
    T.input(input, "  写周报 ");
    T.key(input, "Enter");
    await T.wait(30);
    T.input(input, "<i>x</i>");
    T.key(input, "Enter");
    await T.wait(30);
    const titles = T.$$("#todo-list li.todo .title");
    T.eq(titles.length, 3, "条数");
    T.eq(titles[1].textContent, "写周报", "应去掉首尾空白");
    T.eq(titles[2].textContent, "<i>x</i>", "应按纯文本显示");
    T.eq(titles[2].querySelector("i"), null, "不应解析出 HTML 元素");
    T.eq(T.text(T.must(T.$("#todo-count"), "#todo-count")), "3 项未完成", "#todo-count");
    T.eq(T.must(T.$("#clear-completed"), "#clear-completed").disabled, true, "没有已完成时 #clear-completed 是否禁用");
  }],
  ["勾选完成", async (T) => {
    const second = T.$$("#todo-list li.todo")[1];
    T.click(second.querySelector(".toggle"));
    await T.wait(30);
    T.eq(T.$$("#todo-list li.todo")[1].classList.contains("completed"), true, "勾选后 li 是否有 class completed");
    T.eq(T.text(T.$("#todo-count")), "2 项未完成", "#todo-count");
    T.eq(T.$("#clear-completed").disabled, false, "有已完成时 #clear-completed 是否禁用");
  }],
  ["筛选", async (T) => {
    const visibleTitles = () => T.$$("#todo-list li.todo").filter((li) => T.visible(li)).map((li) => T.text(li.querySelector(".title")));
    const btn = (f) => T.must(T.$('button[data-filter="' + f + '"]'), "筛选按钮 " + f);
    T.eq(btn("all").getAttribute("aria-pressed"), "true", "默认 all 的 aria-pressed");
    T.click(btn("active"));
    await T.wait(30);
    T.eq(visibleTitles().join(","), "买牛奶,<i>x</i>", "active 筛选结果");
    T.eq(btn("active").getAttribute("aria-pressed"), "true", "active 的 aria-pressed");
    T.eq(btn("all").getAttribute("aria-pressed"), "false", "all 的 aria-pressed");
    T.click(btn("completed"));
    await T.wait(30);
    T.eq(visibleTitles().join(","), "写周报", "completed 筛选结果");
    T.click(btn("all"));
    await T.wait(30);
    T.eq(visibleTitles().length, 3, "all 筛选结果条数");
  }],
  ["双击编辑并保存", async (T) => {
    T.dblclick(T.$$("#todo-list li.todo .title")[0]);
    await T.wait(30);
    const edit = T.must(T.$("#todo-list input.edit"), "双击后出现的 input.edit");
    T.eq(edit.value, "买牛奶", "input.edit 的初始值");
    T.eq(T.active(), edit, "input.edit 应获得焦点");
    T.input(edit, " 买酸奶 ");
    T.key(edit, "Enter");
    await T.wait(30);
    T.eq(T.$("#todo-list input.edit"), null, "保存后 input.edit 应消失");
    T.eq(T.text(T.$$("#todo-list li.todo .title")[0]), "买酸奶", "保存后的文字");
  }],
  ["Esc 放弃修改", async (T) => {
    T.dblclick(T.$$("#todo-list li.todo .title")[0]);
    await T.wait(30);
    const edit = T.must(T.$("#todo-list input.edit"), "input.edit");
    T.input(edit, "不要这个");
    T.key(edit, "Escape");
    await T.wait(30);
    T.eq(T.$("#todo-list input.edit"), null, "Esc 后 input.edit 应消失");
    T.eq(T.text(T.$$("#todo-list li.todo .title")[0]), "买酸奶", "Esc 后文字不变");
  }],
  ["编辑成空白则删除", async (T) => {
    T.dblclick(T.$$("#todo-list li.todo .title")[0]);
    await T.wait(30);
    const edit = T.must(T.$("#todo-list input.edit"), "input.edit");
    T.input(edit, "   ");
    T.key(edit, "Enter");
    await T.wait(30);
    T.eq(T.$$("#todo-list li.todo .title").map((t) => t.textContent).join(","), "写周报,<i>x</i>", "清空保存后剩下的条目");
  }],
  ["清除已完成与删除", async (T) => {
    T.click(T.$("#clear-completed"));
    await T.wait(30);
    T.eq(T.$$("#todo-list li.todo .title").map((t) => t.textContent).join(","), "<i>x</i>", "清除已完成后");
    T.eq(T.text(T.$("#todo-count")), "1 项未完成", "#todo-count");
    T.eq(T.$("#clear-completed").disabled, true, "清除后 #clear-completed 是否禁用");
    T.click(T.$("#todo-list li.todo .delete"));
    await T.wait(30);
    T.eq(T.$$("#todo-list li.todo").length, 0, "删除后条数");
    T.eq(T.text(T.$("#todo-count")), "0 项未完成", "#todo-count");
  }],
]`,
  },

  // ---------------------------------------------------------------- 白金
  {
    id: "fe-platinum-modal",
    tier: "platinum",
    kind: "ui",
    title: "模态对话框",
    tags: ["焦点陷阱", "inert", "无障碍"],
    statement: `做一个可访问的模态对话框。DOM 约定：
- 页面主体放在 #main 里，#main 里有 button#open-dialog（打开对话框）和 #greeting（问候语，初始为空）；
- 对话框元素：role="dialog"、aria-modal="true"、aria-labelledby 指向对话框标题元素的 id；关闭时不可见；
  里面依次有：input#dlg-name、button#dlg-cancel、button#dlg-confirm，以及错误提示 #dlg-error；
- 遮罩层 #dlg-backdrop：对话框打开时可见，关闭时不可见；
- 对话框和遮罩都不在 #main 里。

行为：
- 打开：焦点移到 #dlg-name；#main 加上 inert 属性；document.body.style.overflow 设为 "hidden"；
- 关闭（任何方式）：去掉 #main 的 inert；body 的 style.overflow 恢复成打开之前的值；焦点回到 #open-dialog；清空 #dlg-error；
- 焦点循环：焦点在 #dlg-confirm 上按 Tab 时，阻止默认行为，把焦点移到 #dlg-name；焦点在 #dlg-name 上按 Shift+Tab 时，移到 #dlg-confirm；
- 按 Esc 关闭；
- 点击遮罩关闭；点击对话框内部不关闭；
- #dlg-cancel 关闭；
- #dlg-confirm：名字去掉首尾空白后为空时，#dlg-error 显示「请输入名字」并保持打开；
  否则关闭对话框，#greeting 显示「你好，名字」（名字去掉首尾空白），并清空输入框。

注意：测试派发的是合成键盘事件，浏览器不会自动移动焦点，也不会因为 Esc 自动关闭原生 <dialog>，这些都要自己在 keydown 里处理。`,
    test: String.raw`[
  ["初始状态", async (T) => {
    const dialog = T.must(T.$('[role="dialog"]'), 'role="dialog" 的元素');
    T.eq(T.visible(dialog), false, "对话框初始是否可见");
    T.eq(T.visible(T.must(T.$("#dlg-backdrop"), "#dlg-backdrop")), false, "遮罩初始是否可见");
    const main = T.must(T.$("#main"), "#main");
    T.assert(main.contains(T.must(T.$("#open-dialog"), "#open-dialog")), "#open-dialog 应在 #main 里");
    T.assert(!main.contains(dialog) && !main.contains(T.$("#dlg-backdrop")), "对话框和遮罩不应在 #main 里");
    T.eq(main.hasAttribute("inert"), false, "#main 初始不应 inert");
    T.eq(T.text(T.must(T.$("#greeting"), "#greeting")), "", "#greeting 初始内容");
  }],
  ["打开", async (T) => {
    T.click(T.$("#open-dialog"));
    await T.wait(50);
    const dialog = T.$('[role="dialog"]');
    T.eq(T.visible(dialog), true, "打开后对话框是否可见");
    T.eq(T.visible(T.$("#dlg-backdrop")), true, "打开后遮罩是否可见");
    T.eq(dialog.getAttribute("aria-modal"), "true", "aria-modal");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby") || "");
    T.assert(title && T.text(title) && dialog.contains(title), "aria-labelledby 应指向对话框里有文字的标题");
    T.eq(T.active(), T.$("#dlg-name"), "打开后焦点");
    T.eq(T.$("#main").hasAttribute("inert"), true, "打开后 #main 是否 inert");
    T.eq(document.body.style.overflow, "hidden", "打开后 body 的 overflow");
  }],
  ["焦点循环", async (T) => {
    T.$("#dlg-confirm").focus();
    const prevented = T.press("Tab");
    await T.wait(20);
    T.eq(prevented, true, "在最后一个元素上按 Tab 是否阻止默认行为");
    T.eq(T.active(), T.$("#dlg-name"), "在 #dlg-confirm 上按 Tab 后的焦点");
    T.press("Tab", { shiftKey: true });
    await T.wait(20);
    T.eq(T.active(), T.$("#dlg-confirm"), "在 #dlg-name 上按 Shift+Tab 后的焦点");
  }],
  ["Esc 关闭并还原", async (T) => {
    T.press("Escape");
    await T.wait(50);
    T.eq(T.visible(T.$('[role="dialog"]')), false, "Esc 后对话框是否可见");
    T.eq(T.active(), T.$("#open-dialog"), "关闭后焦点应回到 #open-dialog");
    T.eq(T.$("#main").hasAttribute("inert"), false, "关闭后 #main 是否 inert");
    T.eq(document.body.style.overflow, "", "关闭后 body 的 overflow 应恢复");
  }],
  ["名字为空不能确认，点遮罩关闭", async (T) => {
    T.click(T.$("#open-dialog"));
    await T.wait(50);
    T.input(T.$("#dlg-name"), "   ");
    T.click(T.$("#dlg-confirm"));
    await T.wait(30);
    T.eq(T.text(T.$("#dlg-error")), "请输入名字", "#dlg-error");
    T.eq(T.visible(T.$('[role="dialog"]')), true, "名字为空时对话框应保持打开");
    T.click(T.$('[role="dialog"]'));
    await T.wait(30);
    T.eq(T.visible(T.$('[role="dialog"]')), true, "点对话框内部不应关闭");
    T.click(T.$("#dlg-backdrop"));
    await T.wait(50);
    T.eq(T.visible(T.$('[role="dialog"]')), false, "点遮罩后对话框是否可见");
    T.eq(T.text(T.$("#dlg-error")), "", "关闭后 #dlg-error 应清空");
    T.eq(T.active(), T.$("#open-dialog"), "点遮罩关闭后焦点");
  }],
  ["确认后问候，并恢复原来的 overflow", async (T) => {
    document.body.style.overflow = "scroll";
    T.click(T.$("#open-dialog"));
    await T.wait(50);
    T.eq(document.body.style.overflow, "hidden", "打开后 body 的 overflow");
    T.input(T.$("#dlg-name"), "  小明 ");
    T.click(T.$("#dlg-confirm"));
    await T.wait(50);
    T.eq(T.visible(T.$('[role="dialog"]')), false, "确认后对话框是否可见");
    T.eq(T.text(T.$("#greeting")), "你好，小明", "#greeting");
    T.eq(document.body.style.overflow, "scroll", "关闭后应恢复成打开前的 overflow");
    T.eq(T.$("#dlg-name").value, "", "确认后输入框应清空");
  }],
  ["取消按钮", async (T) => {
    T.click(T.$("#open-dialog"));
    await T.wait(50);
    T.click(T.$("#dlg-cancel"));
    await T.wait(50);
    T.eq(T.visible(T.$('[role="dialog"]')), false, "点取消后对话框是否可见");
    T.eq(T.text(T.$("#greeting")), "你好，小明", "取消不应改变 #greeting");
  }],
]`,
  },
  {
    id: "fe-platinum-virtual",
    tier: "platinum",
    kind: "ui",
    title: "虚拟滚动列表",
    tags: ["虚拟列表", "滚动", "性能"],
    statement: `做一个虚拟滚动列表，一共 10000 行。DOM 约定：
- div#viewport：高度正好 400px（不要加边框和内边距），纵向可滚动（overflow-y: auto），可以获得焦点（tabindex="0"）；
- 每一行是一个 div.row，高度正好 32px，带 data-index 属性（从 0 开始），文字「第 n 行」（n = 下标 + 1）；
- #selected：显示「已选：第 n 行」，没有选中时为空。

要求：
- 内容总高度等于 10000 × 32 = 320000px，滚动条要和真的渲染了 10000 行一样；
- 任何时候页面上的 .row 不超过 40 个：只渲染可见区域附近的行，滚动后更新（监听 scroll 事件即可）；
- 第 i 行在内容里的位置是 i × 32px：滚到 scrollTop = i × 32 时，它正好在视口顶部；
- 点击某行选中它：这一行加 class "selected"，#selected 显示它；行被移出、再渲染回来后选中状态要保持；
- 焦点在 #viewport 上时：↓ / ↑ 把选中行移到下一行 / 上一行（没有选中时选第一行，到头不动），并滚动到让选中行完整可见；阻止默认行为。`,
    test: String.raw`[
  ["结构", async (T) => {
    const vp = T.must(T.$("#viewport"), "#viewport");
    T.near(vp.clientHeight, 400, 2, "#viewport 的高度");
    T.near(vp.scrollHeight, 320000, 2, "内容总高度");
    const rows = T.$$(".row");
    T.assert(rows.length >= 13 && rows.length <= 40, "渲染的行数应在 13 到 40 之间，实际 " + rows.length);
    const first = T.must(T.$('.row[data-index="0"]'), "第 0 行");
    T.eq(T.text(first), "第 1 行", "第 0 行的文字");
    T.near(first.getBoundingClientRect().top - vp.getBoundingClientRect().top, 0, 1, "第 0 行的位置");
    T.near(first.getBoundingClientRect().height, 32, 0.5, "行高");
  }],
  ["滚到中间", async (T) => {
    const vp = T.$("#viewport");
    vp.scrollTop = 160000;
    vp.dispatchEvent(new Event("scroll"));
    await T.frame();
    await T.wait(30);
    const row = T.must(T.$('.row[data-index="5000"]'), "滚到 160000 后的第 5000 行");
    T.eq(T.text(row), "第 5001 行", "第 5000 行的文字");
    T.near(row.getBoundingClientRect().top - vp.getBoundingClientRect().top, 0, 1, "第 5000 行应在视口顶部");
    T.assert(T.$$(".row").length <= 40, "渲染的行数不应超过 40，实际 " + T.$$(".row").length);
  }],
  ["点击选中", async (T) => {
    T.click(T.must(T.$('.row[data-index="5002"]'), "第 5002 行"));
    await T.wait(30);
    T.eq(T.$('.row[data-index="5002"]').classList.contains("selected"), true, "点击后是否有 class selected");
    T.eq(T.text(T.must(T.$("#selected"), "#selected")), "已选：第 5003 行", "#selected");
  }],
  ["移出再回来保持选中", async (T) => {
    const vp = T.$("#viewport");
    vp.scrollTop = 0;
    vp.dispatchEvent(new Event("scroll"));
    await T.frame();
    await T.wait(30);
    T.eq(T.$('.row[data-index="5002"]'), null, "滚到顶部后第 5002 行不应还在页面上");
    vp.scrollTop = 160000;
    vp.dispatchEvent(new Event("scroll"));
    await T.frame();
    await T.wait(30);
    T.eq(T.must(T.$('.row[data-index="5002"]'), "第 5002 行").classList.contains("selected"), true, "滚回来后是否仍选中");
  }],
  ["键盘移动并滚动到可见", async (T) => {
    const vp = T.$("#viewport");
    vp.focus();
    for (let i = 0; i < 3; i++) T.key(vp, "ArrowDown");
    await T.frame();
    await T.wait(30);
    T.eq(T.text(T.$("#selected")), "已选：第 5006 行", "按三次 ↓ 后");
    const prevented = T.key(vp, "ArrowDown");
    T.eq(prevented, true, "↓ 是否阻止默认行为");
    for (let i = 0; i < 19; i++) T.key(vp, "ArrowDown");
    await T.frame();
    await T.wait(50);
    T.eq(T.text(T.$("#selected")), "已选：第 5026 行", "再按 20 次 ↓ 后");
    const row = T.must(T.$('.row[data-index="5025"]'), "选中的第 5025 行");
    const r = row.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    T.assert(r.top >= v.top - 1 && r.bottom <= v.bottom + 1, "选中行应完整显示在视口里");
    T.eq(row.classList.contains("selected"), true, "第 5025 行是否有 class selected");
  }],
  ["滚到底", async (T) => {
    const vp = T.$("#viewport");
    vp.scrollTop = 1e9;
    vp.dispatchEvent(new Event("scroll"));
    await T.frame();
    await T.wait(30);
    const last = T.must(T.$('.row[data-index="9999"]'), "最后一行");
    T.near(last.getBoundingClientRect().bottom, vp.getBoundingClientRect().top + vp.clientHeight, 1, "最后一行应贴着视口底部");
    T.assert(T.$$(".row").length <= 40, "渲染的行数不应超过 40");
  }],
]`,
  },

  // ---------------------------------------------------------------- 钻石
  {
    id: "fe-diamond-sortable",
    tier: "diamond",
    kind: "ui",
    title: "可排序列表",
    tags: ["拖拽", "键盘排序", "实时播报"],
    statement: `做一个既能用鼠标拖拽、也能用键盘排序的列表。初始顺序：苹果(a)、香蕉(b)、樱桃(c)、葡萄(d)、芒果(e)、桃子(f)，括号里是 id。

DOM 约定：
- ul#sortable，每一项是 li.item，data-id 为上面的 id，文字为水果名；每一项都能获得焦点（tabindex）；
- #order：始终显示当前顺序的 id，用英文逗号连接，如「a,b,c,d,e,f」；
- #live：role="status" 或 aria-live="polite" 的播报区域。

键盘（焦点在某一项上）：
- 没拿起时：↑ / ↓ 把焦点移到上一项 / 下一项；
- 空格：拿起这一项（加 class "grabbed"），#live 显示「已拿起 水果名，当前位置第 k 项」；
- 拿起时 ↑ / ↓：把它往上 / 下移一位（到头不动），焦点保持在这一项上，#live 显示「已移动到第 k 项」；
- 拿起时空格或 Enter：放下（去掉 grabbed），#live 显示「已放下，位于第 k 项」；
- 拿起时 Esc：取消，恢复到拿起之前的顺序，去掉 grabbed，#live 显示「已取消」；
- 以上按键都要阻止默认行为。k 从 1 开始数。

鼠标拖拽（只用 pointer 事件，不要用 HTML5 的 draggable）：
- 在一项上 pointerdown，移动后在另一项上 pointerup：把被拖的项移到松开处那一项的位置 —— 松开在那一项的上半部分就放到它前面，下半部分就放到它后面；
- 拖动过程中可以有视觉反馈，但列表顺序在 pointerup 时才改变；
- 测试派发的是合成的 pointer 事件（pointerId 为 1），pointermove 和 pointerup 派发给指针下的元素并冒泡到 document；不要依赖 setPointerCapture。`,
    test: String.raw`[
  ["初始状态", async (T) => {
    const ids = () => T.$$("#sortable li.item").map((li) => li.dataset.id).join(",");
    T.eq(ids(), "a,b,c,d,e,f", "初始顺序");
    T.eq(T.$$("#sortable li.item").map((li) => T.text(li)).join(","), "苹果,香蕉,樱桃,葡萄,芒果,桃子", "初始文字");
    T.eq(T.text(T.must(T.$("#order"), "#order")), "a,b,c,d,e,f", "#order");
    const live = T.must(T.$("#live"), "#live");
    T.assert(live.getAttribute("role") === "status" || live.getAttribute("aria-live") === "polite", "#live 应是 role=status 或 aria-live=polite");
  }],
  ["方向键移动焦点", async (T) => {
    const item = (id) => T.$('#sortable li.item[data-id="' + id + '"]');
    item("a").focus();
    T.press("ArrowDown");
    await T.wait(20);
    T.eq(T.active(), item("b"), "在苹果上按 ↓ 后的焦点");
    T.press("ArrowDown");
    T.press("ArrowUp");
    await T.wait(20);
    T.eq(T.active(), item("b"), "↓ 再 ↑ 后的焦点");
    T.eq(T.text(T.$("#order")), "a,b,c,d,e,f", "只移动焦点不应改变顺序");
  }],
  ["拿起、移动、放下", async (T) => {
    const item = (id) => T.$('#sortable li.item[data-id="' + id + '"]');
    T.eq(T.press(" "), true, "空格是否阻止默认行为");
    await T.wait(20);
    T.eq(item("b").classList.contains("grabbed"), true, "拿起后是否有 class grabbed");
    T.assert(T.text(T.$("#live")).includes("已拿起") && T.text(T.$("#live")).includes("香蕉"), "#live 应播报已拿起香蕉，实际：" + T.text(T.$("#live")));
    T.press("ArrowDown");
    await T.wait(20);
    T.press("ArrowDown");
    await T.wait(20);
    T.eq(T.text(T.$("#order")), "a,c,d,b,e,f", "下移两位后的顺序");
    T.eq(T.active(), item("b"), "移动后焦点应还在香蕉上");
    T.assert(T.text(T.$("#live")).includes("第 4 项") || T.text(T.$("#live")).includes("第4项"), "#live 应播报第 4 项，实际：" + T.text(T.$("#live")));
    T.press(" ");
    await T.wait(20);
    T.eq(item("b").classList.contains("grabbed"), false, "放下后是否还有 class grabbed");
    T.assert(T.text(T.$("#live")).includes("已放下"), "#live 应播报已放下，实际：" + T.text(T.$("#live")));
    T.eq(T.$$("#sortable li.item").map((li) => li.dataset.id).join(","), "a,c,d,b,e,f", "DOM 里的顺序");
  }],
  ["Esc 取消", async (T) => {
    const item = (id) => T.$('#sortable li.item[data-id="' + id + '"]');
    item("e").focus();
    T.press(" ");
    await T.wait(20);
    for (let i = 0; i < 3; i++) { T.press("ArrowUp"); await T.wait(20); }
    T.eq(T.text(T.$("#order")), "a,e,c,d,b,f", "上移三位后的顺序");
    T.press("Escape");
    await T.wait(20);
    T.eq(T.text(T.$("#order")), "a,c,d,b,e,f", "Esc 后应恢复顺序");
    T.eq(item("e").classList.contains("grabbed"), false, "Esc 后是否还有 class grabbed");
    T.assert(T.text(T.$("#live")).includes("已取消"), "#live 应播报已取消");
  }],
  ["到头不动，Enter 放下", async (T) => {
    const item = (id) => T.$('#sortable li.item[data-id="' + id + '"]');
    item("a").focus();
    T.press(" ");
    await T.wait(20);
    T.press("ArrowUp");
    await T.wait(20);
    T.eq(T.text(T.$("#order")), "a,c,d,b,e,f", "第一项上移应不动");
    T.press("Enter");
    await T.wait(20);
    T.eq(item("a").classList.contains("grabbed"), false, "Enter 后应放下");
  }],
  ["鼠标拖拽", async (T) => {
    const item = (id) => T.$('#sortable li.item[data-id="' + id + '"]');
    let r = item("c").getBoundingClientRect();
    await T.drag(item("f"), r.left + r.width / 2, r.top + r.height * 0.75);
    await T.wait(30);
    T.eq(T.text(T.$("#order")), "a,c,f,d,b,e", "把桃子拖到樱桃下半部分后的顺序");
    r = item("b").getBoundingClientRect();
    await T.drag(item("a"), r.left + r.width / 2, r.top + r.height * 0.25);
    await T.wait(30);
    T.eq(T.text(T.$("#order")), "c,f,d,a,b,e", "把苹果拖到香蕉上半部分后的顺序");
    T.eq(T.$$("#sortable li.item").map((li) => li.dataset.id).join(","), "c,f,d,a,b,e", "DOM 里的顺序");
  }],
]`,
  },
  {
    id: "fe-diamond-table",
    tier: "diamond",
    kind: "ui",
    title: "数据表格",
    tags: ["排序", "筛选", "分页"],
    statement: `做一个带排序、筛选、分页的数据表格。数据共 57 行，第 i 行（i 从 1 到 57）：
- name：「User」+ i（User1 … User57）
- age：(i × 37) % 50 + 18
- city：["Beijing", "Shanghai", "Shenzhen", "Hangzhou"][i % 4]
- score：(i × 73) % 101

DOM 约定：
- input#filter：筛选输入框；
- table#grid：thead 里四个表头依次是 name、age、city、score，每个 th 里有一个 button（点它排序），th 带 aria-sort（"ascending" / "descending" / "none"）；
- tbody 里每行一个 tr，四个 td 依次是 name、age、city、score（纯文本）；
- button#prev、button#next 翻页，#page 显示「第 x / y 页」。

规则：
- 每页 10 行；初始第 1 页，原始顺序（i 从小到大）；
- 点表头按钮：这一列按「升序 → 降序 → 恢复原始顺序」循环；点另一列时那一列从升序开始，原来的列变回 none；
- age、score 按数值比较；name 按自然顺序（User2 排在 User10 前面）；city 按字符串比较；值相同的保持原始顺序（稳定排序）；
- 筛选（input 事件）：不区分大小写，name 或 city 包含输入内容的行保留；筛选条件变化后回到第 1 页；
- 排序变化时保持当前页码；
- 第 1 页时 #prev 禁用，最后一页时 #next 禁用；一行都没有时 #page 显示「第 0 / 0 页」，两个按钮都禁用。`,
    test: String.raw`[
  ["初始状态", async (T) => {
    T.must(T.$("#grid"), "#grid");
    const heads = T.$$("#grid thead th");
    T.eq(heads.length, 4, "表头数量");
    T.eq(heads.map((th) => T.text(th)).join(","), "name,age,city,score", "表头文字");
    heads.forEach((th) => { T.must(th.querySelector("button"), "表头里的 button"); T.eq(th.getAttribute("aria-sort"), "none", T.text(th) + " 的初始 aria-sort"); });
    const rows = T.$$("#grid tbody tr");
    T.eq(rows.length, 10, "第 1 页的行数");
    T.eq(Array.from(rows[0].children).map((td) => T.text(td)).join("|"), "User1|55|Shanghai|73", "第一行");
    T.eq(T.text(T.must(T.$("#page"), "#page")), "第 1 / 6 页", "#page");
    T.eq(T.must(T.$("#prev"), "#prev").disabled, true, "第 1 页时 #prev 是否禁用");
    T.eq(T.must(T.$("#next"), "#next").disabled, false, "#next 是否禁用");
  }],
  ["翻到最后一页", async (T) => {
    for (let i = 0; i < 5; i++) { T.click(T.$("#next")); await T.wait(10); }
    T.eq(T.text(T.$("#page")), "第 6 / 6 页", "#page");
    T.eq(T.$$("#grid tbody tr").length, 7, "最后一页的行数");
    T.eq(T.text(T.$("#grid tbody tr td")), "User51", "最后一页第一行");
    T.eq(T.$("#next").disabled, true, "最后一页 #next 是否禁用");
    T.eq(T.$("#prev").disabled, false, "#prev 是否禁用");
  }],
  ["按 age 排序并保持页码", async (T) => {
    const data = Array.from({ length: 57 }, (_, k) => { const i = k + 1; return { name: "User" + i, age: (i * 37) % 50 + 18, city: ["Beijing", "Shanghai", "Shenzhen", "Hangzhou"][i % 4], score: (i * 73) % 101 }; });
    const asc = data.slice().sort((x, y) => x.age - y.age);
    const btn = (n) => T.$$("#grid thead th")[n].querySelector("button");
    T.click(btn(1));
    await T.wait(20);
    T.eq(T.$$("#grid thead th")[1].getAttribute("aria-sort"), "ascending", "age 的 aria-sort");
    T.eq(T.text(T.$("#page")), "第 6 / 6 页", "排序后应保持页码");
    T.eq(T.$$("#grid tbody tr").map((tr) => T.text(tr.children[0])).join(","), asc.slice(50).map((r) => r.name).join(","), "age 升序第 6 页");
    for (let i = 0; i < 5; i++) { T.click(T.$("#prev")); await T.wait(10); }
    T.eq(T.$$("#grid tbody tr").map((tr) => T.text(tr.children[0])).join(","), asc.slice(0, 10).map((r) => r.name).join(","), "age 升序第 1 页（相同年龄保持原顺序）");
    T.click(btn(1));
    await T.wait(20);
    const desc = data.slice().sort((x, y) => y.age - x.age);
    T.eq(T.$$("#grid thead th")[1].getAttribute("aria-sort"), "descending", "第二次点 age 的 aria-sort");
    T.eq(T.$$("#grid tbody tr").map((tr) => T.text(tr.children[0])).join(","), desc.slice(0, 10).map((r) => r.name).join(","), "age 降序第 1 页");
    T.click(btn(1));
    await T.wait(20);
    T.eq(T.$$("#grid thead th")[1].getAttribute("aria-sort"), "none", "第三次点 age 的 aria-sort");
    T.eq(T.text(T.$("#grid tbody tr td")), "User1", "恢复原始顺序后的第一行");
  }],
  ["name 按自然顺序，切换列", async (T) => {
    const btn = (n) => T.$$("#grid thead th")[n].querySelector("button");
    T.click(btn(0));
    await T.wait(20);
    T.eq(T.$$("#grid tbody tr").map((tr) => T.text(tr.children[0])).join(","), "User1,User2,User3,User4,User5,User6,User7,User8,User9,User10", "name 升序第 1 页");
    T.click(btn(0));
    await T.wait(20);
    T.eq(T.text(T.$("#grid tbody tr td")), "User57", "name 降序第一行");
    T.click(btn(3));
    await T.wait(20);
    T.eq(T.$$("#grid thead th")[0].getAttribute("aria-sort"), "none", "点 score 后 name 的 aria-sort");
    T.eq(T.$$("#grid thead th")[3].getAttribute("aria-sort"), "ascending", "score 的 aria-sort");
    const data = Array.from({ length: 57 }, (_, k) => { const i = k + 1; return { name: "User" + i, score: (i * 73) % 101 }; });
    const asc = data.slice().sort((x, y) => x.score - y.score);
    T.eq(T.$$("#grid tbody tr").map((tr) => T.text(tr.children[0])).join(","), asc.slice(0, 10).map((r) => r.name).join(","), "score 升序第 1 页");
  }],
  ["筛选回到第 1 页", async (T) => {
    T.click(T.$("#next"));
    await T.wait(10);
    T.input(T.must(T.$("#filter"), "#filter"), "SHEN");
    await T.wait(30);
    T.eq(T.text(T.$("#page")), "第 1 / 2 页", "筛选 SHEN 后的 #page");
    const data = Array.from({ length: 57 }, (_, k) => { const i = k + 1; return { name: "User" + i, city: ["Beijing", "Shanghai", "Shenzhen", "Hangzhou"][i % 4], score: (i * 73) % 101 }; });
    const rows = data.filter((r) => r.city === "Shenzhen").sort((x, y) => x.score - y.score);
    T.eq(T.$$("#grid tbody tr").map((tr) => T.text(tr.children[0])).join(","), rows.slice(0, 10).map((r) => r.name).join(","), "筛选并按 score 升序的第 1 页");
    T.input(T.$("#filter"), "user5");
    await T.wait(30);
    T.eq(T.$$("#grid tbody tr").length, 9, "筛选 user5 的行数");
    T.eq(T.text(T.$("#page")), "第 1 / 1 页", "#page");
    T.eq(T.$("#next").disabled, true, "只有一页时 #next 是否禁用");
  }],
  ["没有结果", async (T) => {
    T.input(T.$("#filter"), "zzz");
    await T.wait(30);
    T.eq(T.$$("#grid tbody tr").length, 0, "没有结果时的行数");
    T.eq(T.text(T.$("#page")), "第 0 / 0 页", "没有结果时的 #page");
    T.eq(T.$("#prev").disabled, true, "#prev 是否禁用");
    T.eq(T.$("#next").disabled, true, "#next 是否禁用");
  }],
]`,
  },

  // ---------------------------------------------------------------- 王者
  {
    id: "fe-king-sheet",
    tier: "king",
    kind: "ui",
    title: "迷你电子表格",
    tags: ["表达式解析", "依赖图", "循环检测"],
    statement: `做一个 5 列 × 6 行的迷你电子表格，列 A–E，行 1–6。每个单元格是一个 input，id 就是单元格名（A1 … E6）。

编辑与显示：
- 在单元格里输入（input 事件）只是编辑；按 Enter（keydown）或单元格失去焦点（blur）时「提交」，提交后重新计算所有受影响的单元格；
  按 Enter 提交后焦点仍在这个单元格上，它继续显示原文；随后失去焦点时再提交一次，内容不变；
- 单元格没有焦点时，input 的值显示计算结果；获得焦点（focus 事件）时显示用户输入的原文（如公式 =A1*2）。

内容：
- 空：显示为空，被引用时当作 0；
- 数字（如 3、-2.5）：值就是这个数；
- 以 = 开头的是公式；其他内容是文本，原样显示，被公式引用时得到 #VALUE!。

公式：
- 支持数字、单元格引用（A1，大小写都可以）、+ - * /、括号、一元负号（如 =-A1、=2*-3、=-(1+2)），按常规优先级，从左到右；
- 函数 SUM、MIN、MAX（大小写都可以）：参数用逗号分隔，每个参数是表达式或区域（如 SUM(A1:B3)、SUM(A1, B2:B3, 4)）；
  区域是矩形，也可以倒着写（B3:A1）；区域里的空单元格忽略；MIN / MAX 一个值都没有时为 0。

错误（单元格显示这些文字）：
- 除以 0：#DIV/0!
- 引用了文本：#VALUE!
- 公式写错（无法解析、引用不存在的单元格如 F1 或 A7、未知函数）：#ERROR!
- 循环引用：处在循环里的所有单元格显示 #CYCLE!（包括引用自己）
- 公式引用了出错的单元格：显示同样的错误；有多个时取第一个遇到的（按公式里从左到右、区域按行优先的顺序计算）。

数字显示：整数原样显示；非整数四舍五入保留最多 4 位小数，并去掉末尾的 0（1/3 显示 0.3333，2.5 显示 2.5，0.1+0.2 显示 0.3）。`,
    test: String.raw`[
  ["结构", async (T) => {
    for (const c of "ABCDE") for (let r = 1; r <= 6; r++) T.must(T.$("input#" + c + r), "input#" + c + r);
  }],
  ["数字、文本与公式", async (T) => {
    const set = async (id, raw) => { const el = T.$("#" + id); T.focus(el); T.input(el, raw); T.key(el, "Enter"); T.blur(el); await T.wait(20); };
    await set("A1", "5");
    T.eq(T.$("#A1").value, "5", "A1");
    await set("A4", "hello");
    T.eq(T.$("#A4").value, "hello", "A4");
    await set("B1", "=A1*2");
    T.eq(T.$("#B1").value, "10", "B1 = A1*2");
    const b1 = T.$("#B1");
    T.focus(b1);
    await T.wait(20);
    T.eq(b1.value, "=A1*2", "B1 获得焦点时应显示公式原文");
    T.blur(b1);
    await T.wait(20);
    T.eq(b1.value, "10", "B1 失去焦点后应显示结果");
  }],
  ["依赖更新与区域", async (T) => {
    const set = async (id, raw) => { const el = T.$("#" + id); T.focus(el); T.input(el, raw); T.key(el, "Enter"); T.blur(el); await T.wait(20); };
    await set("A1", "7");
    T.eq(T.$("#B1").value, "14", "A1 改成 7 后 B1");
    await set("C1", "=SUM(A1:B1)");
    T.eq(T.$("#C1").value, "21", "C1 = SUM(A1:B1)");
    await set("C2", "=sum(b1:a1) + 1");
    T.eq(T.$("#C2").value, "22", "C2 = sum(b1:a1) + 1");
  }],
  ["优先级、负号与小数", async (T) => {
    const set = async (id, raw) => { const el = T.$("#" + id); T.focus(el); T.input(el, raw); T.key(el, "Enter"); T.blur(el); await T.wait(20); };
    await set("E1", "=(A1+1)*-2");
    T.eq(T.$("#E1").value, "-16", "E1 = (A1+1)*-2");
    await set("E2", "=2+3*4-6/3");
    T.eq(T.$("#E2").value, "12", "E2 = 2+3*4-6/3");
    await set("E3", "=-(-3)-1");
    T.eq(T.$("#E3").value, "2", "E3 = -(-3)-1");
    await set("A3", "=1/3");
    T.eq(T.$("#A3").value, "0.3333", "A3 = 1/3");
    await set("A5", "=2.5*1");
    T.eq(T.$("#A5").value, "2.5", "A5 = 2.5*1");
    await set("A6", "=0.1+0.2");
    T.eq(T.$("#A6").value, "0.3", "A6 = 0.1+0.2");
  }],
  ["错误", async (T) => {
    const set = async (id, raw) => { const el = T.$("#" + id); T.focus(el); T.input(el, raw); T.key(el, "Enter"); T.blur(el); await T.wait(20); };
    await set("D1", "=C1/0");
    T.eq(T.$("#D1").value, "#DIV/0!", "D1 = C1/0");
    await set("B4", "=A4+1");
    T.eq(T.$("#B4").value, "#VALUE!", "B4 引用文本");
    await set("D2", "=A1+");
    T.eq(T.$("#D2").value, "#ERROR!", "D2 公式不完整");
    await set("D3", "=F1");
    T.eq(T.$("#D3").value, "#ERROR!", "D3 引用不存在的单元格");
    await set("D4", "=FOO(A1)");
    T.eq(T.$("#D4").value, "#ERROR!", "D4 未知函数");
    await set("D5", "=D1+1");
    T.eq(T.$("#D5").value, "#DIV/0!", "D5 引用出错的单元格");
    await set("D6", "=SUM(A1, B4, D1)");
    T.eq(T.$("#D6").value, "#VALUE!", "D6 取第一个遇到的错误");
  }],
  ["循环引用", async (T) => {
    const set = async (id, raw) => { const el = T.$("#" + id); T.focus(el); T.input(el, raw); T.key(el, "Enter"); T.blur(el); await T.wait(20); };
    await set("A2", "=B2");
    await set("B2", "=A2");
    T.eq(T.$("#A2").value, "#CYCLE!", "A2 在循环里");
    T.eq(T.$("#B2").value, "#CYCLE!", "B2 在循环里");
    await set("C3", "=A2+1");
    T.eq(T.$("#C3").value, "#CYCLE!", "C3 引用循环里的单元格");
    await set("E4", "=E4+1");
    T.eq(T.$("#E4").value, "#CYCLE!", "E4 引用自己");
    await set("B2", "3");
    T.eq(T.$("#A2").value, "3", "打破循环后 A2");
    T.eq(T.$("#C3").value, "4", "打破循环后 C3");
  }],
  ["函数与链式更新", async (T) => {
    const set = async (id, raw) => { const el = T.$("#" + id); T.focus(el); T.input(el, raw); T.key(el, "Enter"); T.blur(el); await T.wait(20); };
    await set("E5", "=MAX(A1:C1)");
    T.eq(T.$("#E5").value, "21", "E5 = MAX(A1:C1)");
    await set("E6", "=min(B5:C6)");
    T.eq(T.$("#E6").value, "0", "E6 空区域的 MIN");
    await set("C4", "=SUM(A1, B2:B2, 4)");
    T.eq(T.$("#C4").value, "14", "C4 = SUM(A1, B2:B2, 4)");
    await set("A1", "1");
    T.eq(T.$("#B1").value, "2", "A1 改成 1 后 B1");
    T.eq(T.$("#C1").value, "3", "C1");
    T.eq(T.$("#C2").value, "4", "C2");
    T.eq(T.$("#E1").value, "-4", "E1");
    T.eq(T.$("#E5").value, "3", "E5");
    T.eq(T.$("#C4").value, "8", "C4");
    T.eq(T.$("#D1").value, "#DIV/0!", "D1 仍是除以 0");
  }],
]`,
  },
  {
    id: "fe-king-datepicker",
    tier: "king",
    kind: "ui",
    title: "键盘日期选择器",
    tags: ["日期计算", "网格导航", "无障碍"],
    statement: `做一个可以完全用键盘操作的日期选择器（不要用 <input type="date">）。

DOM 约定：
- input#date：文本框，显示选中的日期，格式 YYYY-MM-DD，初始为空；带 data-min="2024-01-10" 和 data-max="2024-12-20" 两个属性（可选范围，写死在页面里）；
- button#date-toggle：打开 / 关闭日历，aria-haspopup="dialog"，aria-expanded 为 "true" / "false"；
- 日历弹层 #calendar：role="dialog"，关闭时隐藏；
- #calendar-title：显示「YYYY年M月」，如「2024年3月」；
- button#prev-month、button#next-month：切换到上 / 下个月；
- 日期网格：role="grid" 的元素，里面当月每一天是一个 button，带 data-date="YYYY-MM-DD"；只渲染当月的天（补位处留空）；一周从星期一开始，每周一行，同一星期几在同一列；
- 选中的那天 aria-selected="true"，其他天为 "false"；焦点所在的那天 tabindex="0"，其他天 tabindex="-1"；
- 范围外的日期 aria-disabled="true"，不能选中。

行为：
- 打开：已选了日期就显示那个月、焦点在选中那天；否则显示 2024年3月、焦点在 2024-03-15。打开后焦点移到这个日期按钮上；
- 焦点在日期按钮上时：
  ← / →：前 / 后一天；↑ / ↓：前 / 后 7 天；Home / End：本周的星期一 / 星期日；
  PageUp / PageDown：上 / 下个月的同一天，那个月没有这一天时取那个月最后一天（1 月 31 日 → 2 月 29 日）；
  Shift+PageUp / Shift+PageDown：上 / 下一年的同一天（同样处理 2 月 29 日）；
  移到别的月份时日历切换到那个月并聚焦那一天；焦点可以移到范围外的日期上，但不能选它；
  Enter 或空格：选中焦点所在的那天（范围外的不响应），把日期填进 input#date，关闭日历，焦点回到 #date-toggle；
  Esc：关闭日历，不改变选择，焦点回到 #date-toggle；
  这些按键都要阻止默认行为；
- 点击某一天：和按 Enter 一样；
- 点 #prev-month / #next-month：切换月份，焦点所在的日期移到新月份的同一天（没有就取最后一天，这一天 tabindex="0"），但页面焦点留在按钮上；
- 在 input#date 里输入并提交（change 事件）：是合法日期（YYYY-MM-DD）且在范围内时成为选中日期；否则恢复显示原来的选中日期（没有就为空）。

注意：测试派发的是合成键盘事件，浏览器不会自动移动焦点，焦点都要自己用 focus() 移动。`,
    test: String.raw`[
  ["初始状态", async (T) => {
    T.eq(T.must(T.$("#date"), "#date").value, "", "#date 初始值");
    const toggle = T.must(T.$("#date-toggle"), "#date-toggle");
    T.eq(toggle.getAttribute("aria-expanded"), "false", "初始 aria-expanded");
    T.eq(toggle.getAttribute("aria-haspopup"), "dialog", "aria-haspopup");
    T.eq(T.visible(T.$("#calendar")), false, "日历初始是否可见");
  }],
  ["打开与网格", async (T) => {
    T.click(T.$("#date-toggle"));
    await T.wait(50);
    T.eq(T.visible(T.$("#calendar")), true, "打开后日历是否可见");
    T.eq(T.$("#calendar").getAttribute("role"), "dialog", "#calendar 的 role");
    T.eq(T.$("#date-toggle").getAttribute("aria-expanded"), "true", "打开后 aria-expanded");
    T.eq(T.text(T.$("#calendar-title")), "2024年3月", "标题");
    T.eq(T.active() && T.active().dataset.date, "2024-03-15", "打开后的焦点");
    const days = T.$$('[role="grid"] button[data-date]');
    T.eq(days.length, 31, "3 月的天数");
    T.eq(days.filter((b) => b.getAttribute("tabindex") === "0").length, 1, "tabindex=0 的按钮数量");
    const left = (d) => T.$('[data-date="2024-03-' + d + '"]').getBoundingClientRect().left;
    T.near(left("04"), left("11"), 1, "3 月 4 日和 11 日应在同一列");
    T.near(left("01"), left("08"), 1, "3 月 1 日和 8 日应在同一列");
    T.assert(left("04") < left("01"), "一周从星期一开始：3 月 4 日（星期一）应在 3 月 1 日（星期五）左边");
  }],
  ["方向键、Home、End、翻月翻年", async (T) => {
    const at = () => T.active() && T.active().dataset.date;
    T.eq(T.press("ArrowRight"), true, "→ 是否阻止默认行为");
    await T.wait(20);
    T.eq(at(), "2024-03-16", "→ 之后");
    T.press("ArrowDown");
    await T.wait(20);
    T.eq(at(), "2024-03-23", "↓ 之后");
    T.press("Home");
    await T.wait(20);
    T.eq(at(), "2024-03-18", "Home 之后（本周星期一）");
    T.press("End");
    await T.wait(20);
    T.eq(at(), "2024-03-24", "End 之后（本周星期日）");
    T.press("PageDown");
    await T.wait(30);
    T.eq(at(), "2024-04-24", "PageDown 之后");
    T.eq(T.text(T.$("#calendar-title")), "2024年4月", "PageDown 之后的标题");
    T.press("PageDown", { shiftKey: true });
    await T.wait(30);
    T.eq(at(), "2025-04-24", "Shift+PageDown 之后");
    T.press("PageUp", { shiftKey: true });
    await T.wait(30);
    T.eq(at(), "2024-04-24", "Shift+PageUp 之后");
    T.eq(T.$('[data-date="2024-04-24"]').getAttribute("tabindex"), "0", "焦点日期的 tabindex");
  }],
  ["月末与闰年", async (T) => {
    const at = () => T.active() && T.active().dataset.date;
    for (let i = 0; i < 3; i++) { T.press("PageUp"); await T.wait(20); }
    T.eq(at(), "2024-01-24", "三次 PageUp 之后");
    T.press("ArrowDown");
    await T.wait(20);
    T.eq(at(), "2024-01-31", "↓ 之后");
    T.press("PageDown");
    await T.wait(30);
    T.eq(at(), "2024-02-29", "1 月 31 日按 PageDown 应到 2 月 29 日");
    T.press("PageDown", { shiftKey: true });
    await T.wait(30);
    T.eq(at(), "2025-02-28", "2024-02-29 按 Shift+PageDown 应到 2025-02-28");
    T.eq(T.text(T.$("#calendar-title")), "2025年2月", "标题");
  }],
  ["范围外不能选，范围内选中", async (T) => {
    const at = () => T.active() && T.active().dataset.date;
    T.eq(T.active().getAttribute("aria-disabled"), "true", "2025-02-28 在范围外，应 aria-disabled");
    T.press("Enter");
    await T.wait(30);
    T.eq(T.visible(T.$("#calendar")), true, "范围外按 Enter 日历应保持打开");
    T.eq(T.$("#date").value, "", "范围外按 Enter 不应选中");
    T.press("PageUp", { shiftKey: true });
    await T.wait(30);
    T.eq(at(), "2024-02-28", "Shift+PageUp 之后");
    T.press("ArrowRight");
    await T.wait(20);
    T.press("Enter");
    await T.wait(30);
    T.eq(T.$("#date").value, "2024-02-29", "选中后 #date");
    T.eq(T.visible(T.$("#calendar")), false, "选中后日历是否可见");
    T.eq(T.active(), T.$("#date-toggle"), "选中后焦点");
    T.eq(T.$("#date-toggle").getAttribute("aria-expanded"), "false", "选中后 aria-expanded");
  }],
  ["重新打开与 Esc", async (T) => {
    T.click(T.$("#date-toggle"));
    await T.wait(50);
    T.eq(T.text(T.$("#calendar-title")), "2024年2月", "重新打开的标题");
    T.eq(T.active() && T.active().dataset.date, "2024-02-29", "重新打开的焦点");
    T.eq(T.active().getAttribute("aria-selected"), "true", "选中日期的 aria-selected");
    T.press("ArrowRight");
    await T.wait(30);
    T.press("Escape");
    await T.wait(30);
    T.eq(T.visible(T.$("#calendar")), false, "Esc 后日历是否可见");
    T.eq(T.$("#date").value, "2024-02-29", "Esc 不应改变选择");
    T.eq(T.active(), T.$("#date-toggle"), "Esc 后焦点");
  }],
  ["月份按钮与点击选择", async (T) => {
    T.click(T.$("#date-toggle"));
    await T.wait(50);
    T.click(T.must(T.$("#next-month"), "#next-month"));
    await T.wait(30);
    T.eq(T.text(T.$("#calendar-title")), "2024年3月", "点下个月后的标题");
    T.eq(T.active(), T.$("#next-month"), "点下个月后焦点应留在按钮上");
    T.eq(T.$('[data-date="2024-03-29"]').getAttribute("tabindex"), "0", "3 月 29 日的 tabindex");
    T.click(T.$('[data-date="2024-03-05"]'));
    await T.wait(30);
    T.eq(T.$("#date").value, "2024-03-05", "点击 3 月 5 日后");
    T.eq(T.visible(T.$("#calendar")), false, "点击选择后日历是否可见");
  }],
  ["手动输入", async (T) => {
    const input = T.$("#date");
    T.input(input, "2024-12-25");
    T.change(input);
    await T.wait(30);
    T.eq(input.value, "2024-03-05", "超出范围的输入应恢复原来的日期");
    T.input(input, "2024-02-30");
    T.change(input);
    await T.wait(30);
    T.eq(input.value, "2024-03-05", "不存在的日期应恢复原来的日期");
    T.input(input, "2024-07-04");
    T.change(input);
    await T.wait(30);
    T.eq(input.value, "2024-07-04", "合法输入");
    T.click(T.$("#date-toggle"));
    await T.wait(50);
    T.eq(T.text(T.$("#calendar-title")), "2024年7月", "打开后的标题");
    T.eq(T.active() && T.active().dataset.date, "2024-07-04", "打开后的焦点");
  }],
  ["下限", async (T) => {
    for (let i = 0; i < 6; i++) { T.press("PageUp"); await T.wait(20); }
    T.eq(T.active() && T.active().dataset.date, "2024-01-04", "六次 PageUp 之后");
    T.eq(T.active().getAttribute("aria-disabled"), "true", "2024-01-04 在范围外");
    for (let i = 0; i < 6; i++) { T.press("ArrowRight"); await T.wait(10); }
    T.eq(T.active().getAttribute("aria-disabled") === "true", false, "2024-01-10 在范围内");
    T.press(" ");
    await T.wait(30);
    T.eq(T.$("#date").value, "2024-01-10", "按空格选中");
  }],
]`,
  },
];
