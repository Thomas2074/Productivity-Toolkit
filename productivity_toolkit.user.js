// ==UserScript==
// @name         Productivity Toolkit
// @namespace    local.productivity-toolkit
// @version      0.2.8
// @description  Local-first browser productivity suite with notes, snippets, focus blocking, timer, reports, highlights, shortcuts, site rules, and backup/restore.
// @author       Productivity Toolkit
// Author GitHub: https://github.com/Thomas2074
// Author LinkedIn: https://www.linkedin.com/in/thomas-crutchfield-780957192/
// @match        http://*/*
// @match        https://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  if (window.__PRODUCTIVITY_TOOLKIT_BOOTED__) {
    return;
  }
  window.__PRODUCTIVITY_TOOLKIT_BOOTED__ = true;

  try {
    if (window.top !== window.self) {
      return;
    }
  } catch (error) {
    return;
  }

  const APP = {
    version: "0.2.8",
    storageKey: "productivity_toolkit_state_v1",
    styleId: "ptk-style",
    rootId: "ptk-root",
    disabledId: "ptk-disabled-launcher",
    focusOverlayId: "ptk-focus-overlay",
    highlightClass: "ptk-highlight",
    maxHighlights: 500,
    maxHighlightTextNodes: 12000
  };

  const FEATURE_LABELS = {
    textExpander: "Text Expander",
    quickNotes: "Quick Notes",
    focusLock: "FocusLock",
    pomodoro: "Pomodoro",
    timeTracker: "Time Tracker",
    highlights: "Highlights",
    shortcuts: "Keyboard Shortcuts"
  };

  const DEFAULT_SHORTCUTS = {
    togglePanel: "Alt+Shift+P",
    openNotes: "Alt+Shift+N",
    highlightSelection: "Alt+Shift+H",
    clearHighlights: "Alt+Shift+C",
    toggleFocus: "Alt+Shift+F"
  };

  const SHORTCUT_LABELS = {
    togglePanel: "Open or close panel",
    openNotes: "Open notes",
    highlightSelection: "Highlight selected text",
    clearHighlights: "Clear highlights",
    toggleFocus: "Start or end focus"
  };

  const DEFAULT_BLOCKLIST = [
    "youtube.com",
    "tiktok.com",
    "instagram.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "reddit.com"
  ];

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const TEXT_EXPANDER_KEYS = new Set([" ", "Enter", "Tab", ".", ",", "!", "?", ";", ":", ")", "]", "}"]);
  const SITE_RULE_FEATURES = Object.keys(FEATURE_LABELS);

  let state = normalizeState(readStoredState());
  let root = null;
  let panel = null;
  let edgeTab = null;
  let toolkitStarted = false;
  let listenersBound = false;
  let pomodoroInterval = null;
  let timeTrackerInterval = null;
  let focusInterval = null;
  let scheduleInterval = null;
  let shortcutCaptureAction = null;
  let currentDomain = getCurrentDomain();
  let lastTrackedAt = Date.now();
  let lastTimeSaveAt = Date.now();
  let dragState = null;
  let pendingSaveTimer = null;

  function createDefaultState() {
    return {
      appVersion: APP.version,
      ui: {
        open: false,
        activeTab: "notes",
        position: null,
        theme: "light"
      },
      snippets: [
        {
          id: "default-brb",
          shortcut: "brb",
          expansion: "Be right back.",
          category: "General",
          enabled: true
        },
        {
          id: "default-ty",
          shortcut: "ty",
          expansion: "Thank you, I appreciate it.",
          category: "General",
          enabled: true
        },
        {
          id: "default-sig",
          shortcut: "sig",
          expansion: "Best regards,\nYour Name",
          category: "General",
          enabled: true
        }
      ],
      snippetCategories: ["General"],
      snippetFilter: "all",
      notes: "",
      focus: {
        activeUntil: 0,
        activeSource: "manual",
        activeScheduleEnd: 0,
        schedulePausedUntil: 0,
        blocklist: DEFAULT_BLOCKLIST.slice(),
        schedules: []
      },
      pomodoro: {
        running: false,
        mode: "work",
        endsAt: 0,
        remainingMs: 25 * 60 * 1000,
        workMinutes: 25,
        breakMinutes: 5,
        sessionsCompleted: 0
      },
      timeLogs: {},
      shortcuts: Object.assign({}, DEFAULT_SHORTCUTS),
      siteRules: {}
    };
  }

  function normalizeState(raw) {
    const defaults = createDefaultState();
    if (!isPlainObject(raw)) {
      return defaults;
    }

    const next = defaults;

    if (isPlainObject(raw.ui)) {
      next.ui.open = Boolean(raw.ui.open);
      next.ui.activeTab = typeof raw.ui.activeTab === "string" ? raw.ui.activeTab : defaults.ui.activeTab;
      next.ui.theme = raw.ui.theme === "dark" ? "dark" : "light";
      if (isPlainObject(raw.ui.position) && Number.isFinite(raw.ui.position.left) && Number.isFinite(raw.ui.position.top)) {
        next.ui.position = {
          left: clamp(raw.ui.position.left, 0, Math.max(0, window.innerWidth - 80)),
          top: clamp(raw.ui.position.top, 0, Math.max(0, window.innerHeight - 40))
        };
      }
    }

    if (Array.isArray(raw.snippets)) {
      const snippets = raw.snippets
        .map((snippet) => ({
          id: stringOr(snippet && snippet.id, createId("snippet")),
          shortcut: stringOr(snippet && snippet.shortcut, "").trim(),
          expansion: stringOr(snippet && snippet.expansion, ""),
          category: stringOr(snippet && snippet.category, "General").trim() || "General",
          enabled: snippet && snippet.enabled !== false
        }))
        .filter((snippet) => snippet.shortcut && snippet.expansion);
      if (snippets.length) {
        next.snippets = snippets;
      }
    }

    if (Array.isArray(raw.snippetCategories)) {
      next.snippetCategories = uniqueStrings(raw.snippetCategories.concat(next.snippets.map((snippet) => snippet.category)));
    } else {
      next.snippetCategories = uniqueStrings(next.snippets.map((snippet) => snippet.category).concat(defaults.snippetCategories));
    }
    next.snippetFilter = typeof raw.snippetFilter === "string" ? raw.snippetFilter : defaults.snippetFilter;
    if (next.snippetFilter !== "all" && !next.snippetCategories.includes(next.snippetFilter)) {
      next.snippetFilter = "all";
    }

    next.notes = typeof raw.notes === "string" ? raw.notes : defaults.notes;

    if (isPlainObject(raw.focus)) {
      next.focus.activeUntil = positiveNumber(raw.focus.activeUntil, 0);
      next.focus.activeSource = raw.focus.activeSource === "schedule" ? "schedule" : "manual";
      next.focus.activeScheduleEnd = positiveNumber(raw.focus.activeScheduleEnd, 0);
      next.focus.schedulePausedUntil = positiveNumber(raw.focus.schedulePausedUntil, 0);
      if (Array.isArray(raw.focus.blocklist)) {
        const blocklist = uniqueStrings(raw.focus.blocklist.map(normalizeDomain).filter(Boolean));
        next.focus.blocklist = blocklist.length ? blocklist : DEFAULT_BLOCKLIST.slice();
      }
      if (Array.isArray(raw.focus.schedules)) {
        next.focus.schedules = raw.focus.schedules.map(normalizeSchedule).filter(Boolean);
      }
    }

    if (isPlainObject(raw.pomodoro)) {
      next.pomodoro.running = Boolean(raw.pomodoro.running && raw.pomodoro.endsAt > Date.now());
      next.pomodoro.mode = raw.pomodoro.mode === "break" ? "break" : "work";
      next.pomodoro.endsAt = positiveNumber(raw.pomodoro.endsAt, 0);
      next.pomodoro.workMinutes = clamp(positiveNumber(raw.pomodoro.workMinutes, defaults.pomodoro.workMinutes), 1, 180);
      next.pomodoro.breakMinutes = clamp(positiveNumber(raw.pomodoro.breakMinutes, defaults.pomodoro.breakMinutes), 1, 120);
      next.pomodoro.remainingMs = clamp(positiveNumber(raw.pomodoro.remainingMs, defaults.pomodoro.remainingMs), 1000, 12 * 60 * 60 * 1000);
      next.pomodoro.sessionsCompleted = Math.floor(positiveNumber(raw.pomodoro.sessionsCompleted, 0));
    }

    if (isPlainObject(raw.timeLogs)) {
      next.timeLogs = normalizeTimeLogs(raw.timeLogs);
    }

    if (isPlainObject(raw.shortcuts)) {
      next.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS);
      Object.keys(DEFAULT_SHORTCUTS).forEach((action) => {
        const combo = normalizeComboString(raw.shortcuts[action]);
        if (combo) {
          next.shortcuts[action] = combo;
        }
      });
    }

    if (isPlainObject(raw.siteRules)) {
      next.siteRules = normalizeSiteRules(raw.siteRules);
    }

    next.appVersion = APP.version;
    return next;
  }

  function normalizeSchedule(schedule) {
    if (!isPlainObject(schedule)) {
      return null;
    }
    const days = Array.isArray(schedule.days)
      ? uniqueNumbers(schedule.days.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6))
      : [];
    const start = isTimeString(schedule.start) ? schedule.start : "";
    const end = isTimeString(schedule.end) ? schedule.end : "";
    if (!days.length || !start || !end) {
      return null;
    }
    return {
      id: stringOr(schedule.id, createId("schedule")),
      name: stringOr(schedule.name, "Focus window").trim() || "Focus window",
      days,
      start,
      end,
      enabled: schedule.enabled !== false
    };
  }

  function normalizeTimeLogs(logs) {
    const next = {};
    Object.keys(logs).forEach((dateKey) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !isPlainObject(logs[dateKey])) {
        return;
      }
      const day = {};
      Object.keys(logs[dateKey]).forEach((domain) => {
        const cleanDomain = normalizeDomain(domain);
        const seconds = Math.floor(positiveNumber(logs[dateKey][domain], 0));
        if (cleanDomain && seconds > 0) {
          day[cleanDomain] = seconds;
        }
      });
      if (Object.keys(day).length) {
        next[dateKey] = day;
      }
    });
    return next;
  }

  function normalizeSiteRules(rules) {
    const next = {};
    Object.keys(rules).forEach((domain) => {
      const cleanDomain = normalizeDomain(domain);
      const rule = rules[domain];
      if (!cleanDomain || !isPlainObject(rule)) {
        return;
      }
      const disabledFeatures = {};
      if (isPlainObject(rule.disabledFeatures)) {
        SITE_RULE_FEATURES.forEach((feature) => {
          if (rule.disabledFeatures[feature]) {
            disabledFeatures[feature] = true;
          }
        });
      }
      next[cleanDomain] = {
        toolkitDisabled: Boolean(rule.toolkitDisabled),
        disabledFeatures
      };
    });
    return next;
  }

  function readStoredState() {
    const fallback = null;
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(APP.storageKey, fallback);
      }
    } catch (error) {
      console.warn("Productivity Toolkit: GM_getValue failed", error);
    }
    try {
      const raw = window.localStorage && window.localStorage.getItem(APP.storageKey);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn("Productivity Toolkit: localStorage read failed", error);
      return fallback;
    }
  }

  function saveState() {
    if (pendingSaveTimer) {
      window.clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    state.appVersion = APP.version;
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(APP.storageKey, state);
        return;
      }
    } catch (error) {
      console.warn("Productivity Toolkit: GM_setValue failed", error);
    }
    try {
      if (window.localStorage) {
        window.localStorage.setItem(APP.storageKey, JSON.stringify(state));
      }
    } catch (error) {
      console.warn("Productivity Toolkit: localStorage write failed", error);
    }
  }

  function saveStateSoon() {
    if (pendingSaveTimer) {
      window.clearTimeout(pendingSaveTimer);
    }
    pendingSaveTimer = window.setTimeout(() => {
      pendingSaveTimer = null;
      saveState();
    }, 350);
  }

  function bootWhenReady() {
    if (!document.documentElement) {
      return;
    }
    if (!document.body) {
      window.setTimeout(bootWhenReady, 50);
      return;
    }
    addStyles();
    bindGlobalListeners();
    currentDomain = getCurrentDomain();

    if (isToolkitDisabledForCurrentDomain()) {
      createDisabledLauncher();
      return;
    }

    startToolkit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootWhenReady, { once: true });
  } else {
    bootWhenReady();
  }

  function startToolkit() {
    if (toolkitStarted || isToolkitDisabledForCurrentDomain()) {
      return;
    }
    if (!createRoot()) {
      window.setTimeout(startToolkit, 50);
      return;
    }
    toolkitStarted = true;
    applyPanelPosition();
    renderPanel();
    startIntervals();
    checkSchedules();
    updateFocusOverlay();
    updateLauncher();
  }

  function stopToolkitUiOnly() {
    flushTimeTracker();
    stopIntervals();
    removeFocusOverlay();
    if (root) {
      root.remove();
    }
    root = null;
    panel = null;
    edgeTab = null;
    toolkitStarted = false;
  }

  function createDisabledLauncher() {
    if (document.getElementById(APP.disabledId) || !document.body) {
      return;
    }
    const button = document.createElement("button");
    button.id = APP.disabledId;
    button.type = "button";
    button.innerHTML = renderToolboxIcon() + "<small>Off</small>";
    button.setAttribute("aria-label", "Re-enable Productivity Toolkit on this site");
    button.title = "Productivity Toolkit is disabled on this site. Click to re-enable.";
    button.addEventListener("click", () => {
      const rule = ensureSiteRule(currentDomain);
      rule.toolkitDisabled = false;
      saveState();
      button.remove();
      startToolkit();
      toast("Toolkit re-enabled for this site.");
    });
    document.body.appendChild(button);
  }

  function createRoot() {
    if (!document.body) {
      return false;
    }
    const existingRoot = document.getElementById(APP.rootId);
    if (existingRoot) {
      existingRoot.remove();
    }

    root = document.createElement("div");
    root.id = APP.rootId;
    root.dataset.theme = getTheme();
    root.innerHTML = [
      '<button type="button" class="ptk-edge-tab" data-action="toggle-panel" aria-label="Open Productivity Toolkit">',
      renderToolboxIcon(),
      '<small>Toolkit</small>',
      "</button>",
      '<section class="ptk-panel" role="dialog" aria-label="Productivity Toolkit"></section>',
      '<div class="ptk-toast" aria-live="polite"></div>'
    ].join("");
    document.body.appendChild(root);

    edgeTab = root.querySelector(".ptk-edge-tab");
    panel = root.querySelector(".ptk-panel");

    root.addEventListener("click", handleRootClick);
    root.addEventListener("input", handleRootInput);
    root.addEventListener("change", handleRootChange);
    root.addEventListener("pointerdown", handleDragStart);
    return true;
  }

  function renderToolboxIcon() {
    return [
      '<svg class="ptk-toolbox-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
      '<path d="M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1"></path>',
      '<rect x="3" y="6" width="18" height="14" rx="2"></rect>',
      '<path d="M3 11h18"></path>',
      '<path d="M10 11v2h4v-2"></path>',
      "</svg>"
    ].join("");
  }

  function renderPanel() {
    if (!panel) {
      return;
    }

    if (edgeTab) {
      edgeTab.setAttribute("aria-expanded", state.ui.open ? "true" : "false");
    }
    panel.hidden = !state.ui.open;
    updateLauncher();
    if (!state.ui.open) {
      return;
    }

    const tabs = [
      ["notes", "Notes"],
      ["snippets", "Snippets"],
      ["focus", "Focus"],
      ["timer", "Timer"],
      ["reports", "Reports"],
      ["highlight", "Highlight"],
      ["shortcuts", "Shortcuts"],
      ["site", "Site"],
      ["backup", "Backup"]
    ];
    const theme = getTheme();
    const themeButtonLabel = theme === "dark" ? "Light" : "Dark";

    panel.innerHTML = [
      '<header class="ptk-header" data-drag-handle>',
      '<div><strong>Productivity Toolkit</strong><span>v' + escapeHtml(APP.version) + "</span></div>",
      '<div class="ptk-header-actions">',
      '<button type="button" class="ptk-icon-button" data-action="toggle-theme" title="Switch to ' + escapeAttr(themeButtonLabel.toLowerCase()) + ' mode">' + escapeHtml(themeButtonLabel) + "</button>",
      '<button type="button" class="ptk-icon-button" data-action="reset-position" title="Reset panel position">Reset</button>',
      '<button type="button" class="ptk-icon-button" data-action="close-panel" title="Close panel">Close</button>',
      "</div>",
      "</header>",
      '<nav class="ptk-tabs" aria-label="Toolkit sections">',
      tabs.map(([tab, label]) => {
        const active = state.ui.activeTab === tab ? " aria-current=\"page\"" : "";
        return '<button type="button" data-action="select-tab" data-tab="' + tab + '"' + active + ">" + escapeHtml(label) + "</button>";
      }).join(""),
      "</nav>",
      '<main class="ptk-body">',
      renderActiveTab(),
      "</main>"
    ].join("");
  }

  function renderActiveTab() {
    switch (state.ui.activeTab) {
      case "snippets":
        return renderSnippetsTab();
      case "focus":
        return renderFocusTab();
      case "timer":
        return renderTimerTab();
      case "reports":
        return renderReportsTab();
      case "highlight":
        return renderHighlightTab();
      case "shortcuts":
        return renderShortcutsTab();
      case "site":
        return renderSiteTab();
      case "backup":
        return renderBackupTab();
      case "notes":
      default:
        return renderNotesTab();
    }
  }

  function renderNotesTab() {
    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>Quick Notes</h2><span>Autosaved locally</span></div>',
      '<textarea class="ptk-notes" data-field="notes" spellcheck="true" placeholder="Capture quick notes here...">' + escapeHtml(state.notes) + "</textarea>",
      '<div class="ptk-row">',
      '<button type="button" data-action="export-notes">Export .txt</button>',
      '<button type="button" data-action="clear-notes">Clear notes</button>',
      "</div>",
      "</section>"
    ].join("");
  }

  function renderSnippetsTab() {
    const filter = state.snippetFilter || "all";
    const categories = uniqueStrings(state.snippetCategories.concat(state.snippets.map((snippet) => snippet.category)));
    const snippets = state.snippets.filter((snippet) => filter === "all" || snippet.category === filter);
    const categoryOptions = ['<option value="all">All categories</option>']
      .concat(categories.map((category) => {
        const selected = filter === category ? " selected" : "";
        return '<option value="' + escapeAttr(category) + '"' + selected + ">" + escapeHtml(category) + "</option>";
      }))
      .join("");
    const datalist = '<datalist id="ptk-category-list">' + categories.map((category) => '<option value="' + escapeAttr(category) + '"></option>').join("") + "</datalist>";

    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>Text Expander</h2><span>' + state.snippets.length + " snippets</span></div>",
      '<label class="ptk-label">Filter<select data-change="snippet-filter">' + categoryOptions + "</select></label>",
      datalist,
      '<div class="ptk-subpanel">',
      '<h3>Add snippet</h3>',
      '<div class="ptk-grid-2">',
      '<label class="ptk-label">Shortcut<input data-field="new-snippet-shortcut" autocomplete="off" placeholder="omw"></label>',
      '<label class="ptk-label">Category<input data-field="new-snippet-category" list="ptk-category-list" placeholder="General"></label>',
      "</div>",
      '<label class="ptk-label">Expansion<textarea data-field="new-snippet-expansion" rows="3" placeholder="On my way."></textarea></label>',
      '<button type="button" data-action="add-snippet">Add snippet</button>',
      "</div>",
      '<div class="ptk-subpanel">',
      '<h3>Categories</h3>',
      '<div class="ptk-inline-form">',
      '<input data-field="new-category" placeholder="New category">',
      '<button type="button" data-action="add-category">Add</button>',
      "</div>",
      "</div>",
      '<div class="ptk-list">',
      snippets.length ? snippets.map(renderSnippetItem).join("") : '<p class="ptk-empty">No snippets in this category.</p>',
      "</div>",
      "</section>"
    ].join("");
  }

  function renderSnippetItem(snippet) {
    const checked = snippet.enabled ? " checked" : "";
    return [
      '<article class="ptk-list-item" data-snippet-id="' + escapeAttr(snippet.id) + '">',
      '<div class="ptk-list-heading">',
      '<label class="ptk-checkbox"><input type="checkbox" data-change="snippet-enabled" data-id="' + escapeAttr(snippet.id) + '"' + checked + "> Enabled</label>",
      '<button type="button" data-action="delete-snippet" data-id="' + escapeAttr(snippet.id) + '">Delete</button>',
      "</div>",
      '<div class="ptk-grid-2">',
      '<label class="ptk-label">Shortcut<input data-snippet-field="shortcut" data-id="' + escapeAttr(snippet.id) + '" value="' + escapeAttr(snippet.shortcut) + '"></label>',
      '<label class="ptk-label">Category<input data-snippet-field="category" data-id="' + escapeAttr(snippet.id) + '" list="ptk-category-list" value="' + escapeAttr(snippet.category) + '"></label>',
      "</div>",
      '<label class="ptk-label">Expansion<textarea data-snippet-field="expansion" data-id="' + escapeAttr(snippet.id) + '" rows="3">' + escapeHtml(snippet.expansion) + "</textarea></label>",
      "</article>"
    ].join("");
  }

  function renderFocusTab() {
    const active = isFocusActive();
    const remaining = active ? formatDuration(Math.ceil((state.focus.activeUntil - Date.now()) / 1000)) : "Inactive";
    const blocklistText = state.focus.blocklist.join("\n");
    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>FocusLock</h2><span>' + escapeHtml(remaining) + "</span></div>",
      '<div class="ptk-status-row">',
      '<strong>Status</strong>',
      '<span class="' + (active ? "ptk-pill ptk-pill-active" : "ptk-pill") + '">' + (active ? "Active" : "Inactive") + "</span>",
      "</div>",
      '<div class="ptk-grid-2">',
      '<button type="button" data-action="start-focus-default">Start 25 minutes</button>',
      '<button type="button" data-action="stop-focus">Stop focus</button>',
      "</div>",
      '<div class="ptk-inline-form">',
      '<input data-field="custom-focus-minutes" type="number" min="1" max="720" value="25" aria-label="Custom focus minutes">',
      '<button type="button" data-action="start-focus-custom">Start custom</button>',
      "</div>",
      '<label class="ptk-label">Blocklist<textarea data-field="focus-blocklist" rows="7">' + escapeHtml(blocklistText) + "</textarea></label>",
      '<button type="button" data-action="add-current-site-blocklist">Add current site</button>',
      '<div class="ptk-subpanel">',
      '<h3>Schedules</h3>',
      renderScheduleList(),
      '<div class="ptk-schedule-add">',
      '<input data-field="new-schedule-name" placeholder="Deep work">',
      '<div class="ptk-day-row">' + DAY_LABELS.map((label, index) => '<label><input type="checkbox" data-schedule-day="' + index + '"' + (index >= 1 && index <= 5 ? " checked" : "") + "> " + label + "</label>").join("") + "</div>",
      '<div class="ptk-grid-2">',
      '<label class="ptk-label">Start<input data-field="new-schedule-start" type="time" value="09:00"></label>',
      '<label class="ptk-label">End<input data-field="new-schedule-end" type="time" value="11:00"></label>',
      "</div>",
      '<button type="button" data-action="add-schedule">Add schedule</button>',
      "</div>",
      "</div>",
      "</section>"
    ].join("");
  }

  function renderScheduleList() {
    if (!state.focus.schedules.length) {
      return '<p class="ptk-empty">No schedules yet.</p>';
    }
    return state.focus.schedules.map((schedule) => {
      const days = DAY_LABELS.map((label, index) => {
        const checked = schedule.days.includes(index) ? " checked" : "";
        return '<label><input type="checkbox" data-change="schedule-day" data-id="' + escapeAttr(schedule.id) + '" data-day="' + index + '"' + checked + "> " + label + "</label>";
      }).join("");
      return [
        '<article class="ptk-list-item">',
        '<div class="ptk-list-heading">',
        '<label class="ptk-checkbox"><input type="checkbox" data-change="schedule-enabled" data-id="' + escapeAttr(schedule.id) + '"' + (schedule.enabled ? " checked" : "") + "> Enabled</label>",
        '<button type="button" data-action="delete-schedule" data-id="' + escapeAttr(schedule.id) + '">Delete</button>',
        "</div>",
        '<label class="ptk-label">Name<input data-schedule-field="name" data-id="' + escapeAttr(schedule.id) + '" value="' + escapeAttr(schedule.name) + '"></label>',
        '<div class="ptk-day-row">' + days + "</div>",
        '<div class="ptk-grid-2">',
        '<label class="ptk-label">Start<input type="time" data-change="schedule-time" data-field-name="start" data-id="' + escapeAttr(schedule.id) + '" value="' + escapeAttr(schedule.start) + '"></label>',
        '<label class="ptk-label">End<input type="time" data-change="schedule-time" data-field-name="end" data-id="' + escapeAttr(schedule.id) + '" value="' + escapeAttr(schedule.end) + '"></label>',
        "</div>",
        "</article>"
      ].join("");
    }).join("");
  }

  function renderTimerTab() {
    const remainingMs = getPomodoroRemainingMs();
    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>Pomodoro</h2><span>' + escapeHtml(capitalize(state.pomodoro.mode)) + "</span></div>",
      '<div class="ptk-timer-display">' + escapeHtml(formatCountdown(remainingMs)) + "</div>",
      '<div class="ptk-status-row">',
      '<strong>Completed work sessions</strong>',
      '<span class="ptk-pill">' + state.pomodoro.sessionsCompleted + "</span>",
      "</div>",
      '<div class="ptk-grid-2">',
      '<label class="ptk-label">Work minutes<input type="number" min="1" max="180" data-change="pomodoro-work" value="' + state.pomodoro.workMinutes + '"></label>',
      '<label class="ptk-label">Break minutes<input type="number" min="1" max="120" data-change="pomodoro-break" value="' + state.pomodoro.breakMinutes + '"></label>',
      "</div>",
      '<div class="ptk-grid-2">',
      '<button type="button" data-action="start-pomodoro-work">Start work</button>',
      '<button type="button" data-action="start-pomodoro-break">Start break</button>',
      '<button type="button" data-action="toggle-pomodoro">' + (state.pomodoro.running ? "Pause" : "Resume") + "</button>",
      '<button type="button" data-action="reset-pomodoro">Reset</button>',
      "</div>",
      "</section>"
    ].join("");
  }

  function renderReportsTab() {
    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>Reports</h2><span>Domain-level browsing time</span></div>',
      '<div class="ptk-subpanel">',
      '<h3>Today</h3>',
      renderReportTable(getReportForDates([todayKey()])),
      '<div class="ptk-row">',
      '<button type="button" data-action="export-today-csv">Export today CSV</button>',
      '<button type="button" data-action="clear-today-report">Clear today</button>',
      "</div>",
      "</div>",
      '<div class="ptk-subpanel">',
      '<h3>Current week</h3>',
      renderReportTable(getReportForDates(currentWeekKeys())),
      '<button type="button" data-action="export-week-csv">Export week CSV</button>',
      "</div>",
      "</section>"
    ].join("");
  }

  function renderReportTable(rows) {
    if (!rows.length) {
      return '<p class="ptk-empty">No tracked time yet.</p>';
    }
    return [
      '<table class="ptk-table"><thead><tr><th>Domain</th><th>Time</th></tr></thead><tbody>',
      rows.map((row) => '<tr><td>' + escapeHtml(row.domain) + "</td><td>" + escapeHtml(formatDuration(row.seconds)) + "</td></tr>").join(""),
      "</tbody></table>"
    ].join("");
  }

  function renderHighlightTab() {
    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>Highlights</h2><span>Current page only</span></div>',
      '<button type="button" data-action="highlight-selection">Highlight selected text</button>',
      '<label class="ptk-label">Phrase<input data-field="highlight-phrase" placeholder="Phrase to highlight"></label>',
      '<label class="ptk-checkbox"><input type="checkbox" data-field="highlight-case-sensitive"> Case sensitive</label>',
      '<div class="ptk-grid-2">',
      '<button type="button" data-action="highlight-phrase">Highlight phrase</button>',
      '<button type="button" data-action="clear-highlights">Clear highlights</button>',
      "</div>",
      "</section>"
    ].join("");
  }

  function renderShortcutsTab() {
    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>Keyboard Shortcuts</h2><span>' + (shortcutCaptureAction ? "Capturing..." : "Editable") + "</span></div>",
      '<div class="ptk-list">',
      Object.keys(DEFAULT_SHORTCUTS).map((action) => [
        '<article class="ptk-list-item">',
        '<div class="ptk-list-heading">',
        '<strong>' + escapeHtml(SHORTCUT_LABELS[action]) + "</strong>",
        '<span class="ptk-kbd">' + escapeHtml(state.shortcuts[action] || DEFAULT_SHORTCUTS[action]) + "</span>",
        "</div>",
        '<button type="button" data-action="capture-shortcut" data-shortcut-action="' + escapeAttr(action) + '">' + (shortcutCaptureAction === action ? "Press keys..." : "Capture") + "</button>",
        "</article>"
      ].join("")).join(""),
      "</div>",
      '<button type="button" data-action="reset-shortcuts">Restore defaults</button>',
      "</section>"
    ].join("");
  }

  function renderSiteTab() {
    const domain = currentDomain || "no-hostname";
    const rule = getSiteRule(currentDomain);
    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>Site Rules</h2><span>' + escapeHtml(domain) + "</span></div>",
      '<label class="ptk-checkbox ptk-danger-check"><input type="checkbox" data-change="site-toolkit-disabled"' + (rule.toolkitDisabled ? " checked" : "") + "> Disable entire toolkit on this site</label>",
      '<div class="ptk-list">',
      SITE_RULE_FEATURES.map((feature) => {
        const disabled = Boolean(rule.disabledFeatures[feature]);
        return [
          '<label class="ptk-checkbox ptk-list-item">',
          '<input type="checkbox" data-change="site-feature-disabled" data-feature="' + escapeAttr(feature) + '"' + (disabled ? " checked" : "") + ">",
          " Disable " + escapeHtml(FEATURE_LABELS[feature]),
          "</label>"
        ].join("");
      }).join(""),
      "</div>",
      "</section>"
    ].join("");
  }

  function renderBackupTab() {
    return [
      '<section class="ptk-section">',
      '<div class="ptk-section-title"><h2>Backup / Restore</h2><span>JSON only</span></div>',
      '<div class="ptk-grid-2">',
      '<button type="button" data-action="export-backup">Download backup</button>',
      '<button type="button" data-action="copy-backup">Copy JSON</button>',
      "</div>",
      '<label class="ptk-label">Restore JSON<input type="file" data-change="backup-file" accept="application/json,.json"></label>',
      '<p class="ptk-muted">Restore validates the JSON before replacing local settings.</p>',
      "</section>"
    ].join("");
  }

  function handleRootClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || !root || !root.contains(button)) {
      return;
    }
    if (button.matches('input[type="checkbox"]')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.action;
    switch (action) {
      case "toggle-panel":
        togglePanel();
        break;
      case "close-panel":
        closePanel();
        break;
      case "select-tab":
        openPanel(button.dataset.tab);
        break;
      case "reset-position":
        resetPanelPosition();
        break;
      case "toggle-theme":
        toggleTheme();
        break;
      case "export-notes":
        exportNotes();
        break;
      case "clear-notes":
        clearNotes();
        break;
      case "add-snippet":
        addSnippetFromForm();
        break;
      case "delete-snippet":
        deleteSnippet(button.dataset.id);
        break;
      case "add-category":
        addCategoryFromForm();
        break;
      case "start-focus-default":
        startFocusSession(25, "manual");
        break;
      case "start-focus-custom":
        startCustomFocusSession();
        break;
      case "stop-focus":
        stopFocusSession();
        break;
      case "add-current-site-blocklist":
        addCurrentSiteToBlocklist();
        break;
      case "add-schedule":
        addScheduleFromForm();
        break;
      case "delete-schedule":
        deleteSchedule(button.dataset.id);
        break;
      case "start-pomodoro-work":
        startPomodoro("work");
        break;
      case "start-pomodoro-break":
        startPomodoro("break");
        break;
      case "toggle-pomodoro":
        togglePomodoroPause();
        break;
      case "reset-pomodoro":
        resetPomodoro();
        break;
      case "export-today-csv":
        exportReportCsv([todayKey()], "productivity-toolkit-today.csv");
        break;
      case "export-week-csv":
        exportReportCsv(currentWeekKeys(), "productivity-toolkit-week.csv");
        break;
      case "clear-today-report":
        clearTodayReport();
        break;
      case "highlight-selection":
        highlightSelectedText();
        break;
      case "highlight-phrase":
        highlightPhraseFromForm();
        break;
      case "clear-highlights":
        clearHighlights();
        break;
      case "capture-shortcut":
        captureShortcut(button.dataset.shortcutAction);
        break;
      case "reset-shortcuts":
        resetShortcuts();
        break;
      case "export-backup":
        exportBackup();
        break;
      case "copy-backup":
        copyBackup();
        break;
      default:
        break;
    }
  }

  function handleRootInput(event) {
    const target = event.target;
    if (!target) {
      return;
    }

    if (target.dataset.field === "notes") {
      state.notes = target.value;
      saveStateSoon();
      return;
    }

    if (target.dataset.field === "focus-blocklist") {
      state.focus.blocklist = parseBlocklist(target.value);
      saveState();
      updateFocusOverlay();
      return;
    }

    if (target.dataset.snippetField) {
      updateSnippetField(target.dataset.id, target.dataset.snippetField, target.value);
      return;
    }

    if (target.dataset.scheduleField) {
      updateScheduleField(target.dataset.id, target.dataset.scheduleField, target.value);
    }
  }

  function handleRootChange(event) {
    const target = event.target;
    if (!target) {
      return;
    }

    const change = target.dataset.change;
    switch (change) {
      case "snippet-enabled":
        setSnippetEnabled(target.dataset.id, target.checked);
        break;
      case "snippet-filter":
        state.snippetFilter = target.value;
        saveState();
        renderPanel();
        break;
      case "schedule-enabled":
        updateScheduleEnabled(target.dataset.id, target.checked);
        break;
      case "schedule-day":
        updateScheduleDay(target.dataset.id, Number(target.dataset.day), target.checked);
        break;
      case "schedule-time":
        updateScheduleField(target.dataset.id, target.dataset.fieldName, target.value);
        break;
      case "pomodoro-work":
        state.pomodoro.workMinutes = clamp(Number(target.value) || 25, 1, 180);
        if (!state.pomodoro.running && state.pomodoro.mode === "work") {
          state.pomodoro.remainingMs = state.pomodoro.workMinutes * 60 * 1000;
        }
        saveState();
        renderPanel();
        break;
      case "pomodoro-break":
        state.pomodoro.breakMinutes = clamp(Number(target.value) || 5, 1, 120);
        if (!state.pomodoro.running && state.pomodoro.mode === "break") {
          state.pomodoro.remainingMs = state.pomodoro.breakMinutes * 60 * 1000;
        }
        saveState();
        renderPanel();
        break;
      case "site-toolkit-disabled":
        setToolkitDisabledForCurrentSite(target.checked);
        break;
      case "site-feature-disabled":
        setFeatureDisabledForCurrentSite(target.dataset.feature, target.checked);
        break;
      case "backup-file":
        importBackupFile(target.files && target.files[0]);
        target.value = "";
        break;
      default:
        break;
    }
  }

  function bindGlobalListeners() {
    if (listenersBound) {
      return;
    }
    listenersBound = true;
    document.addEventListener("keydown", handleDocumentKeydown, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", flushTimeTracker);
    window.addEventListener("resize", keepPanelInViewport);
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  }

  function handleDocumentKeydown(event) {
    if (shortcutCaptureAction) {
      const combo = eventToCombo(event);
      if (combo && !isModifierOnly(event)) {
        event.preventDefault();
        event.stopPropagation();
        state.shortcuts[shortcutCaptureAction] = combo;
        shortcutCaptureAction = null;
        saveState();
        renderPanel();
        toast("Shortcut saved.");
      }
      return;
    }

    if (isFeatureEnabled("shortcuts") && handleShortcut(event)) {
      return;
    }

    if (isFeatureEnabled("textExpander")) {
      handleTextExpansion(event);
    }
  }

  function handleShortcut(event) {
    const combo = eventToCombo(event);
    if (!combo || isTypingTarget(event.target)) {
      return false;
    }

    const shortcuts = state.shortcuts || DEFAULT_SHORTCUTS;
    if (combo === shortcuts.togglePanel) {
      event.preventDefault();
      togglePanel();
      return true;
    }
    if (combo === shortcuts.openNotes) {
      event.preventDefault();
      openPanel("notes");
      return true;
    }
    if (combo === shortcuts.highlightSelection && isFeatureEnabled("highlights")) {
      event.preventDefault();
      highlightSelectedText();
      return true;
    }
    if (combo === shortcuts.clearHighlights && isFeatureEnabled("highlights")) {
      event.preventDefault();
      clearHighlights();
      return true;
    }
    if (combo === shortcuts.toggleFocus && isFeatureEnabled("focusLock")) {
      event.preventDefault();
      if (isFocusActive()) {
        stopFocusSession();
      } else {
        startFocusSession(25, "manual");
      }
      return true;
    }
    return false;
  }

  function handleTextExpansion(event) {
    if (!TEXT_EXPANDER_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (!target || isInsideToolkit(target) || isPasswordField(target)) {
      return;
    }

    if (isTextControl(target)) {
      expandInTextControl(event, target);
      return;
    }

    const editable = target.closest && target.closest("[contenteditable=''], [contenteditable='true']");
    if (editable) {
      expandInContentEditable(event, editable);
    }
  }

  function expandInTextControl(event, target) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start !== end) {
      return;
    }
    const before = target.value.slice(0, start);
    const token = getLastToken(before);
    if (!token) {
      return;
    }
    const snippet = findEnabledSnippet(token);
    if (!snippet) {
      return;
    }

    event.preventDefault();
    const delimiter = delimiterForEvent(event, target);
    target.setRangeText(buildExpansionReplacement(snippet.expansion, delimiter), start - token.length, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function expandInContentEditable(event, editable) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return;
    }
    const range = selection.getRangeAt(0);
    const caret = getEditableCaretTextNode(range, editable);
    if (!caret) {
      return;
    }
    const before = caret.node.nodeValue.slice(0, caret.offset);
    const token = getLastToken(before);
    const snippet = token ? findEnabledSnippet(token) : null;
    if (!snippet) {
      return;
    }

    event.preventDefault();
    const delimiter = delimiterForEvent(event, null);
    const replacement = buildExpansionReplacement(snippet.expansion, delimiter);
    const replaceRange = document.createRange();
    replaceRange.setStart(caret.node, caret.offset - token.length);
    replaceRange.setEnd(caret.node, caret.offset);
    selection.removeAllRanges();
    selection.addRange(replaceRange);

    if (!document.execCommand || !document.execCommand("insertText", false, replacement)) {
      replaceRange.deleteContents();
      const textNode = document.createTextNode(replacement);
      replaceRange.insertNode(textNode);
      replaceRange.setStartAfter(textNode);
      replaceRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(replaceRange);
    }
  }

  function getEditableCaretTextNode(range, editable) {
    if (range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
      return {
        node: range.startContainer,
        offset: range.startOffset
      };
    }
    if (!editable || !range.startContainer || range.startContainer.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    let node = range.startContainer.childNodes[Math.max(0, range.startOffset - 1)];
    while (node && node.lastChild) {
      node = node.lastChild;
    }
    if (node && node.nodeType === Node.TEXT_NODE) {
      return {
        node,
        offset: node.nodeValue.length
      };
    }
    return null;
  }

  function getLastToken(text) {
    const match = text.match(/([^\s.,!?;:()[\]{}"'`]+)$/);
    return match ? match[1] : "";
  }

  function findEnabledSnippet(shortcut) {
    return state.snippets.find((snippet) => snippet.enabled && snippet.shortcut === shortcut);
  }

  function delimiterForEvent(event, target) {
    if (event.key === "Enter") {
      return target && target.tagName === "INPUT" ? " " : "\n";
    }
    if (event.key === "Tab") {
      return " ";
    }
    return event.key === " " ? " " : event.key;
  }

  function buildExpansionReplacement(expansion, delimiter) {
    const text = String(expansion || "");
    if (delimiter && /[.,!?;:)\]}]/.test(delimiter) && text.endsWith(delimiter)) {
      return text;
    }
    return text + delimiter;
  }

  function addSnippetFromForm() {
    const shortcut = getFieldValue("new-snippet-shortcut").trim();
    const expansion = getFieldValue("new-snippet-expansion");
    const category = getFieldValue("new-snippet-category").trim() || "General";
    if (!shortcut || !expansion) {
      toast("Shortcut and expansion are required.");
      return;
    }
    if (state.snippets.some((snippet) => snippet.shortcut === shortcut)) {
      toast("That shortcut already exists.");
      return;
    }
    state.snippets.push({
      id: createId("snippet"),
      shortcut,
      expansion,
      category,
      enabled: true
    });
    state.snippetCategories = uniqueStrings(state.snippetCategories.concat(category));
    state.snippetFilter = "all";
    saveState();
    renderPanel();
    toast("Snippet added.");
  }

  function deleteSnippet(id) {
    state.snippets = state.snippets.filter((snippet) => snippet.id !== id);
    state.snippetCategories = uniqueStrings(["General"].concat(state.snippets.map((snippet) => snippet.category), state.snippetCategories));
    saveState();
    renderPanel();
    toast("Snippet deleted.");
  }

  function updateSnippetField(id, field, value) {
    const snippet = state.snippets.find((item) => item.id === id);
    if (!snippet || !["shortcut", "expansion", "category"].includes(field)) {
      return;
    }
    snippet[field] = field === "category" ? (value.trim() || "General") : value;
    if (field === "category") {
      state.snippetCategories = uniqueStrings(state.snippetCategories.concat(snippet.category));
    }
    saveState();
  }

  function setSnippetEnabled(id, enabled) {
    const snippet = state.snippets.find((item) => item.id === id);
    if (!snippet) {
      return;
    }
    snippet.enabled = Boolean(enabled);
    saveState();
  }

  function addCategoryFromForm() {
    const category = getFieldValue("new-category").trim();
    if (!category) {
      return;
    }
    state.snippetCategories = uniqueStrings(state.snippetCategories.concat(category));
    saveState();
    renderPanel();
  }

  function exportNotes() {
    downloadTextFile("productivity-toolkit-notes.txt", state.notes || "");
  }

  function clearNotes() {
    if (state.notes && !window.confirm("Clear all notes?")) {
      return;
    }
    state.notes = "";
    saveState();
    renderPanel();
    toast("Notes cleared.");
  }

  function startFocusSession(minutes, source, scheduleEnd) {
    if (!isFeatureEnabled("focusLock")) {
      return;
    }
    const duration = clamp(Number(minutes) || 25, 1, 720);
    state.focus.activeUntil = Date.now() + duration * 60 * 1000;
    state.focus.activeSource = source === "schedule" ? "schedule" : "manual";
    state.focus.activeScheduleEnd = positiveNumber(scheduleEnd, 0);
    if (source !== "schedule") {
      state.focus.schedulePausedUntil = 0;
    }
    saveState();
    updateFocusOverlay();
    renderPanel();
    toast("FocusLock started.");
  }

  function startCustomFocusSession() {
    const minutes = clamp(Number(getFieldValue("custom-focus-minutes")) || 25, 1, 720);
    startFocusSession(minutes, "manual");
  }

  function stopFocusSession() {
    if (state.focus.activeSource === "schedule" && state.focus.activeScheduleEnd > Date.now()) {
      state.focus.schedulePausedUntil = state.focus.activeScheduleEnd;
    }
    state.focus.activeUntil = 0;
    state.focus.activeSource = "manual";
    state.focus.activeScheduleEnd = 0;
    saveState();
    removeFocusOverlay();
    renderPanel();
    toast("FocusLock stopped.");
  }

  function isFocusActive() {
    if (state.focus.activeUntil > Date.now()) {
      return true;
    }
    if (state.focus.activeUntil) {
      state.focus.activeUntil = 0;
      state.focus.activeSource = "manual";
      state.focus.activeScheduleEnd = 0;
      saveState();
      removeFocusOverlay();
    }
    return false;
  }

  function parseBlocklist(value) {
    return uniqueStrings(String(value || "")
      .split(/\r?\n|,/)
      .map(normalizeDomain)
      .filter(Boolean));
  }

  function addCurrentSiteToBlocklist() {
    if (!currentDomain) {
      toast("This page does not have a normal hostname.");
      return;
    }
    state.focus.blocklist = uniqueStrings(state.focus.blocklist.concat(currentDomain));
    saveState();
    renderPanel();
    updateFocusOverlay();
    toast("Current site added to blocklist.");
  }

  function updateFocusOverlay() {
    if (!isFeatureEnabled("focusLock") || !isFocusActive() || !isBlockedDomain(currentDomain)) {
      removeFocusOverlay();
      return;
    }
    if (!document.body) {
      return;
    }
    let overlay = document.getElementById(APP.focusOverlayId);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = APP.focusOverlayId;
      overlay.addEventListener("click", (event) => {
        const button = event.target.closest("[data-focus-action]");
        if (button && button.dataset.focusAction === "stop") {
          event.preventDefault();
          stopFocusSession();
        }
      });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = [
      '<div class="ptk-focus-card">',
      "<h1>FocusLock is active</h1>",
      "<p>This site is on your blocklist during the current focus session.</p>",
      '<strong>' + escapeHtml(formatDuration(Math.ceil((state.focus.activeUntil - Date.now()) / 1000))) + " remaining</strong>",
      '<button type="button" data-focus-action="stop">End focus session</button>',
      "</div>"
    ].join("");
  }

  function removeFocusOverlay() {
    const overlay = document.getElementById(APP.focusOverlayId);
    if (overlay) {
      overlay.remove();
    }
  }

  function isBlockedDomain(domain) {
    const cleanDomain = normalizeDomain(domain);
    if (!cleanDomain) {
      return false;
    }
    return state.focus.blocklist.some((blocked) => {
      const cleanBlocked = normalizeDomain(blocked);
      return cleanDomain === cleanBlocked || cleanDomain.endsWith("." + cleanBlocked);
    });
  }

  function addScheduleFromForm() {
    const days = Array.from(root.querySelectorAll("[data-schedule-day]:checked")).map((input) => Number(input.dataset.scheduleDay));
    const start = getFieldValue("new-schedule-start");
    const end = getFieldValue("new-schedule-end");
    const name = getFieldValue("new-schedule-name").trim() || "Focus window";
    if (!days.length || !isTimeString(start) || !isTimeString(end)) {
      toast("Choose days, start time, and end time.");
      return;
    }
    state.focus.schedules.push({
      id: createId("schedule"),
      name,
      days: uniqueNumbers(days),
      start,
      end,
      enabled: true
    });
    saveState();
    renderPanel();
    checkSchedules();
  }

  function deleteSchedule(id) {
    state.focus.schedules = state.focus.schedules.filter((schedule) => schedule.id !== id);
    saveState();
    renderPanel();
  }

  function updateScheduleEnabled(id, enabled) {
    const schedule = findSchedule(id);
    if (!schedule) {
      return;
    }
    schedule.enabled = Boolean(enabled);
    saveState();
    checkSchedules();
  }

  function updateScheduleDay(id, day, checked) {
    const schedule = findSchedule(id);
    if (!schedule || day < 0 || day > 6) {
      return;
    }
    if (checked) {
      schedule.days = uniqueNumbers(schedule.days.concat(day));
    } else {
      schedule.days = schedule.days.filter((item) => item !== day);
    }
    saveState();
    checkSchedules();
  }

  function updateScheduleField(id, field, value) {
    const schedule = findSchedule(id);
    if (!schedule || !["name", "start", "end"].includes(field)) {
      return;
    }
    if ((field === "start" || field === "end") && !isTimeString(value)) {
      return;
    }
    schedule[field] = field === "name" ? (value.trim() || "Focus window") : value;
    saveState();
    checkSchedules();
  }

  function findSchedule(id) {
    return state.focus.schedules.find((schedule) => schedule.id === id);
  }

  function checkSchedules() {
    if (!isFeatureEnabled("focusLock")) {
      return;
    }
    const now = Date.now();
    if (state.focus.schedulePausedUntil > now) {
      return;
    }
    const activeWindow = getActiveScheduleWindow(new Date(now));
    if (!activeWindow) {
      if (state.focus.activeSource === "schedule" && state.focus.activeUntil) {
        state.focus.activeUntil = 0;
        state.focus.activeSource = "manual";
        state.focus.activeScheduleEnd = 0;
        saveState();
        removeFocusOverlay();
      }
      return;
    }
    if (isFocusActive() && state.focus.activeUntil >= activeWindow.end.getTime()) {
      return;
    }
    const minutes = Math.max(1, Math.ceil((activeWindow.end.getTime() - now) / 60000));
    startFocusSession(minutes, "schedule", activeWindow.end.getTime());
  }

  function getActiveScheduleWindow(now) {
    const windows = [];
    state.focus.schedules.forEach((schedule) => {
      if (!schedule.enabled) {
        return;
      }
      const today = scheduleWindowForDate(schedule, now);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const previous = scheduleWindowForDate(schedule, yesterday);
      [today, previous].forEach((windowInfo) => {
        if (windowInfo && now >= windowInfo.start && now < windowInfo.end) {
          windows.push(windowInfo);
        }
      });
    });
    windows.sort((a, b) => a.end - b.end);
    return windows[0] || null;
  }

  function scheduleWindowForDate(schedule, date) {
    const day = date.getDay();
    if (!schedule.days.includes(day)) {
      return null;
    }
    const [startHour, startMinute] = schedule.start.split(":").map(Number);
    const [endHour, endMinute] = schedule.end.split(":").map(Number);
    const start = new Date(date);
    start.setHours(startHour, startMinute, 0, 0);
    const end = new Date(date);
    end.setHours(endHour, endMinute, 0, 0);
    if (end <= start) {
      end.setDate(end.getDate() + 1);
    }
    return { schedule, start, end };
  }

  function startPomodoro(mode) {
    if (!isFeatureEnabled("pomodoro")) {
      return;
    }
    state.pomodoro.mode = mode === "break" ? "break" : "work";
    state.pomodoro.running = true;
    state.pomodoro.remainingMs = (state.pomodoro.mode === "work" ? state.pomodoro.workMinutes : state.pomodoro.breakMinutes) * 60 * 1000;
    state.pomodoro.endsAt = Date.now() + state.pomodoro.remainingMs;
    saveState();
    renderPanel();
    updateLauncher();
  }

  function togglePomodoroPause() {
    if (!isFeatureEnabled("pomodoro")) {
      return;
    }
    if (state.pomodoro.running) {
      state.pomodoro.remainingMs = getPomodoroRemainingMs();
      state.pomodoro.running = false;
      state.pomodoro.endsAt = 0;
    } else {
      state.pomodoro.running = true;
      state.pomodoro.endsAt = Date.now() + state.pomodoro.remainingMs;
    }
    saveState();
    renderPanel();
    updateLauncher();
  }

  function resetPomodoro() {
    state.pomodoro.running = false;
    state.pomodoro.endsAt = 0;
    state.pomodoro.mode = "work";
    state.pomodoro.remainingMs = state.pomodoro.workMinutes * 60 * 1000;
    saveState();
    renderPanel();
    updateLauncher();
  }

  function updatePomodoro() {
    if (!isFeatureEnabled("pomodoro")) {
      return;
    }
    if (state.pomodoro.running && Date.now() >= state.pomodoro.endsAt) {
      const completedMode = state.pomodoro.mode;
      state.pomodoro.running = false;
      state.pomodoro.mode = completedMode === "work" ? "break" : "work";
      state.pomodoro.remainingMs = (state.pomodoro.mode === "work" ? state.pomodoro.workMinutes : state.pomodoro.breakMinutes) * 60 * 1000;
      state.pomodoro.endsAt = 0;
      if (completedMode === "work") {
        state.pomodoro.sessionsCompleted += 1;
      }
      saveState();
      playBeep();
      toast(completedMode === "work" ? "Work session complete." : "Break complete.");
      renderPanel();
    }
    updateLauncher();
  }

  function getPomodoroRemainingMs() {
    if (state.pomodoro.running) {
      return Math.max(0, state.pomodoro.endsAt - Date.now());
    }
    return Math.max(0, state.pomodoro.remainingMs);
  }

  function playBeep() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return;
      }
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.06;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
      oscillator.addEventListener("ended", () => context.close());
    } catch (error) {
      console.warn("Productivity Toolkit: notification beep unavailable", error);
    }
  }

  function trackVisibleTime() {
    const now = Date.now();
    if (!isFeatureEnabled("timeTracker") || document.hidden || !currentDomain) {
      lastTrackedAt = now;
      return;
    }
    const deltaSeconds = Math.floor((now - lastTrackedAt) / 1000);
    lastTrackedAt = now;
    if (deltaSeconds <= 0 || deltaSeconds > 120) {
      return;
    }
    const day = todayKey();
    if (!state.timeLogs[day]) {
      state.timeLogs[day] = {};
    }
    state.timeLogs[day][currentDomain] = Math.floor((state.timeLogs[day][currentDomain] || 0) + deltaSeconds);
    if (now - lastTimeSaveAt > 30000) {
      lastTimeSaveAt = now;
      saveState();
      if (state.ui.activeTab === "reports") {
        renderPanel();
      }
    }
  }

  function flushTimeTracker() {
    trackVisibleTime();
    lastTimeSaveAt = Date.now();
    saveState();
  }

  function handleVisibilityChange() {
    lastTrackedAt = Date.now();
    if (document.hidden) {
      flushTimeTracker();
    }
  }

  function getReportForDates(dateKeys) {
    const totals = {};
    dateKeys.forEach((dateKey) => {
      const day = state.timeLogs[dateKey] || {};
      Object.keys(day).forEach((domain) => {
        totals[domain] = (totals[domain] || 0) + Math.floor(day[domain]);
      });
    });
    return Object.keys(totals)
      .map((domain) => ({ domain, seconds: totals[domain] }))
      .sort((a, b) => b.seconds - a.seconds);
  }

  function exportReportCsv(dateKeys, filename) {
    const rows = [["date", "domain", "seconds", "duration"]];
    dateKeys.forEach((dateKey) => {
      const day = state.timeLogs[dateKey] || {};
      Object.keys(day).sort().forEach((domain) => {
        rows.push([dateKey, domain, String(Math.floor(day[domain])), formatDuration(day[domain])]);
      });
    });
    downloadTextFile(filename, rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv");
  }

  function clearTodayReport() {
    if (!window.confirm("Clear today's time report?")) {
      return;
    }
    delete state.timeLogs[todayKey()];
    saveState();
    renderPanel();
  }

  function highlightSelectedText() {
    if (!isFeatureEnabled("highlights")) {
      return;
    }
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";
    if (!text) {
      toast("Select text to highlight.");
      return;
    }
    const count = highlightPhrase(text, false);
    toast(count ? "Highlighted " + count + " match" + (count === 1 ? "." : "es.") : "No matches found.");
  }

  function highlightPhraseFromForm() {
    if (!isFeatureEnabled("highlights")) {
      return;
    }
    const phrase = getFieldValue("highlight-phrase").trim();
    const caseSensitive = Boolean(root.querySelector('[data-field="highlight-case-sensitive"]') && root.querySelector('[data-field="highlight-case-sensitive"]').checked);
    if (!phrase) {
      toast("Enter a phrase to highlight.");
      return;
    }
    const count = highlightPhrase(phrase, caseSensitive);
    toast(count ? "Highlighted " + count + " match" + (count === 1 ? "." : "es.") : "No matches found.");
  }

  function highlightPhrase(phrase, caseSensitive) {
    if (!phrase || !document.body) {
      return 0;
    }
    const regex = new RegExp(escapeRegExp(phrase), caseSensitive ? "g" : "gi");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let scannedTextNodes = 0;
    while (nodes.length < APP.maxHighlights && scannedTextNodes < APP.maxHighlightTextNodes) {
      const node = walker.nextNode();
      if (!node) {
        break;
      }
      scannedTextNodes += 1;
      if (!node.nodeValue || !node.nodeValue.trim()) {
        continue;
      }
      const parent = node.parentElement;
      if (!parent || shouldSkipHighlightParent(parent)) {
        continue;
      }
      regex.lastIndex = 0;
      if (!regex.test(node.nodeValue)) {
        continue;
      }
      nodes.push(node);
    }

    let count = 0;
    nodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      const text = node.nodeValue;
      regex.lastIndex = 0;
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) && count < APP.maxHighlights) {
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const mark = document.createElement("mark");
        mark.className = APP.highlightClass;
        mark.textContent = match[0];
        fragment.appendChild(mark);
        count += 1;
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      if (count > 0 && node.parentNode) {
        node.parentNode.replaceChild(fragment, node);
      }
    });

    return count;
  }

  function shouldSkipHighlightParent(parent) {
    if (isInsideToolkit(parent) || parent.closest("#" + APP.focusOverlayId)) {
      return true;
    }
    if (parent.closest("script, style, noscript, textarea, input, select, option, mark." + APP.highlightClass)) {
      return true;
    }
    return false;
  }

  function clearHighlights() {
    const marks = Array.from(document.querySelectorAll("mark." + APP.highlightClass));
    marks.forEach((mark) => {
      const text = document.createTextNode(mark.textContent || "");
      mark.replaceWith(text);
      if (text.parentNode) {
        text.parentNode.normalize();
      }
    });
    toast("Highlights cleared.");
  }

  function captureShortcut(action) {
    if (!DEFAULT_SHORTCUTS[action]) {
      return;
    }
    shortcutCaptureAction = action;
    renderPanel();
  }

  function resetShortcuts() {
    state.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS);
    shortcutCaptureAction = null;
    saveState();
    renderPanel();
  }

  function setToolkitDisabledForCurrentSite(disabled) {
    if (!currentDomain) {
      toast("This page does not have a normal hostname.");
      renderPanel();
      return;
    }
    const rule = ensureSiteRule(currentDomain);
    rule.toolkitDisabled = Boolean(disabled);
    saveState();
    if (disabled) {
      stopToolkitUiOnly();
      createDisabledLauncher();
      return;
    }
    renderPanel();
  }

  function setFeatureDisabledForCurrentSite(feature, disabled) {
    if (!SITE_RULE_FEATURES.includes(feature) || !currentDomain) {
      return;
    }
    const rule = ensureSiteRule(currentDomain);
    if (disabled) {
      rule.disabledFeatures[feature] = true;
    } else {
      delete rule.disabledFeatures[feature];
    }
    saveState();
    updateFocusOverlay();
    updateLauncher();
  }

  function exportBackup() {
    downloadTextFile("productivity-toolkit-backup.json", buildBackupJson(), "application/json");
  }

  function copyBackup() {
    const json = buildBackupJson();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json)
        .then(() => toast("Backup JSON copied."))
        .catch(() => fallbackCopy(json));
      return;
    }
    fallbackCopy(json);
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      toast("Backup JSON copied.");
    } catch (error) {
      toast("Copy failed; download the backup instead.");
    }
    textarea.remove();
  }

  function buildBackupJson() {
    return JSON.stringify({
      product: "Productivity Toolkit",
      version: APP.version,
      exportedAt: new Date().toISOString(),
      settings: state
    }, null, 2);
  }

  function importBackupFile(file) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        restoreBackupText(String(reader.result || ""));
        toast("Backup restored.");
      } catch (error) {
        console.warn("Productivity Toolkit: backup restore failed", error);
        toast("Invalid backup JSON.");
      }
    };
    reader.onerror = () => toast("Could not read backup file.");
    reader.readAsText(file);
  }

  function restoreBackupText(text) {
    const parsed = JSON.parse(text);
    const candidate = parsed && isPlainObject(parsed.settings) ? parsed.settings : parsed;
    if (!isPlainObject(candidate) || !hasKnownSettingsShape(candidate)) {
      throw new Error("Backup is not a Productivity Toolkit settings object.");
    }
    state = normalizeState(candidate);
    saveState();
    currentDomain = getCurrentDomain();
    if (isToolkitDisabledForCurrentDomain()) {
      stopToolkitUiOnly();
      createDisabledLauncher();
    } else {
      const disabledLauncher = document.getElementById(APP.disabledId);
      if (disabledLauncher) {
        disabledLauncher.remove();
      }
      if (!toolkitStarted) {
        startToolkit();
      }
      applyTheme();
      renderPanel();
      startIntervals();
      checkSchedules();
      updateFocusOverlay();
    }
  }

  function hasKnownSettingsShape(candidate) {
    return [
      "snippets",
      "snippetCategories",
      "notes",
      "focus",
      "pomodoro",
      "timeLogs",
      "shortcuts",
      "siteRules",
      "ui"
    ].some((key) => Object.prototype.hasOwnProperty.call(candidate, key));
  }

  function togglePanel() {
    if (!toolkitStarted) {
      return;
    }
    state.ui.open = !state.ui.open;
    saveState();
    renderPanel();
  }

  function getTheme() {
    return state.ui && state.ui.theme === "dark" ? "dark" : "light";
  }

  function applyTheme() {
    if (root) {
      root.dataset.theme = getTheme();
    }
  }

  function toggleTheme() {
    state.ui.theme = getTheme() === "dark" ? "light" : "dark";
    applyTheme();
    saveState();
    renderPanel();
    toast("Switched to " + getTheme() + " mode.");
  }

  function openPanel(tab) {
    if (!toolkitStarted) {
      return;
    }
    if (tab) {
      state.ui.activeTab = tab;
    }
    state.ui.open = true;
    saveState();
    renderPanel();
  }

  function closePanel() {
    state.ui.open = false;
    saveState();
    renderPanel();
  }

  function resetPanelPosition() {
    state.ui.position = null;
    saveState();
    applyPanelPosition();
    toast("Panel position reset.");
  }

  function applyPanelPosition() {
    if (!panel) {
      return;
    }
    if (state.ui.position) {
      panel.style.left = state.ui.position.left + "px";
      panel.style.top = state.ui.position.top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    } else {
      panel.style.left = "auto";
      panel.style.top = "auto";
      panel.style.right = "18px";
      panel.style.bottom = "82px";
    }
  }

  function keepPanelInViewport() {
    if (!panel || !state.ui.position) {
      return;
    }
    state.ui.position.left = clamp(state.ui.position.left, 0, Math.max(0, window.innerWidth - 80));
    state.ui.position.top = clamp(state.ui.position.top, 0, Math.max(0, window.innerHeight - 40));
    applyPanelPosition();
    saveState();
  }

  function handleDragStart(event) {
    if (!panel || !event.target.closest("[data-drag-handle]")) {
      return;
    }
    if (event.target.closest("button, input, textarea, select, label, a")) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    document.documentElement.classList.add("ptk-dragging");
    event.preventDefault();
  }

  function handleDragMove(event) {
    if (!dragState || !panel) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const left = clamp(event.clientX - dragState.offsetX, 0, Math.max(0, window.innerWidth - rect.width));
    const top = clamp(event.clientY - dragState.offsetY, 0, Math.max(0, window.innerHeight - rect.height));
    state.ui.position = { left, top };
    applyPanelPosition();
  }

  function handleDragEnd() {
    if (!dragState) {
      return;
    }
    dragState = null;
    document.documentElement.classList.remove("ptk-dragging");
    saveState();
  }

  function startIntervals() {
    if (!pomodoroInterval) {
      pomodoroInterval = window.setInterval(updatePomodoro, 1000);
    }
    if (!timeTrackerInterval) {
      timeTrackerInterval = window.setInterval(trackVisibleTime, 5000);
    }
    if (!focusInterval) {
      focusInterval = window.setInterval(updateFocusOverlay, 1000);
    }
    if (!scheduleInterval) {
      scheduleInterval = window.setInterval(checkSchedules, 30000);
    }
  }

  function stopIntervals() {
    if (pomodoroInterval) {
      window.clearInterval(pomodoroInterval);
      pomodoroInterval = null;
    }
    if (timeTrackerInterval) {
      window.clearInterval(timeTrackerInterval);
      timeTrackerInterval = null;
    }
    if (focusInterval) {
      window.clearInterval(focusInterval);
      focusInterval = null;
    }
    if (scheduleInterval) {
      window.clearInterval(scheduleInterval);
      scheduleInterval = null;
    }
  }

  function updateLauncher() {
    if (!edgeTab) {
      return;
    }
    const label = edgeTab.querySelector("small");
    if (!label) {
      return;
    }
    if (state.pomodoro.running && isFeatureEnabled("pomodoro")) {
      label.textContent = formatCountdown(getPomodoroRemainingMs());
    } else {
      label.textContent = "Toolkit";
    }
  }

  function toast(message) {
    if (!root) {
      return;
    }
    const toastNode = root.querySelector(".ptk-toast");
    if (!toastNode) {
      return;
    }
    toastNode.textContent = message;
    toastNode.classList.add("ptk-toast-visible");
    window.clearTimeout(toastNode._ptkTimer);
    toastNode._ptkTimer = window.setTimeout(() => {
      toastNode.classList.remove("ptk-toast-visible");
    }, 2200);
  }

  function getFieldValue(field) {
    const input = root && root.querySelector('[data-field="' + cssEscape(field) + '"]');
    return input ? input.value || "" : "";
  }

  function getSiteRule(domain) {
    const cleanDomain = normalizeDomain(domain);
    if (!cleanDomain || !state.siteRules[cleanDomain]) {
      return { toolkitDisabled: false, disabledFeatures: {} };
    }
    return state.siteRules[cleanDomain];
  }

  function ensureSiteRule(domain) {
    const cleanDomain = normalizeDomain(domain);
    if (!state.siteRules[cleanDomain]) {
      state.siteRules[cleanDomain] = { toolkitDisabled: false, disabledFeatures: {} };
    }
    return state.siteRules[cleanDomain];
  }

  function isToolkitDisabledForCurrentDomain() {
    return Boolean(currentDomain && getSiteRule(currentDomain).toolkitDisabled);
  }

  function isFeatureEnabled(feature) {
    if (isToolkitDisabledForCurrentDomain()) {
      return false;
    }
    const rule = getSiteRule(currentDomain);
    return !rule.disabledFeatures[feature];
  }

  function getCurrentDomain() {
    try {
      return normalizeDomain(window.location && window.location.hostname ? window.location.hostname : "");
    } catch (error) {
      return "";
    }
  }

  function normalizeDomain(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^www\./, "");
  }

  function eventToCombo(event) {
    const parts = [];
    if (event.ctrlKey) {
      parts.push("Ctrl");
    }
    if (event.altKey) {
      parts.push("Alt");
    }
    if (event.shiftKey) {
      parts.push("Shift");
    }
    if (event.metaKey) {
      parts.push("Meta");
    }
    const key = normalizeKey(event.key);
    if (!key) {
      return "";
    }
    if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
      parts.push(key);
    }
    return parts.join("+");
  }

  function normalizeComboString(combo) {
    if (typeof combo !== "string" || !combo.trim()) {
      return "";
    }
    const parts = combo.split("+").map((part) => part.trim()).filter(Boolean);
    const modifiers = [];
    let key = "";
    parts.forEach((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl" || lower === "control") {
        modifiers.push("Ctrl");
      } else if (lower === "alt" || lower === "option") {
        modifiers.push("Alt");
      } else if (lower === "shift") {
        modifiers.push("Shift");
      } else if (lower === "meta" || lower === "cmd" || lower === "command") {
        modifiers.push("Meta");
      } else {
        key = normalizeKey(part);
      }
    });
    return uniqueStrings(modifiers).concat(key ? [key] : []).join("+");
  }

  function normalizeKey(key) {
    if (!key) {
      return "";
    }
    const aliases = {
      " ": "Space",
      Spacebar: "Space",
      Esc: "Escape",
      Del: "Delete",
      Up: "ArrowUp",
      Down: "ArrowDown",
      Left: "ArrowLeft",
      Right: "ArrowRight"
    };
    if (aliases[key]) {
      return aliases[key];
    }
    return key.length === 1 ? key.toUpperCase() : key;
  }

  function isModifierOnly(event) {
    return ["Control", "Shift", "Alt", "Meta"].includes(event.key);
  }

  function isTypingTarget(target) {
    if (!target || isInsideToolkit(target)) {
      return Boolean(target && target.closest && target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
    }
    return isTextControl(target) || Boolean(target.closest && target.closest("[contenteditable=''], [contenteditable='true']"));
  }

  function isTextControl(target) {
    if (!target || !target.tagName) {
      return false;
    }
    const tag = target.tagName.toLowerCase();
    if (tag === "textarea") {
      return true;
    }
    if (tag !== "input") {
      return false;
    }
    const type = String(target.type || "text").toLowerCase();
    return ["text", "search", "url", "tel", "email"].includes(type);
  }

  function isPasswordField(target) {
    return target && target.tagName && target.tagName.toLowerCase() === "input" && String(target.type || "").toLowerCase() === "password";
  }

  function isInsideToolkit(target) {
    return Boolean(target && target.closest && (target.closest("#" + APP.rootId) || target.closest("#" + APP.disabledId)));
  }

  function currentWeekKeys() {
    const today = new Date();
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return dateKey(date);
    });
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) {
      return hours + "h " + String(minutes).padStart(2, "0") + "m";
    }
    if (minutes) {
      return minutes + "m " + String(secs).padStart(2, "0") + "s";
    }
    return secs + "s";
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType || "text/plain" });
    const canUseObjectUrl = window.URL && typeof URL.createObjectURL === "function";
    const url = canUseObjectUrl
      ? URL.createObjectURL(blob)
      : "data:" + encodeURIComponent(mimeType || "text/plain") + ";charset=utf-8," + encodeURIComponent(text);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (canUseObjectUrl && typeof URL.revokeObjectURL === "function") {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function csvCell(value) {
    const text = String(value == null ? "" : value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
  }

  function createId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function stringOr(value, fallback) {
    return typeof value === "string" ? value : fallback;
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    values.forEach((value) => {
      const text = String(value || "").trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        result.push(text);
      }
    });
    return result;
  }

  function uniqueNumbers(values) {
    return Array.from(new Set(values.map(Number))).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  }

  function isTimeString(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function addStyles() {
    if (document.getElementById(APP.styleId)) {
      return;
    }
    const css = `
#${APP.rootId}, #${APP.rootId} *, #${APP.focusOverlayId}, #${APP.focusOverlayId} *, #${APP.disabledId} {
  box-sizing: border-box;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}
#${APP.rootId} {
  position: fixed;
  z-index: 2147483000;
  inset: auto 0 0 auto;
  color: #17202a;
}
#${APP.rootId} button, #${APP.disabledId} {
  border: 1px solid #8aa0b8;
  background: #ffffff;
  color: #17202a;
  min-height: 34px;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
}
#${APP.rootId} button:hover, #${APP.disabledId}:hover {
  background: #eef4fb;
}
.ptk-edge-tab {
  position: fixed;
  top: 50%;
  right: -76px;
  transform: translateY(-50%);
  width: 112px;
  min-height: 46px !important;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 12px !important;
  border-radius: 8px 0 0 8px !important;
  border: 1px solid #5f7f9d !important;
  background: #e9edf2 !important;
  box-shadow: 0 10px 26px rgba(23, 32, 42, 0.22);
  transition: right 0.18s ease, box-shadow 0.18s ease;
}
.ptk-edge-tab:hover, .ptk-edge-tab:focus, .ptk-edge-tab:focus-visible {
  background: #dde5ee !important;
  right: 0;
  box-shadow: 0 12px 30px rgba(23, 32, 42, 0.28);
}
.ptk-toolbox-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ptk-edge-tab small {
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.ptk-panel {
  position: fixed;
  right: 18px;
  bottom: 82px;
  width: min(420px, calc(100vw - 24px));
  max-height: min(760px, calc(100vh - 110px));
  background: #f8fafc;
  border: 1px solid #9cafbf;
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(23, 32, 42, 0.28);
  overflow: hidden;
}
.ptk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #243447;
  color: #ffffff;
  padding: 10px 12px;
  cursor: move;
  user-select: none;
}
.ptk-header strong {
  display: block;
  font-size: 14px;
}
.ptk-header span {
  display: block;
  margin-top: 2px;
  color: #dbe6ef;
  font-size: 11px;
}
.ptk-header-actions {
  display: flex;
  gap: 6px;
}
#${APP.rootId} .ptk-header .ptk-icon-button {
  background: #ffffff;
  border-color: #d5e0ea;
  min-height: 28px;
  padding: 4px 8px;
}
.ptk-tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  overflow-x: auto;
  background: #e8eef4;
  border-bottom: 1px solid #c5d1dc;
}
#${APP.rootId} .ptk-tabs button {
  min-height: 30px;
  white-space: nowrap;
  background: transparent;
  border-color: transparent;
}
#${APP.rootId} .ptk-tabs button[aria-current="page"] {
  background: #ffffff;
  border-color: #9cafbf;
  font-weight: 700;
}
.ptk-body {
  max-height: calc(min(760px, 100vh - 110px) - 94px);
  overflow: auto;
  padding: 12px;
}
.ptk-section {
  display: grid;
  gap: 12px;
}
.ptk-section-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.ptk-section-title h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.25;
}
.ptk-section-title span, .ptk-muted {
  color: #5f6f7f;
  font-size: 12px;
}
.ptk-subpanel, .ptk-list-item {
  border: 1px solid #d2dce6;
  border-radius: 8px;
  background: #ffffff;
  padding: 10px;
}
.ptk-subpanel h3 {
  margin: 0 0 8px;
  font-size: 13px;
}
.ptk-list {
  display: grid;
  gap: 8px;
}
.ptk-list-heading, .ptk-status-row, .ptk-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ptk-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.ptk-inline-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
}
.ptk-label {
  display: grid;
  gap: 5px;
  color: #405163;
  font-size: 12px;
}
#${APP.rootId} input, #${APP.rootId} textarea, #${APP.rootId} select {
  width: 100%;
  min-height: 34px;
  border: 1px solid #aebccd;
  border-radius: 6px;
  background: #ffffff;
  color: #17202a;
  padding: 7px 8px;
  font-size: 13px;
  line-height: 1.3;
}
#${APP.rootId} textarea {
  resize: vertical;
}
.ptk-notes {
  min-height: 230px;
}
.ptk-checkbox {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: #17202a;
}
#${APP.rootId} .ptk-checkbox input {
  width: auto;
  min-height: auto;
}
.ptk-danger-check {
  border: 1px solid #e0b1a7;
  border-radius: 8px;
  background: #fff7f5;
  padding: 10px;
}
.ptk-day-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}
.ptk-day-row input {
  width: auto !important;
  min-height: auto !important;
}
.ptk-schedule-add {
  display: grid;
  gap: 8px;
}
.ptk-pill, .ptk-kbd {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  background: #e8eef4;
  color: #27384a;
  padding: 3px 8px;
  font-size: 12px;
  font-weight: 700;
}
.ptk-pill-active {
  background: #daf2e3;
  color: #1d6537;
}
.ptk-timer-display {
  font-variant-numeric: tabular-nums;
  font-size: 42px;
  font-weight: 800;
  text-align: center;
  color: #223244;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #d2dce6;
  border-radius: 8px;
}
.ptk-table {
  width: 100%;
  border-collapse: collapse;
  background: #ffffff;
  font-size: 12px;
}
.ptk-table th, .ptk-table td {
  border-bottom: 1px solid #d8e1ea;
  padding: 7px;
  text-align: left;
}
.ptk-table th:last-child, .ptk-table td:last-child {
  text-align: right;
}
.ptk-empty {
  margin: 0;
  color: #6b7c8f;
  font-size: 12px;
}
.${APP.highlightClass} {
  background: #fff08a !important;
  color: inherit !important;
  padding: 0 1px;
}
.ptk-toast {
  position: fixed;
  right: 18px;
  bottom: 84px;
  max-width: min(360px, calc(100vw - 24px));
  background: #17202a;
  color: #ffffff;
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 12px;
  box-shadow: 0 10px 26px rgba(23, 32, 42, 0.24);
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.ptk-toast-visible {
  opacity: 1;
  transform: translateY(0);
}
#${APP.focusOverlayId} {
  position: fixed;
  z-index: 2147482999;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(16, 24, 32, 0.94);
  color: #ffffff;
  padding: 24px;
}
.ptk-focus-card {
  width: min(520px, 100%);
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 8px;
  background: #233242;
  padding: 24px;
  text-align: center;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.35);
}
.ptk-focus-card h1 {
  margin: 0 0 10px;
  font-size: 24px;
}
.ptk-focus-card p {
  margin: 0 0 16px;
  color: #d8e3ed;
}
.ptk-focus-card strong {
  display: block;
  margin-bottom: 18px;
}
.ptk-focus-card button {
  min-height: 38px;
  border: 1px solid #ffffff;
  border-radius: 6px;
  background: #ffffff;
  color: #17202a;
  padding: 8px 12px;
  cursor: pointer;
}
#${APP.disabledId} {
  position: fixed;
  z-index: 2147483000;
  top: 50%;
  right: -70px;
  bottom: auto;
  transform: translateY(-50%);
  width: 106px;
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  border-radius: 8px 0 0 8px;
  border-color: #b56c5b;
  background: #ece7e5;
  box-shadow: 0 10px 24px rgba(23, 32, 42, 0.2);
  transition: right 0.18s ease, box-shadow 0.18s ease;
}
#${APP.disabledId}:hover, #${APP.disabledId}:focus, #${APP.disabledId}:focus-visible {
  background: #e3d8d4;
  right: 0;
  box-shadow: 0 12px 30px rgba(23, 32, 42, 0.26);
}
#${APP.disabledId} small {
  font-size: 11px;
  font-weight: 700;
}
.ptk-dragging, .ptk-dragging * {
  user-select: none !important;
}
#${APP.rootId}[data-theme="dark"] {
  color: #edf3f8;
}
#${APP.rootId}[data-theme="dark"] button {
  border-color: #53677c;
  background: #1b2633;
  color: #edf3f8;
}
#${APP.rootId}[data-theme="dark"] button:hover {
  background: #263648;
}
#${APP.rootId}[data-theme="dark"] .ptk-edge-tab {
  border-color: #6c8aae !important;
  background: #1b2633 !important;
  color: #f8fafc;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.38);
}
#${APP.rootId}[data-theme="dark"] .ptk-panel {
  background: #101820;
  border-color: #43566b;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48);
}
#${APP.rootId}[data-theme="dark"] .ptk-header {
  background: #0b1118;
  color: #f8fafc;
}
#${APP.rootId}[data-theme="dark"] .ptk-header span {
  color: #b8c7d7;
}
#${APP.rootId}[data-theme="dark"] .ptk-header .ptk-icon-button {
  background: #1b2633;
  border-color: #53677c;
  color: #edf3f8;
}
#${APP.rootId}[data-theme="dark"] .ptk-tabs {
  background: #172231;
  border-color: #34475c;
}
#${APP.rootId}[data-theme="dark"] .ptk-tabs button {
  color: #dbe5ee;
}
#${APP.rootId}[data-theme="dark"] .ptk-tabs button[aria-current="page"] {
  background: #243247;
  border-color: #526a85;
  color: #ffffff;
}
#${APP.rootId}[data-theme="dark"] .ptk-section-title span,
#${APP.rootId}[data-theme="dark"] .ptk-muted,
#${APP.rootId}[data-theme="dark"] .ptk-empty {
  color: #aab8c7;
}
#${APP.rootId}[data-theme="dark"] .ptk-subpanel,
#${APP.rootId}[data-theme="dark"] .ptk-list-item,
#${APP.rootId}[data-theme="dark"] .ptk-timer-display,
#${APP.rootId}[data-theme="dark"] .ptk-table {
  background: #151f2b;
  border-color: #34475c;
  color: #edf3f8;
}
#${APP.rootId}[data-theme="dark"] .ptk-label,
#${APP.rootId}[data-theme="dark"] .ptk-checkbox {
  color: #edf3f8;
}
#${APP.rootId}[data-theme="dark"] input,
#${APP.rootId}[data-theme="dark"] textarea,
#${APP.rootId}[data-theme="dark"] select {
  background: #0f1720;
  border-color: #52667d;
  color: #f8fafc;
}
#${APP.rootId}[data-theme="dark"] input::placeholder,
#${APP.rootId}[data-theme="dark"] textarea::placeholder {
  color: #8fa1b4;
}
#${APP.rootId}[data-theme="dark"] .ptk-danger-check {
  background: #291819;
  border-color: #76524f;
}
#${APP.rootId}[data-theme="dark"] .ptk-pill,
#${APP.rootId}[data-theme="dark"] .ptk-kbd {
  background: #27384c;
  color: #edf3f8;
}
#${APP.rootId}[data-theme="dark"] .ptk-pill-active {
  background: #123d2a;
  color: #9ee8b8;
}
#${APP.rootId}[data-theme="dark"] .ptk-table th,
#${APP.rootId}[data-theme="dark"] .ptk-table td {
  border-color: #34475c;
}
@media (max-width: 520px) {
  .ptk-panel {
    width: calc(100vw - 16px);
    right: 8px;
    bottom: 76px;
  }
  .ptk-grid-2 {
    grid-template-columns: 1fr;
  }
  .ptk-section-title, .ptk-list-heading, .ptk-status-row, .ptk-row {
    align-items: stretch;
    flex-direction: column;
  }
}
`;
    try {
      if (typeof GM_addStyle === "function") {
        const styleNode = GM_addStyle(css);
        if (styleNode && styleNode.setAttribute) {
          styleNode.setAttribute("id", APP.styleId);
        }
        return;
      }
    } catch (error) {
      console.warn("Productivity Toolkit: GM_addStyle failed", error);
    }
    const style = document.createElement("style");
    style.id = APP.styleId;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
})();
