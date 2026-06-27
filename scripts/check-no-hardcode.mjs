/**
 * 验收 #5：检查代码中不得硬编码品牌产品名 "盯一下 ChancePing"。
 *
 * 仅扫描 src/ 下的 .ts 代码（排除 src/brand/constants.ts 常量单一来源）。
 * 示例数据 data/samples/sample-spec.json 属数据文件，按"文档/数据"口径豁免。
 *
 * 运行：npm run check:no-hardcode
 */

import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd(), "src");
const NEEDLE = "盯一下 ChancePing";
const EXCLUDE = path.join(ROOT, "brand", "constants.ts");

const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && full.endsWith(".ts")) {
      if (full === EXCLUDE) continue;
      const content = fs.readFileSync(full, "utf-8");
      if (content.includes(NEEDLE)) {
        hits.push(full);
      }
    }
  }
}

walk(ROOT);

console.log("\n=== 验收 #5：代码无硬编码品牌产品名 ===");
console.log(`扫描目录: ${ROOT}`);
console.log(`豁免文件: ${EXCLUDE}`);
if (hits.length === 0) {
  console.log(`PASS  src/ 下未发现硬编码 "${NEEDLE}"（常量文件除外）`);
  process.exit(0);
} else {
  console.log(`FAIL  以下文件硬编码了 "${NEEDLE}"：`);
  for (const f of hits) console.log("  - " + f);
  process.exit(1);
}
