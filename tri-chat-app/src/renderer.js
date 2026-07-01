const form = document.getElementById("promptForm");
const promptInput = document.getElementById("prompt");
const autoSubmit = document.getElementById("autoSubmit");
const statusLine = document.getElementById("status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = promptInput.value.trim();
  const targets = [...document.querySelectorAll(".pane-head")]
    .filter((pane) => pane.querySelector("input[type='checkbox']").checked)
    .map((pane) => pane.dataset.key);

  if (!text) {
    setStatus("先输入消息。");
    promptInput.focus();
    return;
  }

  if (targets.length === 0) {
    setStatus("至少选择一个模型。");
    return;
  }

  setStatus("正在发送...");
  const result = await window.triChat.broadcastPrompt({
    text,
    targets,
    autoSubmit: autoSubmit.checked
  });

  if (!result.ok) {
    setStatus(result.message || "发送失败。");
    return;
  }

  const ok = result.results.filter((item) => item.ok).length;
  const failed = result.results.length - ok;
  setStatus(failed ? `已发送 ${ok} 个，${failed} 个失败。` : `已发送到 ${ok} 个模型。`);
});

document.querySelectorAll(".pane-head button").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.closest(".pane-head").dataset.key;
    window.triChat.paneAction({ key, type: button.dataset.action });
  });
});

window.triChat.onPaneState((state) => {
  const pane = document.querySelector(`.pane-head[data-key='${state.key}']`);
  if (!pane) return;
  pane.dataset.state = state.state;
});

function setStatus(text) {
  statusLine.textContent = text;
}
