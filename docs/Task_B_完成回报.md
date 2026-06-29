# Task B 完成回报：一次一问需求确认 + 长文本整理

## 一、任务概述

Task B 实现 V1.3 一次一问需求确认机制与长文本整理能力，包括：
- **一次一问**：QuestionPlanner 基于 7 维度置信度选问，每轮最多 1 个问题
- **6 轮封顶**：达到 6 轮后触发低置信度逃逸逻辑
- **低置信度逃逸**：total ≥ 90 → 正式确认卡；turnCount ≥ 6 && total ≥ 70 → 低置信度确认卡；turnCount ≥ 6 && total < 70 → 信息不足
- **长文本整理**：normalizeUserInput 实现断句 / 去重 / 纠错 / 结构化提取
- **V2 Prompt**：一次一问版 System Prompt，构造函数新增 `useV2Prompt` 参数
- **新增 API**：`POST /api/chat/:id/confirmation-card` + `POST /api/chat/:id/confirm`

## 二、交付物清单

### 新建文件（3 个）

| 文件 | 说明 |
|------|------|
| `src/agents/question-planner.ts` | 选问算法 + 6 轮封顶 + 低置信度逃逸 |
| `src/agents/normalize-user-input.ts` | 长文本整理（断句/去重/纠错/结构化） |
| `src/agents/requirement-card-generator.ts` | 确认卡生成（含低置信度标识） |

### 改造文件（4 个）

| 文件 | 改动点 |
|------|--------|
| `src/agents/conversation-turn-output.ts` | TurnOutput 新增 4 个 optional 字段：nextQuestion / canGenerateDraft / maxTurnsReached / questionMode |
| `src/agents/conversation-manager.ts` | V2 一次一问模式 + V1 fallback + 长文本整理 + 3 个公开方法 |
| `src/api/routes/chat.ts` | V2 模式默认启用 + 新增 confirmation-card / confirm 端点 |
| `web/requirement-chat.js` | nextQuestion 渲染 + 低置信度提示 + 确认卡可生成提示 |

### 验证脚本与配置（3 个）

| 文件 | 说明 |
|------|------|
| `scripts/verify-taskB.ts` | Task B 验收脚本（9 模块 87 检查项） |
| `scripts/verify-task043.ts` | 修复 libuv async handle 崩溃（server.close 回调 + process.exitCode） |
| `package.json` | 新增 `verify:taskB` 脚本 |

## 三、核心设计

### 3.1 QuestionPlanner 选问算法

```
priority = weight × (1 - score / 100)
```

选 priority 最高的未问维度，通过 aliasMap 兼容旧命名（client_profile → client_identity 等）。

### 3.2 低置信度逃逸决策

| 条件 | 决策 | isLowConfidence |
|------|------|-----------------|
| total ≥ 90 | 生成正式确认卡 | false |
| turnCount ≥ 6 && total ≥ 70 | 生成低置信度确认卡 | true |
| turnCount ≥ 6 && total < 70 | 信息不足，不生成 | false |
| turnCount < 6 && total < 90 | 继续问 | false |

### 3.3 normalizeUserInput 长文本整理

- **触发条件**：文本 > 50 字，或含口语化，或含连续重复模式
- **整理流程**：纠错 → 压缩重复 → 断句 → 去重 → 结构化提取 → 口语化检测
- **错别字修正**：QWAN→Qwen, deepseek→DeepSeek 等
- **口语化映射**：大厂办的→主办方权威 等

### 3.4 兼容性设计

- TurnOutput 新增字段全部 optional（红线 #10）
- chat.ts 仍返回 `...turn` 展开（红线 #11）
- conversation-manager.ts 仍维护 questions 数组作为 fallback（红线 #12）
- requirement-chat.js 仍含 questions fallback 渲染
- V1 模式（useV2Prompt=false）完全保留旧行为

## 四、验证结果

### 4.1 TypeScript 类型检查

```
npx tsc --noEmit
```
结果：**EXIT=0**（无错误）

### 4.2 Task B 验收脚本

```
npx tsx scripts/verify-taskB.ts
```
结果：**87 PASS / 0 FAIL**

| 模块 | 检查项 | 结果 |
|------|--------|------|
| 1. 文件存在性 | 7 | PASS |
| 2. QuestionPlanner 单元测试 | 13 | PASS |
| 3. normalizeUserInput 单元测试 | 9 | PASS |
| 4. RequirementCardGenerator 单元测试 | 13 | PASS |
| 5. ConversationManager 集成测试 | 11 | PASS |
| 6. API 测试 | 13 | PASS |
| 7. 兼容性验证 | 7 | PASS |
| 8. 安全红线 | 7 | PASS |
| 9. 回归测试 | 7 | PASS |

### 4.3 回归测试详情

| 脚本 | 实际 PASS | 期望 PASS | 结果 |
|------|-----------|-----------|------|
| verify-e2e-ai-events | 14 | 13 | PASS |
| verify-task038 | 38 | 30 | PASS |
| verify-task039 | 57 | 57 | PASS |
| verify-task040 | 75 | 75 | PASS |
| verify-task041 | 38 | 38 | PASS |
| verify-task042 | 31 | 30 | PASS |
| verify-task043 | 23 | 23 | PASS |

## 五、IDE 交付规范遵循

| 红线 | 遵循情况 |
|------|----------|
| #1 tsc 附完整输出 | ✓ 输出重定向至 tsc-taskB.log，EXIT=0 |
| #2 matchAll 取最后匹配 | ✓ 回归测试使用 matchAll 取最后一个 PASS 匹配 |
| #3 optionalDependencies 类型声明 | ✓ 未涉及 puppeteer |
| #4 DOM 类型处理 | ✓ web/requirement-chat.js 为 JS 文件，无 DOM 类型问题 |
| #5 回归测试范围与任务书一致 | ✓ 7 个回归测试覆盖 Task 037-043 |

## 六、修复的附带问题

在验证过程中发现并修复了 `scripts/verify-task043.ts` 的 libuv async handle 崩溃问题：
- **问题**：`server.close()` 同步调用 + `process.exit()` 强制退出导致 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
- **修复**：改为 `await new Promise(resolve => server.close(resolve))` + `process.exitCode` 替代 `process.exit()`

## 七、下一步建议

Task B 已完成并验证通过，建议：
1. 提交本版本到 Git
2. 并行执行 Task C（源透明度）和 Task E（文件上传）
