/**
 * Task V1.5-02 验收脚本：存储与注册表
 *
 * 运行：npx tsx scripts/verify-task-v1.5-02-store.ts
 *
 * 验证范围（32 项）：
 *   6.1 RadarStore CRUD（1-11）
 *   6.2 RadarRunStore CRUD（12-16）
 *   6.3 RadarRegistry（17-28）
 *   6.4 radar-router.ts 兼容（29-30）
 *   6.5 AppContext 集成（31-32）
 *
 * 回归测试（33-37）由外部命令运行：
 *   - tsc --noEmit
 *   - verify-task038.ts
 *   - verify-task039.ts
 *   - verify-e2e-v13.ts
 *   - verify-task-v1.5-01-model.ts
 *
 * 测试隔离：使用临时文件 data/radars-test.json / data/radar-runs-test.json，测试后清理。
 */

import fs from "fs";
import path from "path";
import { JsonRadarStore, JsonRadarRunStore } from "../src/agents/radar-store";
import type { RadarStore, RadarRunStore } from "../src/agents/radar-store";
import { RadarRegistry } from "../src/agents/radar-registry";
import { getProviderNamesForRadar, getProviderNamesForRadarId } from "../src/search/radar-router";
import { createAppContext } from "../src/api/context";

// ============================================================
// 测试框架
// ============================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? " -> " + detail : ""}`);
  }
}

function section(title: string): void {
  console.log("");
  console.log(`=== ${title} ===`);
}

// ============================================================
// 临时文件管理
// ============================================================

const TEMP_RADARS_FILE = "data/radars-test.json";
const TEMP_RUNS_FILE = "data/radar-runs-test.json";

function cleanupTempFiles(): void {
  for (const f of [TEMP_RADARS_FILE, TEMP_RUNS_FILE]) {
    const abs = path.resolve(process.cwd(), f);
    if (fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        // 忽略删除失败
      }
    }
  }
}

// ============================================================
// 6.1 RadarStore CRUD
// ============================================================

function testRadarStoreCRUD(): void {
  section("6.1 RadarStore CRUD");

  cleanupTempFiles();
  const store = new JsonRadarStore({ file_path: TEMP_RADARS_FILE });

  // 1. create → 返回 Radar，含 id（radar_ 开头），status=draft
  const radar = store.create({ name: "测试雷达", kind: "custom" });
  check("1. create 返回 Radar，含 id（radar_ 开头）",
    radar.id.startsWith("radar_"), `id=${radar.id}`);
  check("1.1 create 返回 Radar，status=draft",
    radar.status === "draft", `status=${radar.status}`);

  // 2. get(id) → 返回刚才创建的 Radar
  const got = store.get(radar.id);
  check("2. get(id) 返回 Radar", got !== null);
  check("2.1 get(id) name 一致", got?.name === "测试雷达");

  // 3. get("不存在") → 返回 null
  const notFound = store.get("nonexistent_id_12345");
  check("3. get(不存在) 返回 null", notFound === null);

  // 4. list() → 返回数组，含刚才创建的雷达
  const list = store.list();
  check("4. list() 返回数组，含创建的雷达",
    list.length >= 1 && list.some((r) => r.id === radar.id));

  // 5. list({ kind: "custom" }) → 只返回 kind=custom
  const listCustom = store.list({ kind: "custom" });
  check("5. list({ kind: 'custom' }) 只返回 custom",
    listCustom.length >= 1 && listCustom.every((r) => r.kind === "custom"));

  // 6. list({ status: "draft" }) → 只返回 status=draft
  const listDraft = store.list({ status: "draft" });
  check("6. list({ status: 'draft' }) 只返回 draft",
    listDraft.length >= 1 && listDraft.every((r) => r.status === "draft"));

  // 7. update(id, { name: "改名" }) → name 已改，updatedAt 已更新
  const originalUpdatedAt = radar.updatedAt;
  // 确保时间戳不同
  const updated = store.update(radar.id, { name: "改名" });
  check("7. update 返回非 null", updated !== null);
  check("7.1 update name 已改", updated?.name === "改名");
  check("7.2 update updatedAt 已更新", updated?.updatedAt !== originalUpdatedAt);

  // 8. archive(id) → status=archived, deletedAt 有值
  const archived = store.archive(radar.id);
  check("8. archive 返回非 null", archived !== null);
  check("8.1 archive status=archived", archived?.status === "archived");
  check("8.2 archive deletedAt 有值", archived?.deletedAt !== undefined && archived!.deletedAt!.length > 0);

  // 9. list() 不含已归档雷达（默认）
  const listNoArchived = store.list();
  check("9. list() 不含已归档雷达",
    !listNoArchived.some((r) => r.id === radar.id));

  // 10. list({ includeArchived: true }) 含已归档雷达
  const listWithArchived = store.list({ includeArchived: true });
  check("10. list({ includeArchived: true }) 含已归档雷达",
    listWithArchived.some((r) => r.id === radar.id));

  // 11. save() + 重新 load() 后数据一致
  store.save();
  const store2 = new JsonRadarStore({ file_path: TEMP_RADARS_FILE });
  const reloaded = store2.get(radar.id);
  check("11. save + load 后数据一致", reloaded !== null);
  check("11.1 reloaded name 一致", reloaded?.name === "改名");
  check("11.2 reloaded status=archived", reloaded?.status === "archived");

  cleanupTempFiles();
}

// ============================================================
// 6.2 RadarRunStore CRUD
// ============================================================

function testRadarRunStoreCRUD(): void {
  section("6.2 RadarRunStore CRUD");

  cleanupTempFiles();
  const store = new JsonRadarStore({ file_path: TEMP_RADARS_FILE });
  const runStore = new JsonRadarRunStore({ file_path: TEMP_RUNS_FILE });

  // 先创建一个雷达
  const radar = store.create({ name: "运行测试雷达", kind: "custom" });

  // 12. create → 返回 RadarRun，含 id（run_ 开头），status="running"
  const run = runStore.create({
    radarId: radar.id,
    mode: "manual",
    triggeredBy: "user",
  });
  check("12. create 返回 RadarRun，含 id（run_ 开头）",
    run.id.startsWith("run_"), `id=${run.id}`);
  check("12.1 create status=running",
    run.status === "running", `status=${run.status}`);

  // 13. get(runId) → 返回刚才创建的 RadarRun
  const gotRun = runStore.get(run.id);
  check("13. get(runId) 返回 RadarRun", gotRun !== null);
  check("13.1 get(runId) radarId 一致", gotRun?.radarId === radar.id);

  // 14. listByRadarId(radarId) → 返回该雷达的运行记录数组
  const runs = runStore.listByRadarId(radar.id);
  check("14. listByRadarId 返回数组，含创建的运行记录",
    runs.length >= 1 && runs.some((r) => r.id === run.id));

  // 15. update(runId, { status: "succeeded", finishedAt: now })
  const now = new Date().toISOString();
  const updatedRun = runStore.update(run.id, { status: "succeeded", finishedAt: now });
  check("15. update 返回非 null", updatedRun !== null);
  check("15.1 update status=succeeded", updatedRun?.status === "succeeded");
  check("15.2 update finishedAt 有值", updatedRun?.finishedAt === now);

  // 16. save() + load() 后数据一致
  runStore.save();
  const runStore2 = new JsonRadarRunStore({ file_path: TEMP_RUNS_FILE });
  const reloadedRun = runStore2.get(run.id);
  check("16. save + load 后数据一致", reloadedRun !== null);
  check("16.1 reloaded status=succeeded", reloadedRun?.status === "succeeded");

  cleanupTempFiles();
}

// ============================================================
// 6.3 RadarRegistry
// ============================================================

function testRadarRegistry(): void {
  section("6.3 RadarRegistry");

  cleanupTempFiles();
  const store = new JsonRadarStore({ file_path: TEMP_RADARS_FILE });
  const registry = new RadarRegistry(store);

  // 17. initialize() 后 listRadars() 含 3 个内置雷达
  registry.initialize();
  const radars = registry.listRadars();
  check("17. initialize() 后 listRadars() 含 3 个内置雷达",
    radars.length === 3, `len=${radars.length}`);

  // 18. 内置雷达 ID 分别为 builtin_ai_competition / builtin_opc_policy / builtin_cultural_heritage
  const ids = radars.map((r) => r.id).sort();
  const expectedIds = ["builtin_ai_competition", "builtin_cultural_heritage", "builtin_opc_policy"].sort();
  check("18. 内置雷达 ID 正确",
    ids.join(",") === expectedIds.join(","), `ids=${ids.join(",")}`);

  // 19. 内置雷达 isBuiltin=true / isEditable=false / isDeletable=false / ownerId="system"
  const builtin = registry.getRadarById("builtin_ai_competition");
  check("19. 内置 isBuiltin=true", builtin?.isBuiltin === true);
  check("19.1 内置 isEditable=false", builtin?.isEditable === false);
  check("19.2 内置 isDeletable=false", builtin?.isDeletable === false);
  check("19.3 内置 ownerId=system", builtin?.ownerId === "system");

  // 20. 内置雷达 status="active"
  check("20. 内置 status=active", builtin?.status === "active", `status=${builtin?.status}`);

  // 21. initialize() 调用两次（幂等）后，listRadars() 仍只有 3 个内置雷达
  registry.initialize();
  const radarsAfterSecondInit = registry.listRadars();
  check("21. 二次 initialize() 幂等，仍 3 个内置雷达",
    radarsAfterSecondInit.length === 3, `len=${radarsAfterSecondInit.length}`);

  // 22. getBuiltinRadars() 返回 3 个
  const builtins = registry.getBuiltinRadars();
  check("22. getBuiltinRadars() 返回 3 个", builtins.length === 3);

  // 23. getCustomRadars() 不含内置雷达
  const customs = registry.getCustomRadars();
  check("23. getCustomRadars() 不含内置雷达",
    customs.every((r) => !r.isBuiltin));

  // 24. createCustomRadar → 返回 Radar，isBuiltin=false
  const custom = registry.createCustomRadar({ name: "我的雷达", kind: "custom" });
  check("24. createCustomRadar 返回 Radar", custom !== null);
  check("24.1 createCustomRadar isBuiltin=false", custom.isBuiltin === false);
  check("24.2 createCustomRadar name 一致", custom.name === "我的雷达");

  // 25. updateRadar("builtin_ai_competition", { name: "改" }) → 抛错
  let threwOnUpdate = false;
  try {
    registry.updateRadar("builtin_ai_competition", { name: "改" });
  } catch {
    threwOnUpdate = true;
  }
  check("25. updateRadar(内置) 抛错", threwOnUpdate);

  // 26. archiveRadar("builtin_ai_competition") → 抛错
  let threwOnArchive = false;
  try {
    registry.archiveRadar("builtin_ai_competition");
  } catch {
    threwOnArchive = true;
  }
  check("26. archiveRadar(内置) 抛错", threwOnArchive);

  // 27. getProvidersForRadar("builtin_ai_competition") → ["serper","exa"]
  const providers1 = registry.getProvidersForRadar("builtin_ai_competition");
  check("27. getProvidersForRadar(builtin_ai_competition) 返回 ['serper','exa']",
    providers1.join(",") === "serper,exa", `got=${providers1.join(",")}`);

  // 28. getProvidersForRadar("ai_competition") → ["serper","exa"]（旧式 radar_type 兼容）
  const providers2 = registry.getProvidersForRadar("ai_competition");
  check("28. getProvidersForRadar(ai_competition) 旧式兼容返回 ['serper','exa']",
    providers2.join(",") === "serper,exa", `got=${providers2.join(",")}`);

  cleanupTempFiles();
}

// ============================================================
// 6.4 radar-router.ts 兼容
// ============================================================

function testRadarRouterCompat(): void {
  section("6.4 radar-router.ts 兼容");

  // 29. getProviderNamesForRadar("ai_competition") → ["serper","exa"]（旧函数不破坏）
  const oldProviders = getProviderNamesForRadar("ai_competition");
  check("29. getProviderNamesForRadar('ai_competition') 返回 ['serper','exa']",
    oldProviders.join(",") === "serper,exa", `got=${oldProviders.join(",")}`);

  // 30. getProviderNamesForRadarId("builtin_ai_competition", registry) → ["serper","exa"]
  cleanupTempFiles();
  const store = new JsonRadarStore({ file_path: TEMP_RADARS_FILE });
  const registry = new RadarRegistry(store);
  registry.initialize();
  const newProviders = getProviderNamesForRadarId("builtin_ai_competition", registry);
  check("30. getProviderNamesForRadarId(builtin_ai_competition, registry) 返回 ['serper','exa']",
    newProviders.join(",") === "serper,exa", `got=${newProviders.join(",")}`);

  cleanupTempFiles();
}

// ============================================================
// 6.5 AppContext 集成
// ============================================================

function testAppContextIntegration(): void {
  section("6.5 AppContext 集成");

  // 31. createAppContext() 返回的对象含 radarStore / radarRunStore / radarRegistry
  const ctx = createAppContext();
  check("31. ctx 含 radarStore", ctx.radarStore !== undefined && ctx.radarStore !== null);
  check("31.1 ctx 含 radarRunStore", ctx.radarRunStore !== undefined && ctx.radarRunStore !== null);
  check("31.2 ctx 含 radarRegistry", ctx.radarRegistry !== undefined && ctx.radarRegistry !== null);

  // 32. ctx.radarRegistry.listRadars() 含 3 个内置雷达
  const radars = ctx.radarRegistry.listRadars();
  const builtinCount = radars.filter((r) => r.isBuiltin).length;
  check("32. ctx.radarRegistry.listRadars() 含 3 个内置雷达",
    builtinCount === 3, `builtinCount=${builtinCount}`);
}

// ============================================================
// 主函数
// ============================================================

console.log("=== Task V1.5-02 验收检查：存储与注册表 ===\n");

testRadarStoreCRUD();
testRadarRunStoreCRUD();
testRadarRegistry();
testRadarRouterCompat();
testAppContextIntegration();

console.log("");
console.log("=== 验收结果 ===");
console.log(`PASS: ${passed} / FAIL: ${failed}`);
if (failures.length > 0) {
  console.log("失败项：");
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
}

// 清理临时文件
cleanupTempFiles();

process.exit(failed > 0 ? 1 : 0);
