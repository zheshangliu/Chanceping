/**
 * ChancePing 报告 Tab 逻辑
 * 来源：Task 040 第 6 节
 *
 * 职责：
 *   - 报告生成（POST /api/reports/generate）
 *   - Markdown 预览（正则简单渲染，不引入解析库）
 *   - 报告导出（Markdown/HTML/PDF，Blob 下载）
 *   - 历史报告列表（GET /api/reports/export/list）
 *   - 历史报告下载（GET /api/reports/export/:filename）
 *
 * 纯 JS，无框架，无构建工具。
 */

(function () {
  // ============================================================
  // 状态
  // ============================================================
  let currentReportParams = null;
  let currentMarkdown = null;

  // ============================================================
  // Tab 切换监听
  // ============================================================
  window.addEventListener("tab-switched", (e) => {
    if (e.detail && e.detail.tab === "reports") {
      loadHistory();
    }
  });

  // DOMContentLoaded 时绑定事件
  document.addEventListener("DOMContentLoaded", () => {
    bindReportActions();
    // 默认填充周期：最近 7 天
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    setElValue("report-period-end", formatDate(end));
    setElValue("report-period-start", formatDate(start));
  });

  // ============================================================
  // 报告生成
  // ============================================================
  async function generateReport() {
    const radar = getElValue("report-radar") || "ai_competition";
    const periodStart = getElValue("report-period-start");
    const periodEnd = getElValue("report-period-end");

    if (!periodStart || !periodEnd) {
      if (typeof window.showToast === "function") window.showToast("请选择周期日期", "warning");
      return;
    }

    currentReportParams = {
      radar_type: radar,
      period_start: periodStart,
      period_end: periodEnd,
    };

    const btn = document.getElementById("btn-generate-report");
    if (btn) btn.disabled = true;

    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentReportParams),
      });
      const json = await res.json();
      if (json.success && json.data && json.data.markdown) {
        currentMarkdown = json.data.markdown;
        renderReportPreview(json.data);
        if (typeof window.showToast === "function") window.showToast("报告生成成功", "success");
      } else {
        const msg = (json.error && json.error.message) || "生成失败";
        if (typeof window.showToast === "function") window.showToast(msg, "error");
      }
    } catch (err) {
      console.error("[reports] generateReport 失败:", err);
      if (typeof window.showToast === "function") window.showToast("生成失败", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderReportPreview(data) {
    const section = document.getElementById("report-preview-section");
    const preview = document.getElementById("report-preview");
    const statsEl = document.getElementById("report-stats");
    if (section) section.style.display = "block";
    if (preview) preview.innerHTML = renderMarkdown(currentMarkdown || "");
    if (statsEl && data.stats) {
      const s = data.stats;
      statsEl.textContent = `（共 ${s.total_opportunities ?? 0} 条 | S:${s.s_count ?? 0} A:${s.a_count ?? 0} B:${s.b_count ?? 0} C:${s.c_count ?? 0} | 即将截止:${s.expiring_soon_count ?? 0}）`;
    }
  }

  // ============================================================
  // 报告导出
  // ============================================================
  async function exportReport(format) {
    if (!currentReportParams) {
      if (typeof window.showToast === "function") window.showToast("请先生成报告", "warning");
      return;
    }
    try {
      const res = await fetch(`/api/reports/export?format=${encodeURIComponent(format)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentReportParams),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const msg = (errJson && errJson.error && errJson.error.message) || "导出失败";
        if (typeof window.showToast === "function") window.showToast(msg, "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chanceping-report.${format === "markdown" ? "md" : format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (typeof window.showToast === "function") window.showToast(`已导出 ${format}`, "success");
      // 刷新历史列表
      loadHistory();
    } catch (err) {
      console.error("[reports] exportReport 失败:", err);
      if (typeof window.showToast === "function") window.showToast("导出失败", "error");
    }
  }

  // ============================================================
  // 历史报告
  // ============================================================
  async function loadHistory() {
    const listEl = document.getElementById("report-history-list");
    if (!listEl) return;
    try {
      const res = await fetch("/api/reports/export/list");
      const json = await res.json();
      if (json.success && json.data && Array.isArray(json.data.files)) {
        renderHistoryList(json.data.files);
      } else {
        listEl.innerHTML = '<p class="placeholder">暂无历史报告</p>';
      }
    } catch (err) {
      console.error("[reports] loadHistory 失败:", err);
      listEl.innerHTML = '<p class="placeholder">加载历史失败</p>';
    }
  }

  function renderHistoryList(files) {
    const listEl = document.getElementById("report-history-list");
    if (!listEl) return;
    if (files.length === 0) {
      listEl.innerHTML = '<p class="placeholder">暂无历史报告</p>';
      return;
    }
    listEl.innerHTML = files
      .map((f) => {
        const name = escapeHtml(f.filename || "");
        const size = formatSize(f.size || 0);
        const created = f.created_at ? escapeHtml(String(f.created_at)) : "";
        return `
          <div class="history-item">
            <span class="history-name">${name}</span>
            <span class="history-size">${size}</span>
            <span class="history-date">${created}</span>
            <button class="btn-download-history" data-filename="${name}">下载</button>
          </div>
        `;
      })
      .join("");
    listEl.querySelectorAll(".btn-download-history").forEach((btn) => {
      btn.addEventListener("click", () => {
        downloadHistory(btn.dataset.filename);
      });
    });
  }

  async function downloadHistory(filename) {
    if (!filename) return;
    try {
      const res = await fetch(`/api/reports/export/${encodeURIComponent(filename)}`);
      if (!res.ok) {
        if (typeof window.showToast === "function") window.showToast("下载失败", "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (typeof window.showToast === "function") window.showToast("下载成功", "success");
    } catch (err) {
      console.error("[reports] downloadHistory 失败:", err);
      if (typeof window.showToast === "function") window.showToast("下载失败", "error");
    }
  }

  // ============================================================
  // Markdown 简单渲染（正则转换，不引入解析库）
  // ============================================================
  function renderMarkdown(md) {
    if (!md) return "";
    // 先转义 HTML
    let html = escapeHtml(md);
    // 标题
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    // 加粗
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // 链接
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, (match, text, url) => {
      if (/^(https?:\/\/|\/\/)/i.test(url)) {
        return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
      }
      return match; // 非安全协议,保留原文
    });
    // 列表项
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    // 段落分隔
    html = html.replace(/\n\n/g, "</p><p>");
    // 段落包裹（非标题/列表开头的行）
    html = html.replace(/^(?!<[hlu])(.+)$/gm, "<p>$1</p>");
    // 修复 <li> 未被 <ul> 包裹
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
    return html;
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindReportActions() {
    const btnGenerate = document.getElementById("btn-generate-report");
    if (btnGenerate) btnGenerate.addEventListener("click", generateReport);

    document.querySelectorAll(".export-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fmt = btn.dataset.format;
        exportReport(fmt);
      });
    });
  }

  // ============================================================
  // 工具函数
  // ============================================================
  function getElValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
  }

  function setElValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
})();
