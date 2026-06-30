# Task V1.5-07 完成回报：雷达数量限制

> 版本：V1.0 | 日期：2026-06-30 | 阶段：V1.5b-2
> 前置依赖：Task V1.5-03（API 最小闭环）已验收通过

---

## 一、任务概述

免费用户只能创建 1 个自定义雷达，超限时返回 403 RADAR_QUOTA_EXCEEDED。V1.5b 不引入真实登录系统，用固定 demo_user 假用户（free 计划，配额 1）。核心链路：

```
POST /api/radars → getCurrentUser() → RadarQuotaChecker.check()
→ 统计 isBuiltin=false + status≠archived 的自定义雷达数
→ current < quota → 允许创建
→ current >= quota → 403 RADAR_QUOTA_EXCEEDED
```

归档雷达释放配额（不计入统计），内置雷达不计入配额。

---

## 二、交付清单

### 2.1 新建文件（3 个）

| 文件 | 内容 |
|---|---|
| [src/agents/user-context.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/agents/user-context.ts) | UserContext 类型 + UserPlan + RADAR_QUOTA（4 等级）+ getCurrentUser（固定 demo_user + free） |
| [src/agents/radar-quota.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/agents/radar-quota.ts) | RadarQuotaChecker 类：统计非内置非归档雷达数，比对 RADAR_QUOTA |
| [scripts/verify-task-v1.5-07-quota.ts](file:///c:/Users/test/Desktop/chanceping/changeping/scripts/verify-task-v1.5-07-quota.ts) | 验收脚本：16 项断言（6.1-6.5），回归 3 项由外部命令运行 |

### 2.2 改造文件（5 个）

| 文件 | 改动 |
|---|---|
| [src/api/routes/radars.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/api/routes/radars.ts) | POST / 加配额检查（!allowed → 403 RADAR_QUOTA_EXCEEDED）；新增 GET /quota 端点（在 /:id 之前注册避免路由冲突） |
| [web/radars.js](file:///c:/Users/test/Desktop/chanceping/changeping/web/radars.js) | 新增 loadQuotaInfo() 渲染配额条 + 按钮禁用；submitCreate() 处理 403 RADAR_QUOTA_EXCEEDED 特殊提示 |
| [web/index.html](file:///c:/Users/test/Desktop/chanceping/changeping/web/index.html) | panel-radars 顶部新增配额展示容器 #radar-quota-bar |
| [web/styles.css](file:///c:/Users/test/Desktop/chanceping/changeping/web/styles.css) | 新增 .radar-quota-bar + .quota-full 样式 |
| [scripts/verify-task-v1.5-03-api.ts](file:///c:/Users/test/Desktop/chanceping/changeping/scripts/verify-task-v1.5-03-api.ts) | 适配 V1.5-07 配额限制：test 7/16 创建新雷达前先归档 customId 释放配额 |

---

## 三、关键设计点

### 3.1 假用户上下文（不引入登录）

V1.5b 用固定 demo_user + free 计划。`getCurrentUser()` 永远返回 `{ userId: "demo_user", plan: "free" }`。预留 4 个付费等级常量（free=1 / basic=3 / pro=10 / enterprise=50），V1.5b 只用 free。未来接入登录后只需改 getCurrentUser。

### 3.2 配额计算规则

RadarQuotaChecker.check() 复用 RadarStore.list 已有的过滤能力：
- `isBuiltin: false` → 排除内置雷达
- `ownerId: user.userId` → 只统计当前用户的雷达
- `includeArchived` 默认 false → 排除已归档雷达（归档释放配额）

### 3.3 GET /quota 路由顺序

GET /quota 必须在 GET /:id 之前注册，否则 "quota" 会被当成 id 参数。Hono 按注册顺序匹配，精确路径优先于参数路径。

### 3.4 V1.5-03 回归脚本适配

V1.5-03 验收脚本创建多个自定义雷达（test 7 创建删除雷达、test 16 创建 draft 雷达），在配额=1 限制下第 2 个 POST 被 403 拒绝。修复方式：在创建新雷达前先 DELETE（归档）当前 customId 释放配额，test 7 删除后再重建 customId 供后续 activate/run 测试使用。

---

## 四、验收结果

| 验收项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出码 0 |
| `npx tsx scripts/verify-task-v1.5-07-quota.ts` | 14 PASS / 0 FAIL |
| `npx tsx scripts/verify-e2e-v13.ts`（回归） | 43 PASS / 0 FAIL |
| `npx tsx scripts/verify-task-v1.5-03-api.ts`（回归） | 48 PASS / 0 FAIL |
| `npx tsx scripts/verify-task-v1.5-06-schedule.ts`（回归） | 15 PASS / 0 FAIL |

验收脚本 16 项断言明细：
- 6.1 配额常量（1-4）：free=1 / basic=3 / pro=10 / enterprise=50
- 6.2 getCurrentUser（5-6）：userId=demo_user / plan=free
- 6.3 RadarQuotaChecker（7-10）：初始 allowed / 创建后 not allowed / 归档后 allowed / 内置不计入
- 6.4 API 端点（11-13）：第1次 200 / 第2次 403 / 归档后 200
- 6.5 回归（14-16）：tsc + e2e + v1.5-03-api（外部命令）

---

## 五、Git 提交

- 提交信息：`Task V1.5-07 雷达数量限制`
- 文件：8 个（3 新建 + 4 改造 + 1 回归脚本适配）+ 完成回报
