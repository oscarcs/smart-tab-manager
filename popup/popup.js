const queryInput = document.querySelector("#queryInput");
const composerPanel = document.querySelector("#composerPanel");
const clearButton = document.querySelector("#clearButton");
const settingsButton = document.querySelector("#settingsButton");
const queryView = document.querySelector("#queryView");
const runButton = document.querySelector("#runButton");
const newQueryButton = document.querySelector("#newQueryButton");
const executeButton = document.querySelector("#executeButton");
const statusMessage = document.querySelector("#statusMessage");
const responsePanel = document.querySelector("#responsePanel");
const responseMeta = document.querySelector("#responseMeta");
const responseOutput = document.querySelector("#responseOutput");
const actionList = document.querySelector("#actionList");
const settingsPanel = document.querySelector("#settingsPanel");
const geminiApiKeyInput = document.querySelector("#geminiApiKeyInput");
const geminiModelInput = document.querySelector("#geminiModelInput");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const settingsStatus = document.querySelector("#settingsStatus");
const DRAFT_STORAGE_KEY = "queryDraft";
const PLAN_STORAGE_KEY = "pendingPlan";
const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
let pendingActions = [];
let pendingSummary = "";
let pendingModel = "";
let hasConfiguredApiKey = false;
let showingSettings = false;

async function saveDraft() {
  await browser.storage.local.set({ [DRAFT_STORAGE_KEY]: queryInput.value });
}

async function loadDraft() {
  const stored = await browser.storage.local.get(DRAFT_STORAGE_KEY);
  queryInput.value = stored[DRAFT_STORAGE_KEY] ?? "";
}

function setStatus(element, message) {
  element.textContent = message;
}

async function savePendingPlan() {
  await browser.storage.local.set({
    [PLAN_STORAGE_KEY]: {
      summary: pendingSummary,
      model: pendingModel,
      actions: pendingActions
    }
  });
}

async function clearPendingPlan() {
  pendingSummary = "";
  pendingModel = "";
  pendingActions = [];
  await browser.storage.local.remove(PLAN_STORAGE_KEY);
}

function setBusy(isBusy) {
  runButton.disabled = isBusy;
  executeButton.disabled = isBusy || pendingActions.length === 0;
  newQueryButton.disabled = isBusy;
  saveSettingsButton.disabled = isBusy;
  clearButton.disabled = isBusy;
}

function renderPlanState() {
  const hasPlan = Boolean(pendingSummary) || pendingActions.length > 0;

  composerPanel.hidden = hasPlan;
  responsePanel.hidden = !hasPlan;

  if (!hasPlan) {
    actionList.replaceChildren();
    responseOutput.textContent = "";
    responseMeta.textContent = "";
    executeButton.disabled = true;
    return;
  }

  responseOutput.textContent = pendingSummary;
  responseMeta.textContent = pendingModel;
  actionList.replaceChildren();

  for (const action of pendingActions) {
    const item = document.createElement("li");
    item.textContent = action.description;
    actionList.append(item);
  }

  executeButton.disabled = pendingActions.length === 0;
}

function updateView() {
  const forceSettings = !hasConfiguredApiKey;
  const showSettings = forceSettings || showingSettings;

  settingsPanel.hidden = !showSettings;
  queryView.hidden = showSettings;
  settingsButton.setAttribute("aria-label", showSettings ? "Close settings" : "Open settings");
  settingsButton.title = showSettings ? "Close settings" : "Open settings";

  if (showSettings) {
    geminiApiKeyInput.focus();
    return;
  }

  queryInput.focus();
}

function toggleSettingsPanel() {
  if (!hasConfiguredApiKey) {
    showingSettings = true;
  } else {
    showingSettings = !showingSettings;
  }

  updateView();
}

async function loadSettings() {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  geminiApiKeyInput.value = settings.geminiApiKey ?? "";
  geminiModelInput.value = settings.geminiModel ?? DEFAULT_GEMINI_MODEL;
  hasConfiguredApiKey = Boolean((settings.geminiApiKey ?? "").trim());
  showingSettings = !hasConfiguredApiKey;
  updateView();
}

async function loadPendingPlan() {
  const stored = await browser.storage.local.get(PLAN_STORAGE_KEY);
  const plan = stored[PLAN_STORAGE_KEY];

  if (!plan || typeof plan !== "object") {
    renderPlanState();
    return;
  }

  pendingSummary = typeof plan.summary === "string" ? plan.summary : "";
  pendingModel = typeof plan.model === "string" ? plan.model : "";
  pendingActions = Array.isArray(plan.actions) ? plan.actions : [];
  renderPlanState();
}

async function saveSettings() {
  const settings = await browser.runtime.sendMessage({
    type: "saveSettings",
    settings: {
      geminiApiKey: geminiApiKeyInput.value,
      geminiModel: geminiModelInput.value || DEFAULT_GEMINI_MODEL
    }
  });

  geminiApiKeyInput.value = settings.geminiApiKey;
  geminiModelInput.value = settings.geminiModel;
  hasConfiguredApiKey = Boolean(settings.geminiApiKey);
  showingSettings = !hasConfiguredApiKey ? true : false;
  updateView();
  setStatus(settingsStatus, "Settings saved.");
}

async function runQuery() {
  const query = queryInput.value.trim();

  if (!query) {
    setStatus(statusMessage, "Enter a query first.");
    queryInput.focus();
    return;
  }

  setBusy(true);
  setStatus(statusMessage, "Calling Gemini...");
  composerPanel.hidden = false;
  responsePanel.hidden = true;

  try {
    await saveDraft();
    const result = await browser.runtime.sendMessage({
      type: "planQuery",
      query
    });

    pendingActions = result.proposal.actions ?? [];
    pendingSummary = result.proposal.summary;
    pendingModel = result.model;
    await savePendingPlan();
    renderPlanState();
    setStatus(
      statusMessage,
      pendingActions.length === 0 ? "No actions proposed." : "Review the proposed actions, then execute if they look right."
    );
  } catch (error) {
    setStatus(statusMessage, error.message);
  } finally {
    setBusy(false);
  }
}

async function executeProposal() {
  if (pendingActions.length === 0) {
    setStatus(statusMessage, "No actions to execute.");
    return;
  }

  setBusy(true);
  setStatus(statusMessage, "Executing actions...");

  try {
    const result = await browser.runtime.sendMessage({
      type: "executeProposal",
      actions: pendingActions
    });

    await clearPendingPlan();
    renderPlanState();
    setStatus(statusMessage, `Executed ${result.executed} action${result.executed === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(statusMessage, error.message);
  } finally {
    setBusy(false);
  }
}

queryInput.addEventListener("input", () => {
  saveDraft().catch(console.error);
});

queryInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runQuery().catch(console.error);
  }
});

clearButton.addEventListener("click", async () => {
  queryInput.value = "";
  await saveDraft();
  setStatus(statusMessage, "");
  queryInput.focus();
});

newQueryButton.addEventListener("click", () => {
  clearPendingPlan()
    .then(() => {
      renderPlanState();
      setStatus(statusMessage, "");
      queryInput.focus();
    })
    .catch(console.error);
});

settingsButton.addEventListener("click", toggleSettingsPanel);
saveSettingsButton.addEventListener("click", () => {
  saveSettings().catch((error) => {
    setStatus(settingsStatus, error.message);
  });
});
runButton.addEventListener("click", () => {
  runQuery().catch(console.error);
});
executeButton.addEventListener("click", () => {
  executeProposal().catch(console.error);
});

Promise.all([loadDraft(), loadSettings(), loadPendingPlan()]).catch(console.error);
