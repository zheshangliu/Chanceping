# Task E 完成回报

## 1. 修改了哪些文件

| 文件 | 改动内容 |
|---|---|
| `src/api/types.ts` | ChatRequest 接口新增 `uploaded_text?: string` 字段 |
| `src/api/context.ts` | AppContext 接口新增 `fileParser?: FileParser` 字段；createAppContext 初始化 FileParserRouter |
| `src/api/app.ts` | 导入并注册 `/api/upload` 路由 |
| `src/api/routes/chat.ts` | POST / 端点新增 uploaded_text 合并逻辑（追加到 message 末尾） |
| `package.json` | dependencies 新增 exceljs/mammoth/pdf-parse |
| `web/index.html` | home-input-area 和 chat-input-area 各添加一个📎附件按钮 |
| `web/requirement-chat.js` | 新增 uploadFile/bindAttachButton 函数；DOMContentLoaded 中绑定两个附件按钮 |

## 2. 新增了哪些文件

| 文件 | 职责 |
|---|---|
| `src/search/file-parser-router.ts` | 文件解析路由器，按 MIME 类型分发到对应适配器 |
| `src/search/pdf-parse-adapter.ts` | PDF 文件解析（pdf-parse） |
| `src/search/mammoth-adapter.ts` | Word(.docx) 文件解析（mammoth） |
| `src/search/exceljs-adapter.ts` | Excel(.xlsx) 文件解析（exceljs） |
| `src/search/qwen-vl-adapter.ts` | 图片/扫描件解析（Qwen-VL-Max，参赛版合规） |
| `src/api/routes/upload.ts` | POST /api/upload 端点，接收 multipart/form-data 文件 |
| `src/types/pdf-parse.d.ts` | pdf-parse 模块 TypeScript 类型声明 |

## 3. 如何本地运行

```bash
cd changeping
npm install          # 安装新增依赖
npm run dev          # 启动开发服务器
# 访问 http://localhost:3000
# 在首页或需求确认页点击📎按钮上传文件
```

## 4. 如何测试

```bash
# 类型检查
npx tsc --noEmit

# 回归测试
npx tsx scripts/verify-task038.ts   # 首页 + 需求确认页
npx tsx scripts/verify-task039.ts   # 搜索结果页 + 机会卡片
```

### 运行输出

**tsc --noEmit:**
```
EXIT_CODE=0
```

**verify-task038:**
```
总计: 68 PASS / 0 FAIL
✓ 全部通过
```

**verify-task039:**
```
总计: 57 PASS / 0 FAIL
✓ 全部通过
```

## 5. 哪些功能还没做

1. `.attach-btn` 的 CSS 样式尚未添加到 `web/styles.css`（按钮可点击但无样式）
2. 专门的 `verify-taskE.ts` 验收脚本未编写
3. QwenVlAdapter 的实际 API 调用未做端到端测试（需要 DASHSCOPE_API_KEY + 真实图片）
4. 前端未做文件大小和 MIME 类型预检查（仅服务端校验）
5. 首页附件按钮的事件绑定由 requirement-chat.js 统一处理，未在 home.js 中单独绑定

## 6. 下一步建议

1. 添加 `.attach-btn` CSS 样式到 `web/styles.css`
2. 编写 `scripts/verify-taskE.ts` 验收脚本（覆盖 MIME 路由、大小限制、错误处理）
3. 在 `LLM_MODE=live` 环境下测试 QwenVlAdapter 的真实图片识别
4. 前端添加文件大小和类型预检查，减少无效上传请求
5. 考虑大文件上传时的进度条展示
