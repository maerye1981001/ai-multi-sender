# AI Multi Sender / AI 多模型工作台

AI Multi Sender is a local Chrome extension for sending one prompt to multiple AI chat websites, arranging them into a workbench, and optionally asking one model to judge the answers from other models.

AI 多模型工作台是一个本地 Chrome 插件：可以把同一个问题发送给多个 AI 网页，把模型窗口自动排成工作台，还可以指定某个模型作为“裁判”，读取其他模型的回答后生成最终判断提示词。

## Features / 功能

- Send one prompt to multiple AI chat tabs.
- Open a persistent workbench: input panel on top, model windows arranged below.
- Choose each model's role: `Answerer`, `Judge`, or `Off`.
- Ask the judge model to review answerer outputs.
- Judge mode fills the judge prompt only; you manually review and send it.
- Add or delete custom web-based AI models.
- No API keys, no backend server, no hosted data storage.

---

- 同一条消息同时发给多个 AI 网页。
- 打开常驻工作台：上方输入，下方并排显示模型窗口。
- 每个模型都可以选择角色：`回答`、`裁判`、`关闭`。
- 裁判模式会读取回答者的最新回答，并整理成裁判提示词。
- 裁判提示词只会填入裁判窗口，不会自动发送，方便你先检查。
- 支持新增或删除自定义网页模型。
- 不需要 API Key，没有后端服务，也不会上传保存你的聊天内容。

## Install / 安装

1. Open Chrome and go to `chrome://extensions/`.
2. Turn on Developer Mode.
3. Click `Load unpacked`.
4. Select the `extension` folder in this project.
5. Pin `AI Multi Sender` to the Chrome toolbar.

---

1. 打开 Chrome，进入 `chrome://extensions/`。
2. 打开右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目里的 `extension` 文件夹。
5. 把 `AI Multi Sender` 固定到浏览器工具栏。

## Basic Usage / 基础使用

1. Click the extension icon.
2. Click `Open Workbench`.
3. Sign in to the model pages if needed.
4. Type your prompt in the top workbench input.
5. Set model roles.
6. Click `Send` to send the prompt to all models marked as `Answerer`.

---

1. 点击浏览器插件图标。
2. 点击“打开工作台”。
3. 如果模型网页需要登录，先完成登录。
4. 在工作台顶部输入问题。
5. 设置每个模型的角色。
6. 点击“发送”，问题会发给所有设为“回答”的模型。

## Role Mode / 角色模式

Each model can be set to one of three roles:

- `Answerer`: receives your original prompt.
- `Judge`: receives a synthesized judge prompt after you click `Judge Summary`.
- `Off`: does not participate in the current round.

The roles are fully configurable. For example:

- ChatGPT + Gemini answer, Claude judges.
- Claude + Gemini answer, ChatGPT judges.
- One model answers, another model judges.
- Extra custom models can also answer or judge.

When you click `Judge Summary`, the extension reads the latest visible answers from the answerer pages, builds a judge prompt, and fills it into the judge model's input box. It does not auto-send the judge prompt.

---

每个模型都可以设成三种角色之一：

- `回答`：收到你的原始问题。
- `裁判`：点击“裁判总结”后，收到整理好的裁判提示词。
- `关闭`：本轮不参与。

角色不是固定的，你可以每轮自由组合。例如：

- ChatGPT + Gemini 回答，Claude 裁判。
- Claude + Gemini 回答，ChatGPT 裁判。
- 一个模型回答，另一个模型裁判。
- 你新增的模型也可以回答或裁判。

点击“裁判总结”时，插件会读取回答者页面里最新可见的回答，生成裁判提示词，并填入裁判模型的输入框。它不会自动发送裁判提示词，你可以检查后手动发送。

## Add Custom Models / 新增自定义模型

In the workbench:

1. Click `Add Model`.
2. Enter a display name.
3. Enter the model website URL.
4. Save.
5. Choose its role: `Answerer`, `Judge`, or `Off`.

Custom models must be browser-based chat products with a detectable text input and send button. Some sites may change their DOM structure or block automation, so custom model support is best-effort.

---

在工作台中：

1. 点击“新增模型”。
2. 输入显示名称。
3. 输入模型网页地址。
4. 保存。
5. 给它选择角色：`回答`、`裁判`、`关闭`。

新增模型需要是网页聊天产品，并且页面里有插件能识别的输入框和发送按钮。不同网站可能改版或限制自动化，所以自定义模型是尽力兼容。

## Files / 文件结构

- `extension/manifest.json`: Chrome extension manifest.
- `extension/popup.*`: small toolbar popup.
- `extension/controller.*`: persistent workbench UI.
- `extension/contentScript.js`: page automation for filling prompts, clicking send, and reading latest answers.
- `tri-chat-app/`: earlier Electron prototype kept as an optional desktop experiment.

---

- `extension/manifest.json`：Chrome 插件配置。
- `extension/popup.*`：工具栏小弹窗。
- `extension/controller.*`：常驻工作台界面。
- `extension/contentScript.js`：负责给网页填入提示词、点击发送、读取最新回答。
- `tri-chat-app/`：早期 Electron 桌面版原型，作为可选实验保留。

## Privacy / 隐私

This extension runs locally in your browser. It does not require API keys and does not send your prompts to any server other than the AI websites you open and choose to use.

Because custom models can be added, the extension requests broad host access so it can inject the local content script into user-selected model websites. Only pages you open and use in the workbench are operated on.

---

这个插件在你的浏览器本地运行，不需要 API Key，也不会把你的内容发送到除你打开并使用的 AI 网站之外的服务器。

由于支持自定义模型，插件需要较宽的网页访问权限，才能把本地内容脚本注入到你新增的模型网站中。插件只会操作你在工作台里打开和选择的模型页面。

## Troubleshooting / 排错

- If `Judge Summary` only captures one model, wait until all answerers finish, then click it again.
- If a judge prompt is not filled, reload the extension at `chrome://extensions/`, close old workbench/model windows, and reopen the workbench.
- If a site changed its UI, turn off auto-send and send manually after the prompt is filled.
- If a custom model cannot be automated, its site may not expose a standard editable input or send button.

---

- 如果“裁判总结”只抓到一个模型，先等所有回答者完成，再点一次。
- 如果裁判提示词没有填进去，到 `chrome://extensions/` 刷新插件，关闭旧工作台和旧模型窗口，再重新打开。
- 如果某个网站改版导致自动发送失败，可以关闭“自动发送”，填入后手动发送。
- 如果自定义模型无法操作，可能是该网站没有标准输入框/发送按钮，或限制了自动化。

## Development / 开发

There is no build step for the Chrome extension. Edit files under `extension/`, then reload the unpacked extension in Chrome.

Basic syntax check:

```bash
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); for (const file of ['extension/popup.js','extension/contentScript.js','extension/controller.js']) new Function(require('fs').readFileSync(file,'utf8')); console.log('extension syntax ok')"
```

Optional Electron prototype:

```bash
cd tri-chat-app
npm install
npm start
```

---

Chrome 插件不需要构建步骤。修改 `extension/` 下的文件后，在 Chrome 扩展管理页刷新已解压插件即可。

基础语法检查：

```bash
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); for (const file of ['extension/popup.js','extension/contentScript.js','extension/controller.js']) new Function(require('fs').readFileSync(file,'utf8')); console.log('extension syntax ok')"
```

可选 Electron 原型：

```bash
cd tri-chat-app
npm install
npm start
```
