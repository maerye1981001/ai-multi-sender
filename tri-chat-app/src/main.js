const path = require("node:path");
const { app, BrowserView, BrowserWindow, ipcMain, Menu, shell } = require("electron");

const HEADER_HEIGHT = 96;
const MIN_PANE_WIDTH = 320;

const services = [
  { key: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { key: "gemini", label: "Gemini", url: "https://gemini.google.com/" },
  { key: "claude", label: "Claude", url: "https://claude.ai/new" }
];

let mainWindow;
let views = [];

app.setName("Tri Chat Window");

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: MIN_PANE_WIDTH * 3,
    minHeight: 620,
    title: "Tri Chat Window",
    backgroundColor: "#f5f5f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("resize", layoutViews);
  mainWindow.on("closed", () => {
    views = [];
    mainWindow = null;
  });

  views = services.map((service) => createPane(service));
  for (const view of views) {
    mainWindow.addBrowserView(view.browserView);
    view.browserView.webContents.loadURL(serviceUrl(view.key));
  }

  layoutViews();
}

function createPane(service) {
  const browserView = new BrowserView({
    webPreferences: {
      partition: `persist:${service.key}`,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  browserView.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedServiceUrl(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  browserView.webContents.on("page-title-updated", (event) => event.preventDefault());
  browserView.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("pane-state", {
      key: service.key,
      state: "ready",
      url: browserView.webContents.getURL()
    });
  });
  browserView.webContents.on("did-fail-load", (_event, _code, description) => {
    mainWindow?.webContents.send("pane-state", {
      key: service.key,
      state: "failed",
      message: description
    });
  });

  return { key: service.key, browserView };
}

function layoutViews() {
  if (!mainWindow || views.length === 0) return;

  const { width, height } = mainWindow.getContentBounds();
  const paneWidth = Math.floor(width / views.length);
  const paneHeight = Math.max(0, height - HEADER_HEIGHT);

  views.forEach((view, index) => {
    const x = index * paneWidth;
    const isLast = index === views.length - 1;
    const widthForPane = isLast ? width - x : paneWidth;
    view.browserView.setBounds({
      x,
      y: HEADER_HEIGHT,
      width: widthForPane,
      height: paneHeight
    });
    view.browserView.setAutoResize({ width: true, height: true });
  });
}

ipcMain.handle("broadcast-prompt", async (_event, payload) => {
  const text = String(payload?.text || "").trim();
  const autoSubmit = payload?.autoSubmit !== false;
  const enabled = new Set(payload?.targets || services.map((service) => service.key));

  if (!text) return { ok: false, message: "请输入消息。" };

  const results = [];
  for (const view of views) {
    if (!enabled.has(view.key)) continue;
    results.push({
      key: view.key,
      ...(await sendPromptToView(view.browserView, text, autoSubmit))
    });
  }

  return { ok: true, results };
});

ipcMain.handle("pane-action", async (_event, action) => {
  const view = views.find((item) => item.key === action?.key);
  if (!view) return { ok: false };

  if (action.type === "home") {
    await view.browserView.webContents.loadURL(serviceUrl(view.key));
  } else if (action.type === "reload") {
    view.browserView.webContents.reload();
  } else if (action.type === "back" && view.browserView.webContents.canGoBack()) {
    view.browserView.webContents.goBack();
  }

  return { ok: true };
});

async function sendPromptToView(browserView, text, autoSubmit) {
  try {
    const result = await browserView.webContents.executeJavaScript(
      `(${fillAndMaybeSubmitInPage})(${JSON.stringify(text)}, ${JSON.stringify(autoSubmit)})`,
      true
    );
    return result?.ok ? { ok: true } : { ok: false, error: result?.error || "发送失败" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function serviceUrl(key) {
  return services.find((service) => service.key === key)?.url || services[0].url;
}

function isAllowedServiceUrl(url) {
  try {
    const host = new URL(url).host;
    return [
      "chatgpt.com",
      "chat.openai.com",
      "gemini.google.com",
      "claude.ai",
      "accounts.google.com",
      "auth0.openai.com",
      "login.microsoftonline.com"
    ].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch (_error) {
    return false;
  }
}

async function fillAndMaybeSubmitInPage(text, autoSubmit) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isVisible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };

  const waitFor = async (fn, timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = fn();
      if (result) return result;
      await sleep(150);
    }
    return null;
  };

  const scoreEditor = (node) => {
    const meta = [
      node.getAttribute("aria-label"),
      node.getAttribute("placeholder"),
      node.getAttribute("data-placeholder"),
      node.className,
      node.id
    ].join(" ").toLowerCase();

    let score = 0;
    if (/prompt|message|ask|chat|输入|发送|提问|消息/.test(meta)) score += 30;
    if (node.matches("textarea")) score += 20;
    if (node.isContentEditable) score += 15;
    if (node.closest("form")) score += 10;
    score += Math.min(node.getBoundingClientRect().width / 20, 20);
    return score;
  };

  const findPromptEditor = () => {
    const selectors = [
      "textarea[placeholder]",
      "textarea",
      "[contenteditable='true']",
      ".ProseMirror",
      "div[role='textbox']"
    ];

    return selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter(isVisible)
      .filter((node) => !node.closest("[aria-hidden='true']"))
      .sort((a, b) => scoreEditor(b) - scoreEditor(a))[0];
  };

  const setEditorValue = (editor) => {
    editor.focus();

    if (editor.matches("textarea, input")) {
      const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value")?.set;
      nativeSetter ? nativeSetter.call(editor, text) : (editor.value = text);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  };

  const isClickable = (node) => isVisible(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true";
  const distanceToBottom = (node) => Math.abs(window.innerHeight - node.getBoundingClientRect().bottom);

  const findSendButton = () => {
    const selectors = [
      "button[data-testid='send-button']",
      "button[data-testid='composer-send-button']",
      "button[aria-label*='Send']",
      "button[aria-label*='send']",
      "button[aria-label*='Submit']",
      "button[aria-label*='发送']",
      "button[aria-label*='提交']",
      "button[type='submit']"
    ];

    const explicit = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).find(isClickable);
    if (explicit) return explicit;

    return [...document.querySelectorAll("button")]
      .filter(isClickable)
      .filter((button) => {
        const label = [
          button.getAttribute("aria-label"),
          button.title,
          button.textContent,
          button.dataset.testid
        ].join(" ");
        return /send|submit|发送|提交|arrow-up|paper-airplane/i.test(label);
      })
      .sort((a, b) => distanceToBottom(a) - distanceToBottom(b))[0];
  };

  const editor = await waitFor(findPromptEditor, 8000);
  if (!editor) return { ok: false, error: "没有找到输入框，页面可能还没加载完或需要登录。" };

  setEditorValue(editor);

  if (autoSubmit) {
    await sleep(250);
    const button = await waitFor(findSendButton, 5000);
    if (!button) return { ok: false, error: "没有找到发送按钮。" };
    button.click();
  }

  return { ok: true };
}
