/**
 * tsc 预检查脚本
 *
 * 运行：npm run precheck
 * 或：npx tsx scripts/precheck.ts
 *
 * 目的：解决 IDE 4 次报告 tsc 通过但实际失败的问题。
 * 所有 verify 脚本运行前应先运行 precheck。
 *
 * 检查项：
 *   1. npx tsc --noEmit（TypeScript 类型检查）
 *   2. npm run check:no-hardcode（硬编码品牌名检查）
 *
 * 任一失败则 exit 1，全部通过则 exit 0。
 */

import { execSync } from "child_process";

function runStep(name: string, command: string, label: string): boolean {
  process.stdout.write(`[precheck] 运行 ${label}...`);
  try {
    execSync(command, {
      stdio: "pipe",
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    console.log(" OK");
    return true;
  } catch (err: unknown) {
    console.log(" FAIL");
    const e = err as { stdout?: string; stderr?: string; message?: string };
    if (e.stdout) {
      console.log("--- stdout ---");
      console.log(e.stdout);
    }
    if (e.stderr) {
      console.log("--- stderr ---");
      console.log(e.stderr);
    }
    console.error(`[precheck] ${name} 失败`);
    return false;
  }
}

function main(): void {
  console.log("============================================================");
  console.log("precheck：tsc + 硬编码双检查");
  console.log("============================================================");

  const ok1 = runStep("tsc", "npx tsc --noEmit", "tsc --noEmit");
  if (!ok1) {
    console.error("\n============================================================");
    console.error("precheck 失败：tsc 类型检查未通过");
    console.error("============================================================");
    process.exit(1);
  }

  const ok2 = runStep(
    "check:no-hardcode",
    "npm run check:no-hardcode",
    "check:no-hardcode",
  );
  if (!ok2) {
    console.error("\n============================================================");
    console.error("precheck 失败：硬编码品牌名检查未通过");
    console.error("============================================================");
    process.exit(1);
  }

  console.log("\n============================================================");
  console.log("✓ precheck 通过（tsc + hardcode）");
  console.log("============================================================");
  process.exit(0);
}

main();
