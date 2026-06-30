# Task V1.6-08 providerRouting fallback 策略 完成回报

## 1. 任务概述

**任务书**：V1.6-08providerRouting-fallback任务书.md
**Git Commit**：`d885726`
**提交时间**：2026-06-30
**状态**：✅ 全部完成，所有验收通过

## 2. 目标

完善 `SearchOrchestrator.search()` 的 providerRouting fallback 策略：
- primary provider 全失败（无结果）时自动启用 fallback provider
- 在 `SearchOrchestratorResult.providerDegradation` 中记录降级信息
- 非法 provider 名称 console.warn 告警
- 向后兼容：无 providerRouting 时行为不变

## 3. 交付清单

### 3.1 新建文件（2 个）
| 文件 | 说明 |
|------|------|
| `scripts/verify-task-v1.6-08-provider-fallback.ts` | 32 项断言验收脚本（5 静态 + 5 primary正常 + 6 primary全失败 + 3 无fallback + 1 非法名称 + 4 部分失败 + 3 空结果 + 3 fallback全失败 + 2 去重） |
| `docs/Task_V1.6-08_完成回报.md` | 本完成回报 |

### 3.2 修改文件（2 个）
| 文件 | 改动 |
|------|------|
| `src/search/orchestrator.ts` | SearchOrchestratorResult 新增 `providerDegradation` 字段；live 模式 provider 执行重构为 primary+fallback 两阶段；非法 provider 名称 console.warn |
| `package.json` | 新增 `verify:v16:provider-fallback` 脚本 |

## 4. 核心设计

### 4.1 fallback 触发条件
```
if (
  allResults.length === 0 &&        // primary 无结果
  primaryProviders.length > 0 &&    // 有 primary provider
  fallbackProviders.length > 0      // 有 fallback 配置
) {
  → 触发 fallback
}
```
- **全失败才触发**：部分 primary 失败但有结果时不触发（验收项 8）
- **空结果也算失败**：primary 返回空数组时也触发（验收项 G）
- **无 fallback 配置不触发**：providerRouting.fallback 为空时 providerDegradation 不输出（验收项 4）

### 4.2 providerDegradation 结构
```typescript
providerDegradation?: {
  fallbackUsed: boolean;              // 是否触发了 fallback
  primaryErrors: Record<string, string>;  // primary + fallback 错误（fallback 加 [fallback] 前缀）
  fallbackProviders: string[];        // 实际被调用的 fallback provider 名称
}
```
- 仅在配置了 `providerRouting.fallback` 时输出（即使未触发 fallback 也输出 fallbackUsed=false）
- 无 fallback 配置时 `providerDegradation === undefined`

### 4.3 错误记录
- primary 错误：`provider ${name} 调用失败: ${errMsg}`
- fallback 错误：`[fallback] provider ${name} 调用失败: ${errMsg}`（加前缀区分）
- 两者都记录在 `primaryErrors` 中，key 为 provider name

## 5. 验证结果

| 验证项 | 结果 |
|--------|------|
| `npx tsc --noEmit` | ✅ exit 0 |
| `verify-task-v1.6-08-provider-fallback.ts` | ✅ 32 PASS / 0 FAIL |
| `npm run verify:v15`（回归） | ✅ 241 PASS / 0 FAIL |
| `npm run verify:v15:e2e`（回归） | ✅ 326 PASS / 0 FAIL |

### 验收脚本分组（32 项）
- A. 静态检查 5 项：providerDegradation 字段 + getByNames/get 方法 + ProviderRouting.fallback
- B. primary 正常 5 项：fallback 未调用 + providerDegradation.fallbackUsed=false
- C. primary 全失败 6 项：fallback 调用 + fallbackUsed=true + primaryErrors + fallbackProviders + errors 降级提示
- D. 无 fallback 配置 3 项：不触发 + providerDegradation 不存在
- E. 非法名称 1 项：console.warn 触发
- F. 部分失败 4 项：有结果不触发 fallback + primaryErrors 记录失败
- G. primary 返回空 3 项：触发 fallback
- H. fallback 全失败 3 项：无结果 + [fallback] 前缀
- I. 结果去重 2 项：fallback 结果可用

## 6. 工作量统计

- 文件变更：4 个（2 新建 + 2 修改）
- 代码增量：+816 行 / -11 行
- Git 提交：`d885726`（main 分支，领先 origin/main 9 个提交）

## 7. 后续依赖

V1.6-08 完成后，V1.6b 阶段剩余：
- V1.6-09 生成失败前端降级（AI 生成失败时前端降级提示）
