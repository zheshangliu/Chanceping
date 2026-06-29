# Task V1.5-04 完成回报：最简 UI

> 日期：2026-06-30 | 版本：V1.0 | 阶段：V1.5a-3

---

## 一、任务概述

前端页面展示雷达列表和详情，支持创建/激活/运行/归档操作。这是 V1.5a 的用户可见层——用户通过这些页面管理自己的雷达并查看运行结果。

本 Task 不含 AI 生成器（Task V1.5-05），创建雷达使用手动表单（输入名称 + 选类型 + 填关键词）。

---

## 二、交付清单

### 新建文件（3 个）

| 文件 | 内容 |
|---|---|
| `web/radars.js` | 雷达列表页逻辑（loadRadarList / renderRadarCards / openCreateModal / submitCreate / goToDetail / backToList，约 376 行） |
| `web/radar-detail.js` | 雷达详情页逻辑（loadRadarDetail / renderRadarDetail / activateRadar / runRadar / renderRunResult / archiveRadar，约 422 行） |
| `scripts/verify-task-v1.5-04-ui.ts` | 验收脚本（18 项检查，23 PASS） |

### 改造文件（2 个）

| 文件 | 改动 |
|---|---|
| `web/index.html` | Tab 导航新增"我的雷达"（第 27 行）；新增 panel-radars（含列表视图 + 详情视图容器，第 244-261 行）；引入 radars.js 和 radar-detail.js（第 338-339 行） |
| `web/styles.css` | 新增雷达卡片 + 类型徽章 + 内置角标 + 状态圆点 + 详情页分区 + 运行结果 + 运行历史 + 创建对话框样式（约 460 行，第 2212-2671 行） |

---

## 三、核心设计

### 3.1 导航栏新增"我的雷达"Tab

在原 6 个 Tab（首页/需求确认/搜索/机会库/报告/编辑器）的"报告"和"编辑器"之间新增第 7 个 Tab"我的雷达"。

```html
<button class="tab-btn" data-tab="radars">我的雷达</button>
```

panel-radars 内部包含两个视图（用 display:none/block 切换）：
- 列表视图（radars-list-view）：默认显示
- 详情视图（radar-detail-view）：点击"详情"后显示

### 3.2 雷达列表页（web/radars.js）

- **loadRadarList()**：GET /api/radars 获取雷达列表
- **renderRadarCards(radars)**：渲染卡片网格
- **卡片元素**：名称 + 类型徽章（kind-*） + 内置角标（builtin-tag） + 状态圆点（status-*） + Provider 列表 + 最后运行时间 + 详情按钮
- **状态颜色映射**：draft 灰 / active 绿 / paused 黄 / archived 红
- **openCreateModal()**：动态构造 modal DOM（名称 + 类型 + 关键词 + 地域）
- **submitCreate(modal)**：POST /api/radars，构造 spec（keyword_strategy + region_scope）
- **goToDetail(radarId)**：切换到详情视图
- **backToList()**：返回列表视图并刷新

### 3.3 雷达详情页（web/radar-detail.js）

- **loadRadarDetail(radarId)**：GET /api/radars/:id
- **renderRadarDetail(radar)**：渲染基本信息 + Spec 摘要 + 操作按钮 + 运行结果区 + 运行历史区
- **操作按钮**（按状态/内置禁用）：
  - 激活：仅 draft 状态可用（内置也禁用）
  - 手动运行：仅 active 状态可用
  - 编辑：自定义且未归档可用（当前版本仅 Toast 提示，编辑功能在后续版本支持）
  - 归档：自定义且未归档可用
- **activateRadar(radarId)**：POST /api/radars/:id/activate
- **runRadar(radarId)**：POST /api/radars/:id/run，渲染返回的机会卡片
- **renderRunResult(opportunities)**：渲染最简版机会卡片（复用 .opp-card 样式）
- **archiveRadar(radarId)**：DELETE /api/radars/:id（软删除）
- **Spec 摘要提取**：从 radar.spec 提取关键词/地域/排除规则/评分规则摘要

### 3.4 创建对话框（Modal）

- 用 CSS modal（固定定位 + 半透明遮罩），不用 alert/prompt
- 字段：雷达名称（必填） + 类型选择 + 关键词（逗号分隔） + 地域（可选）
- 提交时构造 spec：`{ keyword_strategy: { core_keywords_zh, core_keywords_en }, region_scope: { primary_regions, ... } }`
- 创建成功后关闭 modal + 刷新列表 + Toast 提示

### 3.5 事件监听

- 监听 `tab-switched` 事件（tab === "radars"）触发 `loadRadarList()`（与现有 opportunities.js / reports.js 模式一致）
- DOMContentLoaded 后绑定"创建雷达"和"刷新列表"按钮事件
- 详情按钮通过 addEventListener 绑定（避免内联 onclick）

### 3.6 复用现有能力

- `switchTab()` / `showToast()`：复用 home.js 暴露的全局函数
- `.opp-card` / `.level-badge` / `.card-title` / `.card-meta` 等：复用 search.js 的卡片样式
- `.tab-btn` / `.tab-panel` / `.btn-primary` / `.btn-refresh` / `.placeholder`：复用现有组件样式

---

## 四、验收结果

### 4.1 类型检查

```
npx tsc --noEmit → exit 0
```

### 4.2 验收脚本

```
npx tsx scripts/verify-task-v1.5-04-ui.ts → 23 PASS / 0 FAIL
```

| 章节 | 检查项 | 结果 |
|---|---|---|
| 6.1 文件存在性 | 1-2（2 项） | 全 PASS |
| 6.2 HTML 元素 | 3-6（4 项） | 全 PASS |
| 6.3 JS 函数 + API 调用 | 7-14（8 项） | 全 PASS |
| 6.4 CSS 样式 | 15-16（2 项） | 全 PASS |
| 6.5 API 集成 | 17-18（7 项子检查） | 全 PASS |

### 4.3 回归测试

| 脚本 | 结果 |
|---|---|
| `verify-e2e-v13.ts` | 43 PASS / 0 FAIL |
| `verify-task-v1.5-03-api.ts` | 48 PASS / 0 FAIL |

---

## 五、注意事项

1. **不使用框架**：前端纯原生 JS + HTML + CSS，与现有 web/ 目录风格一致（无 React/Vue）
2. **Tab 切换复用**：复用现有 `switchTab()` 逻辑，监听 `tab-switched` 事件触发 `loadRadarList()`
3. **详情页用 panel 切换**：不用单独页面，在 panel-radars 内切换列表视图和详情视图（用 display:none/block）
4. **机会卡片复用样式**：运行结果的机会卡片渲染复用现有 `.opp-card` / `.level-badge` 样式（最简版，不含 Star/反馈）
5. **创建对话框用 Modal**：CSS modal（固定定位 + 半透明遮罩），不用 alert/prompt
6. **内置雷达按钮禁用**：编辑/归档按钮用 `disabled` 属性禁用，加 tooltip 提示原因
7. **运行历史最简展示**：从 `radar.lastRunAt` / `radar.lastRunStatus` 推算（V1.5-03 API 无运行历史端点）
8. **编辑功能占位**：编辑按钮当前仅 Toast 提示"编辑功能将在后续版本支持"（避免引入复杂表单）
9. **状态颜色映射**：draft 灰（#888） / active 绿（var(--success)） / paused 黄（var(--warning)） / archived 红（var(--error)）
10. **测试隔离**：验收脚本使用临时文件 `data/radars-v1.5.04-test.json` 等，测试后自动清理
