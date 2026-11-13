// ==UserScript==
// @name         OpenCode Subagent Navigator
// @namespace    https://github.com/WantexZard/opencode-subagent-navigator
// @version      1.5.3
// @description  Add subagent navigation links and a live session panel to the OpenCode web app.
// @author       WantexZard
// @homepageURL  https://github.com/WantexZard/opencode-subagent-navigator
// @supportURL   https://github.com/WantexZard/opencode-subagent-navigator/issues
// @updateURL    https://raw.githubusercontent.com/WantexZard/opencode-subagent-navigator/main/opencode-subagent-navigator.user.js
// @downloadURL  https://raw.githubusercontent.com/WantexZard/opencode-subagent-navigator/main/opencode-subagent-navigator.user.js
// @license      MIT
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  if (window.__ocSubagentEntry) return;
  window.__ocSubagentEntry = true;

  // ---------- 可调开关 ----------
  const SHOW_PANEL = true; // 不需要右下角列表就改成 false
  const PANEL_LIMIT = 6; // 默认窗口行数；所有符合筛选的条目均可滚动查看
  const EXPANDED_LIMIT = 12;
  const ROW_HEIGHT = 30;
  // ------------------------------

  const OPEN_ATTR = "data-oc-subagent-open";
  const PANEL_ID = "oc-subagent-panel";
  const SESSION_RE = /ses_[A-Za-z0-9]{1,128}/;
  const SESSION_ID_RE = /^ses_[A-Za-z0-9]{1,128}$/;
  const SESSION_PATH_RE = /\/session\/([^/?#]+)/;
  const COLLAPSE_KEY = "oc-subagent-panel-collapsed";

  let observer = null;
  let scanTimer = 0;
  let panelTimer = 0;
  let panelToken = 0;
  let lastHref = location.href;
  let lastPanelSignature = "";
  let expanded = false;
  let panelBusy = false;
  let panelPending = false;
  let panelSnapshot = null;
  let agents = [];
  let agentsFetchedAt = 0;
  const typeCache = new Map();
  const parentCache = new Map();
  const scopeCache = new Map();
  const requests = new Map();

  function cacheSet(cache, key, value) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
  }

  function log(...args) {
    try {
      console.debug("[oc-subagent]", ...args);
    } catch {}
  }

  function currentSessionID() {
    const match = location.pathname.match(SESSION_PATH_RE);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function isSessionID(id) {
    return typeof id === "string" && SESSION_ID_RE.test(id);
  }

  // 保留当前前缀（/:dir/session/... 或 /server/:key/session/...）和查询串，
  // 只替换/补上 session 段，清掉 hash。
  function sessionPath(pathname, id) {
    const match = pathname.match(/\/session(?:\/[^/]*)?\/?$/);
    if (match) return `${pathname.slice(0, match.index)}/session/${id}`;
    return `${pathname.replace(/\/+$/, "")}/session/${id}`;
  }

  function urlForSession(id) {
    const url = new URL(location.href);
    url.pathname = sessionPath(url.pathname, id);
    url.hash = "";
    return url.toString();
  }

  // 用真实同源 anchor 触发导航：
  // - OpenCode 的 Solid Router 在 document 上拦截同源 <a> 点击，走 SPA 路由；
  // - 没有 Router（或版本行为变化）时，浏览器默认跳转仍能工作，作为可靠降级。
  // 不直接改 history，也不使用 location.assign。
  function clickSessionLink(href) {
    const anchor = document.createElement("a");
    anchor.setAttribute("data-oc-subagent-nav", "");
    anchor.href = href;
    Object.assign(anchor.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => anchor.remove(), 0);
    return anchor;
  }

  function openSession(id) {
    if (!isSessionID(id)) return false;
    clickSessionLink(urlForSession(id));
    return true;
  }

  // ---------- 卡片按钮 ----------

  function isReviveCard(wrapper) {
    const title = wrapper.querySelector('[data-slot="basic-tool-tool-title"]');
    return !!title && /\btask_(?:revive|message)\b/.test(title.textContent || "");
  }

  function sessionIDFromCard(wrapper) {
    const args = wrapper.querySelectorAll('[data-slot="basic-tool-tool-arg"]');
    for (const arg of args) {
      const text = (arg.textContent || "").trim();
      // 只认 task_id / sessionID 这类参数，避免从 prompt 正文里误抓别的会话号
      if (!/^(task_id|sessionID|session_id|taskId)\s*=/.test(text)) continue;
      const match = text.match(SESSION_RE);
      if (match) return match[0];
    }
    return null;
  }

  function styleButton(button) {
    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      margin: "6px 0 0 0",
      padding: "3px 10px",
      font: "inherit",
      fontSize: "12px",
      lineHeight: "18px",
      color: "inherit",
      cursor: "pointer",
      textDecoration: "none",
      borderRadius: "999px",
      border: "1px solid color-mix(in srgb, currentColor 28%, transparent)",
      background: "color-mix(in srgb, currentColor 6%, transparent)",
      opacity: "0.85",
    });

    button.addEventListener("mouseenter", () => {
      button.style.opacity = "1";
    });
    button.addEventListener("mouseleave", () => {
      button.style.opacity = "0.85";
    });
  }

  function makeButton(id) {
    // 直接使用同源 anchor：左键交给 Solid Router 做 SPA 导航；
    // 中键/Ctrl/Shift/Alt 由浏览器按原生链接行为处理。
    const link = document.createElement("a");
    link.href = urlForSession(id);
    link.setAttribute(OPEN_ATTR, id);
    link.textContent = "↗ 打开子对话";
    link.title = `打开子 Agent 会话 ${id}`;
    styleButton(link);
    return link;
  }

  function showPicker(anchor, sessions) {
    const existing = document.getElementById("oc-subagent-picker");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "oc-subagent-picker";
    const rect = anchor.getBoundingClientRect();
    Object.assign(menu.style, {
      position: "fixed",
      left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`,
      top: `${Math.min(rect.bottom + 6, window.innerHeight - 240)}px`,
      zIndex: "2147483647",
      width: "280px",
      maxHeight: "220px",
      overflow: "auto",
      padding: "6px",
      borderRadius: "10px",
      background: "rgba(24, 24, 24, 0.96)",
      color: "#f2f2f2",
      border: "1px solid rgba(255, 255, 255, 0.14)",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
      font: "12px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif",
    });

    const ordered = sessions.slice().sort((a, b) => {
      const at = (a.time && (a.time.updated || a.time.created)) || 0;
      const bt = (b.time && (b.time.updated || b.time.created)) || 0;
      return bt - at;
    });

    ordered.forEach((session) => {
      const row = document.createElement("a");
      row.href = urlForSession(session.id);
      row.textContent = cleanTitle(session);
      Object.assign(row.style, {
        display: "block",
        color: "inherit",
        textDecoration: "none",
        padding: "6px 8px",
        borderRadius: "6px",
        cursor: "pointer",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      row.title = session.id;
      row.addEventListener("mouseenter", () => {
        row.style.background = "rgba(255, 255, 255, 0.1)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });
      row.addEventListener("click", () => {
        // 等点击冒泡给 Solid Router / 浏览器默认跳转后再收起菜单，
        // 避免在默认动作执行前把 anchor 移出 DOM。
        setTimeout(() => menu.remove(), 0);
      });
      menu.appendChild(row);
    });

    document.body.appendChild(menu);

    const close = (event) => {
      if (menu.contains(event.target)) return;
      menu.remove();
      document.removeEventListener("mousedown", close, true);
    };
    setTimeout(() => document.addEventListener("mousedown", close, true), 0);
  }

  function makePickerButton(alias) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(OPEN_ATTR, `pick:${alias || "unknown"}`);
    button.textContent = "↗ 选择子对话";
    button.title = alias
      ? `续接卡片里只有别名 ${alias}，点击后从本次会话的子 Agent 里选`
      : "点击后从本次会话的子 Agent 里选";
    styleButton(button);

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const id = currentSessionID();
      if (!id) return;

      const original = button.textContent;
      button.disabled = true;
      button.textContent = "读取中…";

      const children = await childrenForSession(id);
      button.disabled = false;
      button.textContent = original;

      // 异步返回时路由可能已经变了，丢弃上一个会话的结果
      if (currentSessionID() !== id) return;

      if (children.length === 0) {
        button.textContent = "没有子对话";
        setTimeout(() => {
          button.textContent = original;
        }, 1500);
        return;
      }

      if (children.length === 1) {
        openSession(children[0].id);
        return;
      }

      showPicker(button, children);
    });

    return button;
  }

  function decorate(wrapper) {
    if (!isReviveCard(wrapper)) return;
    if (wrapper.querySelector(`[${OPEN_ATTR}]`)) return;

    const id = sessionIDFromCard(wrapper);
    const button = id ? makeButton(id) : makePickerButton(null);

    const anchor =
      wrapper.querySelector(".tool-collapsible") ||
      wrapper.querySelector('[data-component="tool-trigger"]');

    if (anchor) anchor.insertAdjacentElement("afterend", button);
    else wrapper.appendChild(button);
  }

  function scan() {
    document.querySelectorAll('[data-component="tool-part-wrapper"]').forEach(decorate);
  }

  // ---------- 右下角子 Agent 列表 ----------

  function panelElement() {
    return document.getElementById(PANEL_ID);
  }

  function ensurePanel() {
    const existing = panelElement();
    if (existing) return existing;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    const style = document.createElement("style");
    style.textContent = `
      #${PANEL_ID}, #${PANEL_ID} * { resize: none !important; }
      #${PANEL_ID}, #${PANEL_ID} [data-oc-subagent-body] { overflow: hidden !important; }
      #${PANEL_ID} [data-oc-subagent-list] {
        overflow-y: auto !important; overflow-x: hidden !important;
        scrollbar-width: thin !important; scrollbar-color: #484848 transparent !important;
        scrollbar-gutter: auto !important;
      }
      #${PANEL_ID} [data-oc-subagent-list]::-webkit-scrollbar { width: 5px !important; height: 0 !important; }
      #${PANEL_ID} [data-oc-subagent-list]::-webkit-scrollbar-thumb { background: #484848 !important; border: none !important; border-radius: 8px !important; }
      #${PANEL_ID} [data-oc-subagent-list]::-webkit-scrollbar-track,
      #${PANEL_ID} [data-oc-subagent-list]::-webkit-scrollbar-corner { background: transparent !important; }
      #${PANEL_ID} [data-oc-subagent-list]::-webkit-scrollbar-button { display: none !important; }
      #${PANEL_ID} [data-oc-subagent-resize] { position: absolute; z-index: 2; touch-action: none; user-select: none; background: transparent; }
      #${PANEL_ID} [data-oc-subagent-resize]::after { content: ""; position: absolute; right: 4px; bottom: 5px; width: 5px; height: 1px; background: rgba(128,128,128,.45); transform: rotate(-45deg); opacity: 0; pointer-events: none; }
      #${PANEL_ID} [data-oc-subagent-resize]:hover::after { opacity: 1; }
    `;
    panel.appendChild(style);
    Object.assign(panel.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      width: "320px",
      boxSizing: "border-box",
      overflowX: "hidden",
      maxWidth: "calc(100vw - 16px)",
      maxHeight: "calc(100dvh - 16px)",
      padding: "10px 14px 14px 12px",
      borderRadius: "12px",
      background: "rgba(24, 24, 24, 0.92)",
      color: "#f2f2f2",
      boxShadow: "0 8px 28px rgba(0, 0, 0, 0.35)",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      font: "12px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif",
      backdropFilter: "blur(8px)",
      display: "none",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      cursor: "grab",
      touchAction: "none",
      userSelect: "none",
      marginBottom: "6px",
    });

    const title = document.createElement("span");
    title.textContent = "Subagent";
    title.style.fontWeight = "600";

    const actions = document.createElement("span");
    Object.assign(actions.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      opacity: "0.8",
    });

    const count = document.createElement("span");
    count.setAttribute("data-oc-subagent-count", "");
    count.textContent = "0";

    const more = document.createElement("button");
    more.type = "button";
    more.setAttribute("data-oc-subagent-more", "");
    Object.assign(more.style, { padding: "3px 7px", borderRadius: "6px",
      border: "1px solid #525252", color: "#e5e5e5", background: "#303030",
      font: "inherit", fontSize: "11px", cursor: "pointer", flexShrink: "0" });
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!panelSnapshot || panelSnapshot.id !== currentSessionID()) return;
      expanded = !expanded;
      // 显式切换模式恢复 6/12 行窗口，不沿用手动缩放高度；视口限制仍保留。
      panel.style.removeProperty("--oc-list-height");
      renderPanel(panelSnapshot.sessions, panelSnapshot.id, panelSnapshot.failed);
    });

    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.textContent = "–";
    collapse.title = "收起 / 展开";
    Object.assign(collapse.style, {
      background: "transparent",
      border: "none",
      color: "inherit",
      cursor: "pointer",
      font: "inherit",
      padding: "0 2px",
      opacity: "0.8",
    });

    actions.appendChild(count);
    actions.appendChild(more);
    actions.appendChild(collapse);
    header.appendChild(title);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.setAttribute("data-oc-subagent-body", "");
    body.style.minWidth = "0";
    // 纵向滚动交给浏览器；列表自身的 overscrollBehavior 限制滚动传递。

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    let stored = false;
    try { stored = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch {}
    body.style.display = stored ? "none" : "block";
    collapse.textContent = stored ? "+" : "–";
    collapse.setAttribute("aria-label", "收起或展开子 Agent 列表");
    collapse.setAttribute("aria-expanded", String(!stored));

    collapse.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = body.style.display !== "none";
      body.style.display = next ? "none" : "block";
      collapse.textContent = next ? "+" : "–";
      collapse.setAttribute("aria-expanded", String(!next));
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch {}
    });

    header.title = "拖动标题栏移动面板；拖动右下角调整大小";
    installPanelGeometry(panel, header);

    return panel;
  }

  // 两个局部 pointer 手势，不改页面滚动/导航；几何状态仅保留在当前页面。
  function installPanelGeometry(panel, header) {
    const handle = document.createElement("span");
    handle.setAttribute("data-oc-subagent-resize", "corner");
    handle.title = "拖动右下角调整面板大小";
    // 仅占用右下角预留 padding，不覆盖列表或其滚动条。
    Object.assign(handle.style, { right: "0", bottom: "0", width: "12px", height: "12px", cursor: "nwse-resize" });
    panel.appendChild(handle);
    let gesture = null;
    const clamp = () => {
      if (panel.style.display === "none") return;
      const rect = panel.getBoundingClientRect();
      const width = Math.min(rect.width, Math.max(0, window.innerWidth - 16));
      if (width !== rect.width) panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      // 始终保存 bottom；内容增减不能把定位悄悄转换为 top。
      const bottom = Math.max(8, Math.min(window.innerHeight - rect.bottom, window.innerHeight - 80));
      panel.style.bottom = `${bottom}px`;
      panel.style.right = panel.style.top = "auto";
      const list = panel.querySelector("[data-oc-subagent-list]");
      if (list && list.getBoundingClientRect().height) {
        const chrome = rect.height - list.getBoundingClientRect().height;
        panel.style.setProperty("--oc-available-list-height", `${Math.max(0, window.innerHeight - bottom - chrome - 8)}px`);
      }
    };
    for (const [target, resize] of [[header, false], [handle, true]]) {
      target.addEventListener("pointerdown", (event) => {
        if (gesture || event.button !== 0 || event.target.closest("button")) return;
        event.preventDefault();
        clamp();
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
          rect: panel.getBoundingClientRect(), resize,
          listHeight: panel.querySelector("[data-oc-subagent-list]")?.getBoundingClientRect().height || 0 };
        target.setPointerCapture(event.pointerId);
      });
      target.addEventListener("pointermove", (event) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        const { rect, x, y, resize } = gesture;
        if (resize) {
          const width = Math.max( Math.min(240, window.innerWidth - 16), rect.width + event.clientX - x);
          panel.style.width = `${Math.min(width, window.innerWidth - rect.left - 8)}px`;
          if (gesture.listHeight) {
            const chrome = rect.height - gesture.listHeight;
            const height = Math.min(Math.max(chrome + 30, rect.height + event.clientY - y), window.innerHeight - rect.top - 8);
            // 手动右下角缩放保持 top；实际高度仍受行数上限约束。
            panel.style.setProperty("--oc-available-list-height", `${Math.max(0, window.innerHeight - rect.top - chrome - 8)}px`);
            panel.style.setProperty("--oc-list-height", `${Math.max(0, height - chrome)}px`);
            panel.style.bottom = `${Math.max(8, window.innerHeight - rect.top - panel.getBoundingClientRect().height)}px`;
          }
        } else {
          panel.style.left = `${rect.left + event.clientX - x}px`;
          panel.style.bottom = `${Math.max(8, Math.min(window.innerHeight - rect.bottom - event.clientY + y, window.innerHeight - rect.height - 8))}px`;
        }
        clamp();
      });
      const end = () => { gesture = null; };
      target.addEventListener("pointerup", end);
      target.addEventListener("pointercancel", end);
      target.addEventListener("lostpointercapture", end);
    }
    window.addEventListener("resize", clamp);
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(clamp).observe(panel);
  }

  async function fetchJSON(path) {
    // 相同请求合并；路由/可见性变化可取消，超时覆盖响应体读取。
    if (requests.has(path)) return requests.get(path).promise;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const promise = (async () => { try {
      const response = await fetch(path, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const json = await response.json();
      if (Array.isArray(json)) return json;
      if (json && Array.isArray(json.data)) return json.data;
      return json;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      requests.delete(path);
    } })();
    requests.set(path, { promise, controller });
    return promise;
  }

  async function childrenForSession(id, preserveFailure = false) {
    let list = await fetchJSON(`/session/${encodeURIComponent(id)}/children`);
    if (Array.isArray(list) && list.length === 0) {
      // 当前就在子会话里：改列它的兄弟
      let parent = parentCache.get(id);
      if (parent === undefined) {
        const current = await fetchJSON(`/session/${encodeURIComponent(id)}`);
        parent = current && isSessionID(current.parentID) ? current.parentID : null;
        if (current) cacheSet(parentCache, id, parent);
      }
      if (parent) list = await fetchJSON(`/session/${encodeURIComponent(parent)}/children`);
    }
    return Array.isArray(list) ? list.filter((item) => item && isSessionID(item.id)) : preserveFailure ? null : [];
  }

  function agentName(value) {
    return typeof value === "string" && /^[\w.-][\w .-]{0,63}$/.test(value.trim()) ? value.trim() : "";
  }

  function sessionAgent(session) {
    return agentName(session.agent) || agentName((session.title || "").match(/\(@(.+?) subagent\)\s*$/i)?.[1]);
  }

  // OpenCode 1.19.5 message-part.tsx: taskAgent / tone；不提亮或替换灰色。
  const agentTones = { ask: "--icon-agent-ask-base", build: "--icon-agent-build-base",
    docs: "--icon-agent-docs-base", plan: "--icon-agent-plan-base" };
  const v2AgentTones = { build: "--v2-agent-build-solid", explore: "--v2-agent-explore-solid",
    plan: "--v2-agent-plan-solid", review: "--v2-agent-review-solid", writer: "--v2-agent-writer-solid" };
  const agentPalette = ["--icon-agent-ask-base", "--icon-agent-build-base", "--icon-agent-docs-base",
    "--icon-agent-plan-base", "--syntax-info", "--syntax-success", "--syntax-warning",
    "--syntax-property", "--syntax-constant", "--text-diff-add-base", "--text-diff-delete-base", "--icon-warning-base"];
  const agentThemes = {
    primary: ["--text-interactive-base", "--v2-text-text-accent"], secondary: ["--text-base", "--v2-text-text-muted"],
    accent: ["--icon-info-base", "--v2-icon-icon-accent"], success: ["--icon-success-base", "--v2-state-fg-success"],
    warning: ["--icon-warning-base", "--v2-state-fg-warning"], error: ["--icon-critical-base", "--v2-state-fg-danger"],
    info: ["--icon-info-base", "--v2-state-fg-info"],
  };

  function safeColor(value, element = document.body, depth = 0) {
    if (typeof value !== "string" || depth > 8) return "";
    value = value.trim();
    // Resolve variables at their actual scope; an absent variable is never a color.
    value = value.replace(/var\((--[\w-]+)\)/g, (_, variable) =>
      safeColor(getComputedStyle(element).getPropertyValue(variable), element, depth + 1));
    if (!value || /var\(|[;{}]|url\(|^(transparent|inherit|initial|unset|currentcolor|revert(?:-layer)?)$/i.test(value)) return "";
    return CSS.supports("color", value) ? value : "";
  }

  function agentAppearance(name) {
    const key = name.toLowerCase();
    const item = agents.find((entry) => entry.name === name || entry.name.toLowerCase() === key);
    // 仅规范显示名，不改变查找颜色或匹配会话所用的原始 key。
    const label = (item?.name || name || "Agent").replace(/(^|[\s._-])([a-z])/g,
      (_, separator, initial) => separator + initial.toUpperCase());
    const v2 = document.body.hasAttribute("data-new-layout");
    let color = "";
    for (const card of document.querySelectorAll('[data-component="task-tool-card"]')) {
      const title = card.querySelector('[data-component="task-tool-title"]')?.textContent?.trim().toLowerCase();
      if (!key || title !== key) continue;
      color = safeColor(getComputedStyle(card).getPropertyValue(v2 ? "--task-agent-color" : "--task-agent-legacy-color"), card);
      if (color) break;
    }
    if (!color && name) {
      let hash = 0;
      for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      const configured = item?.color;
      const variable = configured ? agentThemes[configured]?.[v2 ? 1 : 0]
        : (v2 && v2AgentTones[key]) || agentTones[key] || agentPalette[hash % agentPalette.length];
      color = safeColor(variable ? `var(${variable})` : configured);
    }
    return { label, color: color || "#a3a3a3", colorKnown: !!color };
  }

  function sessionStatus(statuses, id) {
    if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return "unknown";
    // 服务端 idle 会删除映射项；只有成功拿到映射时，缺席才代表 idle。
    if (!Object.hasOwn(statuses, id)) return "idle";
    const type = statuses[id]?.type;
    return ["busy", "retry", "idle"].includes(type) ? type : "unknown";
  }

  function sessionScope(info) {
    if (!info || typeof info.directory !== "string" || !info.directory.trim()) return null;
    if (info.workspaceID != null && (typeof info.workspaceID !== "string" || !info.workspaceID.trim())) return null;
    return { directory: info.directory, workspace: info.workspaceID || "" };
  }

  function scopedPath(path, scope) {
    // SDK v2 GET rewrite uses raw directory/workspace values in URLSearchParams.
    const query = new URLSearchParams({ directory: scope.directory });
    if (scope.workspace) query.set("workspace", scope.workspace);
    return `${path}?${query}`;
  }

  async function statusesForSessions(sessions, stale) {
    const scopes = new Map();
    const groups = new Map();
    // Only related session metadata is eligible; never infer a child's lane from
    // its parent, URL prefix, tool completion, or message/update timestamps.
    let metadataBudget = 4;
    for (const session of sessions) {
      if (stale()) return new Map();
      let scope = sessionScope(session);
      if (!scope) {
        const cached = scopeCache.get(session.id);
        if (cached && Date.now() - cached.at < 30000) scope = cached.scope;
        else if (metadataBudget > 0) {
          metadataBudget--;
          const info = await fetchJSON(`/session/${encodeURIComponent(session.id)}`);
          if (stale()) return new Map();
          scope = info?.id === session.id ? sessionScope(info) : null;
          cacheSet(scopeCache, session.id, { at: Date.now(), scope });
        }
      }
      if (!scope) continue;
      const path = scopedPath("/session/status", scope);
      scopes.set(session.id, path);
      // Bound fan-out; excess scopes remain unknown, never idle.
      if (!groups.has(path) && groups.size < 16) groups.set(path, null);
    }
    const entries = [...groups.keys()];
    for (let offset = 0; offset < entries.length; offset += 4) {
      if (stale()) return new Map();
      await Promise.all(entries.slice(offset, offset + 4).map(async (path) => {
        const value = await fetchJSON(path);
        // Error envelopes / malformed responses are not successful empty maps.
        const valid = value && typeof value === "object" && !Array.isArray(value) &&
          Object.entries(value).every(([id, status]) => isSessionID(id) &&
            status && ["busy", "retry", "idle"].includes(status.type));
        groups.set(path, valid ? value : null);
      }));
    }
    return new Map(sessions.map((session) => [session.id,
      sessionStatus(groups.get(scopes.get(session.id)), session.id)]));
  }

  function running(type) { return type === "busy" || type === "retry"; }

  function timeAgo(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
    if (seconds < 60) return "刚刚";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.round(hours / 24)} 天前`;
  }

  function cleanTitle(session) {
    const raw =
      (typeof session.title === "string" && session.title) ||
      (typeof session.agent === "string" && session.agent) ||
      session.id;
    return raw.replace(/\s*\(@[^)]+ subagent\)\s*$/, "");
  }

  function renderPanel(sessions, activeId, failed = false) {
    // 列表是异步取回的；如果期间已经切走，不要把旧会话的结果画到新路由上
    if (currentSessionID() !== activeId) return;

    const panel = ensurePanel();
    const body = panel.querySelector("[data-oc-subagent-body]");
    const count = panel.querySelector("[data-oc-subagent-count]");
    if (!body || !count) return;

    const signature = JSON.stringify({
      activeId,
      expanded, failed,
      ids: sessions.map((item) => [item.id, item.title, item.time?.updated, item.status, item.agentLabel, item.agentColor, item.agentColorKnown]),
    });
    if (signature === lastPanelSignature) return;
    lastPanelSignature = signature;

    const active = sessions.filter((session) => running(session.status));
    const visible = !expanded && active.length ? active : sessions;
    const unknown = sessions.filter((session) => session.status === "unknown").length;
    count.textContent = !expanded && active.length ? `${active.length} 运行中${unknown ? ` · ${unknown} 未知` : ""}` : `${sessions.length}${unknown ? ` · ${unknown} 未知` : ""}`;
    const more = panel.querySelector("[data-oc-subagent-more]");
    more.textContent = expanded ? "↙" : "↗";
    more.title = expanded ? "恢复自动筛选，最多显示 6 行" : `查看全部 ${sessions.length} 个会话，最多显示 12 行`;
    more.setAttribute("aria-label", more.title);
    more.setAttribute("aria-expanded", String(expanded));
    const oldList = body.querySelector("[data-oc-subagent-list]");
    const mode = expanded ? "all" : active.length ? "running" : "recent";
    const scrollTop = oldList?.getAttribute("data-mode") === mode ? oldList.scrollTop : 0;
    body.textContent = "";

    if (sessions.length === 0 && !failed) {
      panel.style.display = "none";
      return;
    }

    if (failed) {
      const notice = document.createElement("div");
      notice.textContent = "列表读取失败，等待重试";
      notice.style.color = "#fbbf24";
      body.appendChild(notice);
    }
    if (!expanded && !active.length && unknown) {
      const notice = document.createElement("div");
      notice.textContent = "部分状态未知，等待重试";
      body.appendChild(notice);
    }
    const list = document.createElement("div");
    list.setAttribute("data-oc-subagent-list", "");
    list.setAttribute("data-mode", mode);
    list.setAttribute("tabindex", "0");
    list.setAttribute("aria-label", "Subagent 会话列表，可上下滚动");
    Object.assign(list.style, { maxHeight: `min(${ROW_HEIGHT * (expanded ? EXPANDED_LIMIT : PANEL_LIMIT)}px, var(--oc-list-height, 9999px), var(--oc-available-list-height, 9999px), max(0px, calc(100dvh - 130px)))`,
      overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", minWidth: "0",
      boxSizing: "border-box" });
    body.appendChild(list);
    visible.forEach((session) => {
      const row = document.createElement("a");
      const isActive = session.id === activeId;
      const returnToParent = isActive && isSessionID(session.parentID);
      row.href = urlForSession(returnToParent ? session.parentID : session.id);
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 6px",
        margin: "0",
        height: `${ROW_HEIGHT}px`,
        boxSizing: "border-box",
        width: "100%", minWidth: "0", maxWidth: "100%",
        overflow: "hidden",
        color: "inherit",
        textDecoration: "none",
        borderRadius: "6px",
        cursor: "pointer",
        background: isActive ? "rgba(255, 255, 255, 0.12)" : "transparent",
      });
      row.addEventListener("click", (event) => {
        // 路由已经切走但面板还没刷新时，旧行不再导航
        if (currentSessionID() === activeId) return;
        event.preventDefault();
        event.stopPropagation();
        lastPanelSignature = "";
        schedulePanelRefresh(true);
      });

      const dot = document.createElement("span");
      const statusText = { busy: "运行中", retry: "重试中（任务仍在运行）", idle: "空闲", unknown: "状态未知（读取失败或响应无法识别）" }[session.status];
      dot.textContent = session.status === "unknown" ? "?" : "●";
      dot.setAttribute("data-oc-subagent-status", session.status);
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", statusText);
      dot.title = statusText;
      Object.assign(dot.style, { fontSize: "10px", flex: "0 0 10px", textAlign: "center",
        color: running(session.status) ? "#f87171" : session.status === "unknown" ? "#fbbf24" : "#737373" });
      const badge = document.createElement("span");
      badge.setAttribute("data-oc-subagent-type", "");
      badge.textContent = session.agentLabel;
      badge.title = session.agentColorKnown ? session.agentLabel : `${session.agentLabel} · 配色未知（未读取到可解析的 OpenCode 颜色）`;
      Object.assign(badge.style, { color: session.agentColor,
        background: `color-mix(in srgb, ${session.agentColor} 8%, transparent)`,
        border: "none", borderRadius: "3px", padding: "0 4px",
        fontSize: "10px", lineHeight: "16px", fontWeight: "400",
        maxWidth: "42%", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", flexShrink: "0" });

      const label = document.createElement("span");
      label.textContent = cleanTitle(session);
      Object.assign(label.style, {
        flex: "1 1 0%",
        minWidth: "0",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });

      row.appendChild(badge);
      row.appendChild(dot);
      row.appendChild(label);

      row.title = `${cleanTitle(session)} · ${statusText}\n${timeAgo(session.time?.updated)}\n${session.id}`;
      if (returnToParent) row.title += "\n再次点击返回主会话";
      row.addEventListener("mouseenter", () => {
        if (!isActive) row.style.background = "rgba(255, 255, 255, 0.08)";
      });
      row.addEventListener("mouseleave", () => {
        if (!isActive) row.style.background = "transparent";
      });

      list.appendChild(row);
    });
    list.scrollTop = scrollTop || 0;

    panel.style.display = "block";
  }

  async function refreshPanel() {
    if (!SHOW_PANEL || document.hidden) return;
    if (panelBusy) { panelPending = true; return; }

    const id = currentSessionID();
    if (!id) {
      const panel = panelElement();
      if (panel) panel.style.display = "none";
      return;
    }

    panelBusy = true;
    const token = panelToken;
    const href = location.href;
    const stale = () => token !== panelToken || location.href !== href || document.hidden;
    try {
      const sessions = await childrenForSession(id, true);
      if (stale()) return;
      const source = sessions || (panelSnapshot?.id === id ? panelSnapshot.sessions : []);
      const statuses = await statusesForSessions(source, stale);
      if (stale()) return;
      if (Date.now() - agentsFetchedAt > 300000) {
        const result = await fetchJSON("/agent");
        if (stale()) return;
        if (Array.isArray(result)) agents = result.filter((item) => item && typeof item.name === "string");
        agentsFetchedAt = Date.now();
      }
      const list = source.map((session) => ({ ...session, status: statuses.get(session.id) || "unknown" }));
      list.sort((a, b) => Number(running(b.status)) - Number(running(a.status)) ||
        ((b.time?.updated || b.time?.created || 0) - (a.time?.updated || a.time?.created || 0)));
      // 每轮最多补查两个可见项，仅取最新一条消息；缓存上限128。
      let budget = 2;
      for (const session of list.slice(0, expanded ? list.length : PANEL_LIMIT)) {
        if (sessionAgent(session)) continue;
        const cached = typeCache.get(session.id);
        if (cached && Date.now() - cached.at < (cached.name ? 300000 : 60000)) continue;
        if (!budget--) break;
        const messages = await fetchJSON(`/session/${encodeURIComponent(session.id)}/message?limit=1`);
        if (stale()) return;
        const info = Array.isArray(messages) ? messages[0]?.info : null;
        cacheSet(typeCache, session.id, { at: Date.now(), name: info?.role === "assistant" ? agentName(info.agent) : "" });
      }
      if (stale()) return;
      for (const session of list) {
        const appearance = agentAppearance(sessionAgent(session) || typeCache.get(session.id)?.name || "");
        session.agentLabel = appearance.label;
        session.agentColor = appearance.color;
        session.agentColorKnown = appearance.colorKnown;
      }
      panelSnapshot = { id, sessions: list, failed: !sessions };
      renderPanel(list, id, !sessions);
    } finally {
      panelBusy = false;
      const pending = panelPending;
      panelPending = false;
      schedulePanelRefresh(pending);
    }
  }

  function schedulePanelRefresh(force) {
    clearTimeout(panelTimer);
    if (document.hidden) return;
    panelTimer = setTimeout(() => void refreshPanel(), force ? 0 : 5000);
  }

  // ---------- 启动 ----------

  function looksLikeOpenCode() {
    if (SESSION_PATH_RE.test(location.pathname)) return true;
    if (document.title === "OpenCode") return true;
    return !!document.querySelector('[data-component="tool-part-wrapper"]');
  }

  function scanAndRefresh() {
    scan();
  }

  function scheduleScan() {
    if (document.hidden) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndRefresh, 250);
  }

  function ownNode(node) {
    for (let item = node; item; item = item.parentNode) {
      if (item.id === PANEL_ID || item.id === "oc-subagent-picker" ||
          item.hasAttribute?.(OPEN_ATTR) || item.hasAttribute?.("data-oc-subagent-nav")) return true;
    }
    return false;
  }

  function onLocationChange() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    panelToken++;
    for (const request of requests.values()) request.controller.abort();
    expanded = false;
    lastPanelSignature = "";
    const panel = panelElement();
    if (panel) panel.style.display = "none";
    const picker = document.getElementById("oc-subagent-picker");
    if (picker) picker.remove();
    scan();
    schedulePanelRefresh(true);
  }

  function start() {
    if (observer) return;
    log("started");

    observer = new MutationObserver((records) => {
      if (records.some((record) => !ownNode(record.target) &&
        [...record.addedNodes, ...record.removedNodes].some((node) => !ownNode(node)))) scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    scanAndRefresh();
    schedulePanelRefresh(true);

    // SPA 路由变化：popstate 覆盖前进/后退；Navigation API 覆盖 pushState；
    // 轮询作为没有这些 API 时的兜底。
    setInterval(() => { if (!document.hidden) onLocationChange(); }, 1200);
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("hashchange", onLocationChange);
    if (window.navigation && typeof window.navigation.addEventListener === "function") {
      try {
        window.navigation.addEventListener("navigate", () => setTimeout(onLocationChange, 0));
      } catch {}
    }

    // 兜底：虚拟列表滚动时补按钮
    setInterval(() => { if (!document.hidden) scan(); }, 5000);

    // 回到页面时刷新列表
    window.addEventListener("focus", () => schedulePanelRefresh(true));
    document.addEventListener("visibilitychange", () => {
      clearTimeout(panelTimer);
      panelToken++;
      if (document.hidden) {
        for (const request of requests.values()) request.controller.abort();
      } else {
        onLocationChange();
        schedulePanelRefresh(true);
      }
    });
  }

  const boot = setInterval(() => {
    if (!looksLikeOpenCode()) return;
    clearInterval(boot);
    start();
  }, 800);
})();
