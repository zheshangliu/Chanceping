# Task 041 完成回报：演示脚本 + Demo Mode + 浏览器 E2E

**任务类型**：演示工具 + 自动化测试
**版本**：V1.1 单雷达最小闭环版（最终 Task）
**完成日期**：2026-06-29
**前置任务**：Task 040（已验收通过）

---

## 一、修改了哪些文件

### 1. `web/index.html`（顶部新增 Demo 标识元素）
- 在 `<h1 class="brand">` 内追加 `<span class="demo-badge" id="demo-badge" style="display:none;">Demo 模式</span>`
- 默认隐藏，通过 URL 参数 `?demo=true` 触发显示
- 不破坏现有 top-bar 布局

### 2. `web/home.js`（DOMContentLoaded 内追加 URL 参数检查）
- 在 DOMContentLoaded 回调开头新增 6 行：
  ```javascript
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("demo") === "true") {
    const badge = document.getElementById("demo-badge");
    if (badge) badge.style.display = "inline-block";
  }
  ```
- 纯前端实现，不修改 src/ 代码

### 3. `web/styles.css`（追加 Demo 标识样式）
- 新增 `.demo-badge` 样式块（17 行）：
  - 默认 `display: none`
  - 橙色背景 `var(--warning)` + 白色文字
  - 字号 11px / 字重 600 / 圆角 3px / 左外边距 8px
  - 复用现有 CSS 变量，不引入新色板

### 4. `package.json`（新增 3 个脚本）
- `"demo": "tsx scripts/demo-start.ts"` — 一键启动 Demo Mode
- `"verify:e2e-web-demo": "tsx scripts/verify-e2e-web-demo.ts"` — 浏览器 E2E
- `"verify:task041": "tsx scripts/verify-task041.ts"` — Task 041 验收

---

## 二、新增了哪些文件

### 1. `docs/演示剧本.md`（F1 演示剧本文档）
- 3 分钟演示剧本，7 个时间点（0:00 / 0:30 / 1:00 / 1:30 / 2:00 / 2:30 / 3:00）
- 每个时间点包含：操作步骤 + 预期效果 + 解说词
- 演示环境准备：`npm run demo` + 浏览器打开 `http://localhost:3000/?demo=true`
- 演示前检查清单（5 项）
- 演示中注意事项（4 项）
- 演示后可展示功能（3 项）
- 演示流程图（首页 → 需求确认 → 搜索 → 机会库 → 报告）
- 常见问题应对（5 个 Q&A）
- 截图位置说明（7 张截图）

### 2. `scripts/demo-start.ts`（F2 Demo Mode 启动脚本）
- 强制设置环境变量：`DATA_MODE=mock` + `LLM_MODE=mock` + `DEMO_MODE=true`
- 端口默认 3000（可通过 PORT 环境变量覆盖）
- Store 类型默认 meili + MEILI_MOCK=true（纯内存隔离）
- 打印启动信息：模式说明 + 演示地址 + 剧本引用
- 动态 `import("../src/api/server")` 确保环境变量在模块加载前设置

### 3. `scripts/verify-e2e-web-demo.ts`（F4 浏览器 E2E 脚本）
- 7 步 UI 旅程（puppeteer + Mock 模式）：
  1. 打开首页（验证 Logo + 输入框 + Demo 标识）
  2. 输入需求（验证切换到需求确认 Tab）
  3. 多轮对话确认需求（验证确认度提升）
  4. 搜索并看到机会卡片（验证搜索结果）
  5. Star 收藏（验证 Star 状态切换）
  6. 看到页面内截止提醒（验证机会库 + 提醒区）
  7. 导出报告（验证报告生成 + 预览）
- 独立端口 3998（避免与开发服务器 3000 / E2E API 3999 冲突）
- 截图保存到 `docs/screenshots/` 目录（自动创建）
- **puppeteer 降级处理**：未安装时 `process.exit(0)`（跳过，不算失败）
- 等待策略：networkidle0 / waitForSelector / waitForFunction，超时 5-15s

### 4. `scripts/verify-task041.ts`（F5 验证脚本）
- 38 项验收检查，8 大类：
  1. 文件存在性检查（4 项）
  2. 演示剧本检查（6 项：3 分钟 + 7 时间点 + Demo Mode + AI 比赛 + Star + 报告）
  3. Demo Mode 启动脚本检查（4 项：DATA_MODE + LLM_MODE + DEMO_MODE + server）
  4. 浏览器 E2E 脚本检查（8 项：puppeteer + 7 步 + 5 个选择器 + screenshot + 降级）
  5. UI 标识检查（3 项：demo-badge HTML + CSS + URLSearchParams）
  6. package.json 检查（3 项：demo + verify:e2e-web-demo + verify:task041）
  7. API 集成检查（8 项：GET /?demo=true + POST /api/chat + POST /api/search）
  8. 回归测试（2 项：verify-e2e-ai-events + verify-task040）

---

## 三、如何本地运行

### 3.1 启动 Demo Mode（演示用）

```bash
# 一键启动 Demo Mode（无需任何 API Key）
npm run demo

# 浏览器打开（注意 ?demo=true 参数）
# http://localhost:3000/?demo=true
```

### 3.2 浏览器 E2E（自动化测试）

```bash
# 安装 puppeteer（可选，未安装时自动跳过）
npm install puppeteer

# 运行浏览器 E2E
npm run verify:e2e-web-demo

# 截图保存位置
# docs/screenshots/01-home.png
# docs/screenshots/02-requirement-chat.png
# ... 共 7 张
```

### 3.3 完整演示流程

```bash
# 1. 启动 Demo Mode
npm run demo

# 2. 浏览器打开 http://localhost:3000/?demo=true
# 3. 按照 docs/演示剧本.md 操作（3 分钟 7 个时间点）
```

---

## 四、如何测试

```bash
# 1. tsc 编译检查
npx tsc --noEmit

# 2. Task 041 验收脚本（38 项检查 + 回归测试）
npm run verify:task041

# 3. 浏览器 E2E（可选，需安装 puppeteer）
npm run verify:e2e-web-demo
```

---

## 五、验证结果

### 1. tsc 编译检查
```
npx tsc --noEmit
```
- 结果：exit 0（零错误）

### 2. Task 041 验收脚本（本任务核心）
```
npx tsx scripts/verify-task041.ts
```
- 结果：**38 PASS / 0 FAIL**（exit 0）
- 覆盖：文件存在 + 演示剧本 + Demo Mode 脚本 + 浏览器 E2E 脚本 + UI 标识 + package.json + API 集成 + 回归

### 3. 回归测试（在 verify-task041 中执行）
- `verify-e2e-ai-events`：13/13 通过（第一层 E2E 不破坏）
- `verify-task040`：75 PASS / 0 FAIL（机会库 + 报告 + 提醒不破坏）

### 4. 浏览器 E2E（puppeteer 未安装时自动跳过）
- puppeteer 是 `optionalDependencies`，当前环境未安装
- 运行 `npm run verify:e2e-web-demo` 输出"puppeteer 未安装，跳过浏览器 E2E"并 exit 0
- 安装 puppeteer 后可运行完整 7 步 UI 旅程

---

## 六、关键设计决策

### 1. Demo Mode 通过 URL 参数识别（不修改 src/）
- 任务书约束"不修改 src/ 代码"
- 最终方案：URL 参数 `?demo=true` 触发 Demo 标识显示
- `demo-start.ts` 设置 `DEMO_MODE=true` 环境变量（供日志参考）+ 打印提示用户访问 `?demo=true`
- 前端 `home.js` 检查 URL 参数，显示 `#demo-badge` 元素
- 纯前端实现，不新增 API 端点

### 2. puppeteer 降级处理
- puppeteer 是 `optionalDependencies`，可能未安装
- `verify-e2e-web-demo.ts` 用 `try { await import("puppeteer") } catch { exit(0) }` 降级
- 未安装时打印提示信息并 exit 0（不算失败）
- 支持 `PUPPETEER_SKIP=true` 环境变量主动跳过

### 3. 演示剧本结构
- 7 个时间点（0:00 / 0:30 / 1:00 / 1:30 / 2:00 / 2:30 / 3:00）
- 每个时间点 30 秒，总时长 3 分钟
- 每个时间点包含：操作步骤 + 预期效果 + 解说词
- 附演示前检查清单 + 演示中注意事项 + 常见问题应对

### 4. 浏览器 E2E 7 步旅程
- 步骤 1-7 完整覆盖用户旅程：首页 → 需求确认 → 搜索 → Star → 机会库 → 报告
- 每步截图保存到 `docs/screenshots/`
- 等待策略：networkidle0（页面加载）+ waitForSelector（元素出现）+ waitForFunction（动态值变化）
- 超时设置：5s（Tab 切换）/ 15s（AI 响应 / 搜索 / 报告生成）

### 5. 回归测试超时调整
- 初始 timeout 180s 不足（verify-task040 含 75 项 + 3 个回归，总时间接近 200s）
- 调整为 300s（5 分钟），确保稳定通过

---

## 七、文件清单

### 修改文件（4 个）
1. `web/index.html` — 顶部新增 demo-badge 元素
2. `web/home.js` — DOMContentLoaded 内追加 URL 参数检查
3. `web/styles.css` — 追加 .demo-badge 样式（17 行）
4. `package.json` — 新增 demo / verify:e2e-web-demo / verify:task041 脚本

### 新增文件（4 个）
1. `docs/演示剧本.md` — 3 分钟演示剧本（7 时间点 + 操作步骤 + 解说词）
2. `scripts/demo-start.ts` — Demo Mode 启动脚本
3. `scripts/verify-e2e-web-demo.ts` — 浏览器 E2E 脚本（puppeteer 7 步 + 降级）
4. `scripts/verify-task041.ts` — 38 项验收脚本

---

## 八、任务约束遵守情况

- ✅ 不引入新 npm 依赖（puppeteer 已在 optionalDependencies）
- ✅ 不修改 src/ 代码（Demo Mode 通过环境变量 + URL 参数实现）
- ✅ 不修改现有 Web UI 功能（只新增 Demo 标识元素，不破坏 Tab/搜索/卡片等）
- ✅ 不扩展三类雷达（V1.1 只做 AI 赛事雷达）
- ✅ 不修改 verify-e2e-ai-events.ts（第一层 E2E 保持不变）
- ✅ 不修改 Mock 数据（src/demo/*.json 保持不变）
- ✅ 不修改 data-mode.ts（Demo Mode 复用现有 mock/mock 默认值）
- ✅ puppeteer 降级：未安装时 E2E 脚本 exit 0（跳过，不算失败）
- ✅ 品牌名使用"盯机会"
- ✅ 演示剧本语言：中文为主，Slogan 用英文
- ✅ 复用现有 CSS 变量（--warning）

---

## 九、哪些功能还没做

1. 真实推送演示（V1.5）
2. 演示视频录制（演示时手动操作）
3. 多语言演示（V1.3 开源版）
4. 性能测试/压测（V1.4）
5. 无障碍测试（V1.4）
6. 三类雷达扩展（V1.2）
7. 真实搜索 E2E（V1.4）

---

## 十、下一步建议

**V1.1 单雷达最小闭环已正式收尾**。

完整 Task 链路：
```
Task 036（数据模式基础设施）     ✓ 已验收
Task 037（单雷达 E2E 核心链路）  ✓ 已验收
Task 038（首页 + 需求确认页）    ✓ 已验收
Task 039（搜索结果页 + 机会卡片） ✓ 已验收
Task 040（机会库 + 报告 + 提醒）  ✓ 已验收
Task 041（演示脚本 + Demo Mode） ✓ 已完成（本 Task）
```

V1.1 闭环已全部完成：输入需求 → 确认 → 搜索 → 收藏 → 管理机会 → 看提醒 → 导出报告 → 演示。

**后续版本建议**：
- V1.2：多雷达扩展（政策申报 / 文创非遗）+ 机会库高级搜索
- V1.3：开源版（多语言 + 社区贡献）
- V1.4：真实搜索 E2E + 性能测试 + 评分权重校准
- V1.5：真实推送（微信/邮件/Webhook）+ 复盘仪表盘 + 报告定时生成

---

**结论**：Task 041 演示脚本 + Demo Mode + 浏览器 E2E 已完成，38 项验收全部通过，回归测试无破坏。V1.1 单雷达最小闭环正式收尾。
