/**
 * Task 034 验收脚本：开源就绪 + 一键启动
 *
 * 来源：Task 034 第 6 节验收标准。
 *
 * 5 组验证：
 *   1. 文件存在性检查（14 项新增文件 + package.json scripts）
 *   2. 版本号与脚本检查（F16/F17）
 *   3. 内容完整性检查（F1-F15 关键内容）
 *   4. 脚本可执行性检查（F5/F6）
 *   5. 回归测试（T3-T14 调用 12 个 verify-taskXXX 脚本）
 *
 * 运行：npx tsx scripts/verify-task034.ts
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

// ============================================================
// 测试框架
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];
let sectionCount = 1;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passCount++;
  } else {
    console.log(`  FAIL  ${message}`);
    failCount++;
    failures.push(message);
  }
}

function section(title: string): void {
  console.log(`\n[验收 ${sectionCount}] ${title}\n`);
  sectionCount++;
}

function readFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    return "";
  }
  return fs.readFileSync(fullPath, "utf-8");
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.resolve(process.cwd(), relativePath));
}

// ============================================================
// 1. 文件存在性检查（14 项）
// ============================================================

function checkFileExists(): void {
  section("文件存在性检查（14 项新增文件）");

  const files = [
    "LICENSE",
    "TRADEMARKS.md",
    ".env.example",
    "scripts/quick-start.sh",
    "scripts/quick-start.ps1",
    "README.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "ROADMAP.md",
    "Dockerfile",
    "docker-compose.yml",
    ".dockerignore",
    "scripts/verify-task034.ts",
  ];

  for (const file of files) {
    assert(fileExists(file), `文件存在: ${file}`);
  }
}

// ============================================================
// 2. 版本号与脚本检查（F16/F17）
// ============================================================

function checkVersionAndScripts(): void {
  section("版本号与脚本检查（F16/F17）");

  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkgContent = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(pkgContent);

  // F16: package.json version = "1.3.0"
  assert(pkg.version === "1.3.0", `F16: package.json version = "1.3.0"（当前: ${pkg.version}）`);

  // F17: package.json scripts 含 dev + start + quick-start
  assert(
    typeof pkg.scripts.dev === "string" && pkg.scripts.dev.includes("src/api/server.ts"),
    "F17: package.json 含 dev 脚本（指向 src/api/server.ts）",
  );
  assert(
    typeof pkg.scripts.start === "string" && pkg.scripts.start.includes("src/api/server.ts"),
    "F17: package.json 含 start 脚本（指向 src/api/server.ts）",
  );
  assert(
    typeof pkg.scripts["quick-start"] === "string" && pkg.scripts["quick-start"].includes("quick-start.sh"),
    "F17: package.json 含 quick-start 脚本",
  );
  assert(
    typeof pkg.scripts["verify:task034"] === "string",
    "F17: package.json 含 verify:task034 脚本",
  );

  // description 更新
  assert(
    pkg.description.includes("ChancePing") && !pkg.description.includes("V0.9"),
    "package.json description 已更新（含 ChancePing，不含 V0.9）",
  );
}

// ============================================================
// 3. 内容完整性检查（F1-F15）
// ============================================================

function checkContentIntegrity(): void {
  section("内容完整性检查（F1-F15）");

  // F1: LICENSE 含 "GNU Affero General Public License"
  const license = readFile("LICENSE");
  assert(license.includes("GNU Affero General Public License"), "F1: LICENSE 含 'GNU Affero General Public License'");
  assert(license.includes("Version 3, 19 November 2007"), "F1: LICENSE 含 AGPL v3 版本号");
  assert(license.includes("TERMS AND CONDITIONS"), "F1: LICENSE 含 TERMS AND CONDITIONS");

  // F2: TRADEMARKS.md 含 "ChancePing" + "盯机会" + 使用规则
  const trademarks = readFile("TRADEMARKS.md");
  assert(trademarks.includes("ChancePing"), "F2: TRADEMARKS.md 含 'ChancePing'");
  assert(trademarks.includes("盯机会"), "F2: TRADEMARKS.md 含 '盯机会'");
  assert(trademarks.includes("允许"), "F2: TRADEMARKS.md 含允许使用规则");
  assert(trademarks.includes("不允许"), "F2: TRADEMARKS.md 含不允许使用规则");

  // F3: .env.example 所有 Key 用占位符 + 不含真实 Key
  const envExample = readFile(".env.example");
  // T2: 不含 sk- 开头的真实 API Key
  const skMatches = envExample.match(/sk-[a-zA-Z0-9]{10,}/g);
  assert(skMatches === null, "T2/F3: .env.example 不含真实 API Key（无 sk-xxx 模式）");
  // 含占位符（空值）
  assert(envExample.includes("DASHSCOPE_API_KEY="), "F3: .env.example 含 DASHSCOPE_API_KEY 占位符");
  assert(envExample.includes("DEEPSEEK_API_KEY="), "F3: .env.example 含 DEEPSEEK_API_KEY 占位符");
  assert(envExample.includes("SERPER_API_KEY="), "F3: .env.example 含 SERPER_API_KEY 占位符");

  // F4: .env.example 含 LLM_STRATEGY + STORE_TYPE + NOTIFY_MOCK_MODE
  assert(envExample.includes("LLM_STRATEGY="), "F4: .env.example 含 LLM_STRATEGY");
  assert(envExample.includes("STORE_TYPE="), "F4: .env.example 含 STORE_TYPE");
  assert(envExample.includes("NOTIFY_MOCK_MODE="), "F4: .env.example 含 NOTIFY_MOCK_MODE");
  assert(envExample.includes("LLM_STRATEGY=competition"), "F4: .env.example 默认 LLM_STRATEGY=competition");
  assert(envExample.includes("STORE_TYPE=local"), "F4: .env.example 默认 STORE_TYPE=local");
  assert(envExample.includes("NOTIFY_MOCK_MODE=true"), "F4: .env.example 默认 NOTIFY_MOCK_MODE=true");

  // F7: README.md 含快速开始 + 核心功能 + 环境变量 + API 文档
  const readme = readFile("README.md");
  assert(readme.includes("快速开始"), "F7: README.md 含 '快速开始'");
  assert(readme.includes("git clone"), "F7: README.md 含 'git clone'");
  assert(readme.includes("核心功能"), "F7: README.md 含 '核心功能'");
  assert(readme.includes("环境变量"), "F7: README.md 含 '环境变量'");
  assert(readme.includes("API 文档"), "F7: README.md 含 'API 文档'");
  assert(readme.includes("npm install"), "F7: README.md 含 'npm install'");
  assert(readme.includes("npm run dev"), "F7: README.md 含 'npm run dev'");

  // F8: CONTRIBUTING.md 含 DCO + 提交规范 + PR 流程
  const contributing = readFile("CONTRIBUTING.md");
  assert(contributing.includes("DCO"), "F8: CONTRIBUTING.md 含 'DCO'");
  assert(contributing.includes("Developer Certificate of Origin"), "F8: CONTRIBUTING.md 含 DCO 全称");
  assert(contributing.includes("Signed-off-by"), "F8: CONTRIBUTING.md 含 Signed-off-by 说明");
  assert(contributing.includes("Conventional Commits"), "F8: CONTRIBUTING.md 含 Conventional Commits 提交规范");
  assert(contributing.includes("PR"), "F8: CONTRIBUTING.md 含 PR 流程");

  // F9: CODE_OF_CONDUCT.md 存在 + 含行为准则
  const coc = readFile("CODE_OF_CONDUCT.md");
  assert(coc.length > 0, "F9: CODE_OF_CONDUCT.md 存在且非空");
  assert(coc.includes("行为准则") || coc.includes("Code of Conduct"), "F9: CODE_OF_CONDUCT.md 含行为准则");

  // F10: SECURITY.md 存在 + 含安全披露流程
  const security = readFile("SECURITY.md");
  assert(security.length > 0, "F10: SECURITY.md 存在且非空");
  assert(security.includes("报告") || security.includes("披露"), "F10: SECURITY.md 含安全披露流程");

  // F11: ROADMAP.md 存在 + 含 V1.0/V1.5/V2.0 路线
  const roadmap = readFile("ROADMAP.md");
  assert(roadmap.length > 0, "F11: ROADMAP.md 存在且非空");
  assert(roadmap.includes("V1.0"), "F11: ROADMAP.md 含 V1.0 路线");
  assert(roadmap.includes("V1.5"), "F11: ROADMAP.md 含 V1.5 路线");
  assert(roadmap.includes("V2.0"), "F11: ROADMAP.md 含 V2.0 路线");

  // F12: Dockerfile 存在 + 多阶段构建
  const dockerfile = readFile("Dockerfile");
  assert(dockerfile.includes("FROM") && dockerfile.includes("AS builder"), "F12: Dockerfile 含多阶段构建（builder）");
  assert(dockerfile.includes("AS runtime"), "F12: Dockerfile 含 runtime 阶段");
  assert(dockerfile.includes("node:22"), "F12: Dockerfile 使用 node:22 基础镜像");

  // F13: docker-compose.yml 存在 + 端口 3000
  const compose = readFile("docker-compose.yml");
  assert(compose.includes("3000:3000"), "F13: docker-compose.yml 含端口 3000:3000");
  assert(compose.includes("services:"), "F13: docker-compose.yml 含 services 配置");

  // F14: .dockerignore 存在 + 排除 node_modules
  const dockerignore = readFile(".dockerignore");
  assert(dockerignore.includes("node_modules/"), "F14: .dockerignore 排除 node_modules");
  assert(dockerignore.includes(".env"), "F14: .dockerignore 排除 .env");

  // F15: .gitignore 含 .env + data/ + reports/export/
  const gitignore = readFile(".gitignore");
  assert(gitignore.includes(".env"), "F15: .gitignore 含 .env");
  assert(gitignore.includes("data/"), "F15: .gitignore 含 data/");
  assert(gitignore.includes("reports/export/"), "F15: .gitignore 含 reports/export/");
}

// ============================================================
// 4. 脚本可执行性检查（F5/F6）
// ============================================================

function checkScripts(): void {
  section("脚本可执行性检查（F5/F6）");

  // F5: quick-start.sh 含 Node.js 版本检查 + npm install + npm run dev
  const sh = readFile("scripts/quick-start.sh");
  assert(sh.includes("node"), "F5: quick-start.sh 含 Node.js 检查");
  assert(sh.includes("node -v") || sh.includes("NODE_VERSION"), "F5: quick-start.sh 含 Node.js 版本检查");
  assert(sh.includes("npm install"), "F5: quick-start.sh 含 npm install");
  assert(sh.includes("npm run dev"), "F5: quick-start.sh 含 npm run dev");
  assert(sh.includes(".env.example"), "F5: quick-start.sh 含 .env.example 复制");

  // F6: quick-start.ps1 含 Node.js 版本检查 + npm install + npm run dev
  const ps1 = readFile("scripts/quick-start.ps1");
  assert(ps1.includes("node -v") || ps1.includes("node"), "F6: quick-start.ps1 含 Node.js 检查");
  assert(ps1.includes("npm install"), "F6: quick-start.ps1 含 npm install");
  assert(ps1.includes("npm run dev"), "F6: quick-start.ps1 含 npm run dev");
  assert(ps1.includes(".env.example"), "F6: quick-start.ps1 含 .env.example 复制");
}

// ============================================================
// 5. 回归测试（T3-T14 调用 12 个 verify-taskXXX 脚本）
// ============================================================

function checkRegressionTests(): void {
  section("回归测试（T3-T14 调用 12 个 verify-taskXXX 脚本）");

  const regressionScripts = [
    "verify-task019d.ts",
    "verify-task019.ts",
    "verify-task021.ts",
    "verify-task022.ts",
    "verify-task023.ts",
    "verify-task024.ts",
    "verify-task025.ts",
    "verify-task026.ts",
    "verify-task028.ts",
    "verify-task029.ts",
    "verify-task030.ts",
    "verify-task031.ts",
  ];

  for (const script of regressionScripts) {
    const scriptPath = path.resolve(process.cwd(), "scripts", script);
    assert(fs.existsSync(scriptPath), `T3-T14: ${script} 文件存在`);

    console.log(`  运行: npx tsx scripts/${script} ...`);
    const result = spawnSync("npx", ["tsx", `scripts/${script}`], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 180000, // 3 分钟超时
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const passed = result.status === 0;
    const label = `T3-T14: ${script} 通过（exit ${result.status}）`;

    if (passed) {
      console.log(`  PASS  ${label}`);
      passCount++;
    } else {
      console.log(`  FAIL  ${label}`);
      failCount++;
      failures.push(label);
      // 输出最后 20 行错误输出便于排查
      const stderrTail = (result.stderr || "").split("\n").slice(-20).join("\n");
      const stdoutTail = (result.stdout || "").split("\n").slice(-10).join("\n");
      if (stderrTail.trim()) {
        console.log(`    stderr (tail):\n${stderrTail}`);
      }
      if (stdoutTail.trim()) {
        console.log(`    stdout (tail):\n${stdoutTail}`);
      }
    }
  }
}

// ============================================================
// 主函数
// ============================================================

function main(): void {
  console.log("============================================================");
  console.log("Task 034 验收脚本：开源就绪 + 一键启动");
  console.log("============================================================");

  checkFileExists();
  checkVersionAndScripts();
  checkContentIntegrity();
  checkScripts();
  checkRegressionTests();

  console.log("\n============================================================");
  console.log(`验收结果：${passCount} PASS / ${failCount} FAIL`);
  if (failures.length > 0) {
    console.log("\n失败项：");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }
  console.log("============================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

main();
