/**
 * ChancePing 我的雷达 - 列表页逻辑
 * 来源：Task V1.5-04 第 3.4 节
 *
 * 职责：
 *   - 监听 tab-switched 事件（tab=radars）触发 loadRadarList()
 *   - 调用 GET /api/radars 获取雷达列表
 *   - 渲染雷达卡片（名称 + 类型徽章 + 内置角标 + 状态圆点 + Provider + 最后运行时间）
 *   - "创建雷达"按钮打开 modal（输入名称 + 选类型 + 填关键词）
 *   - 提交创建调用 POST /api/radars
 *   - 点击"详情"按钮切换到详情视图（由 radar-detail.js 接管）
 *
 * 纯 JS，无框架，无构建工具。复用全局 switchTab / showToast。
 */

(function () {
  "use strict";

  // ============================================================
  // 常量
  // ============================================================

  // 雷达类型 → 中文标签
  const RADAR_KIND_LABELS = {
    ai_competition: "AI 赛事",
    opc_policy: "OPC 政策",
    cultural_heritage: "文创非遗",
    custom: "自定义",
  };

  // 雷达状态 → 中文标签
  const RADAR_STATUS_LABELS = {
    draft: "草稿",
    active: "运行中",
    paused: "已暂停",
    archived: "已归档",
  };

  // ============================================================
  // 工具函数
  // ============================================================

  /** HTML 转义，防止注入 */
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** 格式化 ISO 时间为 MM-DD HH:mm */
  function formatTime(iso) {
    if (!iso) return "从未运行";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "从未运行";
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${mm}-${dd} ${hh}:${mi}`;
    } catch {
      return "从未运行";
    }
  }

  /** 获取 Provider 列表展示文本 */
  function getProviderText(radar) {
    const routing = radar.providerRouting;
    if (!routing) return "默认";
    const all = [...(routing.primary || []), ...(routing.fallback || [])];
    return all.length > 0 ? all.join(", ") : "默认";
  }

  // ============================================================
  // 加载雷达列表
  // ============================================================

  /**
   * 加载雷达列表（GET /api/radars）。
   * 成功后调用 renderRadarCards() 渲染。
   */
  async function loadRadarList() {
    const grid = document.getElementById("radar-cards-grid");
    if (!grid) return;
    grid.innerHTML = '<p class="placeholder">加载中...</p>';
    try {
      const res = await fetch("/api/radars");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        renderRadarCards(json.data);
      } else {
        grid.innerHTML = '<p class="placeholder">加载失败</p>';
        if (window.showToast) showToast("雷达列表加载失败", "error");
      }
    } catch (err) {
      grid.innerHTML = '<p class="placeholder">加载失败：网络错误</p>';
      if (window.showToast) showToast("雷达列表加载失败：网络错误", "error");
    }
  }

  /**
   * 渲染雷达卡片列表。
   * @param {Array} radars - Radar[]
   */
  function renderRadarCards(radars) {
    const grid = document.getElementById("radar-cards-grid");
    if (!grid) return;
    if (!radars || radars.length === 0) {
      grid.innerHTML = '<p class="placeholder">暂无雷达，点击"创建雷达"添加</p>';
      return;
    }
    grid.innerHTML = "";
    radars.forEach((radar) => {
      grid.appendChild(buildRadarCard(radar));
    });
  }

  /**
   * 构造单个雷达卡片 DOM 元素。
   * @param {Object} radar - Radar
   * @returns {HTMLElement}
   */
  function buildRadarCard(radar) {
    const card = document.createElement("div");
    card.className = "radar-card";
    card.dataset.radarId = radar.id || "";
    card.dataset.status = radar.status || "draft";

    const kindLabel = RADAR_KIND_LABELS[radar.kind] || "自定义";
    const statusLabel = RADAR_STATUS_LABELS[radar.status] || radar.status;
    const builtinTag = radar.isBuiltin
      ? '<span class="builtin-tag">内置</span>'
      : "";
    const providerText = getProviderText(radar);
    const lastRun = formatTime(radar.lastRunAt);
    const lastRunStatus = radar.lastRunStatus
      ? ` (${radar.lastRunStatus})`
      : "";

    card.innerHTML = `
      ${builtinTag}
      <div class="radar-card-header">
        <span class="radar-kind-badge kind-${escapeHtml(radar.kind || "custom")}">${escapeHtml(kindLabel)}</span>
        <span class="radar-status-dot status-${escapeHtml(radar.status || "draft")}" title="${escapeHtml(statusLabel)}"></span>
      </div>
      <h4 class="radar-name">${escapeHtml(radar.name || "未命名雷达")}</h4>
      <div class="radar-status-text">${escapeHtml(statusLabel)}</div>
      <div class="radar-providers">${escapeHtml(providerText)}</div>
      <div class="radar-last-run">最后运行：${escapeHtml(lastRun)}${escapeHtml(lastRunStatus)}</div>
      <button class="btn-detail" data-radar-id="${escapeAttr(radar.id)}">详情</button>
    `;

    // 绑定详情按钮
    const detailBtn = card.querySelector(".btn-detail");
    if (detailBtn) {
      detailBtn.addEventListener("click", () => {
        goToDetail(radar.id);
      });
    }
    return card;
  }

  /** HTML 属性转义 */
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // ============================================================
  // 创建雷达 Modal
  // ============================================================

  /**
   * 打开创建雷达对话框。
   * 动态构造 modal DOM 并 append 到 body。
   */
  function openCreateModal() {
    // 若已存在，先移除
    const existing = document.getElementById("create-radar-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.className = "create-modal";
    modal.id = "create-radar-modal";
    modal.innerHTML = `
      <div class="create-modal-backdrop"></div>
      <div class="create-modal-dialog">
        <div class="create-modal-header">
          <h3>创建雷达</h3>
          <button class="create-modal-close" title="关闭">×</button>
        </div>
        <div class="create-modal-body">
          <label class="create-field">
            <span class="create-label">雷达名称 <span class="required">*</span></span>
            <input type="text" id="create-radar-name" placeholder="例如：我的 RPA 雷达" maxlength="20" required />
          </label>
          <label class="create-field">
            <span class="create-label">雷达类型</span>
            <select id="create-radar-kind">
              <option value="ai_competition">AI 赛事</option>
              <option value="opc_policy">OPC 政策</option>
              <option value="cultural_heritage">文创非遗</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label class="create-field">
            <span class="create-label">关键词（逗号分隔）</span>
            <input type="text" id="create-radar-keywords" placeholder="例如：RPA, 自动化, 比赛" />
          </label>
          <label class="create-field">
            <span class="create-label">地域（可选）</span>
            <input type="text" id="create-radar-region" placeholder="例如：全国" />
          </label>
        </div>
        <div class="create-modal-footer">
          <button class="btn-cancel" id="create-radar-cancel">取消</button>
          <button class="btn-primary" id="create-radar-submit">创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 关闭事件
    const close = () => modal.remove();
    modal.querySelector(".create-modal-close").addEventListener("click", close);
    modal.querySelector(".create-modal-backdrop").addEventListener("click", close);
    modal.querySelector("#create-radar-cancel").addEventListener("click", close);

    // 提交事件
    modal.querySelector("#create-radar-submit").addEventListener("click", () => {
      submitCreate(modal);
    });
  }

  /**
   * 提交创建雷达（POST /api/radars）。
   * @param {HTMLElement} modal - modal DOM
   */
  async function submitCreate(modal) {
    const nameEl = modal.querySelector("#create-radar-name");
    const kindEl = modal.querySelector("#create-radar-kind");
    const keywordsEl = modal.querySelector("#create-radar-keywords");
    const regionEl = modal.querySelector("#create-radar-region");

    const name = (nameEl.value || "").trim();
    if (!name) {
      if (window.showToast) showToast("请输入雷达名称", "warning");
      nameEl.focus();
      return;
    }
    const kind = kindEl.value || "custom";
    const keywords = (keywordsEl.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const region = (regionEl.value || "").trim();

    // 构造 spec（仅填充关键字段，后端会补全默认 spec）
    const spec = {
      keyword_strategy: {
        core_keywords_zh: keywords,
        core_keywords_en: [],
      },
      region_scope: {
        primary_regions: region ? [region] : [],
        secondary_regions: [],
        excluded_regions: [],
        global_allowed: false,
        overseas_allowed: false,
      },
    };

    const submitBtn = modal.querySelector("#create-radar-submit");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "创建中...";
    }

    try {
      const res = await fetch("/api/radars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, spec }),
      });
      const json = await res.json();
      if (json.success) {
        modal.remove();
        if (window.showToast) showToast("雷达创建成功", "success");
        loadRadarList();
      } else {
        if (window.showToast) {
          const msg = json.error?.message || "创建失败";
          showToast(`创建失败：${msg}`, "error");
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "创建";
        }
      }
    } catch (err) {
      if (window.showToast) showToast("创建失败：网络错误", "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "创建";
      }
    }
  }

  // ============================================================
  // 跳转详情视图
  // ============================================================

  /**
   * 切换到雷达详情视图。
   * 隐藏列表视图，显示详情视图，并调用 radar-detail.js 的 loadRadarDetail()。
   * @param {string} radarId - 雷达 ID
   */
  function goToDetail(radarId) {
    if (!radarId) return;
    const listView = document.getElementById("radars-list-view");
    const detailView = document.getElementById("radar-detail-view");
    if (listView) listView.style.display = "none";
    if (detailView) detailView.style.display = "block";
    // 调用 radar-detail.js 暴露的全局函数
    if (typeof window.loadRadarDetail === "function") {
      window.loadRadarDetail(radarId);
    }
  }

  /**
   * 返回列表视图（供 radar-detail.js 调用）。
   */
  function backToList() {
    const listView = document.getElementById("radars-list-view");
    const detailView = document.getElementById("radar-detail-view");
    if (detailView) {
      detailView.style.display = "none";
      detailView.innerHTML = "";
    }
    if (listView) listView.style.display = "block";
    // 刷新列表以反映最新状态（如刚运行/归档）
    loadRadarList();
  }

  // ============================================================
  // 事件绑定与初始化
  // ============================================================

  // Tab 切换监听：进入"我的雷达"Tab 时加载列表
  window.addEventListener("tab-switched", (e) => {
    if (e.detail && e.detail.tab === "radars") {
      loadRadarList();
    }
  });

  // DOMContentLoaded 后绑定按钮事件
  document.addEventListener("DOMContentLoaded", () => {
    const createBtn = document.getElementById("btn-create-radar");
    if (createBtn) createBtn.addEventListener("click", openCreateModal);

    const refreshBtn = document.getElementById("btn-refresh-radars");
    if (refreshBtn) refreshBtn.addEventListener("click", loadRadarList);
  });

  // 暴露到全局（供 radar-detail.js 调用 backToList，以及 HTML 内联事件）
  window.loadRadarList = loadRadarList;
  window.renderRadarCards = renderRadarCards;
  window.openCreateModal = openCreateModal;
  window.submitCreate = submitCreate;
  window.goToDetail = goToDetail;
  window.backToList = backToList;
})();
