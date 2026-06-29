/**
 * ChancePing 我的雷达 - 详情页逻辑
 * 来源：Task V1.5-04 第 3.5 节
 *
 * 职责：
 *   - 加载雷达详情（GET /api/radars/:id）
 *   - 渲染基本信息 + Spec 摘要 + 操作按钮（激活/手动运行/编辑/归档）
 *   - 激活雷达（POST /api/radars/:id/activate）
 *   - 手动运行（POST /api/radars/:id/run），展示返回的机会卡片
 *   - 运行历史展示（从 radar.lastRunAt / lastRunStatus 推算）
 *
 * 纯 JS，无框架，无构建工具。复用全局 showToast / backToList。
 */

(function () {
  "use strict";

  // ============================================================
  // 常量
  // ============================================================

  const RADAR_KIND_LABELS = {
    ai_competition: "AI 赛事",
    opc_policy: "OPC 政策",
    cultural_heritage: "文创非遗",
    custom: "自定义",
  };

  const RADAR_STATUS_LABELS = {
    draft: "草稿",
    active: "运行中",
    paused: "已暂停",
    archived: "已归档",
  };

  // ============================================================
  // 状态
  // ============================================================

  let currentRadarId = null;
  let currentRadar = null;

  // ============================================================
  // 工具函数
  // ============================================================

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "—";
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    } catch {
      return "—";
    }
  }

  function getProviderText(radar) {
    const routing = radar.providerRouting;
    if (!routing) return "默认";
    const all = [...(routing.primary || []), ...(routing.fallback || [])];
    return all.length > 0 ? all.join(", ") : "默认";
  }

  /** 从 spec 提取关键词 */
  function getKeywords(spec) {
    if (!spec) return [];
    const zh = (spec.keyword_strategy && spec.keyword_strategy.core_keywords_zh) || [];
    const en = (spec.keyword_strategy && spec.keyword_strategy.core_keywords_en) || [];
    return [...zh, ...en];
  }

  /** 从 spec 提取地域 */
  function getRegions(spec) {
    if (!spec || !spec.region_scope) return [];
    return spec.region_scope.primary_regions || [];
  }

  /** 从 spec 提取排除规则 */
  function getExclusions(spec) {
    if (!spec || !spec.filter_rules) return [];
    return spec.filter_rules.must_exclude || [];
  }

  /** 从 spec 提取评分规则摘要 */
  function getScoringSummary(spec) {
    if (!spec || !spec.scoring_rules || !spec.scoring_rules.weights) return "默认";
    const w = spec.scoring_rules.weights;
    const parts = [];
    if (w.match_score != null) parts.push(`匹配度 ${w.match_score}%`);
    if (w.business_value != null) parts.push(`价值 ${w.business_value}%`);
    if (w.timeliness != null) parts.push(`时效 ${w.timeliness}%`);
    if (w.credibility != null) parts.push(`可信 ${w.credibility}%`);
    if (w.actionability != null) parts.push(`可执行 ${w.actionability}%`);
    return parts.length > 0 ? parts.join(", ") : "默认";
  }

  // ============================================================
  // 加载雷达详情
  // ============================================================

  /**
   * 加载雷达详情（GET /api/radars/:id）。
   * @param {string} radarId - 雷达 ID
   */
  async function loadRadarDetail(radarId) {
    if (!radarId) return;
    currentRadarId = radarId;
    const container = document.getElementById("radar-detail-view");
    if (!container) return;
    container.innerHTML = '<p class="placeholder">加载中...</p>';

    try {
      const res = await fetch(`/api/radars/${encodeURIComponent(radarId)}`);
      const json = await res.json();
      if (json.success && json.data) {
        currentRadar = json.data;
        renderRadarDetail(currentRadar);
      } else {
        const msg = json.error?.message || "加载失败";
        container.innerHTML = `<p class="placeholder">加载失败：${escapeHtml(msg)}</p>`;
        if (window.showToast) showToast(`雷达详情加载失败：${msg}`, "error");
      }
    } catch (err) {
      container.innerHTML = '<p class="placeholder">加载失败：网络错误</p>';
      if (window.showToast) showToast("雷达详情加载失败：网络错误", "error");
    }
  }

  /**
   * 渲染雷达详情页。
   * @param {Object} radar - Radar
   */
  function renderRadarDetail(radar) {
    const container = document.getElementById("radar-detail-view");
    if (!container) return;

    const kindLabel = RADAR_KIND_LABELS[radar.kind] || "自定义";
    const statusLabel = RADAR_STATUS_LABELS[radar.status] || radar.status;
    const isBuiltin = !!radar.isBuiltin;
    const isDraft = radar.status === "draft";
    const isActive = radar.status === "active";
    const isArchived = radar.status === "archived";

    const keywords = getKeywords(radar.spec);
    const regions = getRegions(radar.spec);
    const exclusions = getExclusions(radar.spec);
    const scoringText = getScoringSummary(radar.spec);
    const providerText = getProviderText(radar);
    const lastRunText = radar.lastRunAt
      ? `${formatTime(radar.lastRunAt)} (${escapeHtml(radar.lastRunStatus || "—")})`
      : "从未运行";

    container.innerHTML = `
      <div class="radar-detail-container">
        <div class="radar-detail-topbar">
          <button class="btn-back" id="radar-back-btn">← 返回列表</button>
          <h3 class="radar-detail-title">${escapeHtml(radar.name || "未命名雷达")}</h3>
        </div>

        <div class="radar-detail-summary">
          <span class="radar-kind-badge kind-${escapeHtml(radar.kind || "custom")}">${escapeHtml(kindLabel)}</span>
          ${isBuiltin ? '<span class="builtin-tag">内置</span>' : ""}
          <span class="radar-status-dot status-${escapeHtml(radar.status || "draft")}"></span>
          <span class="radar-status-text">${escapeHtml(statusLabel)}</span>
          <div class="radar-detail-actions">
            <button class="btn-primary btn-activate" id="radar-activate-btn" ${!isDraft || isBuiltin ? "disabled" : ""} title="${isBuiltin ? "内置雷达不可激活" : !isDraft ? "仅草稿状态可激活" : ""}">激活</button>
            <button class="btn-primary btn-run" id="radar-run-btn" ${!isActive ? "disabled" : ""} title="${!isActive ? "仅运行中状态可手动运行" : ""}">手动运行</button>
            <button class="btn-edit" id="radar-edit-btn" ${isBuiltin || isArchived ? "disabled" : ""} title="${isBuiltin ? "内置雷达不可编辑" : isArchived ? "已归档不可编辑" : ""}">编辑</button>
            <button class="btn-archive" id="radar-archive-btn" ${isBuiltin || isArchived ? "disabled" : ""} title="${isBuiltin ? "内置雷达不可归档" : isArchived ? "已归档" : ""}">归档</button>
          </div>
        </div>

        <div class="radar-detail-section">
          <h4>基本信息</h4>
          <div class="radar-detail-info">
            <div class="info-row"><span class="info-label">名称</span><span class="info-value">${escapeHtml(radar.name || "—")}</span></div>
            <div class="info-row"><span class="info-label">类型</span><span class="info-value">${escapeHtml(kindLabel)}</span></div>
            <div class="info-row"><span class="info-label">状态</span><span class="info-value">${escapeHtml(statusLabel)}</span></div>
            <div class="info-row"><span class="info-label">创建时间</span><span class="info-value">${escapeHtml(formatTime(radar.createdAt))}</span></div>
            <div class="info-row"><span class="info-label">最后运行</span><span class="info-value">${lastRunText}</span></div>
            <div class="info-row"><span class="info-label">Provider</span><span class="info-value">${escapeHtml(providerText)}</span></div>
          </div>
        </div>

        <div class="radar-detail-section">
          <h4>需求规格 (RadarSpec)</h4>
          <div class="radar-detail-info">
            <div class="info-row"><span class="info-label">关键词</span><span class="info-value">${keywords.length > 0 ? escapeHtml(keywords.join(", ")) : "—"}</span></div>
            <div class="info-row"><span class="info-label">地域</span><span class="info-value">${regions.length > 0 ? escapeHtml(regions.join(", ")) : "—"}</span></div>
            <div class="info-row"><span class="info-label">排除规则</span><span class="info-value">${exclusions.length > 0 ? escapeHtml(exclusions.join(", ")) : "—"}</span></div>
            <div class="info-row"><span class="info-label">评分规则</span><span class="info-value">${escapeHtml(scoringText)}</span></div>
          </div>
        </div>

        <div class="radar-detail-section radar-run-result" id="radar-run-result-section" style="display:none;">
          <h4>本次运行结果</h4>
          <div id="radar-run-result-list"></div>
        </div>

        <div class="radar-detail-section radar-run-history">
          <h4>运行历史</h4>
          <div id="radar-run-history-list">
            <p class="placeholder">${radar.lastRunAt ? `最后运行：${escapeHtml(formatTime(radar.lastRunAt))} (${escapeHtml(radar.lastRunStatus || "—")})` : "暂无运行记录"}</p>
          </div>
        </div>
      </div>
    `;

    bindDetailEvents(radar);
  }

  /** 绑定详情页按钮事件 */
  function bindDetailEvents(radar) {
    const backBtn = document.getElementById("radar-back-btn");
    if (backBtn) backBtn.addEventListener("click", () => {
      if (typeof window.backToList === "function") window.backToList();
    });

    const activateBtn = document.getElementById("radar-activate-btn");
    if (activateBtn) activateBtn.addEventListener("click", () => {
      if (!activateBtn.disabled) activateRadar(radar.id);
    });

    const runBtn = document.getElementById("radar-run-btn");
    if (runBtn) runBtn.addEventListener("click", () => {
      if (!runBtn.disabled) runRadar(radar.id);
    });

    const editBtn = document.getElementById("radar-edit-btn");
    if (editBtn) editBtn.addEventListener("click", () => {
      if (!editBtn.disabled && window.showToast) {
        showToast("编辑功能将在后续版本支持", "warning");
      }
    });

    const archiveBtn = document.getElementById("radar-archive-btn");
    if (archiveBtn) archiveBtn.addEventListener("click", () => {
      if (!archiveBtn.disabled) archiveRadar(radar.id);
    });
  }

  // ============================================================
  // 激活雷达
  // ============================================================

  /**
   * 激活雷达（POST /api/radars/:id/activate）。
   * @param {string} radarId - 雷达 ID
   */
  async function activateRadar(radarId) {
    if (!radarId) return;
    if (!confirm("确认激活此雷达？激活后可手动运行。")) return;
    try {
      const res = await fetch(`/api/radars/${encodeURIComponent(radarId)}/activate`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.success) {
        if (window.showToast) showToast("雷达已激活", "success");
        loadRadarDetail(radarId);
      } else {
        const msg = json.error?.message || "激活失败";
        if (window.showToast) showToast(`激活失败：${msg}`, "error");
      }
    } catch (err) {
      if (window.showToast) showToast("激活失败：网络错误", "error");
    }
  }

  // ============================================================
  // 手动运行
  // ============================================================

  /**
   * 手动运行雷达（POST /api/radars/:id/run）。
   * 成功后渲染返回的机会卡片。
   * @param {string} radarId - 雷达 ID
   */
  async function runRadar(radarId) {
    if (!radarId) return;
    const runBtn = document.getElementById("radar-run-btn");
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = "运行中...";
    }
    const resultSection = document.getElementById("radar-run-result-section");
    const resultList = document.getElementById("radar-run-result-list");
    if (resultSection) resultSection.style.display = "block";
    if (resultList) resultList.innerHTML = '<p class="placeholder">正在搜索机会，请稍候...</p>';

    try {
      const res = await fetch(`/api/radars/${encodeURIComponent(radarId)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const opportunities = json.data.opportunities || [];
        renderRunResult(opportunities);
        if (window.showToast) showToast(`运行完成，发现 ${opportunities.length} 个机会`, "success");
        // 刷新详情（更新 lastRunAt / lastRunStatus）
        loadRadarDetail(radarId);
      } else {
        const msg = json.error?.message || "运行失败";
        if (resultList) resultList.innerHTML = `<p class="placeholder">运行失败：${escapeHtml(msg)}</p>`;
        if (window.showToast) showToast(`运行失败：${msg}`, "error");
      }
    } catch (err) {
      if (resultList) resultList.innerHTML = '<p class="placeholder">运行失败：网络错误</p>';
      if (window.showToast) showToast("运行失败：网络错误", "error");
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = "手动运行";
      }
    }
  }

  /**
   * 渲染运行结果机会卡片（最简版，复用 search.js 的卡片样式）。
   * @param {Array} opportunities - ScoredOpportunity[]（含 radarId）
   */
  function renderRunResult(opportunities) {
    const resultList = document.getElementById("radar-run-result-list");
    if (!resultList) return;
    if (!opportunities || opportunities.length === 0) {
      resultList.innerHTML = '<p class="placeholder">本次运行未发现机会</p>';
      return;
    }
    resultList.innerHTML = "";
    opportunities.forEach((opp) => {
      resultList.appendChild(buildOppCard(opp));
    });
  }

  /**
   * 构造单个机会卡片（最简版）。
   * 复用现有 .opp-card / .level-badge / .card-title 样式。
   * @param {Object} opp - ScoredOpportunity
   * @returns {HTMLElement}
   */
  function buildOppCard(opp) {
    const card = document.createElement("div");
    card.className = "opp-card";
    const level = opp.visible_level || "C";
    const title = (opp.search_result && opp.search_result.title) || "未知机会";
    const url = (opp.search_result && opp.search_result.url) || "#";
    const source = (opp.search_result && opp.search_result.source_provider) || "未知";
    const reason = opp.relevance_reason || "";
    const score = opp.chance_score || {};
    const totalScore = score.total != null ? score.total : (opp.backend_score || 0);

    card.innerHTML = `
      <div class="card-header">
        <span class="level-badge level-${level.toLowerCase()}">${level}</span>
        <a class="card-title" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
      </div>
      <div class="card-meta">
        <span class="card-source">${escapeHtml(source)}</span>
        ${opp.radarId ? `<span class="card-radar-tag">radarId: ${escapeHtml(opp.radarId)}</span>` : ""}
      </div>
      ${reason ? `<div class="card-reason">💡 ${escapeHtml(reason)}</div>` : ""}
      <div class="card-total-score">ChanceScore: ${totalScore}分</div>
    `;
    return card;
  }

  // ============================================================
  // 归档雷达
  // ============================================================

  /**
   * 归档雷达（DELETE /api/radars/:id）。
   * @param {string} radarId - 雷达 ID
   */
  async function archiveRadar(radarId) {
    if (!radarId) return;
    if (!confirm("确认归档此雷达？归档后 3 天物理删除。")) return;
    try {
      const res = await fetch(`/api/radars/${encodeURIComponent(radarId)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (json.success) {
        if (window.showToast) showToast("雷达已归档", "success");
        if (typeof window.backToList === "function") window.backToList();
      } else {
        const msg = json.error?.message || "归档失败";
        if (window.showToast) showToast(`归档失败：${msg}`, "error");
      }
    } catch (err) {
      if (window.showToast) showToast("归档失败：网络错误", "error");
    }
  }

  // ============================================================
  // 暴露到全局
  // ============================================================

  window.loadRadarDetail = loadRadarDetail;
  window.renderRadarDetail = renderRadarDetail;
  window.activateRadar = activateRadar;
  window.runRadar = runRadar;
  window.renderRunResult = renderRunResult;
})();
