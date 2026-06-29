/**
 * ChancePing 需求确认 Tab 逻辑
 * 来源：Task 038 第 6 节
 *
 * 职责：
 *   - 对话区：多轮对话（调用 POST /api/chat）
 *   - 确认卡：实时显示已确认/待确认信息 + 确认度
 *   - 7 维度确认度进度条
 *   - "开始搜索"按钮（确认度 ≥ 90% 时亮起）
 *   - 监听 home.js 的事件（home-submit / chat-user-message / home-chat-response 等）
 *
 * 纯 JS，无框架，无构建工具。
 */

(function () {
  "use strict";

  // ============================================================
  // 状态
  // ============================================================

  let conversationId = null;
  let radarType = "ai_competition";

  // 7 维度定义（按 weight 降序，与任务书 6.5 节一致）
  const DIMENSIONS = [
    { key: "business_goal", label: "业务目标", weight: 20 },
    { key: "opportunity_type", label: "机会类型", weight: 20 },
    { key: "client_identity", label: "客户身份", weight: 15 },
    { key: "action_scenario", label: "行动场景", weight: 15 },
    { key: "region_scope", label: "地域范围", weight: 10 },
    { key: "exclusion_rules", label: "排除规则", weight: 10 },
    { key: "report_format", label: "报告格式", weight: 10 },
  ];

  // ============================================================
  // DOM 元素引用
  // ============================================================

  function getMessagesEl() {
    return document.getElementById("chat-messages");
  }
  function getInputEl() {
    return document.getElementById("chat-input");
  }
  function getSendBtn() {
    return document.getElementById("chat-send-btn");
  }

  // ============================================================
  // 事件监听（与 home.js 联动）
  // ============================================================

  // 首页提交：重置对话状态
  window.addEventListener("home-submit", (e) => {
    conversationId = null;
    radarType = e.detail.radar_type || "ai_competition";
    // 清空对话区
    const msgEl = getMessagesEl();
    if (msgEl) msgEl.innerHTML = "";
  });

  // 用户消息（来自 home.js 的第一条消息）
  window.addEventListener("chat-user-message", (e) => {
    appendMessage("user", e.detail.message);
  });

  // typing 动画
  window.addEventListener("chat-typing-start", () => showTyping());
  window.addEventListener("chat-typing-end", () => hideTyping());

  // 首页发送的第一条消息响应
  window.addEventListener("home-chat-response", (e) => {
    const data = e.detail;
    if (data.conversation_id) conversationId = data.conversation_id;
    appendMessage("ai", data);
    updateConfirmationCard(data);
  });

  // 错误
  window.addEventListener("chat-error", (e) => {
    const msg = e.detail?.message || e.message || "请求失败";
    appendMessage("error", msg);
    showToast(msg, "error");
  });

  // ============================================================
  // 发送消息（后续多轮对话）
  // ============================================================

  async function sendMessage(message) {
    if (!message.trim()) return;

    appendMessage("user", message);
    showTyping();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          radar_type: radarType,
          conversation_id: conversationId || undefined,
        }),
      });
      const json = await res.json();
      hideTyping();

      if (json.success) {
        conversationId = json.data.conversation_id;
        appendMessage("ai", json.data);
        updateConfirmationCard(json.data);
      } else {
        appendMessage("error", json.error?.message || "请求失败");
        showToast(json.error?.message || "请求失败", "error");
      }
    } catch (err) {
      hideTyping();
      appendMessage("error", err.message);
      showToast(err.message, "error");
    }
  }

  // ============================================================
  // 对话区渲染
  // ============================================================

  function appendMessage(role, content) {
    const msgEl = getMessagesEl();
    if (!msgEl) return;

    // 清除占位符
    const placeholder = msgEl.querySelector(".placeholder");
    if (placeholder) placeholder.remove();

    const bubble = document.createElement("div");
    bubble.className = `message-bubble message-${role}`;

    if (role === "ai") {
      // AI 消息：显示 summary + 追问问题
      const data = content;
      const summary = data.summary || "(无摘要)";
      bubble.innerHTML = `<div class="message-summary">${escapeHtml(summary)}</div>`;

      // 追问问题
      if (Array.isArray(data.questions) && data.questions.length > 0) {
        const qList = document.createElement("div");
        qList.className = "message-questions";
        data.questions.forEach((q) => {
          const qBtn = document.createElement("button");
          qBtn.className = "question-chip";
          qBtn.textContent = q.question || q.field || "";
          qBtn.addEventListener("click", () => {
            const input = getInputEl();
            if (input) {
              input.value = q.question || "";
              input.focus();
            }
          });
          qList.appendChild(qBtn);
        });
        bubble.appendChild(qList);
      }

      // 当前状态
      if (data.current_status_text) {
        const status = document.createElement("div");
        status.className = "message-status";
        status.textContent = `状态：${data.current_status_text}`;
        bubble.appendChild(status);
      }
    } else if (role === "user") {
      bubble.textContent = content;
    } else if (role === "error") {
      bubble.className = "message-bubble message-error";
      bubble.textContent = "⚠ " + content;
    }

    msgEl.appendChild(bubble);
    // 滚动到底部
    msgEl.scrollTop = msgEl.scrollHeight;
  }

  function showTyping() {
    const msgEl = getMessagesEl();
    if (!msgEl) return;
    // 避免重复添加
    if (msgEl.querySelector(".typing-indicator")) return;

    const typing = document.createElement("div");
    typing.className = "message-bubble message-ai typing-indicator";
    typing.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span>`;
    msgEl.appendChild(typing);
    msgEl.scrollTop = msgEl.scrollHeight;
  }

  function hideTyping() {
    const msgEl = getMessagesEl();
    if (!msgEl) return;
    const typing = msgEl.querySelector(".typing-indicator");
    if (typing) typing.remove();
  }

  // ============================================================
  // 确认卡更新
  // ============================================================

  function updateConfirmationCard(data) {
    // 确认度总分
    const total = data.confidence?.total ?? 0;
    const confTotal = document.getElementById("conf-total");
    const confBar = document.getElementById("conf-bar-fill");
    if (confTotal) confTotal.textContent = total;
    if (confBar) {
      confBar.style.width = total + "%";
      // 进度条颜色：< 60 红色，60-79 橙色，≥ 80 绿色
      confBar.className = "confidence-bar-fill";
      if (total < 60) {
        confBar.classList.add("low");
      } else if (total < 80) {
        confBar.classList.add("mid");
      } else {
        confBar.classList.add("high");
      }
    }

    // 确认度变化
    const confDelta = document.getElementById("conf-delta");
    if (confDelta) {
      if (data.confidence_delta && data.confidence_delta.total_delta > 0) {
        confDelta.textContent = `↑ ${data.confidence_delta.total_delta}`;
        confDelta.className = "confidence-delta positive";
      } else {
        confDelta.textContent = "";
        confDelta.className = "confidence-delta";
      }
    }

    // 已确认列表
    const confirmedList = document.getElementById("confirmed-list");
    if (confirmedList) {
      const items = data.confirmed_items || [];
      confirmedList.innerHTML =
        items
          .map(
            (item) =>
              `<li class="confirmed-item"><span class="check">✓</span><span class="label">${escapeHtml(item.label || "")}</span><span class="value">${escapeHtml(item.value || "")}</span></li>`,
          )
          .join("") || '<li class="placeholder">暂无</li>';
    }

    // 待确认列表
    const uncertainList = document.getElementById("uncertain-list");
    if (uncertainList) {
      const items = data.uncertain_items || [];
      uncertainList.innerHTML =
        items
          .map(
            (item) =>
              `<li class="uncertain-item"><span class="question">?</span><span class="label">${escapeHtml(item.label || "")}</span><span class="hint">${escapeHtml(item.hint || "")}</span></li>`,
          )
          .join("") || '<li class="placeholder">暂无</li>';
    }

    // 7 维度明细
    const dimsList = document.getElementById("dimensions-list");
    if (dimsList) {
      dimsList.innerHTML = renderDimensions(data.confidence);
    }

    // 开始搜索按钮
    const searchBtn = document.getElementById("start-search-btn");
    if (searchBtn) {
      if (total >= 90) {
        searchBtn.disabled = false;
        searchBtn.classList.add("enabled");
      } else {
        searchBtn.disabled = true;
        searchBtn.classList.remove("enabled");
      }
    }
  }

  // ============================================================
  // 7 维度确认度进度条渲染
  // ============================================================

  function renderDimensions(confidence) {
    if (!confidence) return '<p class="placeholder">暂无数据</p>';

    return DIMENSIONS.map((dim) => {
      const dimData = confidence[dim.key] || {};
      const score = dimData.score ?? 0;
      return `
        <div class="dimension-item">
          <div class="dimension-header">
            <span class="dimension-label">${dim.label}</span>
            <span class="dimension-score">${score}%</span>
          </div>
          <div class="dimension-bar">
            <div class="dimension-bar-fill" style="width: ${score}%"></div>
          </div>
          <span class="dimension-weight">权重 ${dim.weight}%</span>
        </div>`;
    }).join("");
  }

  // ============================================================
  // 工具函数
  // ============================================================

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ============================================================
  // 输入区事件绑定
  // ============================================================

  document.addEventListener("DOMContentLoaded", () => {
    const sendBtn = getSendBtn();
    const input = getInputEl();

    // 发送按钮
    if (sendBtn && input) {
      sendBtn.addEventListener("click", () => {
        const message = input.value.trim();
        if (!message) return;
        input.value = "";
        sendMessage(message);
      });

      // Enter 发送（Shift+Enter 换行）
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      });
    }

    // 开始搜索按钮
    const searchBtn = document.getElementById("start-search-btn");
    if (searchBtn) {
      searchBtn.addEventListener("click", () => {
        if (searchBtn.disabled) return;
        switchTab("search");
        window.dispatchEvent(
          new CustomEvent("chat-search-start", {
            detail: { conversation_id: conversationId, radar_type: radarType },
          }),
        );
        showToast("已切换到搜索，准备开始搜索", "success");
      });
    }
  });
})();
