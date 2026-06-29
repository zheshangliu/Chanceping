# Task V1.5-05 完成回报：AI 生成器

> 版本：V1.0 | 日期：2026-06-30 | 阶段：V1.5a-4（最后一步）
> 前置依赖：Task V1.5-03（API）+ Task V1.5-04（UI）已验收通过

---

## 一、任务概述

用户输入自然语言描述（如"我要盯 RPA 相关的比赛"），AI 自动生成 RadarRequirementSpec。核心链路：

```
用户输入描述 → RadarGenerator 调 LLM 解析意图（ExtractedRequirementInfo）
→ RadarSpecCompiler 编译 RadarRequirementSpec（支持 custom 类型）
→ RadarSpecValidator 校验字段完整率（10 字段，≥90% 通过）
→ 用户前端确认 → 调 POST /api/radars 创建雷达
```

本任务是 V1.5a 的最后一步。如果 AI 生成质量不稳定，用户仍可通过 V1.5-04 的手动创建闭环（可降级）。

---

## 二、交付清单

### 2.1 新建文件（5 个）

| 文件 | 内容 |
|---|---|
| [src/schema/radar-spec-validator.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/schema/radar-spec-validator.ts) | RadarSpec 校验器：10 字段完整性校验，每字段 10%，通过阈值 90% |
| [src/agents/radar-spec-compiler.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/agents/radar-spec-compiler.ts) | SpecCompiler 扩展包装器：custom 类型不查 RADAR_KEYWORDS_TABLE，关键词从 info.opportunity_type.primary_types 取 |
| [src/prompts/radar-generator-prompt.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/prompts/radar-generator-prompt.ts) | LLM 提示词：系统提示词指导 LLM 输出 ExtractedRequirementInfo JSON |
| [src/agents/radar-generator.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/agents/radar-generator.ts) | RadarGenerator 类：LLM 生成 + Mock 模式，返回 spec + suggestedName + extractedInfo + completeness |
| [scripts/verify-task-v1.5-05-generator.ts](file:///c:/Users/test/Desktop/chanceping/changeping/scripts/verify-task-v1.5-05-generator.ts) | 验收脚本：17 项断言（6.1-6.5），回归 4 项由外部命令运行 |

### 2.2 改造文件（5 个）

| 文件 | 改动 |
|---|---|
| [src/api/types.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/api/types.ts) | 新增 RadarGenerateRequest / RadarGenerateResponseData 类型 |
| [src/api/routes/radars.ts](file:///c:/Users/test/Desktop/chanceping/changeping/src/api/routes/radars.ts) | 新增 POST /api/radars/generate 端点（不创建雷达，返回预览） |
| [web/radars.js](file:///c:/Users/test/Desktop/chanceping/changeping/web/radars.js) | 新增 AI 生成按钮事件 + openGenerateModal / submitGenerate / renderGenerateResult |
| [web/index.html](file:///c:/Users/test/Desktop/chanceping/changeping/web/index.html) | 工具栏新增"✨ AI 生成"按钮（id="btn-ai-generate"） |
| [web/styles.css](file:///c:/Users/test/Desktop/chanceping/changeping/web/styles.css) | 新增 AI 生成对话框宽版 / textarea / spec 预览 / 完整率进度条样式 |

---

## 三、关键设计点

### 3.1 RadarSpecValidator（10 字段校验）

10 个核心字段，每字段权重 10%，通过阈值 90%：

1. `keywords`（core_keywords_zh 非空数组）
2. `region`（primary_regions 非空数组）
3. `exclude_rules`（must_exclude 数组，可为空）
4. `scoring_rules`（对象存在）
5-9. `scoring_rules` 各权重字段（match_score / business_value / credibility / timeliness / actionability）
10. `visible_level_mapping`（对象，含 S/A/B/C 字符串值）

**提前返回优化**：scoring_rules 对象不存在时，后续 6 个字段全部记为缺失并提前返回，避免重复校验。

### 3.2 RadarSpecCompiler（custom 类型支持）

- **固定类型**（ai_competition / opc_policy / cultural_heritage）：委托给原 compileSpec，构造 `createFullConfidence()`（total=100 + 各维度 score=100）+ `confirmation_status="confirmed"` 绕过原拒绝检查
- **custom 类型**：不查 RADAR_KEYWORDS_TABLE，关键词从 `info.opportunity_type.primary_types` 取，地域从 `info.region_scope.primary_regions` 取，排除规则从 `info.exclusion_rules.must_exclude` 取
- **向后兼容**：不修改原 spec-compiler.ts

### 3.3 RadarGenerator（LLM + Mock）

- **Mock 模式**（LLM_MODE=mock）：createMockExtractedInfo 返回预设数据（RPA/自动化/比赛关键词 + 全国地域 + 已过期/需付费排除规则），确保 completeness ≥ 90
- **真实模式**：调用 LLM + parseJsonWithRepair（三重修复）+ normalizeExtractedInfo（缺失字段用空值填充）
- **建议名称**：取 primary_types 前 2 个 + "雷达"，截断到 20 字
- **降级策略**：LLM 调用失败时降级返回 mock 数据

### 3.4 API 端点（POST /api/radars/generate）

- **路由顺序**：在 POST / 之后、GET / 之前注册，避免与 POST /:id/activate 等路由冲突
- **不创建雷达**：只返回 Spec 预览（spec + suggestedName + completeness），用户确认后调 POST /api/radars 创建
- **校验**：description 必填，缺失返回 400
- **错误码**：GENERATE_ERROR（500）

### 3.5 前端 AI 生成弹窗

- **完整流程**：描述输入 → 生成 → Spec 预览 + 完整率进度条 + 确认创建/重新生成
- **完整率 < 90% 时**："确认创建"按钮 disabled
- **确认创建**：POST /api/radars with { name, kind: "custom", spec }
- **样式**：宽版对话框 + textarea + spec 预览区 + 完整率进度条（绿色 ≥90% / 黄色 <90%）

---

## 四、验收结果

### 4.1 V1.5-05 验收脚本（17 项断言）

```
=== Task V1.5-05 验收检查：AI 生成器 ===

=== 6.1 RadarSpecValidator ===
  PASS  1. 完整 Spec → completeness=100, passed=true
  PASS  2. 缺 keywords → completeness=90, missingFields 含 keywords
  PASS  3. 缺 2 字段 → completeness=80, passed=false

=== 6.2 RadarSpecCompiler ===
  PASS  4. compile(info, custom) 返回 RadarRequirementSpec
  PASS  5. spec.keywords 从 info.opportunity_type.primary_types 取
  PASS  6. compile(info, ai_competition) 委托原 SpecCompiler（非空 + product_name 正确）

=== 6.3 RadarGenerator（Mock 模式） ===
  PASS  7. Mock generate 返回 RadarGenerateResult
  PASS  8. 返回的 spec 非空
  PASS  9. suggestedName 非空(≤20 字)
  PASS  10. completeness ≥ 90（Mock 预设完整数据）
  PASS  11. extractedInfo 非空

=== 6.4 API 端点 ===
  PASS  12. POST /api/radars/generate 传 description → 200
  PASS  13. 不传 description → 400
  PASS  14. 返回的 spec 含 keywords 数组
  PASS  15. 返回的 completeness 是数字

=== 6.5 前端 ===
  PASS  16. radars.js 含 AI 生成函数 + index.html 含 AI 生成按钮
  PASS  17. radars.js 调用 POST /api/radars/generate

=== 验收结果（V1.5-05 AI 生成器 1-17）===
PASS: 17 / FAIL: 0
```

### 4.2 回归测试（18-21）

| 序号 | 命令 | 结果 |
|---|---|---|
| 18 | `npx tsc --noEmit` | exit 0（零错误） |
| 19 | `npx tsx scripts/verify-e2e-v13.ts` | 43 PASS / 0 FAIL |
| 20 | `npx tsx scripts/verify-task-v1.5-03-api.ts` | 48 PASS / 0 FAIL |
| 21 | `npx tsx scripts/verify-task-v1.5-04-ui.ts` | 23 PASS / 0 FAIL |

**全部 21 项验收标准通过，零失败。**

---

## 五、Git 提交信息

- **提交说明**：Task V1.5-05 AI 生成器：RadarSpecValidator + RadarSpecCompiler + RadarGenerator + POST /api/radars/generate + 前端 AI 生成弹窗
- **改动统计**：10 文件（5 新建 + 5 改造）

---

## 六、注意事项

1. **可降级**：AI 生成质量不稳定时，用户仍可通过 V1.5-04 手动创建雷达，不依赖生成器
2. **不直接创建**：generate 端点只返回 Spec 预览，用户确认后调 POST /api/radars 创建
3. **LLM 适配器复用**：复用现有 ModelRouter（LLM_MODE=mock 走 MockLlmAdapter）
4. **JSON 修复**：LLM 返回的 JSON 用 parseJsonWithRepair（V1.0 已有工具）三重修复
5. **字段完整率阈值**：≥90% 才允许创建（前端按钮 disabled + 后端 validator 双重校验）
6. **Mock 模式**：LLM_MODE=mock 时返回预设完整数据，确保开发环境无 LLM 也能跑通闭环
