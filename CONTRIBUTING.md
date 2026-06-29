# 贡献指南

感谢你对 ChancePing 项目的关注！本文档描述了参与本项目贡献的流程与规范。

---

## 1. 开发环境搭建

### 环境要求

- Node.js 22+
- npm 10+
- Git 2.30+

### 步骤

```bash
# 1. Fork 仓库后克隆
git clone https://github.com/<your-username>/chanceping.git
cd chanceping

# 2. 安装依赖
npm install

# 3. 创建环境变量（Mock 模式，无需 API Key）
cp .env.example .env    # Windows: copy .env.example .env

# 4. 类型检查（必须零错误）
npx tsc --noEmit

# 5. 启动开发服务器
npm run dev
# 浏览器打开 http://localhost:3000
```

---

## 2. 代码风格

### TypeScript 规范

- 严格模式（`strict: true`）
- `npx tsc --noEmit` 零错误是合并 PR 的硬性要求
- 优先使用 `interface` 而非 `type` 描述对象形状
- 公共 API 必须有类型注解，禁止 `any`

### 品牌名硬编码禁令

- 品牌名（"ChancePing"、"盯机会" 等）必须通过 `src/brand/constants.ts` 的 `BRAND` 常量引用
- 禁止在代码中硬编码品牌名字符串字面量
- 运行 `npm run check:no-hardcode` 检查

### 文件组织约定

| 类型 | 目录 | 命名规范 |
|---|---|---|
| 工具函数 | `src/utils/` | `kebab-case.ts` |
| LLM 适配器 | `src/agents/` | `[model-name]-adapter.ts` |
| 搜索 Provider | `src/search/providers/` | `[provider-name].ts` |
| API 路由 | `src/api/routes/` | `[resource].ts` |
| 验证脚本 | `scripts/` | `verify-taskXXX.ts` |
| 任务文档 | `docs/` | `Task_XXX_完成回报.md` |
| 配置文件 | `src/config/` | `[strategy-name].ts` |

---

## 3. 提交规范

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

### 提交格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型（type）

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构（既不是 feat 也不是 fix） |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖变更 |
| `ci` | CI 配置变更 |

### 示例

```
feat(search): 新增 Bing 搜索 Provider

- 实现 BingAdapter 类
- 注册到 providerRegistry
- 添加单元测试

Signed-off-by: Zhang San <zhangsan@example.com>
```

---

## 4. DCO（Developer Certificate of Origin）

本项目要求所有贡献者签署 DCO（Developer Certificate of Origin），声明你拥有提交代码的版权并允许项目使用。

### 如何签署

在每次 git commit 时添加 `-s` 参数：

```bash
git commit -s -m "feat(search): 新增 Bing 搜索 Provider"
```

这会在 commit message 末尾自动添加：

```
Signed-off-by: Zhang San <zhangsan@example.com>
```

### DCO 全文

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

---

## 5. PR 流程

### 提交 PR 前自检清单

- [ ] `npx tsc --noEmit` 零错误
- [ ] `npm run check:no-hardcode` 零错误
- [ ] 相关 `verify-taskXXX.ts` 脚本全部 PASS
- [ ] commit message 遵循 Conventional Commits
- [ ] 所有 commit 已 Signed-off-by（DCO）
- [ ] 未引入新的 npm 依赖（除非必要且在 PR 中说明）
- [ ] 未在 `.env.example` 中放入真实 API Key

### PR 标题格式

```
<type>(<scope>): <subject>
```

示例：`feat(search): 新增 Bing 搜索 Provider`

### PR 描述模板

```markdown
## 变更类型
- [ ] 新功能（feat）
- [ ] Bug 修复（fix）
- [ ] 文档（docs）
- [ ] 重构（refactor）
- [ ] 测试（test）
- [ ] 其他（chore）

## 变更说明
<简要描述本次变更的内容与目的>

## 关联 Issue
Closes #XXX

## 验证结果
- [ ] npx tsc --noEmit 通过
- [ ] npm run check:no-hardcode 通过
- [ ] 相关验收脚本通过

## DCO 确认
- [ ] 我已签署 DCO（所有 commit 含 Signed-off-by）
```

### 审核流程

1. 提交 PR 后，维护者会在 3 个工作日内进行初审
2. 如需修改，贡献者在同一 PR 上追加 commit（不要 force push 覆盖历史）
3. 审核通过后，维护者合并 PR
4. 合并后贡献者会出现在 Contributors 列表

---

## 6. 测试要求

### 验收脚本

项目为每个功能模块提供验收脚本，位于 `scripts/` 目录：

```bash
# 类型检查
npx tsc --noEmit

# 品牌名硬编码检查
npm run check:no-hardcode

# 各模块验收
npx tsx scripts/verify-task019d.ts   # 搜索层六层管道
npx tsx scripts/verify-task021.ts    # Watch Rules DSL
npx tsx scripts/verify-task022.ts    # API 路由
npx tsx scripts/verify-task023.ts    # 存储层
npx tsx scripts/verify-task024.ts    # 增量标签
npx tsx scripts/verify-task025.ts    # Web UI
npx tsx scripts/verify-task026.ts    # 多 Provider
npx tsx scripts/verify-task028.ts    # 调度器
npx tsx scripts/verify-task029.ts    # 通知渠道
npx tsx scripts/verify-task030.ts    # 机会状态机 + 复盘
npx tsx scripts/verify-task031.ts    # 报告导出
npx tsx scripts/verify-task034.ts    # 开源就绪
```

### 新增功能

新增功能必须配套验收脚本：

- 文件命名：`scripts/verify-taskXXX.ts`
- 包含文件存在性检查 + 功能验收 + 工程约束检查
- 在 `package.json` 中注册 `verify:xxx` 脚本
- 在 PR 中提供运行输出

---

## 7. 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。请保持友善、尊重、包容的交流态度。

---

## 8. 安全问题

如发现安全漏洞，请勿通过公开 issue 提交，按 [SECURITY.md](./SECURITY.md) 流程私下披露。

---

## 9. 联系方式

- 提交 issue：[GitHub Issues](https://github.com/user/chanceping/issues)
- 安全问题：见 [SECURITY.md](./SECURITY.md)

感谢你的贡献！
