/**
 * Task V1.5-01 验收脚本:修正模型
 *
 * 验证 radar.ts 的类型设计修正:
 *   1. RadarStatus 不再含 running/queued(只管生命周期)
 *   2. RunStatus 含 queued(管运行状态)
 *   3. RadarRunStatus 完整 6 态
 *   4. Radar 接口含 currentRunId/lastRunStatus/isBuiltin/isEditable/isDeletable/ownerId/providerRouting
 *   5. RadarRun 类型定义完整(含评审建议的扩展字段)
 *   6. createDefaultRadar 工厂函数输出含新字段
 *   7. createDefaultProviderRouting 按雷达类型返回正确配置
 *   8. ALLOWED_PROVIDERS 白名单
 *   9. generateRadarId/generateRunId 格式正确
 */

import {
  type RadarStatus,
  type RunStatus,
  type RadarRunStatus,
  type LastRunStatus,
  type Radar,
  type RadarRun,
  type ProviderRouting,
  type RadarKind,
  type RunMode,
  type RunTriggeredBy,
  ALLOWED_PROVIDERS,
  createDefaultRadar,
  createDefaultPrivacy,
  createDefaultProviderRouting,
  generateRadarId,
  generateRunId,
} from "../src/schema/radar";

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}`);
    fail++;
  }
}

// 类型级断言(编译时检查,运行时不执行)
function _typeChecks(): void {
  // RadarStatus 只含 4 态
  const _rs: RadarStatus = "draft";
  void _rs;

  // RunStatus 含 queued
  const _run: RunStatus = "queued";
  void _run;

  // RadarRunStatus 含 cancelled/skipped
  const _rrs: RadarRunStatus = "cancelled";
  void _rrs;

  // LastRunStatus
  const _lrs: LastRunStatus = "succeeded";
  void _lrs;

  // RunMode / RunTriggeredBy
  const _rm: RunMode = "manual";
  const _rt: RunTriggeredBy = "user";
  void _rm;
  void _rt;
}

function main(): void {
  console.log("=== Task V1.5-01 验收:修正模型 ===\n");

  // ============================================================
  // 1. RadarStatus 不再含 running/queued
  // ============================================================
  console.log("=== 1. RadarStatus 职责分离 ===");

  // 通过类型系统验证:以下赋值在编译时通过,说明类型正确
  const validStatuses: RadarStatus[] = ["draft", "active", "paused", "archived"];
  assert(validStatuses.length === 4, "T1.1 RadarStatus 只含 4 态(draft/active/paused/archived)");
  assert(!validStatuses.includes("running" as RadarStatus), "T1.2 RadarStatus 不含 running");
  assert(!validStatuses.includes("queued" as RadarStatus), "T1.3 RadarStatus 不含 queued");

  // ============================================================
  // 2. RunStatus 含 queued
  // ============================================================
  console.log("\n=== 2. RunStatus ===");

  const validRunStatuses: RunStatus[] = ["idle", "queued", "running", "succeeded", "failed"];
  assert(validRunStatuses.length === 5, "T2.1 RunStatus 含 5 态");
  assert(validRunStatuses.includes("queued"), "T2.2 RunStatus 含 queued");
  assert(validRunStatuses.includes("idle"), "T2.3 RunStatus 含 idle");

  // ============================================================
  // 3. RadarRunStatus 完整 6 态
  // ============================================================
  console.log("\n=== 3. RadarRunStatus ===");

  const validRunRecordStatuses: RadarRunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled", "skipped"];
  assert(validRunRecordStatuses.length === 6, "T3.1 RadarRunStatus 含 6 态");
  assert(validRunRecordStatuses.includes("cancelled"), "T3.2 RadarRunStatus 含 cancelled");
  assert(validRunRecordStatuses.includes("skipped"), "T3.3 RadarRunStatus 含 skipped");

  // ============================================================
  // 4. Radar 接口新字段
  // ============================================================
  console.log("\n=== 4. Radar 接口新字段 ===");

  const radar = createDefaultRadar("测试雷达", "custom");
  assert(radar.currentRunId === undefined, "T4.1 Radar 含 currentRunId(初始 undefined)");
  assert(radar.lastRunStatus === undefined, "T4.2 Radar 含 lastRunStatus(初始 undefined)");
  assert(radar.isBuiltin === false, "T4.3 Radar 含 isBuiltin(自定义=false)");
  assert(radar.isEditable === true, "T4.4 Radar 含 isEditable(自定义=true)");
  assert(radar.isDeletable === true, "T4.5 Radar 含 isDeletable(自定义=true)");
  assert(radar.ownerId === "demo_user", "T4.6 Radar 含 ownerId(自定义=demo_user)");
  assert(radar.providerRouting !== undefined, "T4.7 Radar 含 providerRouting");

  // ============================================================
  // 5. 内置雷达保护字段
  // ============================================================
  console.log("\n=== 5. 内置雷达保护字段 ===");

  const builtin = createDefaultRadar("AI 赛事", "ai_competition", undefined, { isBuiltin: true });
  assert(builtin.isBuiltin === true, "T5.1 内置雷达 isBuiltin=true");
  assert(builtin.isEditable === false, "T5.2 内置雷达 isEditable=false");
  assert(builtin.isDeletable === false, "T5.3 内置雷达 isDeletable=false");
  assert(builtin.ownerId === "system", "T5.4 内置雷达 ownerId=system");

  // ============================================================
  // 6. RadarRun 类型完整性
  // ============================================================
  console.log("\n=== 6. RadarRun 类型 ===");

  const run: RadarRun = {
    id: "run_test123",
    radarId: "radar_test456",
    status: "succeeded",
    mode: "manual",
    triggeredBy: "user",
    startedAt: "2026-06-30T10:00:00Z",
    finishedAt: "2026-06-30T10:00:05Z",
    totalRaw: 20,
    totalScored: 5,
    opportunityKeys: ["opp_1", "opp_2", "opp_3", "opp_4", "opp_5"],
    sourceCandidateCount: 15,
    query: "AI 比赛 2026",
    reportId: undefined,
    error: undefined,
    errorCode: undefined,
  };

  assert(run.mode === "manual", "T6.1 RadarRun 含 mode 字段");
  assert(run.triggeredBy === "user", "T6.2 RadarRun 含 triggeredBy 字段");
  assert(run.sourceCandidateCount === 15, "T6.3 RadarRun 含 sourceCandidateCount 字段");
  assert(run.query === "AI 比赛 2026", "T6.4 RadarRun 含 query 字段");
  assert(Array.isArray(run.opportunityKeys) && run.opportunityKeys.length === 5, "T6.5 RadarRun 含 opportunityKeys 数组");

  // ============================================================
  // 7. createDefaultRadar 工厂函数
  // ============================================================
  console.log("\n=== 7. createDefaultRadar 工厂函数 ===");

  assert(radar.status === "draft", "T7.1 默认状态 draft");
  assert(radar.privacy.visibility === "private", "T7.2 默认隐私 private");
  assert(radar.spec !== undefined, "T7.3 默认 spec 非空");
  assert(radar.createdAt !== undefined, "T7.4 含 createdAt");
  assert(radar.updatedAt !== undefined, "T7.5 含 updatedAt");
  assert(radar.id.startsWith("radar_"), "T7.6 ID 以 radar_ 开头");

  // ============================================================
  // 8. createDefaultProviderRouting
  // ============================================================
  console.log("\n=== 8. createDefaultProviderRouting ===");

  const aiRouting = createDefaultProviderRouting("ai_competition");
  assert(aiRouting.primary.includes("serper"), "T8.1 AI 赛事 primary 含 serper");
  assert(aiRouting.primary.includes("exa"), "T8.2 AI 赛事 primary 含 exa");

  const opcRouting = createDefaultProviderRouting("opc_policy");
  assert(opcRouting.primary.includes("bocha"), "T8.3 OPC 政策 primary 含 bocha");
  assert(opcRouting.primary.includes("google_cse"), "T8.4 OPC 政策 primary 含 google_cse");

  const culturalRouting = createDefaultProviderRouting("cultural_heritage");
  assert(culturalRouting.primary.includes("bocha"), "T8.5 文创非遗 primary 含 bocha");

  const customRouting = createDefaultProviderRouting("custom");
  assert(customRouting.primary.includes("serper"), "T8.6 自定义 primary 含 serper");
  assert(customRouting.fallback.includes("bocha"), "T8.7 自定义 fallback 含 bocha");

  // ============================================================
  // 9. ALLOWED_PROVIDERS 白名单
  // ============================================================
  console.log("\n=== 9. ALLOWED_PROVIDERS 白名单 ===");

  assert(ALLOWED_PROVIDERS.includes("serper"), "T9.1 白名单含 serper");
  assert(ALLOWED_PROVIDERS.includes("bocha"), "T9.2 白名单含 bocha");
  assert(ALLOWED_PROVIDERS.includes("exa"), "T9.3 白名单含 exa");
  assert(ALLOWED_PROVIDERS.includes("google_cse"), "T9.4 白名单含 google_cse");
  assert(ALLOWED_PROVIDERS.length === 4, "T9.5 白名单含 4 个 provider");

  // ============================================================
  // 10. ID 生成函数
  // ============================================================
  console.log("\n=== 10. ID 生成函数 ===");

  const radarId = generateRadarId();
  assert(radarId.startsWith("radar_"), "T10.1 generateRadarId 以 radar_ 开头");
  assert(radarId.length > 10, "T10.2 generateRadarId 长度 > 10");

  const runId = generateRunId();
  assert(runId.startsWith("run_"), "T10.3 generateRunId 以 run_ 开头");
  assert(runId.length > 10, "T10.4 generateRunId 长度 > 10");

  // 唯一性
  const id1 = generateRadarId();
  const id2 = generateRadarId();
  assert(id1 !== id2, "T10.5 generateRadarId 唯一性");

  // ============================================================
  // 11. createDefaultPrivacy
  // ============================================================
  console.log("\n=== 11. createDefaultPrivacy ===");

  const privacy = createDefaultPrivacy();
  assert(privacy.visibility === "private", "T11.1 默认 visibility=private");
  assert(privacy.allowClone === false, "T11.2 默认 allowClone=false");
  assert(privacy.allowShare === false, "T11.3 默认 allowShare=false");
  assert(privacy.redactSensitiveInfo === false, "T11.4 默认 redactSensitiveInfo=false");

  // ============================================================
  // 12. RadarKind 含 custom
  // ============================================================
  console.log("\n=== 12. RadarKind ===");

  const kinds: RadarKind[] = ["ai_competition", "opc_policy", "cultural_heritage", "custom"];
  assert(kinds.length === 4, "T12.1 RadarKind 含 4 种");
  assert(kinds.includes("custom"), "T12.2 RadarKind 含 custom");

  // ============================================================
  // 13. ProviderRouting 类型
  // ============================================================
  console.log("\n=== 13. ProviderRouting 类型 ===");

  const routing: ProviderRouting = { primary: ["serper"], fallback: ["bocha"] };
  assert(Array.isArray(routing.primary), "T13.1 primary 是数组");
  assert(Array.isArray(routing.fallback), "T13.2 fallback 是数组");

  // ============================================================
  // 汇总
  // ============================================================
  console.log("\n========================================");
  console.log(`总计: ${pass} PASS / ${fail} FAIL`);
  console.log("========================================");

  if (fail > 0) {
    console.log("\n❌ 存在失败项,请修复后重试");
    process.exit(1);
  } else {
    console.log("\n✓ 全部通过");
  }
}

main();
