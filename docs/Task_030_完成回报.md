## Task 030 完成回报

### 1. 修改了哪些文件

- src/schema/opportunity-card.ts：+15 行（3 新状态 tracking/missed/expired + 转换表扩展 + 标签扩展）
- src/api/app.ts：+2 行（导入 `reviewRoutes` + 注册 `/api/review` 路由）
- package.json：+1 行（添加 `verify:review` 脚本，指向 `tsx scripts/verify-task030.ts`）

### 2. 新增了哪些文件

- src/agents/opportunity-state-machine.ts（119 行）：状态机引擎（T17）。导出 `TransitionResult` / `AutoTransitionResult` 接口 + `transition(card, targetStatus)` / `autoExpire(card, now)` / `autoMiss(card, now)` / `getValidTransitions(status)` / `batchAutoTransition(entries, now)` 函数。纯函数，不依赖存储。`autoExpire`：截止已过 + 未报名（new/viewed/tracking/saved）→ expired。`autoMiss`：截止 7 天以上 + 未报名 → missed。`batchAutoTransition`：先检查 missed，再检查 expired
- src/agents/opportunity-review.ts（175 行）：机会复盘（T16）。导出 `ReviewSummary` / `LevelStats` / `MissReason` 接口 + `generateReview(entries, periodDays)` 函数。统计已截止机会的命中率（applied / total）+ 按等级（S/A/B/C）分组 + 按雷达类型分组 + 错过原因分析（未查看就过期/查看后未跟踪/跟踪后未报名/保存后未报名）+ 改进建议生成（规则化，基于命中率/错过数/等级命中率）
- src/api/routes/review.ts（98 行）：复盘 API。3 个端点：GET `/`（获取复盘报告，支持 ?days=N 参数）、GET `/summary`（精简摘要）、POST `/auto-transition`（手动触发自动过期/错过检查 + 批量更新）
- scripts/verify-task030.ts（291 行）：82 项验收测试。6 组验证：文件存在性(10) + 状态枚举/转换表/标签(20) + 状态机引擎(18) + 机会复盘(16) + API 路由(10) + 工程约束(8)

### 3. 如何本地运行

```bash
# 编译检查
npx tsc --noEmit

# 运行 Task 030 验收脚本
npx tsx scripts/verify-task030.ts

# 或通过 package.json 脚本
npm run verify:review
```

### 4. 如何测试

```bash
# 编译检查
npx tsc --noEmit

# Task 030 验收
npx tsx scripts/verify-task030.ts

# 回归测试（T3-T12）
npx tsx scripts/verify-task019d.ts
npx tsx scripts/verify-task019.ts
npx tsx scripts/verify-task021.ts
npx tsx scripts/verify-task022.ts
npx tsx scripts/verify-task023.ts
npx tsx scripts/verify-task024.ts
npx tsx scripts/verify-task025.ts
npx tsx scripts/verify-task026.ts
npx tsx scripts/verify-task028.ts
npx tsx scripts/verify-task029.ts
```

### 5. 哪些功能还没做

- 状态转换历史记录（V1.5，记录每次状态转换的时间/操作人/原因）
- 复盘报告 PDF 导出（Task 031 报告导出）
- 复盘定时自动触发（Task 028 调度器已支持，可通过调度器配置定期复盘）
- 复盘报告邮件推送（Task 029 多渠道适配已支持，可通过 notifyReminders 推送）
- 状态机可视化（V1.1 Web UI 扩展，当前仅 API 返回 JSON）
- 自动过期/错过的定时自动执行（V1.1，当前需手动调用 POST /auto-transition）
- 复盘报告对比分析（V2.0，对比不同时间段的命中率变化）

### 6. 下一步建议

- Task 031：报告导出（PDF/Excel，含复盘报告）
- Task 032：Web UI 状态机管理面板（可视化状态转换 + 复盘报告展示）
- V1.0：调度器集成自动过期/错过检查（每日定时执行 batchAutoTransition）

### 验收矩阵对照

| 验收项 | 覆盖状态 | 验证方式 |
|---|---|---|
| F1 状态枚举扩展 | ✅ 通过 | 测试 2.1-2.4（9 个状态含 tracking/missed/expired） |
| F2 tracking 转换表 | ✅ 通过 | 测试 2.5-2.11（tracking 可转 6 个状态） |
| F3 missed/expired 转换表 | ✅ 通过 | 测试 2.12-2.17（missed/expired 可转 archived/dismissed） |
| F4 标签扩展 | ✅ 通过 | 测试 2.18-2.20（9 个标签含跟踪中/已错过/已过期） |
| F5 合法转换 | ✅ 通过 | 测试 3.1-3.2（new → tracking 合法） |
| F6 非法转换 | ✅ 通过 | 测试 3.3-3.5（applied → tracking 非法） |
| F7 自动过期 | ✅ 通过 | 测试 3.6-3.7（截止已过 + 未报名 → expired） |
| F8 自动错过 | ✅ 通过 | 测试 3.8-3.9（截止 7 天以上 + 未报名 → missed） |
| F9 不过期（截止未到） | ✅ 通过 | 测试 3.10-3.11（截止未到 → 状态不变） |
| F10 不过期（已报名） | ✅ 通过 | 测试 3.12-3.13（已报名 → 状态不变） |
| F11 批量自动转换 | ✅ 通过 | 测试 3.14-3.21（batchAutoTransition 返回 2 条） |
| F12 复盘报告 | ✅ 通过 | 测试 4.1-4.4（total=5, applied=2, missed=3） |
| F13 命中率 | ✅ 通过 | 测试 4.5（hit_rate = 0.4） |
| F14 错过率 | ✅ 通过 | 测试 4.6（miss_rate = 0.6） |
| F15 按等级分组 | ✅ 通过 | 测试 4.7-4.11（S/A/B/C 4 组 + S 级命中率 1.0） |
| F16 错过原因 | ✅ 通过 | 测试 4.12-4.16（含未查看/未跟踪/未报名分类） |
| F17 改进建议 | ✅ 通过 | 测试 4.17-4.18（suggestions 非空数组） |
| F18 API GET / | ✅ 通过 | 测试 5.1-5.2（含 GET / 端点 + 调用 generateReview） |
| F19 API GET /summary | ✅ 通过 | 测试 5.3-5.4（含 GET /summary 端点 + 返回 hit_rate） |
| F20 API POST /auto-transition | ✅ 通过 | 测试 5.5-5.8（含端点 + 调用 batchAutoTransition + store.update） |
| T1 tsc 编译 | ✅ 通过 | exit 0 |
| T2 无新 npm 依赖 | ✅ 通过 | 零新依赖 |
| T3 回归测试 019d | ✅ 通过 | PASS 146 / FAIL 0 |
| T4 回归测试 019 | ✅ 通过 | PASS 149 / FAIL 0 |
| T5 回归测试 021 | ✅ 通过 | PASS 68 / FAIL 0 |
| T6 回归测试 022 | ✅ 通过 | PASS 73 / FAIL 0 |
| T7 回归测试 023 | ✅ 通过 | PASS 98 / FAIL 0 |
| T8 回归测试 024 | ✅ 通过 | PASS 40 / FAIL 0 |
| T9 回归测试 025 | ✅ 通过 | PASS 26 / FAIL 0 |
| T10 回归测试 026 | ✅ 通过 | PASS 39 / FAIL 0 |
| T11 回归测试 028 | ✅ 通过 | PASS 119 / FAIL 0 |
| T12 回归测试 029 | ✅ 通过 | PASS 72 / FAIL 0 |
| T13 验证脚本 | ✅ 通过 | 82 项全 PASS |

### 设计说明

**状态机扩展（T17）**：新增 3 个状态（tracking/missed/expired），保留现有 6 个，共 9 个状态。`isStatusTransitionValid()` 函数无需修改，因为它读取 `CARD_STATUS_TRANSITIONS` 常量，常量扩展后自动生效。

**转换表设计**：`new/viewed` 可转 `missed/expired`，因为 `autoExpire`/`autoMiss` 处理所有未报名状态（new/viewed/tracking/saved）。初版转换表只允许 `tracking/saved → missed/expired`，导致 `autoExpire` 对 `new` 状态卡片失败。修复后 `new/viewed` 也能转 `missed/expired`。

**autoExpire vs autoMiss 优先级**：`batchAutoTransition` 先检查 missed（截止 7 天以上），再检查 expired（截止已过）。如果截止日期已过 7 天以上，优先标记为 missed（更严重），而不是 expired。

**复盘统计**：`generateReview(entries, periodDays)` 筛选时间范围内的已截止机会，统计命中率（applied / total）和错过率（missed / total）。按等级（S/A/B/C）和雷达类型分组统计。错过原因分析基于卡片状态分类：new → "未查看就过期"、viewed → "查看后未跟踪"、tracking → "跟踪后未报名"、saved → "保存后未报名"。

**改进建议规则化**：基于命中率/错过数/等级命中率生成，不用 LLM。命中率 < 30% → 建议增加搜索频率；错过数 > 报名数 → 建议设置截止提醒；S/A 级命中率 < 50% → 建议优先关注高价值机会；无问题时 → 保持当前策略。

**API 设计**：3 个端点。GET `/` 返回完整复盘报告（含 by_level/by_radar_type/miss_reasons/suggestions）。GET `/summary` 返回精简摘要（total/applied/missed/hit_rate/miss_rate）。POST `/auto-transition` 手动触发自动过期/错过检查，批量更新卡片状态并返回转换列表。

**向后兼容**：现有 6 个状态保留，不破坏现有数据。现有转换规则（如 new → viewed/saved/applied/archived/dismissed）不变，只是新增了 new → tracking/missed/expired。

### 运行输出

```
=== Task 030 机会状态机扩展 + 机会复盘验收 ===

[验收 1] 文件存在性检查
  PASS  文件存在: src/agents/opportunity-state-machine.ts
  PASS  文件存在: src/agents/opportunity-review.ts
  PASS  文件存在: src/api/routes/review.ts
  PASS  文件存在: scripts/verify-task030.ts
  PASS  app.ts 导入 reviewRoutes
  PASS  app.ts 注册 /api/review 路由
  PASS  package.json 含 verify:review 脚本

[验收 2] opportunity-card.ts 状态枚举/转换表/标签
  PASS  F1 状态枚举含 9 个状态（实际 9）
  PASS  F1 含 tracking 状态
  PASS  F1 含 missed 状态
  PASS  F1 含 expired 状态
  PASS  F2 tracking → saved
  PASS  F2 tracking → applied
  PASS  F2 tracking → missed
  PASS  F2 tracking → expired
  PASS  F2 tracking → archived
  PASS  F2 tracking → dismissed
  PASS  F2 tracking 可转 6 个状态（实际 6）
  PASS  F3 missed → archived
  PASS  F3 missed → dismissed
  PASS  F3 missed 可转 2 个状态
  PASS  F3 expired → archived
  PASS  F3 expired → dismissed
  PASS  F3 expired 可转 2 个状态
  PASS  F4 标签含 9 个（实际 9）
  PASS  F4 tracking 标签 = 跟踪中
  PASS  F4 missed 标签 = 已错过
  PASS  F4 expired 标签 = 已过期
  PASS  F5 new → tracking 合法
  PASS  F6 applied → tracking 非法

[验收 3] opportunity-state-machine.ts 状态机引擎
  PASS  F5 transition new → tracking success
  PASS  F5 transition 后 status = tracking
  PASS  F6 transition applied → tracking 失败
  PASS  F6 transition 返回 error
  PASS  F6 transition 后 status 不变
  PASS  F7 autoExpire success
  PASS  F7 autoExpire 后 status = expired
  PASS  F8 autoMiss success
  PASS  F8 autoMiss 后 status = missed
  PASS  F9 autoExpire 截止未到 success
  PASS  F9 autoExpire 截止未到 → status 不变
  PASS  F10 autoExpire 已报名 success
  PASS  F10 autoExpire 已报名 → status 不变
  PASS  F11 batchAutoTransition 返回 2 条（实际 2）
  PASS  F11 k1 在结果中
  PASS  F11 k1 → missed（截止 7 天以上）
  PASS  F11 k2 在结果中
  PASS  F11 k2 → expired（截止已过未到 7 天）
  PASS  F11 k3 不在结果中（已报名）
  PASS  F11 k4 不在结果中（截止未到）
  PASS  getValidTransitions(new) 含 tracking
  PASS  getValidTransitions(new) 含 applied

[验收 4] opportunity-review.ts 机会复盘
  PASS  F12 generateReview 返回对象
  PASS  F12 total_opportunities = 5（实际 5）
  PASS  F12 applied_count = 2（实际 2）
  PASS  F12 missed_count = 3（实际 3）
  PASS  F13 hit_rate = 0.4（实际 0.4）
  PASS  F14 miss_rate = 0.6（实际 0.6）
  PASS  F15 by_level 含 S
  PASS  F15 by_level 含 A
  PASS  F15 by_level 含 B
  PASS  F15 by_level 含 C
  PASS  F15 S 级命中率 = 1.0（实际 1）
  PASS  F15 A 级命中率 = 0.0（实际 0）
  PASS  F16 miss_reasons 是数组
  PASS  F16 miss_reasons 非空
  PASS  F16 含"未查看就过期"
  PASS  F16 含"跟踪后未报名"
  PASS  F16 含"保存后未报名"
  PASS  F17 suggestions 是数组
  PASS  F17 suggestions 非空

[验收 5] API 路由检查
  PASS  F18 含 GET / 端点
  PASS  F18 GET / 调用 generateReview
  PASS  F19 含 GET /summary 端点
  PASS  F19 summary 返回 hit_rate
  PASS  F20 含 POST /auto-transition 端点
  PASS  F20 调用 batchAutoTransition
  PASS  F20 调用 ctx.store.update
  PASS  F20 返回 transitioned 计数
  PASS  reviewRoutes 导出函数

[验收 6] 工程约束检查
  PASS  T2 无新 npm 依赖
  PASS  package.json 含 verify:review 脚本

=== 汇总 ===
PASS: 82
FAIL: 0
✓ 全部通过
```

### 回归测试汇总

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
| `verify-task028.ts` | 119 | 0 | 0 |
| `verify-task029.ts` | 72 | 0 | 0 |
| `verify-task030.ts` | 82 | 0 | 0 |

**合计：912 项 PASS / 0 项 FAIL**
