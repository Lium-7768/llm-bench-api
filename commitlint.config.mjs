/**
 * 提交信息遵循约定式提交：<type>(<scope>): <中文描述>
 * 例：feat(detect): 新增工具调用探测
 *
 * 提交信息里不能署名：不要加 Co-Authored-By、Signed-off-by 或「Generated with …」之类的行。
 */
const SIGNATURE = /^(co-authored-by|signed-off-by):|generated with \[?claude|🤖 generated/im;

const config = {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "no-signature": ({ raw }) => [
          !SIGNATURE.test(raw ?? ""),
          "提交信息不能包含署名（Co-Authored-By、Signed-off-by、Generated with 等）",
        ],
      },
    },
  ],
  rules: {
    // 中文描述没有大小写之分，关闭这条以免误报
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
    "no-signature": [2, "always"],
  },
};

export default config;
