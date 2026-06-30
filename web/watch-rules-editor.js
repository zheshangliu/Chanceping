/**
 * ChancePing Watch Rules 编辑器核心逻辑
 * 来源：Task 025 第 5.4 节
 *
 * 模块：
 *   - DSLParser：前端简化版 DSL 解析器（镜像 dsl-parser.ts，仅用于预览）
 *   - SyntaxHighlighter：DSL 语法高亮（7 种前缀 + 注释 + 组名）
 *   - PreviewRenderer：实时解析预览渲染
 *   - TestRunner：规则测试面板逻辑
 *   - TabManager：Tab 切换管理
 *   - ThemeManager：暗色/浅色主题切换
 *   - ShortcutManager：快捷键绑定
 *   - API：后端 API 调用封装
 *   - WatchRulesEditor：主控制器
 *
 * 纯 JS，无框架，无构建工具。
 */

(function () {
  "use strict";

  // ============================================================
  // DSLParser：前端简化版 DSL 解析器
  // ============================================================

  const DSLParser = {
    VALID_RADAR_TYPES: ["ai_competition", "opc_policy", "cultural_heritage"],
    VALID_LEVELS: ["S", "A", "B", "C"],
    OPERATOR_LABELS: {
      include: "包含",
      exclude: "排除",
      radar: "雷达",
      level: "等级",
      region: "地区",
      deadline: "截止",
      starred: "已收藏",
    },

    parseLine(line, lineNumber) {
      const trimmed = (line || "").trim();
      if (!trimmed) return null;

      // 注释行
      if (trimmed.startsWith("//")) {
        return {
          type: "comment",
          text: trimmed.slice(2).trim(),
          line_number: lineNumber,
        };
      }

      // 组名 [xxx]
      const groupMatch = trimmed.match(/^\[(.+)\]$/);
      if (groupMatch) {
        return {
          type: "group",
          name: groupMatch[1],
          line_number: lineNumber,
        };
      }

      // 解析条件
      const conditions = [];
      const parts = trimmed.split(/\s+/);
      const errors = [];

      for (const part of parts) {
        if (!part) continue;
        const firstChar = part[0];

        if (firstChar === "+") {
          const value = part.slice(1);
          if (!value) {
            errors.push({ line_number: lineNumber, message: "+ 后缺少关键词" });
          } else {
            conditions.push({ operator: "include", value });
          }
        } else if (firstChar === "!") {
          const value = part.slice(1);
          if (!value) {
            errors.push({ line_number: lineNumber, message: "! 后缺少关键词" });
          } else {
            conditions.push({ operator: "exclude", value });
          }
        } else if (firstChar === "@") {
          const value = part.slice(1);
          if (!this.VALID_RADAR_TYPES.includes(value)) {
            errors.push({
              line_number: lineNumber,
              message: `无效雷达类型: ${value}（有效值: ${this.VALID_RADAR_TYPES.join("/")})`,
            });
          } else {
            conditions.push({ operator: "radar", value });
          }
        } else if (firstChar === "#") {
          const raw = part.slice(1).replace(/\s+/g, "");
          const levels = raw.split("");
          const invalid = levels.filter((l) => !this.VALID_LEVELS.includes(l));
          if (invalid.length > 0) {
            errors.push({
              line_number: lineNumber,
              message: `无效等级: ${invalid.join("")}（有效值: ${this.VALID_LEVELS.join("/")})`,
            });
          } else if (levels.length === 0) {
            errors.push({ line_number: lineNumber, message: "# 后缺少等级" });
          } else {
            conditions.push({ operator: "level", value: levels });
          }
        } else if (firstChar === "$") {
          const value = part.slice(1);
          if (!value) {
            errors.push({ line_number: lineNumber, message: "$ 后缺少地区" });
          } else {
            conditions.push({ operator: "region", value });
          }
        } else if (firstChar === "%") {
          const value = parseInt(part.slice(1), 10);
          if (Number.isNaN(value)) {
            errors.push({ line_number: lineNumber, message: "% 后需为数字（天数）" });
          } else {
            conditions.push({ operator: "deadline", value });
          }
        } else if (part === "*") {
          conditions.push({ operator: "starred", value: true });
        } else {
          errors.push({
            line_number: lineNumber,
            message: `无法解析: ${part}（需以 +/!/@/#/$/% 开头或为 *）`,
          });
        }
      }

      return {
        type: "rule",
        conditions,
        raw_text: trimmed,
        line_number: lineNumber,
        errors,
      };
    },

    parse(text) {
      const lines = (text || "").split("\n");
      const results = [];
      const allErrors = [];
      for (let i = 0; i < lines.length; i++) {
        const result = this.parseLine(lines[i], i + 1);
        if (result) {
          results.push(result);
          if (result.errors) allErrors.push(...result.errors);
        }
      }
      return { results, errors: allErrors };
    },
  };

  // ============================================================
  // SyntaxHighlighter：DSL 语法高亮
  // ============================================================

  const SyntaxHighlighter = {
    /**
     * 将 DSL 文本转为带语法高亮的 HTML。
     * 转义 HTML 特殊字符，避免 XSS。
     */
    highlight(text) {
      const lines = (text || "").split("\n");
      return lines
        .map((line) => this.highlightLine(line))
        .join("\n");
    },

    highlightLine(line) {
      const trimmed = (line || "").trim();
      if (!trimmed) return "";

      // 转义 HTML
      const escaped = this.escapeHtml(line);

      // 注释行
      if (trimmed.startsWith("//")) {
        return `<span class="token-comment">${escaped}</span>`;
      }

      // 组名 [xxx]
      if (/^\[.+\]$/.test(trimmed)) {
        return `<span class="token-group">${escaped}</span>`;
      }

      // 按空格分词着色
      const parts = trimmed.split(/(\s+)/);
      return parts
        .map((part) => {
          if (!part || /^\s+$/.test(part)) return part;
          return this.highlightToken(part);
        })
        .join("");
    },

    highlightToken(part) {
      const escaped = this.escapeHtml(part);
      const firstChar = part[0];

      if (firstChar === "+") return `<span class="token-include">${escaped}</span>`;
      if (firstChar === "!") return `<span class="token-exclude">${escaped}</span>`;
      if (firstChar === "@") return `<span class="token-radar">${escaped}</span>`;
      if (firstChar === "#") return `<span class="token-level">${escaped}</span>`;
      if (firstChar === "$") return `<span class="token-region">${escaped}</span>`;
      if (firstChar === "%") return `<span class="token-deadline">${escaped}</span>`;
      if (part === "*") return `<span class="token-starred">${escaped}</span>`;
      return escaped;
    },

    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    },
  };

  // ============================================================
  // API：后端 API 调用封装
  // ============================================================

  const API = {
    baseUrl: "",

    async getRules() {
      const res = await fetch(`${this.baseUrl}/api/watch-rules`);
      return res.json();
    },

    async saveRules(rulesText) {
      const res = await fetch(`${this.baseUrl}/api/watch-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules_text: rulesText }),
      });
      return res.json();
    },

    async clearRules() {
      const res = await fetch(`${this.baseUrl}/api/watch-rules`, {
        method: "DELETE",
      });
      return res.json();
    },

    async testMatch(rulesText) {
      const res = await fetch(`${this.baseUrl}/api/watch-rules/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules_text: rulesText,
          use_store_entries: false,
        }),
      });
      return res.json();
    },

    async checkHealth() {
      try {
        const res = await fetch(`${this.baseUrl}/health`);
        return res.ok;
      } catch {
        return false;
      }
    },
  };

  // ============================================================
  // PreviewRenderer：实时解析预览渲染
  // ============================================================

  const PreviewRenderer = {
    render(previewEl, text) {
      if (!text || !text.trim()) {
        previewEl.innerHTML = '<p class="placeholder">输入规则后实时预览解析结果</p>';
        return;
      }

      const { results, errors } = DSLParser.parse(text);
      let html = "";

      // 渲染错误
      for (const err of errors) {
        html += `<div class="preview-error">行 ${err.line_number}: ${this.escapeHtml(err.message)}</div>`;
      }

      // 渲染解析结果
      for (const item of results) {
        if (item.type === "comment") {
          // 注释不显示
          continue;
        }
        if (item.type === "group") {
          html += `<div class="preview-group">[${this.escapeHtml(item.name)}]</div>`;
          continue;
        }
        if (item.type === "rule") {
          const conditionsHtml = (item.conditions || [])
            .map((c) => {
              const label = DSLParser.OPERATOR_LABELS[c.operator] || c.operator;
              const value =
                typeof c.value === "boolean"
                  ? ""
                  : Array.isArray(c.value)
                    ? c.value.join("/")
                    : String(c.value);
              return `<span class="preview-condition">${label}: ${this.escapeHtml(value)}</span>`;
            })
            .join("");
          html += `<div class="preview-rule">
            <div class="rule-line">行 ${item.line_number}: ${this.escapeHtml(item.raw_text)}</div>
            <div class="rule-conditions">${conditionsHtml}</div>
          </div>`;
        }
      }

      if (!html) {
        previewEl.innerHTML = '<p class="placeholder">无有效规则</p>';
      } else {
        previewEl.innerHTML = html;
      }
    },

    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = String(text);
      return div.innerHTML;
    },
  };

  // ============================================================
  // TestRunner：规则测试面板
  // ============================================================

  const TestRunner = {
    async run(testResultEl, rulesText, mockDataText) {
      if (!rulesText.trim()) {
        testResultEl.innerHTML =
          '<p class="placeholder">请先输入规则</p>';
        return;
      }

      // 解析 Mock 数据
      let mockData = [];
      if (mockDataText && mockDataText.trim()) {
        try {
          mockData = JSON.parse(mockDataText);
          if (!Array.isArray(mockData)) {
            testResultEl.innerHTML =
              '<p class="placeholder">Mock 数据需为 JSON 数组</p>';
            return;
          }
        } catch (e) {
          testResultEl.innerHTML =
            '<p class="placeholder">Mock 数据 JSON 解析失败: ' +
            this.escapeHtml(e.message) +
            "</p>";
          return;
        }
      }

      testResultEl.innerHTML = '<p class="placeholder">测试中...</p>';

      try {
        const res = await API.testMatch(rulesText);
        if (!res.success) {
          testResultEl.innerHTML =
            '<p class="placeholder">测试失败: ' +
            this.escapeHtml(res.error?.message || "未知错误") +
            "</p>";
          return;
        }

        const data = res.data || {};
        const summary = data.summary || {};
        const byEntry = summary.by_entry || [];

        if (byEntry.length === 0) {
          // 后端用 store entries 匹配，无 mock 数据时显示汇总
          testResultEl.innerHTML =
            '<p class="placeholder">匹配汇总：' +
            `总数 ${summary.total_entries ?? 0}，命中 ${summary.matched_entries ?? 0}` +
            "</p>";
          return;
        }

        let html = "";
        for (const item of byEntry) {
          const matched = item.matched_rules && item.matched_rules.length > 0;
          const card = item.entry?.card || {};
          const title = card.title || "(无标题)";
          const matchedCount = item.matched_rules.length;
          html += `<div class="test-result-item ${matched ? "matched" : "not-matched"}">
            <div class="item-title">${this.escapeHtml(title)}</div>
            <div class="item-detail">${matched ? `命中 ${matchedCount} 条规则` : "未命中任何规则"}</div>
          </div>`;
        }
        testResultEl.innerHTML = html || '<p class="placeholder">无匹配结果</p>';
      } catch (e) {
        testResultEl.innerHTML =
          '<p class="placeholder">请求失败: ' + this.escapeHtml(e.message) + "</p>";
      }
    },

    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = String(text);
      return div.innerHTML;
    },
  };

  // ============================================================
  // TabManager：Tab 切换管理
  // ============================================================

  const TabManager = {
    init() {
      const buttons = document.querySelectorAll(".tab-btn");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => this.switchTo(btn.dataset.tab));
      });
    },

    switchTo(tabName) {
      document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === tabName);
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `panel-${tabName}`);
      });
      window.dispatchEvent(new CustomEvent("tab-switched", { detail: { tab: tabName } }));
    },
  };

  // ============================================================
  // ThemeManager：暗色/浅色主题切换
  // ============================================================

  const ThemeManager = {
    init() {
      const toggle = document.getElementById("theme-toggle");
      if (!toggle) return;
      toggle.addEventListener("click", () => this.toggle());

      // 从 localStorage 恢复主题
      const saved = localStorage.getItem("chanceping-theme");
      if (saved) {
        this.apply(saved);
      }
    },

    toggle() {
      const html = document.documentElement;
      const current = html.getAttribute("data-theme") || "dark";
      this.apply(current === "dark" ? "light" : "dark");
    },

    apply(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("chanceping-theme", theme);
      const toggle = document.getElementById("theme-toggle");
      if (toggle) {
        toggle.textContent = theme === "dark" ? "🌙" : "☀️";
      }
    },
  };

  // ============================================================
  // ShortcutManager：快捷键绑定
  // ============================================================

  const ShortcutManager = {
    editor: null,

    init(editor) {
      this.editor = editor;
      const textarea = document.getElementById("editor-textarea");
      if (!textarea) return;
      textarea.addEventListener("keydown", (e) => this.handleKeydown(e));
    },

    handleKeydown(e) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+S：保存
      if (ctrl && e.key === "s") {
        e.preventDefault();
        this.editor.save();
        return;
      }

      // Ctrl+Enter：运行测试
      if (ctrl && e.key === "Enter") {
        e.preventDefault();
        this.editor.runTest();
        return;
      }

      // Ctrl+/：注释/取消注释当前行
      if (ctrl && e.key === "/") {
        e.preventDefault();
        this.toggleComment();
        return;
      }

      // Ctrl+D：复制当前行
      if (ctrl && e.key === "d") {
        e.preventDefault();
        this.duplicateLine();
        return;
      }

      // Escape：失焦
      if (e.key === "Escape") {
        e.target.blur();
        return;
      }
    },

    toggleComment() {
      const textarea = document.getElementById("editor-textarea");
      const { selectionStart, value } = textarea;
      const lines = value.split("\n");

      // 找到当前行
      let pos = 0;
      let lineIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineEnd = pos + lines[i].length;
        if (selectionStart >= pos && selectionStart <= lineEnd) {
          lineIdx = i;
          break;
        }
        pos = lineEnd + 1;
      }

      const line = lines[lineIdx];
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) {
        // 取消注释
        const indent = line.slice(0, line.length - trimmed.length);
        lines[lineIdx] = indent + trimmed.slice(2).replace(/^\s/, "");
      } else {
        // 添加注释
        const indent = line.slice(0, line.length - trimmed.length);
        lines[lineIdx] = `${indent}// ${trimmed}`;
      }

      textarea.value = lines.join("\n");
      this.editor.updateHighlight();
      this.editor.updatePreview();
      this.editor.updateLineInfo();
    },

    duplicateLine() {
      const textarea = document.getElementById("editor-textarea");
      const { selectionStart, value } = textarea;
      const lines = value.split("\n");

      let pos = 0;
      let lineIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineEnd = pos + lines[i].length;
        if (selectionStart >= pos && selectionStart <= lineEnd) {
          lineIdx = i;
          break;
        }
        pos = lineEnd + 1;
      }

      lines.splice(lineIdx + 1, 0, lines[lineIdx]);
      textarea.value = lines.join("\n");
      this.editor.updateHighlight();
      this.editor.updatePreview();
    },
  };

  // ============================================================
  // WatchRulesEditor：主控制器
  // ============================================================

  const WatchRulesEditor = {
    async init() {
      TabManager.init();
      ThemeManager.init();
      ShortcutManager.init(this);

      const textarea = document.getElementById("editor-textarea");
      const highlight = document.getElementById("editor-highlight");
      const preview = document.getElementById("preview-content");
      const btnSave = document.getElementById("btn-save");
      const btnClear = document.getElementById("btn-clear");
      const btnTest = document.getElementById("btn-test");
      const testMockData = document.getElementById("test-mock-data");
      const testResult = document.getElementById("test-result");

      // 输入事件：更新高亮 + 预览 + 行号
      textarea.addEventListener("input", () => {
        this.updateHighlight();
        this.updatePreview();
        this.updateLineInfo();
      });

      // 滚动同步：textarea 滚动 → highlight 跟随
      textarea.addEventListener("scroll", () => {
        highlight.scrollTop = textarea.scrollTop;
        highlight.scrollLeft = textarea.scrollLeft;
      });

      // 光标移动：更新行列信息
      textarea.addEventListener("keyup", () => this.updateLineInfo());
      textarea.addEventListener("click", () => this.updateLineInfo());

      // 按钮事件
      btnSave.addEventListener("click", () => this.save());
      btnClear.addEventListener("click", () => this.clear());
      btnTest.addEventListener("click", () => this.runTest());

      // 加载已有规则
      await this.loadRules();

      // 检查 API 状态
      this.checkApiStatus();

      // 初始渲染
      this.updateHighlight();
      this.updatePreview();
      this.updateLineInfo();
    },

    updateHighlight() {
      const textarea = document.getElementById("editor-textarea");
      const highlight = document.getElementById("editor-highlight");
      highlight.innerHTML = SyntaxHighlighter.highlight(textarea.value) + "\n";
    },

    updatePreview() {
      const textarea = document.getElementById("editor-textarea");
      const preview = document.getElementById("preview-content");
      PreviewRenderer.render(preview, textarea.value);
    },

    updateLineInfo() {
      const textarea = document.getElementById("editor-textarea");
      const lineInfo = document.getElementById("line-info");
      const { selectionStart, value } = textarea;
      const before = value.slice(0, selectionStart);
      const lines = before.split("\n");
      const row = lines.length;
      const col = lines[lines.length - 1].length + 1;
      lineInfo.textContent = `行 ${row}, 列 ${col}`;
    },

    async loadRules() {
      try {
        const res = await API.getRules();
        if (res.success && res.data && typeof res.data.rules_text === "string") {
          const textarea = document.getElementById("editor-textarea");
          textarea.value = res.data.rules_text;
          this.updateHighlight();
          this.updatePreview();
          this.showToast("规则已加载", "success");
        }
      } catch (e) {
        this.showToast("加载规则失败: " + e.message, "error");
      }
    },

    async save() {
      const textarea = document.getElementById("editor-textarea");
      try {
        const res = await API.saveRules(textarea.value);
        if (res.success) {
          this.showToast("保存成功", "success");
        } else {
          this.showToast("保存失败: " + (res.error?.message || "未知错误"), "error");
        }
      } catch (e) {
        this.showToast("保存失败: " + e.message, "error");
      }
    },

    async clear() {
      if (!confirm("确定要清空所有规则吗？")) return;
      try {
        const res = await API.clearRules();
        if (res.success) {
          const textarea = document.getElementById("editor-textarea");
          textarea.value = "";
          this.updateHighlight();
          this.updatePreview();
          this.showToast("已清空", "success");
        } else {
          this.showToast("清空失败: " + (res.error?.message || "未知错误"), "error");
        }
      } catch (e) {
        this.showToast("清空失败: " + e.message, "error");
      }
    },

    async runTest() {
      const textarea = document.getElementById("editor-textarea");
      const testMockData = document.getElementById("test-mock-data");
      const testResult = document.getElementById("test-result");
      await TestRunner.run(testResult, textarea.value, testMockData.value);
    },

    async checkApiStatus() {
      const indicator = document.getElementById("api-status");
      const ok = await API.checkHealth();
      indicator.classList.toggle("online", ok);
      indicator.classList.toggle("offline", !ok);
      indicator.title = ok ? "API 已连接" : "API 未连接";
    },

    showToast(message, type) {
      const toast = document.getElementById("toast");
      toast.textContent = message;
      toast.className = `toast show ${type || ""}`;
      setTimeout(() => {
        toast.classList.remove("show");
      }, 2500);
    },
  };

  // ============================================================
  // 启动
  // ============================================================

  document.addEventListener("DOMContentLoaded", () => {
    WatchRulesEditor.init();
  });
})();
