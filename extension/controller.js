const DEFAULT_MODELS = [
  {
    key: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    patterns: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  },
  {
    key: "gemini",
    label: "Gemini",
    url: "https://gemini.google.com/",
    patterns: ["https://gemini.google.com/*"]
  },
  {
    key: "claude",
    label: "Claude",
    url: "https://claude.ai/new",
    patterns: ["https://claude.ai/*"]
  }
];

const CONTROL_HEIGHT = 270;

const state = {
  models: [],
  tabsByModel: {},
  roles: {},
  workbenchWindowIds: {},
  controllerWindowId: null
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get({
    prompt: "",
    autoSubmit: true,
    models: DEFAULT_MODELS,
    roles: { chatgpt: "answerer", gemini: "answerer", claude: "judge" },
    workbenchWindowIds: {},
    splitWindowIds: {}
  });

  const current = await chrome.windows.getCurrent();
  state.controllerWindowId = current.id;
  state.models = normalizeModels(stored.models);
  state.roles = { ...stored.roles };
  state.workbenchWindowIds = {
    ...stored.splitWindowIds,
    ...stored.workbenchWindowIds
  };

  $("prompt").value = stored.prompt;
  $("autoSubmit").checked = stored.autoSubmit;

  renderRoles();

  $("prompt").addEventListener("input", saveSettings);
  $("autoSubmit").addEventListener("change", saveSettings);
  $("arrange").addEventListener("click", () => arrangeWorkbench(false));
  $("send").addEventListener("click", sendPrompt);
  $("judge").addEventListener("click", sendJudgePrompt);
  $("addModel").addEventListener("click", openAddModelDialog);
  $("cancelModel").addEventListener("click", () => $("modelDialog").close());
  $("modelForm").addEventListener("submit", saveModelFromDialog);

  await chrome.storage.local.set({ controllerWindowId: current.id });
  await arrangeWorkbench(false);
});

function renderRoles() {
  const roles = $("roles");
  roles.textContent = "";

  for (const model of state.models) {
    const wrapper = document.createElement("div");
    wrapper.className = "role-item";
    wrapper.dataset.key = model.key;

    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = model.label;

    const select = document.createElement("select");
    select.id = `role-${model.key}`;
    select.innerHTML = `
      <option value="answerer">回答</option>
      <option value="judge">裁判</option>
      <option value="off">关闭</option>
    `;
    select.value = state.roles[model.key] || defaultRoleFor(model.key);
    state.roles[model.key] = select.value;
    select.addEventListener("change", async () => {
      state.roles[model.key] = select.value;
      enforceSingleJudge(model.key);
      await saveSettings();
      renderRoles();
      await arrangeWorkbench(false);
    });

    label.append(name, select);
    wrapper.append(label);

    if (!model.builtIn) {
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-model";
      deleteButton.type = "button";
      deleteButton.title = `删除 ${model.label}`;
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", () => deleteModel(model.key));
      wrapper.append(deleteButton);
    }

    roles.append(wrapper);
  }
}

async function saveSettings() {
  await chrome.storage.local.set({
    prompt: $("prompt").value,
    autoSubmit: $("autoSubmit").checked,
    models: state.models,
    roles: state.roles,
    workbenchWindowIds: state.workbenchWindowIds,
    splitWindowIds: state.workbenchWindowIds,
    controllerWindowId: state.controllerWindowId
  });
}

async function arrangeWorkbench(forceNew) {
  $("arrange").disabled = true;
  setMessage("正在排列工作台窗口...");

  try {
    const screenInfo = getScreenInfo();
    const current = await chrome.windows.getCurrent();
    await chrome.windows.update(current.id, {
      left: screenInfo.left,
      top: screenInfo.top,
      width: screenInfo.width,
      height: CONTROL_HEIGHT,
      focused: true
    });

    const selectedModels = state.models.filter((model) => getRole(model.key) !== "off");
    const paneTop = screenInfo.top + CONTROL_HEIGHT;
    const paneHeight = Math.max(420, screenInfo.height - CONTROL_HEIGHT);
    const paneWidth = Math.max(320, Math.floor(screenInfo.width / Math.max(selectedModels.length, 1)));
    const nextWindowIds = {};

    for (let index = 0; index < selectedModels.length; index += 1) {
      const model = selectedModels[index];
      const isLast = index === selectedModels.length - 1;
      const left = screenInfo.left + paneWidth * index;
      const width = isLast ? screenInfo.width - paneWidth * index : paneWidth;
      const existingWindowId = forceNew ? null : state.workbenchWindowIds[model.key];
      const windowId = await openOrMoveModelWindow(model, {
        left,
        top: paneTop,
        width,
        height: paneHeight
      }, existingWindowId);
      nextWindowIds[model.key] = windowId;
    }

    state.workbenchWindowIds = {
      ...state.workbenchWindowIds,
      ...nextWindowIds
    };
    await saveSettings();
    await refreshTabs();
    setMessage("工作台已就绪。新增模型也可以选择回答、裁判或关闭。");
  } catch (error) {
    console.warn("Failed to arrange workbench", error);
    setMessage(`排列失败：${error.message || "可以再点一次重排窗口"}`);
  } finally {
    $("arrange").disabled = false;
  }
}

async function openOrMoveModelWindow(model, bounds, existingWindowId) {
  if (existingWindowId) {
    try {
      const win = await chrome.windows.get(existingWindowId);
      await chrome.windows.update(win.id, { ...bounds, focused: false });
      const tabs = await chrome.tabs.query({ windowId: win.id });
      if (!tabs.some((tab) => matchesModel(tab.url, model))) {
        await chrome.tabs.create({ windowId: win.id, url: model.url, active: true });
      }
      return win.id;
    } catch (_error) {
      // The user may have closed the previous pane; create a fresh one below.
    }
  }

  const win = await chrome.windows.create({
    url: model.url,
    type: "popup",
    focused: false,
    ...bounds
  });
  return win.id;
}

async function refreshTabs() {
  state.tabsByModel = {};
  for (const model of state.models) {
    const tabLists = await Promise.all(
      model.patterns.map((url) => chrome.tabs.query({ url }))
    );
    state.tabsByModel[model.key] = tabLists
      .flat()
      .sort((a, b) => scoreTab(b, model.key) - scoreTab(a, model.key));
  }
}

function scoreTab(tab, key) {
  let score = 0;
  if (state.workbenchWindowIds[key] === tab.windowId) score += 100;
  if (tab.active) score += 10;
  score += tab.id || 0;
  return score;
}

async function sendPrompt() {
  const text = $("prompt").value.trim();
  if (!text) {
    setMessage("先输入要发送的消息。");
    $("prompt").focus();
    return;
  }

  await saveSettings();
  await refreshTabs();
  $("send").disabled = true;
  setMessage("正在发送给回答者...");

  const targets = getTabsForRole("answerer");

  if (!targets.length) {
    $("send").disabled = false;
    setMessage("没有找到回答者页面，先把至少一个模型设为“回答”。");
    return;
  }

  const results = [];
  for (const target of targets) {
    results.push(await sendToTab(target.tab, text, $("autoSubmit").checked, target.model.label));
  }

  $("send").disabled = false;
  const ok = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  setMessage(failed.length ? `已发送 ${ok} 个，失败：${failed.map((item) => item.label).join("、")}。` : `已发送到 ${ok} 个回答者。回答完成后点“裁判总结”。`);
}

async function sendJudgePrompt() {
  const question = $("prompt").value.trim();
  if (!question) {
    setMessage("先输入原始问题，这样裁判知道要判断什么。");
    $("prompt").focus();
    return;
  }

  await saveSettings();
  await refreshTabs();
  $("judge").disabled = true;
  setMessage("正在抓取回答者的最新回答...");

  const judgeTargets = getTabsForRole("judge");
  const answerTargets = getTabsForRole("answerer");

  if (judgeTargets.length !== 1) {
    $("judge").disabled = false;
    setMessage(`当前有 ${judgeTargets.length} 个裁判，请设置且只设置一个裁判。`);
    return;
  }

  if (answerTargets.length < 1) {
    $("judge").disabled = false;
    setMessage("至少需要一个回答者。");
    return;
  }

  const answers = [];
  const extractionFailures = [];
  for (const target of answerTargets) {
    setMessage(`正在读取 ${target.model.label} 的回答...`);
    const extracted = await extractLatestAnswer(target.tab, target.model.label);
    if (extracted.ok) {
      answers.push({ label: target.model.label, text: extracted.text });
    } else {
      extractionFailures.push(`${target.model.label}: ${extracted.error?.message || extracted.error || "读取失败"}`);
    }
  }

  if (!answers.length) {
    $("judge").disabled = false;
    setMessage(`没有抓到回答内容。${extractionFailures.join("；") || "等回答完成后再试。"}`);
    return;
  }

  const prompt = buildJudgePrompt(question, answers, extractionFailures);
  setMessage(`已读取 ${answers.length} 个回答，正在填入裁判 ${judgeTargets[0].model.label}...`);
  const result = await sendToTab(judgeTargets[0].tab, prompt, false, judgeTargets[0].model.label);

  if (result.ok) {
    await chrome.windows.update(judgeTargets[0].tab.windowId, { focused: true });
  }

  $("judge").disabled = false;
  setMessage(result.ok ? `已填入裁判：${judgeTargets[0].model.label}。请检查后手动发送。` : `填入裁判失败：${result.error?.message || result.error || "页面可能没加载完"}`);
}

async function sendToTab(tab, text, autoSubmit, label) {
  try {
    const response = await sendMessageWithInjection(tab.id, {
      type: "AI_MULTI_SENDER_SEND_V3",
      text,
      autoSubmit
    });
    if (!response?.ok) throw new Error(response?.error || "unknown error");
    return { ok: true, label };
  } catch (error) {
    console.warn(`Failed to send to ${label}`, error);
    return { ok: false, label, error };
  }
}

async function sendMessageWithInjection(tabId, payload) {
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, payload);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"]
    });
    response = await chrome.tabs.sendMessage(tabId, payload);
  }

  if (!response) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"]
    });
    response = await chrome.tabs.sendMessage(tabId, payload);
  }
  return response;
}

async function extractLatestAnswer(tab, label) {
  try {
    const response = await sendMessageWithInjection(tab.id, {
      type: "AI_MULTI_SENDER_EXTRACT_LATEST_V3"
    });
    if (!response?.ok) throw new Error(response?.error || "extract failed");
    return { ok: true, label, text: response.text };
  } catch (error) {
    console.warn(`Failed to extract from ${label}`, error);
    return { ok: false, label, error };
  }
}

function getTabsForRole(role) {
  return state.models
    .filter((model) => getRole(model.key) === role)
    .map((model) => ({ model, tab: state.tabsByModel[model.key]?.[0] }))
    .filter((target) => target.tab);
}

function getRole(key) {
  return state.roles[key] || defaultRoleFor(key);
}

function defaultRoleFor(key) {
  return key === "claude" ? "judge" : "answerer";
}

function enforceSingleJudge(changedKey) {
  if (getRole(changedKey) !== "judge") return;
  for (const model of state.models) {
    if (model.key !== changedKey && getRole(model.key) === "judge") {
      state.roles[model.key] = "answerer";
    }
  }
}

function buildJudgePrompt(question, answers, extractionFailures) {
  const receivedBlock = answers.map((answer) => `- 已读取：${answer.label}（${answer.text.length} 字）`).join("\n");
  const answerBlocks = answers
    .map((answer, index) => `回答 ${index + 1}（${answer.label}）：\n${answer.text}`)
    .join("\n\n---\n\n");

  const failureBlock = extractionFailures.length
    ? `\n\n没有成功读取的回答：\n${extractionFailures.map((item) => `- ${item}`).join("\n")}`
    : "";

  return [
    "你现在是裁判和最终决策者。请根据用户原始问题，以及下面多个模型的回答，给出最终判断。",
    "",
    "要求：",
    "1. 先指出各回答的主要优点和问题。",
    "2. 判断哪些结论更可信，哪些地方需要修正。",
    "3. 最后给出一个清晰、可执行的最终答案。",
    "4. 如果信息不足，请明确说明还缺什么，不要假装确定。",
    "",
    `用户原始问题：\n${question}`,
    "",
    `读取清单：\n${receivedBlock}${failureBlock}`,
    "",
    answerBlocks,
  ].join("\n");
}

function openAddModelDialog() {
  $("modelDialogTitle").textContent = "新增模型";
  $("modelName").value = "";
  $("modelUrl").value = "";
  $("modelDialog").showModal();
}

async function saveModelFromDialog(event) {
  event.preventDefault();
  const label = $("modelName").value.trim();
  const url = $("modelUrl").value.trim();

  if (!label || !url) {
    setMessage("新增模型需要名称和网址。");
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    setMessage("网址格式不正确。");
    return;
  }

  const key = uniqueKey(slugify(label));
  const model = {
    key,
    label,
    url: parsedUrl.href,
    patterns: [`${parsedUrl.origin}/*`],
    builtIn: false
  };

  state.models.push(model);
  state.roles[key] = "answerer";
  $("modelDialog").close();
  renderRoles();
  await saveSettings();
  await arrangeWorkbench(false);
}

async function deleteModel(key) {
  const model = state.models.find((item) => item.key === key);
  if (!model || model.builtIn) return;
  state.models = state.models.filter((item) => item.key !== key);
  delete state.roles[key];
  delete state.workbenchWindowIds[key];
  renderRoles();
  await saveSettings();
  await arrangeWorkbench(false);
  setMessage(`已删除模型：${model.label}。`);
}

function normalizeModels(models) {
  const normalized = Array.isArray(models) && models.length ? models : DEFAULT_MODELS;
  return normalized.map((model) => {
    const url = model.url || "https://example.com/";
    let origin = "https://example.com";
    try {
      origin = new URL(url).origin;
    } catch (_error) {
      // Keep a safe fallback pattern for malformed legacy entries.
    }
    return {
      key: model.key || uniqueKey(slugify(model.label || "model")),
      label: model.label || "Model",
      url,
      patterns: Array.isArray(model.patterns) && model.patterns.length ? model.patterns : [`${origin}/*`],
      builtIn: DEFAULT_MODELS.some((defaultModel) => defaultModel.key === model.key)
    };
  });
}

function matchesModel(url, model) {
  return model.patterns.some((pattern) => {
    const prefix = pattern.replace("*", "");
    return typeof url === "string" && url.startsWith(prefix);
  });
}

function uniqueKey(base) {
  const cleanBase = base || "model";
  let key = cleanBase;
  let index = 2;
  const existing = new Set(state.models.map((model) => model.key));
  while (existing.has(key)) {
    key = `${cleanBase}-${index}`;
    index += 1;
  }
  return key;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getScreenInfo() {
  const screenLeft = Number.isFinite(window.screen.availLeft) ? window.screen.availLeft : 0;
  const screenTop = Number.isFinite(window.screen.availTop) ? window.screen.availTop : 0;
  return {
    left: screenLeft,
    top: screenTop,
    width: Math.max(1080, window.screen.availWidth || 1440),
    height: Math.max(760, window.screen.availHeight || 900)
  };
}

function setMessage(text) {
  $("message").textContent = text;
}
