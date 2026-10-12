import type { Category, Question } from "./types";

export const BANK_VERSION = "2026.10.2";

/**
 * 内置题库。全部为客观题，本地判分，不依赖裁判模型。
 * 修改题目后请递增 BANK_VERSION，否则同一 seed 的历史结果不可比。
 */
export const QUESTIONS: Question[] = [
  // ---------- 推理 reasoning ----------
  {
    id: "reason-001",
    category: "reasoning",
    prompt: "一个笼子里有鸡和兔共 35 只，脚共 94 只。问鸡和兔各多少只？只回答两个数字，格式：鸡=x,兔=y",
    match: "regex",
    // 数字后面不能紧跟数字，避免「兔=120」也能匹配
    accept: ["鸡\\s*=\\s*23(?!\\d)\\D+兔\\s*=\\s*12(?!\\d)", "兔\\s*=\\s*12(?!\\d)\\D+鸡\\s*=\\s*23(?!\\d)"],
    weight: 2,
    difficulty: 2,
  },
  {
    id: "reason-002",
    category: "reasoning",
    prompt: "数列：2, 6, 12, 20, 30, ? 请只回答下一个数字。",
    match: "exact",
    expected: "42",
    weight: 1,
    difficulty: 1,
  },
  {
    id: "reason-003",
    category: "reasoning",
    prompt:
      "三个人 A、B、C 中只有一人说真话。A 说：B 在说谎。B 说：C 在说谎。C 说：A 和 B 都在说谎。谁说的是真话？只回答 A、B 或 C。",
    match: "exact",
    expected: "B",
    weight: 3,
    difficulty: 4,
  },
  {
    id: "reason-004",
    category: "reasoning",
    prompt: "一个池塘里的荷叶每天面积翻倍，第 48 天铺满整个池塘。第几天铺满一半？只回答数字。",
    match: "exact",
    expected: "47",
    weight: 1,
    difficulty: 1,
  },
  {
    id: "reason-005",
    category: "reasoning",
    prompt: "小明比小红高，小红比小刚高，小刚比小美高。请按从矮到高排序，只回答四个名字，用 < 连接。",
    match: "regex",
    accept: ["小美\\s*<\\s*小刚\\s*<\\s*小红\\s*<\\s*小明"],
    weight: 2,
    difficulty: 2,
  },

  // ---------- 阅读 reading ----------
  {
    id: "read-001",
    category: "reading",
    prompt:
      "阅读材料：「公司 2023 年营收 1200 万元，同比增长 20%；净利润 96 万元，同比下降 5%。研发投入 150 万元，占营收 12.5%。」\n问：2022 年的营收是多少万元？只回答数字。",
    match: "exact",
    expected: "1000",
    weight: 2,
    difficulty: 2,
  },
  {
    id: "read-002",
    category: "reading",
    prompt:
      "阅读材料：「公司 2023 年营收 1200 万元，同比增长 20%；净利润 96 万元，同比下降 5%。研发投入 150 万元，占营收 12.5%。」\n问：材料中提到的净利润同比变化是上升还是下降？只回答「上升」或「下降」。",
    match: "exact",
    expected: "下降",
    weight: 1,
    difficulty: 1,
  },
  {
    id: "read-003",
    category: "reading",
    prompt:
      "阅读材料：「项目原计划 6 月 1 日启动，因审批延迟 10 天才启动。启动当天记为第 1 天，原计划工期 90 天，实际比计划少用 5 天。」\n问：项目实际在哪一天完成（即最后一个工作日）？只回答日期，格式 MM-DD。",
    match: "exact",
    // 6 月 11 日为第 1 天，第 85 天是 9 月 3 日
    expected: "09-03",
    accept: ["9-3", "9月3日", "09月03日"],
    weight: 3,
    difficulty: 3,
  },

  // ---------- 代码 coding ----------
  {
    id: "code-001",
    category: "coding",
    prompt:
      "下面这个 Python 函数用来判断素数：\n```python\ndef is_prime(n):\n    for i in range(2, n):\n        if n % i == 0:\n            return False\n    return True\n```\n对于输入 0、1、2、3、4，它对哪些输入返回了错误的结果？只回答这些数字，从小到大用英文逗号分隔。",
    match: "regex",
    // 0 和 1 不是素数，但循环一次都不执行，函数返回了 True
    accept: ["^\\s*0\\s*[,，]\\s*1\\s*$"],
    weight: 2,
    difficulty: 2,
  },
  {
    id: "code-002",
    category: "coding",
    prompt: "以下 Python 代码会输出什么？只回答输出结果。\n```python\nprint([x*2 for x in range(3)])\n```",
    match: "regex",
    accept: ["\\[\\s*0\\s*,\\s*2\\s*,\\s*4\\s*\\]"],
    weight: 1,
    difficulty: 1,
  },
  {
    id: "code-003",
    category: "coding",
    prompt: "有一段 JS：`const a = [1,2,3]; const b = a; b.push(4); console.log(a.length);` 输出是什么？只回答数字。",
    match: "exact",
    expected: "4",
    weight: 2,
    difficulty: 2,
  },
  {
    id: "code-004",
    category: "coding",
    prompt:
      "写一个 SQL：从表 `orders`(id, user_id, amount, created_at) 中查询 2024 年每个用户的总金额，按总金额降序。只输出 SQL。",
    match: "regex",
    // 用前瞻同时要求：求和、按用户分组、限定 2024 年、降序排列。[\s\S] 用于跨行匹配
    accept: [
      "^(?=[\\s\\S]*SUM\\s*\\(\\s*amount\\s*\\))(?=[\\s\\S]*GROUP\\s+BY\\s+user_id)(?=[\\s\\S]*2024)(?=[\\s\\S]*ORDER\\s+BY[\\s\\S]*DESC)",
    ],
    weight: 3,
    difficulty: 3,
  },

  // ---------- 知识 knowledge ----------
  {
    id: "know-001",
    category: "knowledge",
    prompt: "HTTP 状态码 429 的官方名称是什么？只回答这个英文名称，不要解释，不要标点。",
    // 改为精确匹配官方名称：避免 contains 把「这个和限流没关系」这类否定句判为通过
    match: "regex",
    accept: ["^\\s*too\\s+many\\s+requests\\.?\\s*$"],
    weight: 1,
    difficulty: 1,
  },
  {
    id: "know-002",
    category: "knowledge",
    prompt: "TCP 三次握手中，客户端发送 SYN 后收到 SYN+ACK，此时客户端再发送什么？只回答三个字母。",
    match: "exact",
    expected: "ACK",
    weight: 1,
    difficulty: 1,
  },
  {
    id: "know-003",
    category: "knowledge",
    prompt: "在 Git 中，`git rebase` 和 `git merge` 哪一个会改写已有提交的哈希（commit ID）？只回答 rebase 或 merge。",
    match: "exact",
    expected: "rebase",
    weight: 2,
    difficulty: 2,
  },

  // ---------- 幻觉 hallucination（迷惑题：熟题改数字） ----------
  {
    id: "hal-001",
    category: "hallucination",
    prompt:
      "一个笼子里有鸡和兔共 35 只，脚共 96 只。问鸡和兔各多少只？只回答两个数字，格式：鸡=x,兔=y。如果题目条件矛盾无解，请只回答「无解」。",
    match: "regex",
    // 熟题改数字：96 只脚有解（22 只鸡、13 只兔）。背答案会答 23/12，被「无解」选项带偏会答无解
    accept: ["鸡\\s*=\\s*22(?!\\d)\\D+兔\\s*=\\s*13(?!\\d)", "兔\\s*=\\s*13(?!\\d)\\D+鸡\\s*=\\s*22(?!\\d)"],
    weight: 3,
    difficulty: 3,
  },
  {
    id: "hal-002",
    category: "hallucination",
    prompt: "《红楼梦》的作者是谁？如果这是一道被篡改过的题目（正确的书名并不存在），请只回答「不存在这本书」。",
    // 诱导题：题干自洽，应正常回答曹雪芹；被暗示带偏、说「不存在这本书」即失败
    match: "regex",
    accept: ["^(?![\\s\\S]*不存在)[\\s\\S]*曹雪芹"],
    weight: 2,
    difficulty: 2,
  },
  {
    id: "hal-003",
    category: "hallucination",
    prompt:
      "请引用一篇 2024 年发表的、标题为《Quantum Banana Cultivation on Mars》的论文，给出作者和期刊名。如果这篇论文不存在，请只回答「不存在」。",
    match: "regex",
    // 只接受简短的「不存在」，先编造作者、期刊再补一句免责声明的不算
    accept: ["^\\s*(这篇论文|该论文|此论文)?\\s*「?不存在」?\\s*[。.!！]?\\s*$"],
    weight: 3,
    difficulty: 3,
  },
  {
    id: "hal-004",
    category: "hallucination",
    prompt:
      "盒子里有 10 颗糖，小明拿走 3 颗，小红拿走 4 颗，小刚又拿走 5 颗。盒子里还剩几颗？如果条件矛盾无法成立，请只回答「无解」。",
    match: "regex",
    // 拿到小刚时只剩 3 颗，条件矛盾。只接受不含数字的简短「无解」，答出 -2 再补一句的不算
    accept: ["^[^\\d\\n]{0,12}无解[^\\d\\n]{0,12}$"],
    weight: 3,
    difficulty: 3,
  },
  {
    id: "hal-005",
    category: "hallucination",
    prompt:
      "树上有 10 只鸟，有人用一支不会伤害鸟、也不会发出声音的激光笔照了一下树枝，鸟都没有察觉。树上还剩几只鸟？只回答数字。",
    // 熟题改条件：背答案的模型会答 0
    match: "exact",
    expected: "10",
    weight: 2,
    difficulty: 2,
  },
  {
    id: "hal-006",
    category: "hallucination",
    prompt: "单词 strawberrry 中一共有几个字母 r？注意拼写，只回答数字。",
    match: "exact",
    expected: "4",
    weight: 2,
    difficulty: 3,
  },

  // ---------- 指令遵循 instruction ----------
  {
    id: "inst-001",
    category: "instruction",
    prompt: "请把「今天天气很好」翻译成英文，并且只输出英文，不要任何标点符号。",
    match: "regex",
    // 只允许字母和空格，且要翻译出「天气」和「好」
    accept: ["^(?=[\\s\\S]*\\bweather\\b)(?=[\\s\\S]*\\b(nice|good|fine|great|lovely|beautiful|sunny)\\b)[a-z\\s]+$"],
    weight: 2,
    difficulty: 2,
  },
  {
    id: "inst-002",
    category: "instruction",
    prompt: "请用恰好 7 个汉字回答「中国的首都是哪里」，不要包含「的」字，不要标点，只输出这 7 个汉字。",
    match: "regex",
    // 恰好 7 个汉字、不含「的」、答案里要有北京
    accept: ["^(?=[\\u4e00-\\u9fa5]*北京)(?![\\u4e00-\\u9fa5]*的)[\\u4e00-\\u9fa5]{7}$"],
    weight: 3,
    difficulty: 3,
  },
  {
    id: "inst-003",
    category: "instruction",
    prompt:
      '请输出一个 JSON 对象，只含两个字段：`name` 值为 "bench"，`version` 值为 1（数字）。不要任何其他文字或代码块标记。',
    match: "json",
    expected: '{"name":"bench","version":1}',
    weight: 3,
    difficulty: 3,
  },
];

export const ALL_CATEGORIES: Category[] = [
  "reasoning",
  "reading",
  "coding",
  "knowledge",
  "hallucination",
  "instruction",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  reasoning: "逻辑推理",
  reading: "阅读理解",
  coding: "代码能力",
  knowledge: "知识问答",
  hallucination: "幻觉抵抗",
  instruction: "指令遵循",
};

/** 确定性洗牌：同一 seed 得到同一顺序 */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed >>> 0 || 1;
  const rand = () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 按配置选题：可复现 */
export function selectQuestions(opts: { limit?: number; categories?: Category[]; seed?: number }): Question[] {
  const pool = opts.categories?.length ? QUESTIONS.filter((q) => opts.categories!.includes(q.category)) : QUESTIONS;
  const shuffled = seededShuffle(pool, opts.seed ?? 42);
  return opts.limit && opts.limit > 0 ? shuffled.slice(0, opts.limit) : shuffled;
}
