const STORAGE_KEY = "tabMetadata";
const SETTINGS_KEY = "llmSettings";
const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const ACTION_TYPES = new Set([
  "close_tabs",
  "focus_tab",
  "pin_tabs",
  "unpin_tabs",
  "group_tabs",
  "ungroup_tabs",
  "move_tabs",
  "open_tab"
]);

async function getMetadata() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? {};
}

async function setMetadata(metadata) {
  await browser.storage.local.set({ [STORAGE_KEY]: metadata });
}

async function updateMetadataForTab(tabId, updater) {
  const key = String(tabId);
  const metadata = await getMetadata();
  const current = metadata[key] ?? {};
  const next = updater(current);

  if (!next) {
    delete metadata[key];
  } else {
    metadata[key] = next;
  }

  await setMetadata(metadata);
}

async function ensureTabSeen(tabId, { markActive = false } = {}) {
  const now = Date.now();

  await updateMetadataForTab(tabId, (current) => ({
    firstSeenAt: current.firstSeenAt ?? now,
    lastActiveAt: markActive ? now : (current.lastActiveAt ?? null)
  }));
}

async function removeTabMetadata(tabId) {
  await updateMetadataForTab(tabId, () => null);
}

async function seedExistingTabs() {
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    await ensureTabSeen(tab.id, { markActive: Boolean(tab.active) });
  }
}

browser.runtime.onInstalled.addListener(() => {
  seedExistingTabs().catch(console.error);
});

browser.runtime.onStartup.addListener(() => {
  seedExistingTabs().catch(console.error);
});

browser.tabs.onCreated.addListener((tab) => {
  ensureTabSeen(tab.id, { markActive: Boolean(tab.active) }).catch(console.error);
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  ensureTabSeen(tabId, { markActive: true }).catch(console.error);
});

browser.tabs.onRemoved.addListener((tabId) => {
  removeTabMetadata(tabId).catch(console.error);
});

seedExistingTabs().catch(console.error);

async function getLlmSettings() {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] ?? {};

  return {
    geminiApiKey: typeof settings.geminiApiKey === "string" ? settings.geminiApiKey : "",
    geminiModel:
      typeof settings.geminiModel === "string" && settings.geminiModel.trim()
        ? settings.geminiModel.trim()
        : DEFAULT_GEMINI_MODEL
  };
}

async function saveLlmSettings(nextSettings) {
  const settings = {
    geminiApiKey: typeof nextSettings.geminiApiKey === "string" ? nextSettings.geminiApiKey.trim() : "",
    geminiModel:
      typeof nextSettings.geminiModel === "string" && nextSettings.geminiModel.trim()
        ? nextSettings.geminiModel.trim()
        : DEFAULT_GEMINI_MODEL
  };

  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function getTabContext() {
  const [tabs, metadata] = await Promise.all([
    browser.tabs.query({ lastFocusedWindow: true }),
    getMetadata()
  ]);

  return tabs
    .sort((left, right) => left.index - right.index)
    .slice(0, 80)
    .map((tab) => {
      const tabData = metadata[String(tab.id)] ?? {};
      return {
        id: tab.id,
        index: tab.index,
        windowId: tab.windowId,
        title: tab.title || "Untitled tab",
        url: tab.url || "",
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        audible: Boolean(tab.audible),
        discarded: Boolean(tab.discarded),
        groupId: typeof tab.groupId === "number" ? tab.groupId : -1,
        lastActiveAt: tabData.lastActiveAt ?? null
      };
    })
    .sort((left, right) => left.index - right.index);
}

function extractTextFromCandidate(candidate) {
  const parts = candidate?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function parseJsonResponse(text) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      return JSON.parse(fencedMatch[1].trim());
    }
  }

  throw new Error("Gemini did not return valid JSON.");
}

function normalizeTabIds(value) {
  if (!Array.isArray(value)) {
    throw new Error("Action tabIds must be an array.");
  }

  const ids = value.filter((item) => Number.isInteger(item));
  if (ids.length === 0) {
    throw new Error("Action tabIds must include at least one tab id.");
  }

  return [...new Set(ids)];
}

function normalizeAction(action, availableTabIds) {
  if (!action || typeof action !== "object") {
    throw new Error("Each action must be an object.");
  }

  if (!ACTION_TYPES.has(action.type)) {
    throw new Error(`Unsupported action type: ${action.type}`);
  }

  const normalized = {
    type: action.type,
    description:
      typeof action.description === "string" && action.description.trim()
        ? action.description.trim()
        : action.type
  };

  if (["close_tabs", "pin_tabs", "unpin_tabs", "group_tabs", "ungroup_tabs"].includes(action.type)) {
    normalized.tabIds = normalizeTabIds(action.tabIds);
  }

  if (action.type === "focus_tab") {
    if (!Number.isInteger(action.tabId)) {
      throw new Error("focus_tab requires a numeric tabId.");
    }

    normalized.tabId = action.tabId;
  }

  if (action.type === "move_tabs") {
    normalized.tabIds = normalizeTabIds(action.tabIds);

    if (!Number.isInteger(action.index) || action.index < 0) {
      throw new Error("move_tabs requires a non-negative index.");
    }

    normalized.index = action.index;
  }

  if (action.type === "open_tab") {
    if (typeof action.url !== "string" || !action.url.trim()) {
      throw new Error("open_tab requires a url.");
    }

    normalized.url = action.url.trim();

    if (typeof action.active === "boolean") {
      normalized.active = action.active;
    }
  }

  const referencedTabIds = [
    ...(normalized.tabIds ?? []),
    ...(Number.isInteger(normalized.tabId) ? [normalized.tabId] : [])
  ];

  for (const tabId of referencedTabIds) {
    if (!availableTabIds.has(tabId)) {
      throw new Error(`Action references unknown tabId ${tabId}.`);
    }
  }

  return normalized;
}

function normalizeProposal(proposal, tabs) {
  if (!proposal || typeof proposal !== "object") {
    throw new Error("Gemini response must be a JSON object.");
  }

  const availableTabIds = new Set(tabs.map((tab) => tab.id));
  const actions = Array.isArray(proposal.actions) ? proposal.actions : [];

  return {
    summary:
      typeof proposal.summary === "string" && proposal.summary.trim()
        ? proposal.summary.trim()
        : "No summary provided.",
    actions: actions.map((action) => normalizeAction(action, availableTabIds))
  };
}

async function callGemini(query, tabs) {
  const settings = await getLlmSettings();

  if (!settings.geminiApiKey) {
    throw new Error("Add a Gemini API key in Settings before running a query.");
  }

  const response = await fetch(`${GEMINI_API_ROOT}/${settings.geminiModel}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": settings.geminiApiKey
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text:
              "You are Smart Tab Manager, a browser tab assistant. " +
              "You receive the user's query and a JSON array of current browser tabs. " +
              "Return JSON only with this shape: " +
              "{\"summary\":\"string\",\"actions\":[{\"type\":\"allowed_action\",\"description\":\"string\",...}]}. " +
              "Allowed action types are: close_tabs, focus_tab, pin_tabs, unpin_tabs, group_tabs, ungroup_tabs, move_tabs, open_tab. " +
              "Use only the provided tab ids. Never invent tabs. Use actions: [] if no change should be made. " +
              "For close_tabs, only propose closing tabs when the user's request clearly implies it."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `User query:\n${query}\n\n` +
                `Current tabs JSON:\n${JSON.stringify(tabs, null, 2)}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiMessage = payload?.error?.message;
    throw new Error(apiMessage || `Gemini request failed with status ${response.status}.`);
  }

  const text = payload?.candidates?.map(extractTextFromCandidate).find(Boolean) ?? "";

  if (!text) {
    throw new Error("Gemini returned no text response.");
  }

  return {
    model: settings.geminiModel,
    proposal: normalizeProposal(parseJsonResponse(text), tabs)
  };
}

async function planGeminiQuery(query) {
  const tabs = await getTabContext();
  return callGemini(query, tabs);
}

async function executeAction(action) {
  if (action.type === "close_tabs") {
    await browser.tabs.remove(action.tabIds);
    return;
  }

  if (action.type === "focus_tab") {
    const tab = await browser.tabs.get(action.tabId);
    await browser.tabs.update(action.tabId, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
    return;
  }

  if (action.type === "pin_tabs" || action.type === "unpin_tabs") {
    const pinned = action.type === "pin_tabs";
    await Promise.all(action.tabIds.map((tabId) => browser.tabs.update(tabId, { pinned })));
    return;
  }

  if (action.type === "group_tabs") {
    await browser.tabs.group({ tabIds: action.tabIds });
    return;
  }

  if (action.type === "ungroup_tabs") {
    await browser.tabs.ungroup(action.tabIds);
    return;
  }

  if (action.type === "move_tabs") {
    await browser.tabs.move(action.tabIds, { index: action.index });
    return;
  }

  if (action.type === "open_tab") {
    await browser.tabs.create({
      url: action.url,
      active: action.active ?? true
    });
    return;
  }

  throw new Error(`Unsupported action type: ${action.type}`);
}

async function executeProposal(actions) {
  const tabs = await getTabContext();
  const proposal = normalizeProposal({ summary: "Execution request", actions }, tabs);

  for (const action of proposal.actions) {
    await executeAction(action);
  }

  return { executed: proposal.actions.length };
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "getSettings") {
    return getLlmSettings();
  }

  if (message.type === "saveSettings") {
    return saveLlmSettings(message.settings ?? {});
  }

  if (message.type === "planQuery") {
    return planGeminiQuery(typeof message.query === "string" ? message.query.trim() : "");
  }

  if (message.type === "executeProposal") {
    return executeProposal(message.actions ?? []);
  }

  return undefined;
});
