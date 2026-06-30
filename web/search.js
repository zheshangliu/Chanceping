/**
 * ChancePing 搜索结果页逻辑
 * 来源：Task 039 第五~七节
 *
 * 职责：
 *   - 监听 Task 038 的 chat-search-start 事件，触发搜索
 *   - 调用 POST /api/search 获取机会
 *   - 渲染机会卡片（等级徽章 + 标题 + 五维评分 + 匹配理由）
 *   - Star 收藏（先入库再 Star，☆ ↔ ★ 切换）
 *   - 卡片详情展开/折叠
 *   - 反馈评价（9 按钮 + 备注）+ 行动意图（意图 + 进度 + 备注 + 日期）
 *   - 调用 PATCH /api/opportunities/:key/feedback 提交反馈
 *
 * 纯 JS，无框架，无构建工具。
 */

(function () {
  "use strict";

  // ============================================================
  // 状态
  // ============================================================

  let currentResults = []; // 当前搜索结果（ScoredOpportunity[]）
  let currentSourceCandidates = []; // V1.3 新增：来源候选列表
  let currentEvidenceItems = []; // V1.3 新增：证据项列表
  let currentOpportunityCards = []; // V1.3 新增：机会卡片列表
  let currentRadarType = "ai_competition"; // 当前雷达类型
  let starredKeys = new Set(); // 已 Star 的 dedup_key
  let cardKeyMap = new Map(); // guid/url → dedup_key（已入库的映射）

  // Task 043: 雷达类型标签映射
  const RADAR_LABELS = {
    ai_competition: "AI 赛事",
    opc_policy: "政策申报",
    cultural_heritage: "文创非遗",
  };

  // Task 043: 雷达类型 → spec 映射（后端通过 spec.opportunity_scope.primary_opportunity_types 推断雷达类型）
  const RADAR_SPEC_MAP = {
    ai_competition: ["AI 比赛"],
    opc_policy: ["政策补贴"],
    cultural_heritage: ["文创非遗"],
  };

  // Task 043: 雷达名称获取
  function radarLabel(radarType) {
    return RADAR_LABELS[radarType] || "未知雷达";
  }

  // Task 043: 根据雷达类型构造搜索 spec
  function buildRadarSpec(radarType) {
    const types = RADAR_SPEC_MAP[radarType] || RADAR_SPEC_MAP.ai_competition;
    return {
      opportunity_scope: { primary_opportunity_types: types },
      keyword_strategy: { core_keywords_zh: [], core_keywords_en: [] },
      filter_rules: { must_exclude: [] },
      region_scope: { excluded_regions: [] },
    };
  }

  // Task 043: 雷达类型 → CSS 着色类名
  function radarTagClass(radarType) {
    if (radarType === "opc_policy") return "opc";
    if (radarType === "cultural_heritage") return "cultural";
    return "ai";
  }

  // 五维评分维度（固定顺序，与任务书 6.3 节一致）
  const SCORE_DIMENSIONS = [
    { key: "fit", label: "匹配度", weight: 30 },
    { key: "intent", label: "意图匹配", weight: 20 },
    { key: "evidence", label: "证据可信", weight: 20 },
    { key: "urgency", label: "紧迫度", weight: 15 },
    { key: "effort_cost", label: "行动成本", weight: 15 },
  ];

  // 反馈评价枚举（9 值，与 src/schema/feedback.ts 一致）
  const FEEDBACK_OPTIONS = [
    { value: "useful", label: "有用" },
    { value: "not_useful", label: "没用" },
    { value: "wrong_match", label: "匹配错误" },
    { value: "already_expired", label: "已过期" },
    { value: "low_value", label: "价值低" },
    { value: "too_hard", label: "太难" },
    { value: "duplicate", label: "重复" },
    { value: "no_official_link", label: "无链接" },
    { value: "bad_deadline", label: "截止问题" },
  ];

  // 行动意图枚举
  const ACTION_INTENTS = [
    { value: "intend_to_apply", label: "打算报名" },
    { value: "considering", label: "考虑中" },
    { value: "not_interested", label: "不感兴趣" },
  ];

  // 行动进度枚举
  const ACTION_STATUSES = [
    { value: "not_started", label: "未开始" },
    { value: "preparing", label: "准备中" },
    { value: "submitted", label: "已提交" },
    { value: "abandoned", label: "放弃" },
  ];

  // ============================================================
  // 事件监听
  // ============================================================

  // 监听 Task 038 的"开始搜索"事件
  window.addEventListener("chat-search-start", (e) => {
    const detail = e.detail || {};
    currentRadarType = detail.radar_type || "ai_competition";
    performSearch();
  });

  // ============================================================
  // 搜索触发
  // ============================================================

  async function performSearch() {
    showSearching();
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          radar_type: currentRadarType,
          enable_content_fetch: false,
          spec: buildRadarSpec(currentRadarType),
        }),
      });
      const json = await res.json();
      if (json.success) {
        currentResults = json.data.opportunities || [];
        // V1.3 新增：来源数据
        currentSourceCandidates = json.data.sourceCandidates || [];
        currentEvidenceItems = json.data.evidenceItems || [];
        currentOpportunityCards = json.data.opportunityCards || [];
        renderResults(currentResults);
      } else {
        showSearchError(json.error?.message || "搜索失败");
      }
    } catch (err) {
      showSearchError(err.message);
    }
  }

  // ============================================================
  // 搜索状态展示
  // ============================================================

  function showSearching() {
    const bar = document.getElementById("search-status-bar");
    const results = document.getElementById("search-results");
    // Task 043: 更新雷达徽章
    const radarBadge = document.getElementById("search-radar-badge");
    if (radarBadge) radarBadge.textContent = radarLabel(currentRadarType);
    if (bar) {
      bar.innerHTML = `<span class="radar-badge">${radarLabel(currentRadarType)}</span><span class="search-loading">⏳ 正在搜索${radarLabel(currentRadarType)}机会...</span>`;
    }
    if (results) {
      results.innerHTML = `<div class="search-spinner"></div>`;
    }
  }

  function showSearchError(message) {
    const bar = document.getElementById("search-status-bar");
    const results = document.getElementById("search-results");
    if (bar) {
      bar.innerHTML = `<span class="search-error">❌ 搜索失败：${escapeHtml(message)}</span>`;
    }
    if (results) {
      results.innerHTML = `<button class="retry-btn" id="search-retry">重试</button>`;
      const retryBtn = document.getElementById("search-retry");
      if (retryBtn) {
        retryBtn.addEventListener("click", performSearch);
      }
    }
  }

  function showSearchSuccess(data) {
    const bar = document.getElementById("search-status-bar");
    if (bar) {
      const durationSec = (data.duration_ms / 1000).toFixed(1);
      const radarName = radarLabel(currentRadarType);
      bar.innerHTML = `<span class="radar-badge">${radarName}</span><span class="search-success">✅ ${radarName}：找到 ${data.opportunities.length} 条机会（原始 ${data.total_raw} → 粗筛 ${data.total_rule_passed} → 精筛 ${data.total_ai_passed}）耗时 ${durationSec}s</span>`;
    }
  }

  function showNoResults() {
    const bar = document.getElementById("search-status-bar");
    const results = document.getElementById("search-results");
    if (bar) {
      bar.innerHTML = `<span class="search-empty">未找到匹配的机会，试试调整搜索条件</span>`;
    }
    if (results) {
      results.innerHTML = "";
    }
  }

  // ============================================================
  // 渲染搜索结果
  // ============================================================

  function renderResults(opportunities) {
    const resultsEl = document.getElementById("search-results");
    if (!resultsEl) return;

    // hidden 等级不展示
    const visible = opportunities.filter((o) => o.visible_level !== "hidden");

    if (visible.length === 0) {
      showNoResults();
      return;
    }

    showSearchSuccess({
      opportunities: visible,
      total_raw: opportunities.length,
      total_rule_passed: visible.length,
      total_ai_passed: visible.length,
      duration_ms: 0,
    });

    resultsEl.innerHTML = "";
    visible.forEach((opp) => {
      // V1.3 新增：查找原始索引以匹配 opportunityCards 数据
      const originalIndex = opportunities.indexOf(opp);
      const cardEl = renderCard(opp, originalIndex);
      resultsEl.appendChild(cardEl);
    });
  }

  // ============================================================
  // 渲染单张卡片
  // ============================================================

  function renderCard(opp, index) {
    const card = document.createElement("div");
    card.className = "opp-card";
    card.dataset.level = opp.visible_level || "C";
    card.dataset.expanded = "false";
    card.dataset.guid = opp.guid || opp.search_result?.url || "";

    const level = opp.visible_level || "C";
    const title = opp.search_result?.title || "未知机会";
    const url = opp.search_result?.url || "#";
    const source = opp.search_result?.source_provider || "未知";
    const reason = opp.relevance_reason || "";
    const score = opp.chance_score || {};
    const totalScore = score.total ?? opp.backend_score ?? 0;

    // V1.3 新增：来源徽章（优先使用 opportunityCards 数据）
    const cardData = currentOpportunityCards[index] || {};
    const sourceBadges = cardData.sourceBadges || [];
    const decision = cardData.decision || "";
    const badgesHtml = sourceBadges.length > 0
      ? sourceBadges.map((b) => `<span class="source-badge">${escapeHtml(b)}</span>`).join("")
      : "";
    const decisionHtml = decision ? `<span class="decision-badge decision-${decision}">${decision === "attack" ? "立即行动" : decision === "hold" ? "观望" : "归档"}</span>` : "";

    card.innerHTML = `
      <div class="card-header">
        <span class="level-badge level-${level.toLowerCase()}">${escapeHtml(String(level))}</span>
        <a class="card-title" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
        <button class="star-btn" data-key="${escapeAttr(card.dataset.guid)}">${isStarred(card.dataset.guid) ? "★" : "☆"}</button>
        <button class="expand-btn">▼</button>
      </div>
      <div class="card-meta">
        <span class="card-radar-tag radar-${radarTagClass(currentRadarType)}">${radarLabel(currentRadarType)}</span>
        <span class="card-source">${escapeHtml(source)}</span>
        ${badgesHtml ? `<span class="source-badges">${badgesHtml}</span>` : ""}
        ${decisionHtml}
      </div>
      ${reason ? `<div class="card-reason">💡 ${escapeHtml(reason)}</div>` : ""}
      <div class="card-total-score">ChanceScore: ${escapeHtml(String(totalScore))}分</div>
      <div class="card-scores">
        ${SCORE_DIMENSIONS.map((dim) => {
          const val = score[dim.key] ?? 0;
          const colorClass = val >= 80 ? "high" : val >= 60 ? "mid" : "low";
          return `
            <div class="score-item">
              <span class="score-label">${dim.label}</span>
              <div class="score-bar"><div class="score-bar-fill ${colorClass}" style="width:${escapeHtml(String(val))}%"></div></div>
              <span class="score-value">${escapeHtml(String(val))}</span>
            </div>`;
        }).join("")}
      </div>
      <div class="card-detail" style="display:none;">
        ${renderCardDetail(opp, index)}
      </div>
    `;

    // 绑定事件
    bindCardEvents(card, opp);

    return card;
  }

  function renderCardDetail(opp, index) {
    const url = opp.search_result?.url || "";
    const cleaned = opp.cleaned_content || {};
    const mainText = cleaned.main_text || "";

    // V1.3 新增：来源列表（从 currentSourceCandidates 中查找匹配的来源）
    const oppUrl = opp.search_result?.url || "";
    const sources = currentSourceCandidates.filter((s) => s.url === oppUrl);
    const sourcesHtml = sources.length > 0
      ? sources.map((s) => `
        <div class="detail-source">
          <span class="source-type-badge source-${escapeAttr(s.sourceType || "unknown")}">${escapeHtml(s.mediaName || s.sourceType || "未知")}</span>
          <span class="source-grade">${escapeHtml(s.confidenceGrade || "")}</span>
          <a href="${escapeAttr(s.url)}" target="_blank" rel="noopener">查看来源</a>
        </div>
      `).join("")
      : '<div class="detail-source-placeholder">暂无来源信息</div>';

    // V1.3 新增：推荐行动（从 opportunityCards 中获取）
    const cardData = currentOpportunityCards[index] || {};
    const recommendedActions = cardData.recommendedActions || [];
    const actionsHtml = recommendedActions.length > 0
      ? recommendedActions.map((a) => `<li>${escapeHtml(a)}</li>`).join("")
      : "";

    return `
      <div class="detail-row"><span>官方链接</span><a href="${escapeAttr(url)}" target="_blank" rel="noopener">查看</a></div>
      <div class="detail-row"><span>主办方</span>${escapeHtml(cleaned.author || opp.search_result?.source_provider || "未知")}</div>
      <div class="detail-row"><span>截止日期</span>${escapeHtml(extractDeadline(mainText) || "未知")}</div>
      <div class="detail-row"><span>地区</span>${escapeHtml(extractRegion(mainText) || "未知")}</div>
      <div class="detail-row"><span>奖励</span>${escapeHtml(extractReward(mainText) || "未知")}</div>
      <div class="detail-row"><span>适合对象</span>${escapeHtml(extractEligibility(mainText) || "未知")}</div>
      <div class="detail-sources">
        <h5>来源信息</h5>
        ${sourcesHtml}
      </div>
      ${actionsHtml ? `<div class="detail-actions"><h5>推荐行动</h5><ul>${actionsHtml}</ul></div>` : ""}
      <div class="feedback-section">
        <h5>反馈评价</h5>
        <div class="feedback-buttons">
          ${FEEDBACK_OPTIONS.map((f) => `<button class="feedback-btn" data-feedback="${f.value}">${f.label}</button>`).join("")}
        </div>
        <input class="feedback-note" placeholder="反馈备注（可选）" />
      </div>
      <div class="action-section">
        <h5>行动意图</h5>
        <div class="action-row">
          <select class="action-intent">
            <option value="">选择意图</option>
            ${ACTION_INTENTS.map((a) => `<option value="${a.value}">${a.label}</option>`).join("")}
          </select>
          <select class="action-status">
            ${ACTION_STATUSES.map((a) => `<option value="${a.value}">${a.label}</option>`).join("")}
          </select>
        </div>
        <input class="action-note" placeholder="行动备注（可选）" />
        <label class="action-date-label">下次行动：<input class="action-date" type="date" /></label>
      </div>
    `;
  }

  // ============================================================
  // 卡片事件绑定
  // ============================================================

  function bindCardEvents(cardEl, opp) {
    // Star 按钮
    const starBtn = cardEl.querySelector(".star-btn");
    if (starBtn) {
      starBtn.addEventListener("click", () => toggleStar(opp, starBtn));
    }

    // 展开/折叠按钮
    const expandBtn = cardEl.querySelector(".expand-btn");
    if (expandBtn) {
      expandBtn.addEventListener("click", () => toggleExpand(cardEl));
    }

    // 标题点击也展开
    const titleLink = cardEl.querySelector(".card-title");
    if (titleLink) {
      titleLink.addEventListener("click", (e) => {
        // 不拦截链接跳转，但展开详情
        toggleExpand(cardEl);
      });
    }

    // 反馈按钮
    const feedbackBtns = cardEl.querySelectorAll(".feedback-btn");
    feedbackBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        // 高亮选中
        feedbackBtns.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        // 提交反馈
        const note = cardEl.querySelector(".feedback-note")?.value || "";
        submitFeedback(opp, { evaluation: btn.dataset.feedback, note }, null, cardEl);
      });
    });

    // 行动意图变更
    const intentSelect = cardEl.querySelector(".action-intent");
    const statusSelect = cardEl.querySelector(".action-status");
    const noteInput = cardEl.querySelector(".action-note");
    const dateInput = cardEl.querySelector(".action-date");

    const submitAction = () => {
      const intent = intentSelect?.value || "";
      const status = statusSelect?.value || "not_started";
      const note = noteInput?.value || "";
      const nextDate = dateInput?.value || "";
      if (!intent) return;
      submitFeedback(opp, null, { intent, status, note, next_action_date: nextDate }, cardEl);
    };

    if (intentSelect) intentSelect.addEventListener("change", submitAction);
    if (statusSelect) statusSelect.addEventListener("change", submitAction);
  }

  // ============================================================
  // 卡片展开/折叠
  // ============================================================

  function toggleExpand(cardEl) {
    const detail = cardEl.querySelector(".card-detail");
    const btn = cardEl.querySelector(".expand-btn");
    if (!detail || !btn) return;

    const isExpanded = cardEl.dataset.expanded === "true";
    if (isExpanded) {
      detail.style.display = "none";
      btn.textContent = "▼";
      cardEl.dataset.expanded = "false";
    } else {
      detail.style.display = "block";
      btn.textContent = "▲";
      cardEl.dataset.expanded = "true";
    }
  }

  // ============================================================
  // Star 收藏
  // ============================================================

  async function toggleStar(opp, btn) {
    const guid = opp.guid || opp.search_result?.url || "";
    const existingKey = cardKeyMap.get(guid);

    if (isStarred(guid)) {
      // 已 Star，取消
      if (!existingKey) return;
      try {
        const res = await fetch(`/api/opportunities/${existingKey}/star`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (json.success) {
          starredKeys.delete(existingKey);
          cardKeyMap.delete(guid);
          btn.textContent = "☆";
          showToast("已取消收藏", "success");
        }
      } catch (err) {
        showToast("取消收藏失败: " + err.message, "error");
      }
    } else {
      // 未 Star，先入库再收藏
      try {
        let dedupKey = existingKey;
        if (!dedupKey) {
          // 先入库
          const card = toCard(opp, currentRadarType);
          const addRes = await fetch("/api/opportunities", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ card, radar_type: currentRadarType }),
          });
          const addJson = await addRes.json();
          if (!addJson.success) {
            showToast("入库失败: " + (addJson.error?.message || ""), "error");
            return;
          }
          dedupKey = addJson.data.dedup_key;
          cardKeyMap.set(guid, dedupKey);
        }

        // 收藏
        const starRes = await fetch(`/api/opportunities/${dedupKey}/star`, {
          method: "POST",
        });
        const starJson = await starRes.json();
        if (starJson.success) {
          starredKeys.add(dedupKey);
          btn.textContent = "★";
          showToast("已收藏", "success");
        } else {
          showToast("收藏失败: " + (starJson.error?.message || ""), "error");
        }
      } catch (err) {
        showToast("收藏失败: " + err.message, "error");
      }
    }
  }

  // ============================================================
  // 提交反馈
  // ============================================================

  async function submitFeedback(opp, feedback, actionIntent, cardEl) {
    const guid = opp.guid || opp.search_result?.url || "";
    let dedupKey = cardKeyMap.get(guid);

    // 未入库则先入库
    if (!dedupKey) {
      try {
        const card = toCard(opp, currentRadarType);
        const addRes = await fetch("/api/opportunities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card, radar_type: currentRadarType }),
        });
        const addJson = await addRes.json();
        if (!addJson.success) {
          showToast("入库失败: " + (addJson.error?.message || ""), "error");
          return;
        }
        dedupKey = addJson.data.dedup_key;
        cardKeyMap.set(guid, dedupKey);
      } catch (err) {
        showToast("入库失败: " + err.message, "error");
        return;
      }
    }

    // 调用 PATCH /feedback
    const body = {};
    if (feedback) {
      body.feedback = { evaluation: feedback.evaluation, note: feedback.note };
    }
    if (actionIntent) {
      body.action_intent = {
        intent: actionIntent.intent,
        status: actionIntent.status,
        note: actionIntent.note,
        next_action_date: actionIntent.next_action_date,
      };
    }

    try {
      const res = await fetch(`/api/opportunities/${dedupKey}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        showToast(feedback ? "反馈已提交" : "行动意图已更新", "success");
      } else {
        showToast("提交失败: " + (json.error?.message || ""), "error");
      }
    } catch (err) {
      showToast("提交失败: " + err.message, "error");
    }
  }

  // ============================================================
  // ScoredOpportunity → OpportunityCard 映射
  // ============================================================

  function toCard(opp, radarType) {
    const typeMap = {
      ai_competition: "AI 赛事",
      opc_policy: "政策申报",
      cultural_heritage: "文创非遗",
    };
    const cleaned = opp.cleaned_content || {};
    const mainText = cleaned.main_text || "";
    return {
      title: opp.search_result?.title || "未知",
      type: typeMap[radarType] || "未知",
      organizer: cleaned.author || opp.search_result?.source_provider || "未知",
      official_source_url: opp.search_result?.url || "",
      deadline: extractDeadline(mainText) || "未知",
      visible_level: opp.visible_level || "C",
      region: extractRegion(mainText) || "未知",
      reward_or_value: extractReward(mainText) || "未知",
      eligibility: extractEligibility(mainText) || "未知",
      materials_required: "未知",
      match_reason: opp.relevance_reason || "",
      next_action: "查看详情",
      application_url: "",
      contact_info: "",
      risk_note: "",
      backend_score: opp.backend_score || 0,
      status: "new",
      guid: opp.search_result?.guid || opp.guid || undefined,
    };
  }

  // ============================================================
  // 正则提取辅助函数
  // ============================================================

  function extractDeadline(text) {
    if (!text) return "";
    // 匹配 YYYY-MM-DD 或 YYYY年MM月DD日
    const m = text.match(/(\d{4}[-/年]\d{1,2}[-/月]\d{1,2})/);
    return m ? m[1].replace(/年/g, "-").replace(/月/g, "-").replace(/\//g, "-") : "";
  }

  function extractRegion(text) {
    if (!text) return "";
    const regions = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安", "南京", "全国", "线上"];
    for (const r of regions) {
      if (text.includes(r)) return r;
    }
    return "";
  }

  function extractReward(text) {
    if (!text) return "";
    // 匹配 奖金 X 万 / 奖金 X 元
    const m = text.match(/奖金\s*(\d+(?:\.\d+)?)\s*(万|元)/);
    if (m) return "奖金 " + m[1] + m[2];
    return "";
  }

  function extractEligibility(text) {
    if (!text) return "";
    const targets = ["个人", "团队", "公司", "机构", "学生", "开发者", "创业者"];
    const found = targets.filter((t) => text.includes(t));
    return found.length > 0 ? found.join("/") : "";
  }

  // ============================================================
  // 工具函数
  // ============================================================

  function isStarred(guid) {
    const key = cardKeyMap.get(guid);
    return key && starredKeys.has(key);
  }

  function radarTypeLabel() {
    const map = {
      ai_competition: "AI 赛事",
      opc_policy: "政策申报",
      cultural_heritage: "文创非遗",
    };
    return map[currentRadarType] || "机会";
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }
})();
