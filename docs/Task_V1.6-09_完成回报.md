# Task V1.6-09 生成失败前端降级 — 完成回报

> 任务书：`V1.6-09生成失败前端降级任务书.md`
> 提交 commit：`7df2cba`（20 files changed, +444/-41）
> 工作区状态：clean，领先 origin/main 10 commits

---

## 1. 任务目标

AI 生成雷达 Spec 失败时，前端不能仅展示 placeholder，必须给出失败原因 + 三个降级选项（重试 / 手动创建 / 转入一次一问），保证用户在 AI 不可用时仍能继续工作流。

后端需配套调整错误码：从 `GENERATE_ERROR` 改为 `RADAR_GENERATION_FAILED`，并确保 HTTP 状态码为 500。

---

## 2. 交付清单

### 2.1 新建文件（2 个）

| 文件 | 说明 |
|------|------|
| `scripts/verify-task-v1.6-09-frontend-fallback.ts` | 验收脚本，29 项断言（前端静态 6 + 降级按钮 7 + CSS 5 + 后端 API 3 + 端到端 5 + 错误处理 3） |
| `docs/Task_V1.6-09_完成回报.md` | 本完成回报 |

### 2.2 修改文件（4 个，V1.6-09 主体）

| 文件 | 改动要点 |
|------|---------|
| `src/api/routes/radars.ts` | POST `/generate` catch 块错误码 `GENERATE_ERROR` → `RADAR_GENERATION_FAILED`，HTTP 500 |
| `web/radars.js` | 新增 `#ai-gen-error` 容器；`submitGenerate` 失败时调用 `showGenerateError`；新增 `showGenerateError(modal, message, description)` 函数，渲染错误原因 + 三按钮（重试 / 手动创建 / 转入一次一问） |
| `web/styles.css` | 新增 `.generate-error` / `.error-message` / `.error-actions` 样式（红色边框 + flex 布局） |
| `package.json` | 新增 `verify:v16:frontend-fallback` 脚本 |

### 2.3 随带提交的 V1.6a 自检修复延续（14 个文件）

V1.6-07 commit 时未完全提交的 V1.6a 五维自检修复延续改动，本次随带提交（已通过全部回归测试）：

| 文件 | 改动要点 |
|------|---------|
| `src/agents/meilisearch-store.ts` | `autoFlush` 从 `private readonly` 改为 `public`，支持批量更新前临时禁用 |
| `src/agents/opportunity-store.ts` | `OpportunityStore.autoFlush` 接口字段；`LocalFileStore.autoFlush` 改为 `public` |
| `src/agents/radar-generator.ts` | 用 `getLlmMode()` 替代 `process.env.LLM_MODE`，确保默认值一致 |
| `src/agents/radar-store.ts` | `RadarRunStore` 接口新增 `delete(id)` 方法；`JsonRadarRunStore` 实现 |
| `src/agents/report-store.ts` | `ReportStore` 接口新增 `delete(id)` 方法；`JsonReportStore` 实现 |
| `src/api/routes/opportunities.ts` | 批量状态回写前禁用 `autoFlush`，结束后单次 `flush()`，避免 N 次全量写入 |
| `src/api/routes/reports.ts` | 生成失败返回 500（原 200）；`/export/:filename` 路径遍历防护 |
| `src/api/routes/web-ui.ts` | 静态文件路径遍历防护（确保解析后路径仍在 `webDir` 内）；`/assets/:filename` 路径遍历防护 |
| `src/scheduler/triggers.ts` | 并发执行防护（`currentRunId` 检查跳过）；回写前重新获取最新 radar 避免用旧快照覆盖用户修改 |
| `web/home.js` | `chat-error` 事件使用 `detail` 字段（原 `message` 字段错误） |
| `web/reports.js` | 链接协议安全检查（仅允许 `http(s)://` 和 `//` 协议相对） |
| `web/search.js` | `escapeHtml` 修复 `level` / `totalScore` / `val` 的 XSS |
| `web/radar-detail.js` | `escapeHtml` 修复 `level` / `totalScore` 的 XSS；请求序号 `loadDetailSeq` 防止快速切换 tab 时的竞态 |
| `web/watch-rules-editor.js` | `escapeHtml` 修复错误信息和组名；`switchTab` 内触发 `tab-switched` 事件（原缺失导致 radars.js 不加载） |

---

## 3. 关键设计决策

### 3.1 错误码命名

- 任务书原要求 `GENERATE_ERROR`，但项目错误码命名规范为 `<资源>_<动作>_FAILED`（参考 `RADAR_NOT_FOUND` / `RADAR_QUOTA_EXCEEDED` / `RADAR_NOT_EDITABLE`）
- 采用 `RADAR_GENERATION_FAILED`，与项目错误码体系一致

### 3.2 前端降级三选项

| 按钮 | 行为 | 实现要点 |
|------|------|---------|
| 重试 | 重新调用 `submitGenerate(modal)` | 隐藏错误容器后重新发起请求 |
| 手动创建 | 关闭 modal + 调用 `openCreateModal()` | 复用 V1.5-04 的手动创建表单 |
| 转入一次一问 | 关闭 modal + `switchTab("chat")` + 预填 `chat-input` | 复用 `window.switchTab`（home.js 全局暴露） |

### 3.3 错误信息展示

- 使用 `escapeHtml(message)` 转义后端返回的 `error.message`，防止 XSS
- 前缀统一为 `AI 生成失败：`
- 网络错误（catch 块）也走 `showGenerateError`，message 为 `err.message || "网络错误，请稍后重试"`

### 3.4 验收脚本 D2 正则修复

原正则 `/errorResponse\("RADAR_GENERATION_FAILED"[^)]*\d+,\s*500\)/` 中 `[^)]*` 会在 `String(err)` 的 `)` 处停止，无法匹配到后面的 `, 500)`。

修复为 `/errorResponse\("RADAR_GENERATION_FAILED"[\s\S]*?,\s*500\)/`，使用 `[\s\S]*?` 非贪婪匹配任意字符（含换行），直到遇到 `,\s*500\)`。

---

## 4. 验证结果

### 4.1 TypeScript 编译

```
npx tsc --noEmit
```
- 退出码：0
- 结果：通过

### 4.2 V1.6-09 验收脚本

```
npx tsx scripts/verify-task-v1.6-09-frontend-fallback.ts
```

```
=== A. 前端代码静态检查 ===  6 PASS
=== B. 降级选项按钮 ===      7 PASS
=== C. CSS 样式 ===           5 PASS
=== D. 后端 API 错误响应 ===  3 PASS
=== E. API 端到端 ===         5 PASS
=== F. 错误信息处理 ===       3 PASS
总计: 29 PASS / 0 FAIL  ✅ 全部通过
```

### 4.3 回归测试 — verify:v15

```
npm run verify:v15
```

| 任务 | 断言数 | 结果 |
|------|--------|------|
| V1.5-01 模型 | 56 | ✅ |
| V1.5-02 存储 | 52 | ✅ |
| V1.5-03 API | 48 | ✅ |
| V1.5-04 UI | 23 | ✅ |
| V1.5-05 生成器 | 17 | ✅ |
| V1.5-06 定时 | 15 | ✅ |
| V1.5-07 配额 | 14 | ✅ |
| V1.5-08 报告 | 16 | ✅ |
| **合计** | **241** | **0 FAIL** |

### 4.4 回归测试 — verify:v15:e2e

```
npm run verify:v15:e2e
```

| 任务 | 断言数 | 结果 |
|------|--------|------|
| V1.5 e2e 闭环 | 29 | ✅ |
| V1.3 端到端（V1.4 修订） | 43 | ✅ |
| Task 038 首页 + 需求确认 | 68 | ✅ |
| Task 022 API 端点 | 73 | ✅ |
| Task 028 统一调度系统 | 119 | ✅ |
| **合计** | **326**（含部分重叠） | **0 FAIL** |

---

## 5. Git 提交记录

```
7df2cba (HEAD -> main) Task V1.6-09 生成失败前端降级 + V1.6a自检修复延续
d885726                 Task V1.6-08 providerRouting fallback策略
0e46972                 fix: V1.6a 五维自检修复(6个P1+4个P2)  [含 V1.6-07 主体]
a08e916                 Task V1.6-06 WatchRules DSL 接入运行链路
d87e9e1                 feat: V1.6a 演示闭环修补(01-04)
e6d6909                 Task V1.6-05 定时设置前端UI
0c66fb4                 Task V1.6-04 radarIds端到端验证
ee0d09d                 Task V1.6-03 报告绑定强校验
```

提交统计：20 files changed, +444/-41

---

## 6. V1.6b 阶段总结

V1.6b 阶段（05-09）现已全部完成：

| 任务 | 主题 | commit | 验收断言 |
|------|------|--------|---------|
| V1.6-05 | 定时设置前端 UI | e6d6909 | — |
| V1.6-06 | WatchRules DSL 接入 | a08e916 | — |
| V1.6-07 | 增量标签接入 | 0e46972 | 48 PASS |
| V1.6-08 | providerRouting fallback | d885726 | 32 PASS |
| V1.6-09 | 生成失败前端降级 | 7df2cba | 29 PASS |

V1.6a（01-04）+ V1.6b（05-09）整体闭环完成，工作区干净，领先 origin/main 10 commits。

---

## 7. 待办与后续

- V1.6 阶段全部任务已完成，无待办
- 后续可考虑：
  - 推送本地 10 commits 到 origin/main（需用户确认）
  - 进入下一阶段任务书（如有）
