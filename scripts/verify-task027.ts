/**
 * Task 027 验收脚本 - V0.9 收口验证
 *
 * 运行：npx tsx scripts/verify-task027.ts
 *
 * 验证项（3 组）：
 *   1. 版本号检查（3 项）：package.json version + description + scripts
 *   2. 交付物完整性检查（2 项）：V0.9 完成报告 + project_memory.md
 *   3. 回归测试（8 项）：verify-task019d/019/021/022/023/024/025/026
 *
 * 注意：project_memory.md 位于项目父目录（c:\Users\test\Desktop\chanceping\），
 *       非项目根目录内，需用 path.resolve(PROJECT_ROOT, "..") 跳出。
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PROJECT_ROOT = path.resolve(__dirname, "..");
// project_memory.md 位于项目父目录（任务书 7.2.3 约束）
const PROJECT_MEMORY_PATH = path.resolve(PROJECT_ROOT, "..", "project_memory.md");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  PASS  ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL  ${msg}`);
    failed++;
  }
}

// ============================================================
// 1. 版本号检查
// ============================================================
console.log("\n=== 1. 版本号检查 ===");
const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
assert(pkg.version === "0.9.0", "package.json version = 0.9.0");
assert(typeof pkg.description === "string" && pkg.description.includes("V0.9"), "package.json description 含 V0.9");
assert("verify:task027" in (pkg.scripts ?? {}), "package.json scripts 含 verify:task027");

// ============================================================
// 2. 交付物完整性检查
// ============================================================
console.log("\n=== 2. 交付物完整性检查 ===");
assert(fs.existsSync(path.join(PROJECT_ROOT, "docs", "V0.9_完成报告.md")), "docs/V0.9_完成报告.md 存在");
assert(fs.existsSync(PROJECT_MEMORY_PATH), `project_memory.md 存在（${PROJECT_MEMORY_PATH}）`);
if (fs.existsSync(PROJECT_MEMORY_PATH)) {
  const pm = fs.readFileSync(PROJECT_MEMORY_PATH, "utf-8");
  assert(pm.includes("V0.9"), "project_memory.md 含 V0.9 完成记录");
  assert(pm.includes("Task 023") || pm.includes("Task023") || pm.includes("MeilisearchStore"), "project_memory.md 含 Task 023 记录");
  assert(pm.includes("Task 026") || pm.includes("Task026") || pm.includes("雷达路由"), "project_memory.md 含 Task 026 记录");
} else {
  assert(false, "project_memory.md 不存在，无法检查内容");
  assert(false, "project_memory.md 含 Task 023 记录（跳过）");
  assert(false, "project_memory.md 含 Task 026 记录（跳过）");
}

// ============================================================
// 3. 回归测试
// ============================================================
console.log("\n=== 3. 回归测试 ===");
const regressionScripts = [
  "verify-task019d.ts",
  "verify-task019.ts",
  "verify-task021.ts",
  "verify-task022.ts",
  "verify-task023.ts",
  "verify-task024.ts",
  "verify-task025.ts",
  "verify-task026.ts",
];

for (const script of regressionScripts) {
  const scriptPath = path.join(PROJECT_ROOT, "scripts", script);
  if (!fs.existsSync(scriptPath)) {
    assert(false, `${script} 存在`);
    continue;
  }
  try {
    execSync(`npx tsx ${scriptPath}`, {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 120000,
    });
    assert(true, `${script} 全部 PASS`);
  } catch (e) {
    assert(false, `${script} 失败`);
  }
}

// ============================================================
// 汇总
// ============================================================
console.log(`\n=== 汇总 ===`);
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);
console.log(failed === 0 ? "✓ 全部通过" : "✗ 存在失败项");
process.exit(failed === 0 ? 0 : 1);
