/**
 * 提交信息遵循约定式提交：<type>(<scope>): <中文描述>
 * 例：feat(detect): 新增工具调用探测
 */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 中文描述没有大小写之分，关闭这条以免误报
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
  },
};

export default config;
