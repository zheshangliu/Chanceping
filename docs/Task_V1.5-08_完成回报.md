# Task V1.5-08 完成回报：报告绑定 radar_id + ReportIndex

> 版本：V1.0 | 日期：2026-06-30 | 阶段：V1.5b
> 前置依赖：Task V1.5-03（API 最小闭环）、V1.5-06（定时运行）、V1.5-07（数量限制）

---

## 一、任务概述

报告生成时关联到具体雷达，支持按雷达查看历史报告。新建 ReportMeta 类型 + ReportStore 持久化，改造现有报告生成端点写入元数据，雷达详情页展示历史报告。

---

## 二、交付清单

### 2.1 新建文件（2 个）

| 文件 | 内容 |
|---|---|
| `src/agents/report-store.ts` | ReportMeta 接口（11 字段）+ ReportCreateInput + ReportListFilter + ReportStore 接口 + JsonReportStore 实现（持久化 data/report-index.json）+ generateReportId |
| `scripts/verify-task-v1.5-08-report.ts` | 19 项断言验收脚本（16 项内验 + 3 项外部回归） |

### 2.2 改造文件（9 个）

| 文件 | 改动 |
|---|---|
| `src/api/types.ts` | ReportGenerateRequest 新增 `radar_id?: string` 字段 |
| `src/api/context.ts` | AppContext 新增 `reportStore: ReportStore` + createAppContext 初始化 `new JsonReportStore()` |
| `src/api/routes/reports.ts` | 新增 `GET /` 查询端点（支持 ?radar_id= 过滤）；POST /generate 在 body.radar_id 存在时写入 ReportStore 并附加 reportId；POST /export 在 body.radar_id 存在时写入 ReportStore |
| `web/radar-detail.js` | 新增 `loadReportHistory(radarId)` + `renderReportList(reports)` 函数；renderRadarDetail 末尾调用 loadReportHistory；HTML 模板新增"历史报告"区 |
| `web/styles.css` | 新增 `.report-history-table` 表格样式（th/td/hover/a） |
| `scripts/verify-task-v1.5-03-api.ts` | createTestContext 新增 reportStore 字段（兼容 AppContext 新增必填字段） |
| `scripts/verify-task-v1.5-04-ui.ts` | 同上 |
| `scripts/verify-task-v1.5-05-generator.ts` | 同上 |
| `scripts/verify-task-v1.5-06-schedule.ts` | 同上 |
| `scripts/verify-task-v1.5-07-quota.ts` | 同上 |
| `scripts/verify-task022.ts` | 同上 |

---

## 三、关键设计

### 3.1 radar_id 可选 + 向后兼容

POST /generate 和 POST /export 在 `body.radar_id` 存在时才写入 ReportStore。不传 radar_id 时按旧逻辑工作（仅写文件，不写元数据），保证 e2e-v13 和 v1.5-03 等旧测试不破坏。

### 3.2 ReportStore 只存元数据

ReportStore 只存 ReportMeta（11 字段），报告正文仍在文件系统（`reports/api/` 或 `reports/export/`），通过 filename 关联。持久化路径 `data/report-index.json`，格式 `{ "reports": ReportMeta[], "version": "1.0" }`。

### 3.3 GET / 查询端点

新增 `GET /api/reports` 端点，返回 ReportMeta 数组（不含正文），支持 `?radar_id=xxx` 过滤。正文通过现有 `GET /api/reports/export/:filename` 下载。

### 3.4 POST /export 元数据写入

POST /export 返回二进制文件（Content-Disposition: attachment），无法在响应体返回 reportId。设计上在写文件后、返回 body 前调用 `ctx.reportStore.create()`，前端通过 GET / 查询。

### 3.5 前端历史报告区

在雷达详情页"运行历史"区下方新增"历史报告"区，表格展示：标题 / 周期 / 机会数 / 创建时间 / 下载链接。`loadReportHistory(radarId)` 在 `renderRadarDetail()` 末尾自动调用。

### 3.6 旧测试脚本兼容

AppContext 新增 reportStore 必填字段后，6 个旧验收脚本的 createTestContext 需补充 reportStore 字段。统一添加 `import { JsonReportStore }` + `const reportStore = new JsonReportStore()` + return 对象添加 `reportStore`。

---

## 四、验证结果

| 验证项 | 结果 |
|---|---|
| `npx tsc --noEmit` | exit 0（零错误） |
| `npx tsx scripts/verify-task-v1.5-08-report.ts` | 16 PASS / 0 FAIL |
| `npx tsx scripts/verify-e2e-v13.ts` | 43 PASS / 0 FAIL |
| `npx tsx scripts/verify-task-v1.5-03-api.ts` | 48 PASS / 0 FAIL |
| `npx tsx scripts/verify-task-v1.5-06-schedule.ts` | 15 PASS / 0 FAIL |
| `npx tsx scripts/verify-task-v1.5-07-quota.ts` | 14 PASS / 0 FAIL |

### V1.5-08 验收明细（16 项）

**6.1 ReportStore CRUD（1-7）**：
1. create 返回 ReportMeta，id 以 report_ 开头
2. get(id) 返回刚才创建的 ReportMeta
3. get(不存在) 返回 null
4. list() 返回数组且含刚才创建的报告
5. listByRadarId 只返回该雷达的报告
6. listByRadarId(radarId, 5) 最多返回 5 条
7. save() + load() 后数据一致

**6.2 报告生成写入元数据（8-11）**：
8. POST /generate 传 radar_id → 200 且含 reportId
9. POST /generate 不传 radar_id → 200 且不含 reportId
10. GET /api/reports?radar_id=xxx 返回该雷达的报告列表
11. ReportMeta 含 filename/periodStart/periodEnd/opportunityCount

**6.3 报告查询端点（12-14）**：
12. GET /api/reports → 200 返回 ReportMeta 数组
13. GET /api/reports?radar_id=xxx 只返回该雷达的报告
14. GET /api/reports?radar_id=不存在 → 返回空数组

**6.4 雷达详情页（15-16）**：
15. web/radar-detail.js 含 loadReportHistory 函数
16. web/radar-detail.js 调用 GET /api/reports?radar_id=

**6.5 回归（17-19，外部命令）**：
17. tsc --noEmit exit 0
18. verify-e2e-v13.ts 43 PASS
19. verify-task-v1.5-03-api.ts 48 PASS

---

## 五、API 端点变更

| 方法 | 路径 | 变更 | 说明 |
|---|---|---|---|
| GET | /api/reports | 新增 | 列出报告元数据，支持 ?radar_id= 过滤 |
| POST | /api/reports/generate | 改造 | body.radar_id 存在时写入 ReportStore，返回结果附加 reportId |
| POST | /api/reports/export | 改造 | body.radar_id 存在时写入 ReportStore |

---

## 六、V1.5b 阶段总结

V1.5b 阶段（06 定时运行 / 07 数量限制 / 08 报告绑定）已全部完成：

- V1.5-06（commit 780e31b）：RadarSchedule 定时配置 + cron 校验 + executeSearchTrigger 兼容层
- V1.5-07（commit e393564）：UserContext + RADAR_QUOTA + RadarQuotaChecker + GET /quota 端点
- V1.5-08（本次）：ReportMeta + ReportStore + GET / 查询端点 + 前端历史报告区

V1.5a（01-05）+ V1.5b（06-08）共 8 个任务全部完成。
