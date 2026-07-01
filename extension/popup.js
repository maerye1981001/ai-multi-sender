const SERVICES = {
  chatgpt: {
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    patterns: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  },
  gemini: {
    label: "Gemini",
    url: "https://gemini.google.com/",
    patterns: ["https://gemini.google.com/*"]
  },
  claude: {
    label: "Claude",
    url: "https://claude.ai/new",
    patterns: ["https://claude.ai/*"]
  }
};

const state = {
  tabsByService: {},
  splitWindowIds: {}
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get({
    prompt: "",
    autoSubmit: true,
    controllerWindowId: null,
    splitWindowIds: {},
    targets: { chatgpt: true, gemini: true, claude: true }
  });

  state.controllerWindowId = stored.controllerWindowId;
  state.splitWindowIds = stored.splitWindowIds;
  $("prompt").value = stored.prompt;
  $("autoSubmit").checked = stored.autoSubmit;
  for (const key of Object.keys(SERVICES)) {
    $(`target-${key}`).checked = stored.targets[key] !== false;
  }

  $("prompt").addEventListener("input", saveSettings);
  $("autoSubmit").addEventListener("change", saveSettings);
  for (const key of Object.keys(SERVICES)) {
    $(`target-${key}`).addEventListener("change", saveSettings);
  }

  $("refreshTabs").addEventListener("click", refreshTabs);
  $("openMissing").addEventListener("click", openMissingTabs);
  $("openWorkbench").addEventListener("click", openWorkbenchWindow);
  $("send").addEventListener("click", sendPrompt);

  await refreshTabs();
});

async function saveSettings() {
  await chrome.storage.local.set({
    prompt: $("prompt").value,
    autoSubmit: $("autoSubmit").checked,
    targets: Object.fromEntries(
      Object.keys(SERVICES).map((key) => [key, $(`target-${key}`).checked])
    ),
    splitWindowIds: state.splitWindowIds,
    controllerWindowId: state.controllerWindowId
  });
}

async function refreshTabs() {
  setMessage("正在查找已打开的 AI 页面...");
  state.tabsByService = {};

  for (const [key, service] of Object.entries(SERVICES)) {
    const tabLists = await Promise.all(
      service.patterns.map((url) => chrome.tabs.query({ url }))
    );
    const tabs = tabLists.flat().sort((a, b) => scoreTab(b, key) - scoreTab(a, key));
    state.tabsByService[key] = tabs;
    updateStatus(key, tabs.length);
  }

  const found = Object.values(state.tabsByService).reduce((sum, tabs) => sum + tabs.length, 0);
  setMessage(found ? `找到 ${found} 个可发送标签页。` : "还没有打开可发送的 AI 页面。");
}

function scoreTab(tab, key) {
  let score = 0;
  if (state.splitWindowIds[key] === tab.windowId) score += 100;
  if (tab.active) score += 10;
  score += tab.id || 0;
  return score;
}

function updateStatus(key, count) {
  const node = $(`status-${key}`);
  node.classList.toggle("ready", count > 0);
  node.classList.toggle("missing", count === 0);
  node.textContent = count > 1 ? `${count} 个，发 1 个` : count === 1 ? "已打开" : "未打开";
}

async function openMissingTabs() {
  const created = [];
  for (const [key, service] of Object.entries(SERVICES)) {
    if (!$(`target-${key}`).checked || state.tabsByService[key]?.length) continue;
    const tab = await chrome.tabs.create({ url: service.url, active: false });
    created.push(tab);
  }
  setMessage(created.length ? `已打开 ${created.length} 个页面，登录或加载完成后再发送。` : "没有需要打开的页面。");
  await refreshTabs();
}

async function openWorkbenchWindow() {
  $("openWorkbench").disabled = true;
  setMessage("正在打开工作台...");

  try {
    if (state.controllerWindowId) {
      try {
        await chrome.windows.update(state.controllerWindowId, { focused: true });
        setMessage("工作台已唤起。");
        return;
      } catch (_error) {
        state.controllerWindowId = null;
      }
    }

    const screenInfo = getScreenInfo();
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("controller.html"),
      type: "popup",
      focused: true,
      left: screenInfo.left,
      top: screenInfo.top,
      width: screenInfo.width,
      height: Math.min(250, Math.max(210, Math.floor(screenInfo.height * 0.28)))
    });
    state.controllerWindowId = win.id;
    await saveSettings();
    setMessage("工作台已打开。");
  } catch (error) {
    console.warn("Failed to open workbench", error);
    setMessage("工作台打开失败，可以重试或检查 Chrome 是否允许弹窗。");
  } finally {
    $("openWorkbench").disabled = false;
  }
}

function getScreenInfo() {
  const screenLeft = Number.isFinite(window.screen.availLeft) ? window.screen.availLeft : 0;
  const screenTop = Number.isFinite(window.screen.availTop) ? window.screen.availTop : 0;
  return {
    left: screenLeft,
    top: screenTop,
    width: Math.max(1080, window.screen.availWidth || 1440),
    height: Math.max(700, window.screen.availHeight || 900)
  };
}

async function sendPrompt() {
  const text = $("prompt").value.trim();
  if (!text) {
    setMessage("先输入要发送的消息。");
    $("prompt").focus();
    return;
  }

  await saveSettings();
  $("send").disabled = true;
  setMessage("正在发送...");

  const targets = Object.keys(SERVICES)
    .filter((key) => $(`target-${key}`).checked)
    .map((key) => ({ key, tab: state.tabsByService[key]?.[0] }))
    .filter((target) => target.tab);

  if (!targets.length) {
    $("send").disabled = false;
    setMessage("没有选中的可发送标签页。");
    return;
  }

  const results = [];
  for (const target of targets) {
    results.push(await sendToTab(target.tab, text, $("autoSubmit").checked, SERVICES[target.key].label));
  }

  $("send").disabled = false;
  const ok = results.filter((result) => result.ok).length;
  const failed = results.length - ok;
  setMessage(failed ? `已发送 ${ok} 个，${failed} 个失败。失败页面可能还没加载完。` : `已发送到 ${ok} 个标签页。`);
}

async function sendToTab(tab, text, autoSubmit, label) {
  try {
    const response = await sendMessageWithInjection(tab.id, {
      type: "AI_MULTI_SENDER_SEND",
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
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"]
    });
    return chrome.tabs.sendMessage(tabId, payload);
  }
}

function setMessage(text) {
  $("message").textContent = text;
}
