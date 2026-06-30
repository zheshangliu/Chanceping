/**
 * ChancePing 首页 Tab 逻辑
 * 来源：Task 038 第 5 节
 *
 * 职责：
 *   - 首页输入框 + 快捷示例
 *   - 提交后直接调用 POST /api/chat 发送第一条消息
 *   - 切换到"需求确认"Tab，并触发 home-chat-response 事件（携带响应数据）
 *   - 暴露全局 switchTab / showToast 函数供其他模块共用
 *
 * 纯 JS，无框架，无构建工具。
 */

// ============================================================
// 全局工具函数（供 home.js / requirement-chat.js / watch-rules-editor.js 共用）
// ============================================================

/**
 * 切换到指定 Tab。
 * @param {string} tabName - Tab 名称（home / chat / search / opportunities / reports / editor）
 */
function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tabName}`);
  });
  // Task 040: 派发 tab-switched 事件，供 opportunities.js / reports.js 监听加载
  window.dispatchEvent(new CustomEvent("tab-switched", { detail: { tab: tabName } }));
}

/**
 * 显示 Toast 提示。
 * @param {string} message - 提示文案
 * @param {string} [type] - 类型：success / error / warning
 */
function showToast(message, type) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type || ""}`;
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

// 暴露到全局
window.switchTab = switchTab;
window.showToast = showToast;

// ============================================================
// 首页逻辑
// ============================================================

// Task 043: 雷达类型标签映射
const RADAR_LABELS = {
  ai_competition: "AI 赛事",
  opc_policy: "政策申报",
  cultural_heritage: "文创非遗",
};

// Task 043: 当前选中的雷达类型（模块变量）
let selectedRadar = "ai_competition";

document.addEventListener("DOMContentLoaded", () => {
  // Task 041: Demo Mode 标识（URL 参数 ?demo=true 触发显示）
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("demo") === "true") {
    const badge = document.getElementById("demo-badge");
    if (badge) badge.style.display = "inline-block";
  }

  const input = document.getElementById("home-input");
  const startBtn = document.getElementById("home-start-btn");
  if (!input || !startBtn) return;

  // Task 043: 雷达选择按钮绑定
  document.querySelectorAll(".radar-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRadar = btn.dataset.radar || "ai_competition";
      document.querySelectorAll(".radar-option").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // 开始按钮：提交需求，切换到需求确认 Tab，并发送第一条消息
  startBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) {
      showToast("请输入你想盯的机会", "warning");
      return;
    }

    // 切换到需求确认 Tab
    switchTab("chat");

    // Task 043: 更新聊天区雷达标识
    const chatBadge = document.getElementById("chat-radar-badge");
    if (chatBadge) chatBadge.textContent = (RADAR_LABELS[selectedRadar] || "未知") + "雷达";

    // Task 043: 更新搜索页雷达徽章
    const searchBadge = document.getElementById("search-radar-badge");
    if (searchBadge) searchBadge.textContent = RADAR_LABELS[selectedRadar] || "未知";

    // 触发 home-submit 事件（通知 requirement-chat.js 重置状态并准备接收）
    window.dispatchEvent(
      new CustomEvent("home-submit", {
        detail: { message: text, radar_type: selectedRadar },
      }),
    );

    // 直接调用 POST /api/chat 发送第一条消息
    sendFirstMessage(text, selectedRadar);

    // 清空首页输入框
    input.value = "";
  });

  // Enter 提交（Shift+Enter 换行）
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      startBtn.click();
    }
  });

  // Task 043: 快捷示例：点击后填入输入框，同步雷达选择，并提交
  document.querySelectorAll(".example-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      input.value = btn.dataset.text || "";
      // 同步雷达选择（从 data-radar 读取）
      selectedRadar = btn.dataset.radar || "ai_competition";
      document.querySelectorAll(".radar-option").forEach((b) => {
        b.classList.toggle("active", b.dataset.radar === selectedRadar);
      });
      startBtn.click();
    });
  });
});

/**
 * 发送第一条消息到 /api/chat，并把响应通过事件传给 requirement-chat.js。
 * @param {string} message - 用户输入的需求
 * @param {string} radarType - 雷达类型
 */
async function sendFirstMessage(message, radarType) {
  // 先通知 requirement-chat.js 追加用户消息 + 显示 typing
  window.dispatchEvent(
    new CustomEvent("chat-user-message", { detail: { message } }),
  );
  window.dispatchEvent(new CustomEvent("chat-typing-start"));

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        radar_type: radarType,
      }),
    });
    const json = await res.json();

    window.dispatchEvent(new CustomEvent("chat-typing-end"));

    if (json.success) {
      // 把响应传给 requirement-chat.js 更新 UI
      window.dispatchEvent(
        new CustomEvent("home-chat-response", { detail: json.data }),
      );
    } else {
      window.dispatchEvent(
        new CustomEvent("chat-error", {
          detail: { message: json.error?.message || "请求失败" },
        }),
      );
    }
  } catch (err) {
    window.dispatchEvent(new CustomEvent("chat-typing-end"));
    window.dispatchEvent(
      new CustomEvent("chat-error", { detail: { message: err.message } }),
    );
  }
}
