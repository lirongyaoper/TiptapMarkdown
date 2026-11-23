# lry-editor

开源多文稿富文本编辑器 —— Tiptap 内核,语雀式体验,**零后端假设**。

- **Markdown 双向分栏**:左侧源码(每行「+」行柄)/ 右侧所见即所得,防抖互转,退出零损失
- **画板**:mermaid 流程图 / 思维导图 / 时序 / 甘特 / UML,编辑器内实时渲染
- **语雀式块**:折叠块、多栏布局、任务列表、状态卡、文件卡、高亮块(四色)、代码块(**编辑态语法高亮** + 行号 + 语言下拉 + 复制)、LaTeX 公式
- **预告下一行**:文末是代码块、表格、画板时,下方常显一行待写行(行首「+」),点一下接着写;代码块随时出得来(空行回车 / `Esc` / `↓`)
- **行柄「+」菜单**:31 项行操作(H1-H6/高亮/引用/列表/任务/代码/折叠/复制/剪切/删除/缩进/画板/公式…)
- **斜杠面板**:空行 `/` 唤起,6 组 51 张卡片
- **上下文工具条**:光标落在链接内 / 选中图片 / 进入表格时,浮现对应操作条;表格列宽可拖拽
- **划词工具条**:选中文本即在选区上方浮现格式条
- **AI 面板**:翻译/续写/摘要/优化/生成大纲/画流程图/画思维导图(经适配器对接任意模型)
- **工具栏**:90 按钮全量;PC 全显,移动端 3 行自适应 + 「更多」
- **自动大纲/标题折叠、自动保存、格式刷、查找替换浮动条、全屏、导出(Markdown / 网页 / Word / 纯文本)、多主题代码高亮**

> 留言/评论场景请看 **[lite 简约版](#lite-简约版留言评论)**:纯文字排版、432KB 单文件,API 与 full 版同形。

## 快速开始(零后端)

```bash
git clone <repo> && cd lry-editor
npm install && npm run build
node demo/_serve.mjs        # → http://localhost:8123/demo/
```

或直接引 `dist/`:

```html
<link rel="stylesheet" href="dist/lry-editor.css">
<div id="editor"></div>
<script src="dist/lry-editor.js"></script>
<script>
  LRYEditor.create({
    mount: '#editor',
    textarea: 'content',          // 表单字段名(自动建隐藏 textarea,提交自动同步)
    height: 420
  });
</script>
```

> `dist/` 须与 `third-party/` 一同部署:showdown / mermaid / KaTeX / highlight.js 都在运行时按需加载,基址由上面 `<script src>` 的路径推断(`…/dist/` 的上一级)。目录结构不同时,在引入编辑器脚本前设置 `window.LRY_EDITOR_BASE = '/static/lry-editor/'`;代码高亮资源可单独用 `window.LRY_EDITOR_HIGHLIGHT_BASE` 覆写。

默认 **memory 适配器**:图片存 dataURI(开箱即用)、AI 为演示 mock —— 适合 Demo 与评估。

## 接入真实后端(适配器)

```js
// 方式一:工厂(URL + 可选 CSRF)
LRYEditor.setAdapter(LRYEditor.createUrlAdapter({
  base: '/api/editor',                  // 拼接 /upload /list /catch
  aiUrl: '/api/ai',                     // OpenAI 兼容 SSE
  csrfHeader: 'X-CSRF-TOKEN',
  csrfToken: () => window.myToken,
  jsonPath: (r) => r.data               // 响应解包
}));

// 方式二:自定义对象(完全控制,含分片)
LRYEditor.setAdapter({
  async upload(file, onProgress, extra) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/my-upload', { method: 'POST', body: fd });
    return (await r.json()).data;         // { url, title, size, filetype }
  },
  async list(filetype, start) { /* { list:[{url,title,mtime}], total } */ },
  async catch(sources) { /* { state, list:[{state,url,source}] } */ },
  async ai(messages) { /* 返回字符串(SSE 解析可参考 createUrlAdapter) */ },
  // 可选大文件分片:uploadChunk(file, { filetype, onProgress })
});
```

适配器约定详见 [docs/adapter.md](docs/adapter.md)。

## API

```js
const inst = LRYEditor.create({ mount, textarea, value, height, wordCount, elementPath, adapter });
inst.getContent()      // HTML(分栏模式下源码脏改动会先转换)
inst.getText()         // 纯文本
inst.setContent(html)  // 设置(自动归一化存量格式)
inst.insertHtml(html)
inst.on('contentChange', cb)
inst.sync()            // 强制写回 textarea(幂等)
inst.destroy()
inst.mdApi.toggle()    // Markdown 分栏开关
inst.aiApi.open()      // AI 面板
inst.findApi.open()    // 查找替换浮动条(Ctrl+F / Ctrl+H)
LRYEditor.get('content')  // 按字段名取实例
```

`create()` 的其余选项:`adapter`(仅本实例使用的适配器,优先于全局)、`dropFiles: false`(关闭视频/音频/附件的拖入与粘贴上传,默认开)、`autoTypeset: { emptyParas, trimSpaces, mergeBlank, paste }`(自动排版的默认项;`paste: true` 时粘贴后自动应用)。

## 存储 HTML 契约(与前端渲染解耦)

编辑器产出的 HTML 可直接入库,块全部以 `class` 语义化标记(`lry-*`),渲染端零 JS 依赖即可基础展示:

```html
<pre class="lry-mermaid">graph TD; A-->B</pre>          <!-- 画板:源码即内容 -->
<div class="lry-fold"><div class="lry-fold-head">…</div>
     <div class="lry-fold-body">…</div></div>              <!-- 折叠 -->
<div class="lry-cols lry-cols-2"><div class="lry-col">…    <!-- 分栏 -->
<ul class="lry-task"><li class="lry-task-item lry-task-done">
  <span class="lry-task-check">☑</span>…</li></ul>        <!-- 任务列表 -->
<span class="lry-status lry-status-ok">进行中</span>        <!-- 状态 -->
<blockquote class="lry-card lry-card-info">…</blockquote>  <!-- 高亮块 -->
<pre class="brush:js;toolbar:false;">…</pre>                <!-- 代码块(theme:xxx 指定高亮主题) -->
```

> 服务端做 HTML 白名单过滤时,须放行 `td/th` 上的 `colspan` / `rowspan` / `width` / `style` 与 `a[name]`(页内锚点)——否则合并单元格保存后被拆开、列宽与单元格背景色丢失、锚点失效。

## lite 简约版(留言/评论)

面向**留言板、文章评论、帖子回复**等轻量输入场景的独立构建:`dist/lry-editor-lite.js`(**432KB / gzip 138KB**,full 版 682KB),全局对象 `window.LRYEditorLite`,与 full 版 **API 完全同形**(页面脚本零学习成本)。

- **纯文字排版**:加粗/斜体/下划线/删除线/行内代码 · 链接(Ctrl+K)/取消链接 · 引用/有序/无序列表 · 待办清单 · Unicode 表情 · 清除格式
- **划词工具条**(6 钮):选中文本即在选区上方浮现格式条
- 默认**无**图片上传、表格、标题、代码块、画板、Markdown、AI —— 面越小越安全,服务端只需一个窄白名单过滤器;留言/评论需要贴图时传 `images: true`(工具栏多一个图片按钮,上传走适配器)
- 字数上限(`maximumWords` 超限硬阻断)、placeholder、只读态、字数计数条
- 表单同步与 full 版同策略:transaction 防抖 200ms 写回 + blur/submit 强制 flush;挂载在既有 `<textarea>` 上时隐藏域保留 name/id,页面既有校验逻辑天然兼容
- 入口自带输入清洗(剥 `script`/`on*`/`javascript:`),服务端仍应做白名单过滤(纵深防御)

```html
<link rel="stylesheet" href="dist/lry-editor-lite.css">
<div id="comment_editor"></div>
<script src="dist/lry-editor-lite.js"></script>
<script>
  LRYEditorLite.create({
    mount: '#comment_editor',
    textarea: 'content',        // 表单字段名
    maximumWords: 500,          // 字数上限(超限阻断 + 计数条)
    height: 140,
    placeholder: '请输入留言内容…'
  });
  // LRYEditorLite.get('content') → 同 full 版实例 API
</script>
```

npm 场景:`import { LRYEditorLiteAPI } from 'lry-editor/lite'`。演示页:[demo/lite.html](demo/lite.html)。

## 目录结构

```
├── src/            # ESM 源码(index.js 门面 + adapters.js 适配层;lite.js 简约版入口)
├── dist/           # 构建产物(lry-editor.js / lry-editor-lite.js 单文件 IIFE + css)
├── third-party/    # 运行时懒加载:showdown / mermaid / katex(均为 MIT)+ highlight(代码高亮,BSD-3)
├── demo/           # 零后端演示页(index.html 全功能 / lite.html 简约版)
├── test/           # os-test.mjs(jsdom)/ os-browser.mjs(真实 Chromium)
└── docs/           # 适配器/配置文档
```

## 构建与开发

```bash
npm install
npm run build         # 产出 dist/lry-editor.js(full 版)
npm run build:lite    # 产出 dist/lry-editor-lite.js(简约版)
npm run watch         # 增量构建(full 版;lite 用 watch:lite)
npm test              # jsdom 回归(契约 / 适配器贯穿 / 各功能入口)
npm run test:browser  # 真实浏览器回归(需本机 Chromium:读 CHROME_PATH,否则找 ~/.cache/ms-playwright)
```

## 许可与署名

- MIT。内嵌运行时库:showdown / mermaid / KaTeX 为 MIT,highlight.js 为 BSD-3-Clause(许可原文见 `third-party/highlight/LICENSE`);三方清单见 [LICENSE](LICENSE)。
- **重要**：  如果你在与你相关的项目中使用该富文本插件，请你务必与我来信(contact@lirongyaoper.com)表示简单的感谢，以鼓励我继续本项目的更新及优化。

---

## 联系方式

| 渠道 | 信息 |
|---|---|
| 作者 | 轩鸿青 |
| 邮箱 | contact@lirongyaoper.com |
| 个人网站/博客 | https://lirongyaoper.com |