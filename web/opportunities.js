/**
 * ChancePing 机会库 Tab 逻辑
 * 来源：Task 040 第 5 节
 *
 * 职责：
 *   - 机会列表展示（等级徽章 + 标题 + 截止日期 + 状态 + Star）
 *   - 筛选与排序（雷达类型/等级/状态/收藏 + 截止日期/分数/入库时间/等级）
 *   - 统计概览（总数/收藏/即将截止/已过期）
 *   - 页面内截止提醒（urgent/soon/warning/expired 分级）
 *   - 取消收藏 / 删除
 *
 * 纯 JS，无框架，无构建工具。
 */

(function () {
  // ============================================================
  // 状态
  // ============================================================
  let currentPage = 1;
  const PAGE_SIZE = 20;
  const currentFilters = {
    radar_type: "",
    visible_level: "",
    status: "",
    starred_only: false,
    sort_by: "deadline",
    sort_order: "asc",
  };

  // 状态标签映射
  const STATUS_LABELS = {
    new: "新发现",
    viewed: "已查看",
    tracking: "跟踪中",
    saved: "已保存",
    applied: "已报名",
    missed: "已错过",
    expired: "已过期",
    archived: "已归档",
    dismissed: "已忽略",
  };

  // 提醒级别配置
  const REMINDER_LEVELS = [
    { key: "urgent", label: "🔴 紧急（≤3天）", className: "reminder-urgent" },
    { key: "soon", label: "🟡 即将（3-7天）", className: "reminder-soon" },
    { key: "warning", label: "🔵 提醒（8-14天）", className: "reminder-warning" },
    { key: "expired", label: "⚫ 已过期", className: "reminder-expired" },
  ];

  // ============================================================
  // Tab 切换监听
  // ============================================================
  window.addEventListener("tab-switched", (e) => {
    if (e.detail && e.detail.tab === "opportunities") {
      loadOpportunities();
    }
  });

  // DOMContentLoaded 时绑定事件
  document.addEventListener("DOMContentLoaded", () => {
    bindFilters();
  });

  // ============================================================
  // 主加载流程
  // ============================================================
  async function loadOpportunities() {
    await Promise.all([refreshStats(), refreshReminders(), refreshList()]);
  }

  // ============================================================
  // 统计概览
  // ============================================================
  async function refreshStats() {
    try {
      const res = await fetch("/api/opportunities/stats");
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        setText("stat-total", `总数：${d.total ?? 0}`);
        setText("stat-starred", `收藏：${d.starred_count ?? 0}`);
        setText("stat-expiring", `即将截止：${d.expiring_soon_count ?? 0}`);
        const expiredCount = (d.by_status && d.by_status.expired) || 0;
        setText("stat-expired", `已过期：${expiredCount}`);
      }
    } catch (err) {
      console.error("[opportunities] refreshStats 失败:", err);
    }
  }

  // ============================================================
  // 截止提醒
  // ============================================================
  async function refreshReminders() {
    try {
      const res = await fetch("/api/reminders");
      const json = await res.json();
      if (json.success && json.data) {
        renderReminderSection(json.data);
      }
    } catch (err) {
      console.error("[opportunities] refreshReminders 失败:", err);
    }
  }

  function renderReminderSection(reminderResult) {
    const listEl = document.getElementById("reminder-list");
    if (!listEl) return;

    const hasAny = REMINDER_LEVELS.some(
      (lv) => reminderResult[lv.key] && reminderResult[lv.key].length > 0,
    );
    if (!hasAny) {
      listEl.innerHTML = '<p class="placeholder">暂无提醒</p>';
      return;
    }

    let html = "";
    for (const lv of REMINDER_LEVELS) {
      const items = reminderResult[lv.key] || [];
      if (items.length === 0) continue;
      html += `<div class="reminder-group ${lv.className}">`;
      html += `<h5 class="reminder-group-title">${lv.label}</h5>`;
      html += "<ul class=\"reminder-items\">";
      for (const item of items) {
        const title = item.title || (item.entry && item.entry.card && item.entry.card.title) || "未知";
        const days = item.days_until_deadline;
        const deadline = item.deadline || "未知";
        const action = item.suggested_action || "";
        const dayText = lv.key === "expired" ? `已截止（${deadline}）` : `${days}天后截止（${deadline}）`;
        html += `<li class="reminder-item"><strong>${escapeHtml(title)}</strong> — ${dayText}${action ? " → " + escapeHtml(action) : ""}</li>`;
      }
      html += "</ul></div>";
    }
    listEl.innerHTML = html;
  }

  // ============================================================
  // 机会列表
  // ============================================================
  async function refreshList() {
    const listEl = document.getElementById("opp-list");
    if (!listEl) return;
    listEl.innerHTML = '<p class="placeholder">加载中...</p>';

    try {
      const params = new URLSearchParams();
      params.set("page", String(currentPage));
      params.set("page_size", String(PAGE_SIZE));
      if (currentFilters.radar_type) params.set("radar_type", currentFilters.radar_type);
      if (currentFilters.visible_level) params.set("visible_level", currentFilters.visible_level);
      if (currentFilters.status) params.set("status", currentFilters.status);
      if (currentFilters.starred_only) params.set("starred_only", "true");
      if (currentFilters.sort_by) params.set("sort_by", currentFilters.sort_by);
      if (currentFilters.sort_order) params.set("sort_order", currentFilters.sort_order);

      const res = await fetch(`/api/opportunities?${params.toString()}`);
      const json = await res.json();
      if (json.success && json.data && Array.isArray(json.data.entries)) {
        renderOppList(json.data);
        renderPagination(json.data);
      } else {
        listEl.innerHTML = '<p class="placeholder">暂无机会</p>';
      }
    } catch (err) {
      console.error("[opportunities] refreshList 失败:", err);
      listEl.innerHTML = '<p class="placeholder">加载失败，请重试</p>';
    }
  }

  function renderOppList(data) {
    const listEl = document.getElementById("opp-list");
    if (!listEl) return;
    const entries = data.entries || [];
    if (entries.length === 0) {
      listEl.innerHTML = '<p class="placeholder">暂无机会，去搜索收藏一些吧</p>';
      return;
    }
    listEl.innerHTML = entries.map((entry) => renderOppItem(entry)).join("");
    bindItemActions();
  }

  function renderOppItem(entry) {
    const card = entry.card || {};
    const key = entry.dedup_key || "";
    const level = card.visible_level || "C";
    const levelClass = `level-${String(level).toLowerCase()}`;
    const title = escapeHtml(card.title || "未命名");
    const url = card.official_source_url || "#";
    const deadline = card.deadline || "未知";
    const status = card.status || "new";
    const statusLabel = STATUS_LABELS[status] || status;
    const isStarred = status === "saved";

    // 行动意图
    let actionText = "";
    if (card.action_intent) {
      const ai = card.action_intent;
      const parts = [];
      if (ai.intent) parts.push(ACTION_INTENT_LABELS(ai.intent));
      if (ai.status) parts.push(ACTION_STATUS_LABELS(ai.status));
      actionText = parts.join(" · ");
    }

    // 提醒标签
    let reminderTag = "";
    if (deadline && deadline !== "未知") {
      const days = daysUntil(deadline);
      if (days >= 0 && days <= 3) {
        reminderTag = `<span class="opp-reminder-tag reminder-urgent">⚠️ ${days}天后截止</span>`;
      } else if (days >= 0 && days <= 7) {
        reminderTag = `<span class="opp-reminder-tag reminder-soon">${days}天后截止</span>`;
      } else if (days >= 0 && days <= 14) {
        reminderTag = `<span class="opp-reminder-tag reminder-warning">${days}天后截止</span>`;
      } else if (days < 0) {
        reminderTag = `<span class="opp-reminder-tag reminder-expired">已过期</span>`;
      }
    }

    return `
      <div class="opp-item" data-key="${escapeHtml(key)}" data-level="${escapeHtml(level)}" data-status="${escapeHtml(status)}">
        <div class="opp-item-header">
          <span class="level-badge ${levelClass}">${escapeHtml(level)}</span>
          <a class="opp-title" href="${escapeHtml(url)}" target="_blank" rel="noopener">${title}</a>
          <span class="opp-deadline">截止：${escapeHtml(deadline)}</span>
          <span class="star-indicator">${isStarred ? "★" : ""}</span>
        </div>
        <div class="opp-item-meta">
          <span class="opp-status">${escapeHtml(statusLabel)}</span>
          ${actionText ? `<span class="opp-action">${escapeHtml(actionText)}</span>` : ""}
          ${reminderTag}
        </div>
        <div class="opp-item-actions">
          <a class="btn-view" href="${escapeHtml(url)}" target="_blank" rel="noopener">查看</a>
          ${isStarred ? `<button class="btn-unstar" data-key="${escapeHtml(key)}">取消收藏</button>` : ""}
          <button class="btn-delete" data-key="${escapeHtml(key)}">删除</button>
        </div>
      </div>
    `;
  }

  function bindItemActions() {
    document.querySelectorAll(".btn-unstar").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.key;
        await unstar(key);
      });
    });
    document.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.key;
        await deleteOpp(key);
      });
    });
  }

  async function unstar(key) {
    try {
      const res = await fetch(`/api/opportunities/${encodeURIComponent(key)}/star`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (json.success) {
        if (typeof window.showToast === "function") window.showToast("已取消收藏", "success");
        await loadOpportunities();
      } else {
        if (typeof window.showToast === "function") window.showToast("取消收藏失败", "error");
      }
    } catch (err) {
      console.error("[opportunities] unstar 失败:", err);
      if (typeof window.showToast === "function") window.showToast("取消收藏失败", "error");
    }
  }

  async function deleteOpp(key) {
    if (!confirm("确定删除这条机会吗？")) return;
    try {
      const res = await fetch(`/api/opportunities/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (json.success) {
        if (typeof window.showToast === "function") window.showToast("已删除", "success");
        await loadOpportunities();
      } else {
        if (typeof window.showToast === "function") window.showToast("删除失败", "error");
      }
    } catch (err) {
      console.error("[opportunities] delete 失败:", err);
      if (typeof window.showToast === "function") window.showToast("删除失败", "error");
    }
  }

  // ============================================================
  // 分页
  // ============================================================
  function renderPagination(data) {
    const pagEl = document.getElementById("opp-pagination");
    if (!pagEl) return;
    const total = data.total || 0;
    const totalPages = data.total_pages || Math.ceil(total / PAGE_SIZE) || 1;
    const page = data.page || currentPage;
    currentPage = page;
    if (totalPages <= 1) {
      pagEl.innerHTML = "";
      return;
    }
    pagEl.innerHTML = `
      <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>&lt; 上一页</button>
      <span class="page-info">第 ${page} 页 / 共 ${totalPages} 页</span>
      <button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页 &gt;</button>
    `;
    pagEl.querySelectorAll(".page-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = parseInt(btn.dataset.page, 10);
        if (!isNaN(p) && p >= 1 && p <= totalPages) {
          currentPage = p;
          refreshList();
        }
      });
    });
  }

  // ============================================================
  // 筛选/排序事件绑定
  // ============================================================
  function bindFilters() {
    const filterRadar = document.getElementById("filter-radar");
    const filterLevel = document.getElementById("filter-level");
    const filterStatus = document.getElementById("filter-status");
    const filterStarred = document.getElementById("filter-starred");
    const sortBy = document.getElementById("sort-by");
    const sortOrder = document.getElementById("sort-order");
    const btnRefresh = document.getElementById("btn-refresh-opp");

    if (filterRadar) filterRadar.addEventListener("change", () => {
      currentFilters.radar_type = filterRadar.value;
      currentPage = 1;
      refreshList();
    });
    if (filterLevel) filterLevel.addEventListener("change", () => {
      currentFilters.visible_level = filterLevel.value;
      currentPage = 1;
      refreshList();
    });
    if (filterStatus) filterStatus.addEventListener("change", () => {
      currentFilters.status = filterStatus.value;
      currentPage = 1;
      refreshList();
    });
    if (filterStarred) filterStarred.addEventListener("change", () => {
      currentFilters.starred_only = filterStarred.checked;
      currentPage = 1;
      refreshList();
    });
    if (sortBy) sortBy.addEventListener("change", () => {
      currentFilters.sort_by = sortBy.value;
      currentPage = 1;
      refreshList();
    });
    if (sortOrder) sortOrder.addEventListener("change", () => {
      currentFilters.sort_order = sortOrder.value;
      currentPage = 1;
      refreshList();
    });
    if (btnRefresh) btnRefresh.addEventListener("click", () => {
      loadOpportunities();
    });
  }

  // ============================================================
  // 工具函数
  // ============================================================
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
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

  function daysUntil(deadlineStr) {
    if (!deadlineStr) return null;
    const dl = new Date(deadlineStr);
    if (isNaN(dl.getTime())) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    dl.setHours(0, 0, 0, 0);
    return Math.round((dl.getTime() - now.getTime()) / 86400000);
  }

  function ACTION_INTENT_LABELS(intent) {
    const m = {
      intend_to_apply: "打算报名",
      considering: "考虑中",
      not_interested: "不感兴趣",
    };
    return m[intent] || intent;
  }

  function ACTION_STATUS_LABELS(status) {
    const m = {
      not_started: "未开始",
      preparing: "准备中",
      submitted: "已提交",
      abandoned: "放弃",
    };
    return m[status] || status;
  }
})();
