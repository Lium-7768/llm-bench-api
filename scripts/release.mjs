/**
 * 发版：升版本号 → 提交 → 打标签 → 推送。推送标签后由 .github/workflows/release.yml 接手。
 * 用法：node scripts/release.mjs patch|minor|major
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const level = process.argv[2];
if (!["patch", "minor", "major"].includes(level)) {
  console.error("用法：node scripts/release.mjs patch|minor|major");
  process.exit(1);
}

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (sh("git rev-parse --abbrev-ref HEAD") !== "dev") fail("请在 dev 分支上发版");
if (sh("git status --porcelain")) fail("工作区有未提交的改动");
run("git fetch origin dev --tags --quiet");
if (sh("git rev-parse HEAD") !== sh("git rev-parse origin/dev")) fail("本地 dev 与 origin/dev 不一致，请先同步");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next =
  level === "major"
    ? `${major + 1}.0.0`
    : level === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
const tag = `v${next}`;
if (sh(`git tag --list ${tag}`)) fail(`标签 ${tag} 已存在`);

console.log(`→ 检查代码`);
run("pnpm lint");
run("pnpm typecheck");

console.log(`→ ${pkg.version} → ${next}`);
pkg.version = next;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
run("git add package.json");
run(`git commit -m "chore(release): ${tag}"`);
run(`git tag -a ${tag} -m "${tag}"`);
run(`git push origin dev ${tag}`);

console.log(`\n✓ 已推送 ${tag}，在 GitHub Actions 的 Release 工作流里查看进度`);
