## Task 026 完成回报

### 1. 修改了哪些文件

- src/search/provider-registry.ts：+6 行（导入 3 个新 Provider + 注册 3 个新 Provider）
- src/search/orchestrator.ts：+2 行（导入 deduplicateByUrL + 合并结果时调用去重）
- package.json：+1 行（添加 verify:providers 脚本）
- scripts/verify-task019d.ts：修复"无可用 provider"测试（注销全部 4 个 Provider 而非仅 serper）

### 2. 新增了哪些文件

- src/search/providers/bocha.ts：博查 Provider（中文搜索主力，radar_types=opc_policy + cultural_heritage，reliability=B）
- src/search/providers/exa.ts：Exa Provider（语义搜索，radar_types=ai_competition，reliability=B，支持 neural/keyword 模式）
- src/search/providers/google-cse.ts：Google CSE Provider（站点限定 gov.cn，radar_types=opc_policy，reliability=A，source_type=gov）
- src/search/radar-router.ts：雷达路由 + URL 去重（RADAR_ROUTING 常量 + getProviderNamesForRadar + deduplicateByUrL）
- scripts/verify-task026.ts：验收脚本（39 项测试，8 组覆盖）

### 3. 如何本地运行

```bash
# 运行验证
npx tsx scripts/verify-task026.ts

# 编译检查
npx tsc --noEmit
```

### 4. 如何测试

```bash
npx tsc --noEmit
npx tsx scripts/verify-task019d.ts
npx tsx scripts/verify-task019.ts
npx tsx scripts/verify-task021.ts
npx tsx scripts/verify-task022.ts
npx tsx scripts/verify-task023.ts
npx tsx scripts/verify-task024.ts
npx tsx scripts/verify-task025.ts
npx tsx scripts/verify-task026.ts
```

### 5. 哪些功能还没做

- 真实 API 联调（需用户申请博查/Exa/Google CSE API Key）
- Provider 故障自动降级切换（V1.0 健壮性增强）
- Provider 调用成本统计（V1.0 运营监控）
- 搜索结果质量评分（V1.0 A/B 测试）
- Provider 配置热更新（V1.0 运维）
- 请求重试 + 指数退避（V1.0 健壮性）

### 6. 下一步建议

- Task 027：V0.9 总结 + Git 版本标签
- V1.0：真实 API Key 联调 + 健壮性增强 + Provider 故障降级

### 验收矩阵对照

| 验收项 | 覆盖状态 | 验证方式 |
|---|---|---|
| F1 BochaProvider 接口实现 | ✅ 通过 | 测试 3.1 |
| F2 ExaProvider 接口实现 | ✅ 通过 | 测试 3.2 |
| F3 GoogleCseProvider 接口实现 | ✅ 通过 | 测试 3.3 |
| F4 Bocha Mock 搜索 | ✅ 通过 | 测试 4.1-4.3 |
| F5 Exa Mock 搜索 | ✅ 通过 | 测试 4.4-4.5 |
| F6 GoogleCse Mock 搜索 | ✅ 通过 | 测试 4.6-4.8 |
| F7 雷达路由 - AI 赛事 | ✅ 通过 | 测试 5.1 |
| F8 雷达路由 - OPC 政策 | ✅ 通过 | 测试 5.2 |
| F9 雷达路由 - 文创 | ✅ 通过 | 测试 5.3 |
| F10 URL 去重 | ✅ 通过 | 测试 6.1-6.4 |
| F11 注册表自动注册 | ✅ 通过 | 测试 7.1-7.6 |
| F12 编排器去重集成 | ✅ 通过 | 测试 8.3 |
| F13 健康检查 | ✅ 通过 | 测试 4.9 |
| F14 可靠性评级 | ✅ 通过 | 测试 3.1-3.3 |
| T1 tsc 编译 | ✅ 通过 | exit 0 |
| T2 无新 npm 依赖 | ✅ 通过 | 测试 8.1 |
| T3-T9 回归测试 | ✅ 通过 | 019d/019/021/022/023/024/025 全 PASS |
| T10 验证脚本 | ✅ 通过 | 39 项全 PASS |

### 设计说明

**雷达路由规则**：严格按搜索层选型决策 V1.0：
- ai_competition → Serper 主力 + Exa 语义
- opc_policy → 博查主力 + Google CSE（限定 gov.cn）
- cultural_heritage → 博查主力 + Serper 补充

**URL 去重策略**：多 Provider 并行搜索时，同一 URL 可能被多个 Provider 返回。按 normalizeUrl(url) 去重，保留第一条出现的结果（保留 source_provider 信息）。

**orchestrator 最小化修改**：仅 +2 行（导入 + 去重调用），将 `providerResults.flatMap((r) => r.results)` 包裹在 `deduplicateByUrL()` 中，所有后续 `rawResults` 引用无需修改。

**回归测试修复**：verify-task019d.ts 的"无可用 provider"测试原本只注销 serper，Task 026 后注册表含 4 个 Provider，需全部注销才能触发该场景。已更新测试逻辑。

### 运行输出

```
Task 026 验收脚本：多 Provider 扩展 + 雷达路由
============================================================

=== 1. 文件存在性检查 ===
  PASS  文件存在: src/search/providers/bocha.ts
  PASS  文件存在: src/search/providers/exa.ts
  PASS  文件存在: src/search/providers/google-cse.ts
  PASS  文件存在: src/search/radar-router.ts
  PASS  文件存在: scripts/verify-task026.ts

=== 2. tsc 编译检查 ===
  PASS  tsc 编译通过（由外部 npx tsc --noEmit 验证）

=== 3. Provider 接口实现检查 ===
  PASS  3.1 BochaProvider 接口实现
  PASS  3.2 ExaProvider 接口实现
  PASS  3.3 GoogleCseProvider 接口实现
  PASS  3.4 BochaProvider 有 search + healthCheck 方法
  PASS  3.5 ExaProvider 有 search + healthCheck 方法
  PASS  3.6 GoogleCseProvider 有 search + healthCheck 方法

=== 4. Mock 模式搜索测试 ===
  PASS  4.1 Bocha Mock 搜索返回非空数组
  PASS  4.2 Bocha Mock 结果 URL 全 HTTPS
  PASS  4.3 Bocha Mock 结果含完整字段
  PASS  4.4 Exa Mock 搜索返回非空数组
  PASS  4.5 Exa Mock 结果 URL 全 HTTPS
  PASS  4.6 GoogleCse Mock 搜索返回非空数组
  PASS  4.7 GoogleCse Mock 结果 URL 含 gov.cn
  PASS  4.8 GoogleCse Mock 结果 source_type=gov
  PASS  4.9 3 个 Provider Mock 模式 healthCheck 返回 true

=== 5. 雷达路由测试 ===
  PASS  5.1 ai_competition → ["serper", "exa"]
  PASS  5.2 opc_policy → ["bocha", "google_cse"]
  PASS  5.3 cultural_heritage → ["bocha", "serper"]
  PASS  5.4 未知雷达类型 fallback 到 ["serper"]

=== 6. URL 去重测试 ===
  PASS  6.1 相同 URL 去重后只保留一条
  PASS  6.2 去重后保留第一条的 source_provider
  PASS  6.3 空数组去重返回空数组
  PASS  6.4 全部不同 URL 去重后长度不变

=== 7. Provider 注册表检查 ===
  PASS  7.1 providerRegistry.get('bocha') 非空
  PASS  7.2 providerRegistry.get('exa') 非空
  PASS  7.3 providerRegistry.get('google_cse') 非空
  PASS  7.4 getByRadarType('opc_policy') 含 bocha + google_cse
  PASS  7.5 getByRadarType('ai_competition') 含 serper + exa
  PASS  7.6 getByRadarType('cultural_heritage') 含 bocha + serper

=== 8. 工程约束自检 ===
  PASS  8.1 不引入新 npm 依赖
  PASS  8.2 provider-registry.ts 已注册 3 个新 Provider
  PASS  8.3 orchestrator.ts 已集成 deduplicateByUrL 去重
  PASS  8.4 package.json 添加 verify:providers 脚本

=== 汇总 ===
PASS: 39
FAIL: 0
✓ 全部通过
```

回归测试汇总：

| 命令 | PASS | FAIL | Exit Code |
|---|---|---|---|
| `npx tsc --noEmit` | — | — | 0 |
| `verify-task019d.ts` | 146 | 0 | 0 |
| `verify-task019.ts` | 149 | 0 | 0 |
| `verify-task021.ts` | 68 | 0 | 0 |
| `verify-task022.ts` | 73 | 0 | 0 |
| `verify-task023.ts` | 98 | 0 | 0 |
| `verify-task024.ts` | 40 | 0 | 0 |
| `verify-task025.ts` | 26 | 0 | 0 |
| `verify-task026.ts` | 39 | 0 | 0 |

**合计：639 项 PASS / 0 项 FAIL**
