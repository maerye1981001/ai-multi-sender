(() => {
  if (window.__aiMultiSenderLoadedV3) return;
  window.__aiMultiSenderLoadedV3 = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "AI_MULTI_SENDER_EXTRACT_LATEST_V3") {
      sendResponse(extractLatestAssistantText());
      return false;
    }

    if (message?.type !== "AI_MULTI_SENDER_SEND_V3" && message?.type !== "AI_MULTI_SENDER_SEND") return false;

    fillAndMaybeSubmit(message.text, Boolean(message.autoSubmit))
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });

  async function fillAndMaybeSubmit(text, autoSubmit) {
    const editor = await waitFor(findPromptEditor, 8000);
    if (!editor) {
      return { ok: false, error: "Prompt editor was not found." };
    }

    setEditorValue(editor, text);

    if (autoSubmit) {
      await sleep(250);
      const button = await waitFor(findSendButton, 5000);
      if (!button) {
        return { ok: false, error: "Send button was not found." };
      }
      button.click();
    }

    return { ok: true };
  }

  function findPromptEditor() {
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
  }

  function scoreEditor(node) {
    const text = [
      node.getAttribute("aria-label"),
      node.getAttribute("placeholder"),
      node.getAttribute("data-placeholder"),
      node.className,
      node.id
    ].join(" ").toLowerCase();

    let score = 0;
    if (/prompt|message|ask|chat|输入|发送|提问|消息/.test(text)) score += 30;
    if (node.matches("textarea")) score += 20;
    if (node.isContentEditable) score += 15;
    if (node.closest("form")) score += 10;
    score += Math.min(node.getBoundingClientRect().width / 20, 20);
    score += window.innerHeight - node.getBoundingClientRect().top > 0 ? 5 : 0;
    return score;
  }

  function setEditorValue(editor, text) {
    editor.focus();

    if (editor.matches("textarea, input")) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(editor),
        "value"
      )?.set;
      nativeSetter ? nativeSetter.call(editor, text) : (editor.value = text);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: text }));
    selectAll(editor);

    let inserted = document.execCommand("insertText", false, text);
    if (!inserted || normalizeText(editor.innerText || editor.textContent || "") !== normalizeText(text)) {
      editor.innerHTML = "";
      for (const line of text.split("\n")) {
        const paragraph = document.createElement("p");
        paragraph.textContent = line || "\u00a0";
        editor.append(paragraph);
      }
    }

    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: " " }));
  }

  function findSendButton() {
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

    const explicit = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .find(isClickable);
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
  }

  function extractLatestAssistantText() {
    const siteSpecific = extractSiteSpecificLatestText();
    if (siteSpecific) return { ok: true, text: siteSpecific.slice(0, 12000), source: "site-specific" };

    const selectors = [
      "[data-message-author-role='assistant']",
      "[data-testid='conversation-turn-2']",
      "[data-testid*='conversation-turn']",
      "[data-testid*='message']",
      "[class*='assistant']",
      "[class*='model-response']",
      "[class*='response-container']",
      ".markdown",
      ".prose",
      "message-content",
      "[class*='response']",
      "article"
    ];

    const candidates = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter(isVisibleEnough)
      .map((node) => normalizeText(node.innerText || node.textContent || ""))
      .filter((text) => text.length > 20)
      .filter((text) => !looksLikeChrome(text));

    const latest = pickLatestUsefulText(dedupe(candidates)) || fallbackLatestText();
    return latest
      ? { ok: true, text: latest.slice(0, 12000) }
      : { ok: false, error: "没有抓到最新回答，可能还没回答完或页面结构变了。" };
  }

  function extractSiteSpecificLatestText() {
    const host = location.hostname;
    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      return latestFromSelectors([
        "[data-message-author-role='assistant'] .markdown",
        "[data-message-author-role='assistant']",
        "[data-testid*='conversation-turn'] [data-message-author-role='assistant']"
      ]);
    }

    if (host.includes("gemini.google.com")) {
      return latestFromSelectors([
        "message-content",
        ".model-response-text",
        "[class*='model-response']",
        "[class*='response-container']"
      ]);
    }

    if (host.includes("claude.ai")) {
      return latestFromSelectors([
        "[data-testid*='message'] .font-claude-message",
        ".font-claude-message",
        "[class*='assistant']",
        ".prose"
      ]);
    }

    return "";
  }

  function latestFromSelectors(selectors) {
    const candidates = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter(isVisibleEnough)
      .map((node) => normalizeText(node.innerText || node.textContent || ""))
      .filter((text) => text.length > 20)
      .filter((text) => !looksLikeChrome(text) && !looksLikePromptEcho(text));

    return dedupe(candidates).at(-1) || "";
  }

  function selectAll(editor) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function pickLatestUsefulText(items) {
    return items
      .filter((text) => !looksLikePromptEcho(text))
      .at(-1) || items.at(-1) || "";
  }

  function fallbackLatestText() {
    const blocks = [...document.body.querySelectorAll("main p, main li, main pre, main div")]
      .filter(isVisibleEnough)
      .map((node) => normalizeText(node.innerText || node.textContent || ""))
      .filter((text) => text.length > 20 && text.length < 12000)
      .filter((text) => !looksLikeChrome(text));
    return pickLatestUsefulText(dedupe(blocks));
  }

  function normalizeText(text) {
    return text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  }

  function looksLikeChrome(text) {
    return /new chat|upgrade|sign in|log in|terms|privacy|help|settings/i.test(text) && text.length < 500;
  }

  function looksLikePromptEcho(text) {
    return /输入问题|自动发送|裁判总结|工作台|回答者|裁判/.test(text) && text.length < 800;
  }

  function dedupe(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = item.slice(0, 200);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isClickable(node) {
    return isVisible(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true";
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isVisibleEnough(node) {
    const style = window.getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || Boolean((node.innerText || node.textContent || "").trim());
  }

  function distanceToBottom(node) {
    return Math.abs(window.innerHeight - node.getBoundingClientRect().bottom);
  }

  async function waitFor(fn, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = fn();
      if (result) return result;
      await sleep(150);
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
