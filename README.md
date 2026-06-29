# ChancePing 盯机会

<p align="center">
  <img src="web/assets/logo.png" alt="ChancePing 盯机会" width="200" />
</p>

> 盯机会，好机会不错过。

AI 机会情报系统 —— 告诉 AI 你要盯什么，ChancePing 帮你找到对的机会，在对的时间提醒你。

![License](https://img.shields.io/badge/license-AGPL%20v3-blue)
![Node.js](https://img.shields.io/badge/node.js-22%2B-green)
![Version](https://img.shields.io/badge/version-1.0.0-orange)
![TypeScript](https://img.shields.io/badge/typescript-5.5-blue)

---

## 目录

- [核心功能](#核心功能)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [项目架构](#项目架构)
- [API 文档](#api-文档)
- [开发指南](#开发指南)
- [路线图](#路线图)
- [开源协议](#开源协议)
- [商标声明](#商标声明)
- [贡献指南](#贡献指南)

---

## 核心功能

### 1. 互动式需求确认

不直接生成报告，先与用户多轮对话确认需求（基于 JTBD + OST 框架），确保情报方向准确。

### 2. 五层情报框架

- **需求理解**：从自然语言提取结构化需求
- **任务拆解**：将需求分解为可执行的搜索任务
- **情报验证**：多源搜索 + AI 筛选 + 证据验证
- **机会评分**：ChanceScore 五维评分模型
- **持续迭代**：用户反馈驱动需求优化

### 3. ChanceScore 评分模型

每个机会按五维评分：

```
ChanceScore = FitScore + IntentScore + EvidenceScore + UrgencyScore - EffortCost
```

- **FitScore**：与用户需求的匹配度
- **IntentScore**：机会意图强度
- **EvidenceScore**：证据可信度
- **UrgencyScore**：时效性
- **EffortCost**：参与成本（负向）

### 4. Watch Rules DSL

用户可配置的订阅规则，支持 `+/!/@/#/$/%/*` 语法：

```
+ AI 赛事          # 订阅 AI 赛事类机会
! 报名费 > 500     # 排除报名费超过 500 的
@ 高校             # 限定主办方为高校
# 2026             # 限定年份为 2026
```

### 5. 多 Provider 雷达路由

按雷达类型自动选择搜索源：

| 雷达类型 | 默认 Provider | 备选 |
|---|---|---|
| AI 赛事 | Serper | Bocha |
| OPC 政策 | Bocha | Serper |
| 文创非遗 | Exa | Bocha |

### 6. Web UI 编辑器

- 暗色主题 + 语法高亮
- Watch Rules DSL 实时预览
- 快捷键支持
- 机会库浏览与 Star 收藏

---

## 快速开始

### 方式一：一键启动（推荐）

```bash
git clone https://github.com/user/chanceping.git
cd chanceping
npm run quick-start
```

或手动执行：

```bash
git clone https://github.com/user/chanceping.git
cd chanceping
npm install
cp .env.example .env    # Windows: copy .env.example .env
npm run dev
```

浏览器打开 <http://localhost:3000>

> **无需配置任何 API Key**，Mock 模式即可体验全部功能。

### 方式二：平台脚本

```bash
# Linux / Mac
bash scripts/quick-start.sh

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\quick-start.ps1
```

### 方式三：Docker（可选）

```bash
docker build -t chanceping .
docker-compose up -d
# 浏览器打开 http://localhost:3000
```

详见 [附录 B：Docker 部署](#附录-bdocker-可选部署)。

### 参赛版演示流程

```bash
# 1. 一键启动
npm run quick-start

# 2. 浏览器打开 http://localhost:3000
# 3. 演示步骤：
#    a. 编辑 Watch Rules（DSL 编辑器 + 语法高亮）
#    b. 测试规则（输入 Mock 数据 + 运行测试）
#    c. 手动触发搜索（POST /api/search）
#    d. 查看机会库（GET /api/opportunities）
#    e. 生成报告（POST /api/reports/generate）
#    f. 导出报告（POST /api/reports/export?format=html）
#    g. 机会复盘（GET /api/review）
```

---

## 环境变量

所有 API Key 均为**可选**。未配置时自动使用 Mock 模式，无需任何外部服务即可体验全部功能。

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

### 关键变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `PORT` | `3000` | 服务器端口 |
| `LLM_STRATEGY` | `competition` | LLM 策略（`competition` 参赛合规 / `commercial` 成本最优） |
| `STORE_TYPE` | `local` | 存储类型（`local` 本地文件 / `meili` Meilisearch） |
| `SCHEDULER_ENABLED` | `false` | 调度器开关（参赛版手动触发） |
| `NOTIFY_MOCK_MODE` | `true` | 推送 Mock 开关（仅打印日志不实际发送） |
| `PDF_EXPORT_ENABLED` | `false` | PDF 导出开关（需安装 puppeteer） |

### API Key（均可选）

| 变量 | Provider | 用途 |
|---|---|---|
| `DASHSCOPE_API_KEY` | Qwen (DashScope) | 报告生成 + 兜底 |
| `DEEPSEEK_API_KEY` | DeepSeek | 核心判断（商业版主力） |
| `ZAI_API_KEY` | Z.AI (GLM) | 批量初筛（商业版免费层） |
| `SERPER_API_KEY` | Serper | 全网搜索 |
| `BOCHA_API_KEY` | 博查 Bocha | 中文搜索 |
| `EXA_API_KEY` | Exa | 语义搜索 |
| `GOOGLE_CSE_API_KEY` | Google CSE | 站点限定搜索 |
| `JINA_READER_API_KEY` | Jina Reader | 网页内容抓取 |

完整变量说明见 [.env.example](./.env.example)。

---

## 项目架构

### 五层架构

```
┌─────────────────────────────────────────────────────┐
│  Web UI 层 (web/)                                    │
│  暗色主题 + DSL 编辑器 + 机会库浏览器                  │
├─────────────────────────────────────────────────────┤
│  API 层 (src/api/)                                   │
│  Hono REST API + 8 组路由 + 健康检查                  │
├─────────────────────────────────────────────────────┤
│  Agent 层 (src/agents/)                              │
│  对话管理 + 雷达方案/报告生成 + 机会状态机 + 复盘      │
├─────────────────────────────────────────────────────┤
│  搜索层 (src/search/)                                │
│  六层管道：Provider → 抓取 → 清洗 → 规则筛 → AI筛 → 评分 │
├─────────────────────────────────────────────────────┤
│  存储层 (src/agents/opportunity-store.ts)            │
│  local 文件存储 / Meilisearch 全文搜索                │
└─────────────────────────────────────────────────────┘
```

### 搜索六层管道

```
1. Provider 层    → 多源搜索（Serper/Bocha/Exa/Google CSE）
2. 抓取层         → Jina Reader 网页转纯文本
3. 清洗层         → 去噪 + 结构化
4. 规则粗筛层     → Watch Rules DSL 过滤
5. AI 精筛层      → LLM 判断相关性
6. 机会评分层     → ChanceScore 五维评分
```

### 目录结构

```
chanceping/
├── src/
│   ├── agents/          # Agent 层（对话、雷达、机会、复盘）
│   ├── api/             # REST API（Hono）
│   │   ├── routes/      # 8 组路由
│   │   ├── app.ts       # 应用入口
│   │   └── server.ts    # 服务器启动
│   ├── brand/           # 品牌常量
│   ├── config/          # LLM 策略配置
│   ├── export/          # 报告导出（Markdown/HTML/PDF）
│   ├── i18n/            # 国际化（zh-CN / en-US）
│   ├── notify/          # 推送通知（微信/邮件/Webhook）
│   ├── prompts/         # LLM 提示词
│   ├── scheduler/       # 统一调度系统
│   ├── schema/          # 数据契约（Zod 风格）
│   ├── search/          # 搜索层六层管道
│   │   ├── content/     # 抓取 + 清洗
│   │   └── providers/   # 4 个搜索 Provider
│   ├── utils/           # 工具函数
│   └── watch/           # Watch Rules DSL
├── web/                 # Web UI（HTML/CSS/JS）
├── scripts/             # 验证脚本 + 启动脚本
├── docs/                # 任务完成回报
├── reports/             # 报告输出（gitignore）
├── exports/             # 导出文件（gitignore）
├── .env.example         # 环境变量模板
├── Dockerfile           # 多阶段构建（可选）
└── docker-compose.yml   # Docker 编排（可选）
```

---

## API 文档

### 健康检查

```http
GET /health
```

### 8 组路由

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/chat` | POST | 多轮对话需求确认 |
| `/api/opportunities` | GET / POST | 机会库管理 + Star 收藏 |
| `/api/search` | POST | 手动触发搜索 |
| `/api/reminders` | GET / POST | 截止提醒管理 |
| `/api/watch-rules` | GET / POST / PUT / DELETE | Watch Rules DSL 管理 |
| `/api/reports` | POST | 报告生成 + 导出（md/html/pdf） |
| `/api/scheduler` | GET / POST | 调度器管理 |
| `/api/review` | GET | 机会复盘统计 |

### 示例

```bash
# 健康检查
curl http://localhost:3000/health

# 触发搜索
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"radar_type":"ai_competition","query":"AI 大赛 2026"}'

# 查看机会库
curl http://localhost:3000/api/opportunities

# 导出报告为 HTML
curl -X POST "http://localhost:3000/api/reports/export?format=html" \
  -H "Content-Type: application/json" \
  -d '{"radar_type":"ai_competition","opportunities":[]}' \
  -o report.html
```

---

## 开发指南

### 环境要求

- Node.js 22+
- npm 10+

### 开发流程

```bash
# 安装依赖
npm install

# 类型检查（零错误要求）
npx tsc --noEmit

# 启动开发服务器
npm run dev

# 运行验收脚本（见下方）
npm run verify:export    # 或其他 verify:* 脚本
```

### 验证脚本

项目提供完整的验收脚本，所有脚本零错误通过是合并 PR 的前提：

```bash
npm run typecheck              # TypeScript 类型检查
npm run check:no-hardcode      # 品牌名硬编码检查
npm run verify:api             # API 路由验收
npm run verify:store           # 存储层验收
npm run verify:web-ui          # Web UI 验收
npm run verify:providers       # 搜索 Provider 验收
npm run verify:scheduler       # 调度器验收
npm run verify:notify          # 通知渠道验收
npm run verify:review          # 机会复盘验收
npm run verify:export          # 报告导出验收
npm run verify:task034         # 本任务（开源就绪）验收
```

### 代码规范

- TypeScript 严格模式
- `npx tsc --noEmit` 零错误
- 品牌名通过 `src/brand/constants.ts` 引用，禁止硬编码
- 新工具模块放 `src/utils/`
- LLM 适配器放 `src/agents/`，命名 `[model-name]-adapter.ts`
- 验证脚本放 `scripts/`，命名 `verify-taskXXX.ts`

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 路线图

### V1.0（当前版本 - 参赛版）

- ✅ 五层情报框架
- ✅ Watch Rules DSL
- ✅ 多 Provider 雷达路由
- ✅ Web UI 编辑器
- ✅ 报告导出（Markdown/HTML/PDF）
- ✅ 机会复盘
- ✅ 一键启动 + Mock 模式

### V1.5（规划中）

- GitHub Actions CI/CD
- NPM 包发布
- Web UI 报告在线预览
- 更多搜索 Provider（Bing / 百度）

### V2.0（远期）

- 多用户支持 + 权限管理
- 报告模板自定义编辑器
- 移动端适配
- 国际化完善（en-US 全量翻译）

完整路线图见 [ROADMAP.md](./ROADMAP.md)。

---

## 开源协议

本项目源代码在 [GNU Affero General Public License v3.0](./LICENSE)（AGPL v3）许可下开源。

### 关键条款

- ✅ 代码可自由使用、修改、分发
- ✅ 衍生作品必须开源（传染性）
- ✅ 网络服务也必须开源（AGPL 特有，阻止套壳 SaaS）
- ✅ 保留版权声明

### 商业使用

如需在商业产品中集成 ChancePing 但不愿开源衍生作品，请通过 issue 联系获取商业授权。

---

## 商标声明

"ChancePing" 和 "盯机会" 是 ChancePing 项目的商标。

AGPL v3 许可覆盖**源代码**的使用，但不授予**商标**使用权。详见 [TRADEMARKS.md](./TRADEMARKS.md)。

---

## 贡献指南

欢迎社区贡献！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解：

- 开发环境搭建
- 代码风格与提交规范
- DCO（Developer Certificate of Origin）签署
- PR 流程
- 测试要求

请遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) 行为准则。

安全问题请按 [SECURITY.md](./SECURITY.md) 流程披露。

---

## 附录 B：Docker 可选部署

```bash
# 构建镜像
docker build -t chanceping .

# 启动容器
docker-compose up -d

# 或手动
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/reports:/app/reports \
  --name chanceping \
  chanceping

# 浏览器打开 http://localhost:3000
```

Docker 为可选部署方式，参赛版无需 Docker，使用 `npm run quick-start` 即可。

---

## 致谢

ChancePing 基于以下开源项目构建：

- [Hono](https://hono.dev/) - Web 框架
- [TypeScript](https://www.typescriptlang.org/) - 类型系统
- [tsx](https://github.com/privatenumber/tsx) - TypeScript 执行器
- [Meilisearch](https://www.meilisearch.com/) - 全文搜索（可选）
- [Puppeteer](https://pptr.dev/) - PDF 渲染（可选）

感谢所有 Provider 提供的 API 服务：Qwen (DashScope) / DeepSeek / Z.AI (GLM) / Serper / Bocha / Exa / Google CSE / Jina Reader。
