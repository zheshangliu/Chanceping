# ChancePing 公开路线图

本文档描述 ChancePing 项目的发展规划。路线图会根据社区反馈和实际进展动态调整。

---

## 当前版本：V1.0（参赛版）

**目标**：1 分钟内"克隆即跑"，无需任何 API Key 即可体验全部功能。

**状态**：✅ 已完成核心功能

### 已交付

#### 核心引擎

- ✅ 五层情报框架（需求理解 → 任务拆解 → 情报验证 → 机会评分 → 持续迭代）
- ✅ ChanceScore 五维评分模型（FitScore + IntentScore + EvidenceScore + UrgencyScore - EffortCost）
- ✅ Watch Rules DSL（`+/!/@/#/$/%/*` 语法）
- ✅ 互动式需求确认（JTBD + OST 框架）

#### 搜索层

- ✅ 六层管道（Provider → 抓取 → 清洗 → 规则筛 → AI 筛 → 评分）
- ✅ 4 个搜索 Provider（Serper / Bocha / Exa / Google CSE）
- ✅ Jina Reader 网页抓取
- ✅ 多 Provider 雷达路由（AI 赛事 / OPC 政策 / 文创非遗）

#### Agent 层

- ✅ 多轮对话管理
- ✅ 雷达方案生成器 + 校验器 + 导出器
- ✅ 雷达报告生成器 + 归档
- ✅ 机会状态机（new → viewed → tracking → applied/expired）
- ✅ 机会复盘（命中率、错过原因、改进建议）

#### API 层

- ✅ Hono REST API（8 组路由）
- ✅ 健康检查端点
- ✅ 报告导出（Markdown / HTML / PDF 降级）

#### Web UI

- ✅ 暗色主题
- ✅ Watch Rules DSL 编辑器（语法高亮 + 实时预览）
- ✅ 机会库浏览器 + Star 收藏

#### 基础设施

- ✅ 统一调度系统
- ✅ 多渠道通知（企业微信 / 邮件 / Webhook）
- ✅ i18n 国际化（zh-CN / en-US）
- ✅ Mock 模式（无 API Key 自动降级）
- ✅ 一键启动（quick-start.sh / quick-start.ps1）
- ✅ AGPL v3 开源协议
- ✅ DCO 贡献流程

---

## V1.1（短期 - 稳定性与体验）

**目标**：完善用户体验，提升稳定性。

### 计划功能

- 🔄 Web UI 报告在线预览（无需下载即可查看 HTML 报告）
- 🔄 Web UI 机会详情页（点击机会卡片查看完整情报）
- 🔄 Web UI 调度器可视化（cron 表达式编辑 + 下次运行时间预览）
- 🔄 通知模板编辑器（自定义通知文案）
- 🔄 增量更新机制（仅搜索新增内容，节省 API 调用）
- 🔄 错误处理完善（友好的错误提示 + 重试机制）

### 稳定性

- 🔄 单元测试覆盖率 > 80%
- 🔄 E2E 测试套件
- 🔄 性能基准测试

---

## V1.5（中期 - 商业化就绪）

**目标**：具备商业部署能力。

### 计划功能

- 🔄 GitHub Actions CI/CD（自动测试 + 自动发布）
- 🔄 NPM 包发布（`@chanceping/core` / `@chanceping/api` / `@chanceping/web`）
- 🔄 Docker Hub 官方镜像
- 🔄 更多搜索 Provider（Bing / 百度 / SearXNG 自建）
- 🔄 更多 LLM 适配器（Claude / GPT-4 / Gemini / Llama 本地）
- 🔄 Excel 导出（.xlsx）
- 🔄 Word 导出（.docx）
- 🔄 报告水印 + 加密
- 🔄 Webhook 入站（接收外部系统的事件触发搜索）

### 部署

- 🔄 Kubernetes Helm Chart
- 🔄 阿里云 Function Compute 部署模板
- 🔄 AWS Lambda 部署模板
- 🔄 一键部署脚本（DigitalOcean / Render / Railway）

---

## V2.0（远期 - 平台化）

**目标**：从单机工具进化为多用户平台。

### 计划功能

- 🔄 多用户支持 + 权限管理（RBAC）
- 🔄 用户隔离的机会库
- 🔄 团队协作（共享 Watch Rules / 共享机会库）
- 🔄 报告模板自定义编辑器
- 🔄 移动端适配（PWA / 响应式）
- 🔄 国际化完善（en-US 全量翻译 + 日语 / 韩语）
- 🔄 插件系统（允许第三方扩展 Provider / Adapter）
- 🔄 GraphQL API
- 🔄 WebSocket 实时推送（搜索进度 / 机会更新）

### 生态

- 🔄 ChancePing Hub（社区分享 Watch Rules 模板）
- 🔄 ChancePing Marketplace（付费 Provider / 报告模板）
- 🔄 官方 SaaS 服务（chanceping.com）

---

## 长期愿景

### V3.0+（AI 原生）

- 🔄 多模态机会识别（图片 / 视频 / PDF 解析）
- 🔄 主动学习（根据用户行为优化推荐）
- 🔄 跨用户机会关联（"类似你的人在关注..."）
- 🔄 AI Agent 自主探索（无 Watch Rules 时主动发现机会）
- 🔄 知识图谱（机会 - 实体 - 关系网络）

### 行业版本

- 🔄 ChancePing for Education（高校版，对接教务系统）
- 🔄 ChancePing for Enterprise（企业版，对接 OA / CRM）
- 🔄 ChancePing for Government（政府版，对接政策发布平台）

---

## 不在路线图中

以下功能**不计划**实现：

- 闭源核心功能（ ChancePing 永远开源，AGPL v3）
- 广告变现（不植入广告）
- 数据出售（不向第三方出售用户数据）
- 监控用户行为（不收集非必要的用户数据）

---

## 反馈与建议

如对路线图有建议，请通过以下方式反馈：

1. 提交 [GitHub Issue](https://github.com/user/chanceping/issues)（标签 `roadmap`）
2. 在 [Discussions](https://github.com/user/chanceping/discussions) 发起讨论
3. 参与季度社区会议（详见 Discussions 公告）

路线图每季度更新一次，根据社区投票和优先级调整。

---

## 版本历史

| 版本 | 发布日期 | 主要变更 |
|---|---|---|
| V0.9 | 2026-06 | 存储 + 搜索集成 + Web UI + 多 Provider |
| V1.0 | 2026-06 | 开源就绪 + 一键启动 + AGPL v3 |
| V1.1 | 规划中 | 稳定性 + 体验优化 |
| V1.5 | 规划中 | 商业化就绪 |
| V2.0 | 规划中 | 平台化 |

---

最后更新：2026-06-28
