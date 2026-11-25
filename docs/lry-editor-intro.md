# TiptapMarkdown：为「替换 UEditor」而生的开源富文本编辑器

> Tiptap v3 内核 · 语雀式体验 · 零后端假设 · 一行 `<script>` 接入任意表单

**TiptapMarkdown** 是一款开源多文稿富文本编辑器（MIT 协议），源自 [荣耀历程](https://lirongyaoper.com) 站内生产环境——历经 **9 轮迭代与全量安全审计**后，于 2026 年 11 月抽出开源。约 7000 行手写源码，无任何前端框架依赖。

它解决的是一个被行业搁置多年的问题：**大量仍在生产运行的老系统（CMS、政企站、内部管理平台）还在使用 2016 年的 UEditor 1.4.3**——不再维护、不支持现代浏览器特性、移动端体验糟糕，但「换编辑器 = 内容迁移 + 前后端改造」的成本让所有人望而却步。lry-editor 把这个成本降到了**覆盖文件 + 删旧目录**。

---

## 一、五个核心卖点

### 1. UEditor 存量内容零丢失兼容

这是 lry-editor 与其他现代编辑器最大的差异点。内置完整的**旧格式兼容层**：

- **打开无损**：`<font color/face/size>`、`_src` 占位图、`edui-*` 装饰类、`anchorname` 锚点、`td>p` 包裹等 UEditor 历史格式自动归一化，roundtrip 语义零丢失；
- **输出同形**：产出 HTML 保持 UEditor 契约（表格内不嵌裸 `<p>`、`<thead>` 重建、`float` 图文环绕、`<pre class="brush:js;toolbar:false;">` 代码块），**前端模板一行不用改**；
- **工具栏同词汇**：90 按钮全量工具栏对齐 UEditor 词汇表（`simpleupload`、`insertimage`、`wordimage`、`insertcode`…），老用户零学习成本；
- **API 同形**：`getContent() / setContent() / on('contentChange')`，老页面的编辑器调用脚本只需换一个全局对象名；
- **Markdown 粘贴识别**直接从 `ueditor.all.js` 移植（评分逻辑零改动），粘贴行为与老编辑器一致。

> **实战验证**：已在 YzmCMS 7.6 完成整站替换——后台文章/单页、会员投稿、自定义模型字段、DIY 表单全部切换，评论/留言板接入 lite 版，旧文章打开、编辑、再保存全链路无损。详见发行版附带的升级案例。

### 2. 零后端假设：一切能力走「适配器」

上传、在线附件库、远程抓图、AI 助手——编辑器本体**不假设任何后端**，全部通过 adapter 注入：

```js
// 默认 memory 适配器：图片转 dataURI，零后端开箱即用
// 接真实后端只需一个工厂调用：
LRYEditor.setAdapter(LRYEditor.createUrlAdapter({
  base: '/api/editor',              // 自动拼 /upload /list /catch
  aiUrl: '/api/ai',                 // OpenAI 兼容 SSE
  csrfHeader: 'X-CSRF-TOKEN',
  csrfToken: () => window.myToken
}));

// 或传自定义对象，完全控制（含 >5MB 大文件分片上传、进度回调）
LRYEditor.setAdapter({
  async upload(file, onProgress) { /* … return { url, title, size, filetype } */ },
  async list(filetype, start)     { /* … { list, total } */ },
  async catch(sources)            { /* … 远程图片批量转存 */ },
  async ai(messages)              { /* … 任意模型 */ }
});
```

无论你的后端是 PHP、Java、Go 还是 Node，只要按 [适配器契约](adapter.md) 返回一个 JSON，就完成对接。

### 3. 表单零改造：挂上 `<textarea>` 就能用

```html
<textarea id="content" name="content">存量HTML</textarea>
<script src="dist/lry-editor.js"></script>
<script>LRYEditor.create({ mount: '#content' });</script>
```

编辑器原位替换 textarea，内容变更 200ms 防抖写回 + `blur`/表单 `submit` 捕获阶段强制 flush——**传统多页表单（PHP/JSP/ASP 直提）不需要改一行提交逻辑**。既有的 `obj.content.value` 校验代码天然兼容。

### 4. 双形态发行：full 全功能 + lite 轻量版

| | full 版 | lite 版 |
|---|---|---|
| 体积 | 891KB 单文件 | **433KB（gzip 138KB）** |
| 全局对象 | `LRYEditor` | `LRYEditorLite` |
| 定位 | 内容生产主编辑器 | 留言/评论/回复 |
| 能力 | 全部（可视化自由画板/公式/Markdown/分栏/AI/表格…） | 纯文字排版（15 按钮） |
| API | 完全同形 | 完全同形 |

lite 版刻意做减法：无图片、无表格、无画板、无 AI，**攻击面越小越安全**——服务端只需一个窄白名单过滤器；入口自带输入清洗（剥 `script`/`on*`/`javascript:`）。字数上限超限硬阻断，自带计数条。

### 5. 存储 HTML 契约：与前端渲染解耦

产出的 HTML 直接入库，块级结构全部以 `class` 语义化标记，**展示端零 JS 依赖**即可正确渲染：

```html
<pre class="lry-mermaid">graph TD; A-->B</pre>        <!-- 画板：源码即内容 -->
<div class="lry-fold">…</div>                             <!-- 折叠块 -->
<div class="lry-cols lry-cols-2">…</div>                  <!-- 双栏布局 -->
<ul class="lry-task"><li class="lry-task-item lry-task-done">…</ul>
<blockquote class="lry-card lry-card-info">…</blockquote> <!-- 高亮块 -->
```

搜索引擎可索引、RSS 可输出、小程序/App 内嵌 WebView 直接展示。

---

## 二、功能全景

**编辑能力**
- 90 按钮全量工具栏，PC 全显 / 移动端 3 行自适应 +「更多」
- 可视化自由画板：流程图 / 思维导图 / UML 类图拖拽编辑，多选、框选、自由元素、剪贴板、PNG/SVG 导出
- KaTeX 公式实时预览与编辑、自动大纲与标题折叠、格式刷、查找替换、全屏、多主题代码高亮（行号/语言标签/一键复制）
- LaTeX 公式（KaTeX 懒加载）、四色高亮块、状态卡、文件卡

**语雀式块操作**
- 行柄「+」菜单：**31 项行操作**（H1-H6/高亮/引用/列表/任务/代码/折叠/画板/公式/缩进…）
- 斜杠面板：空行 `/` 唤起，**6 组 51 张卡片**
- 折叠块、多栏布局、任务列表

**Markdown 双向分栏**
- 左侧源码（每行「+」行柄，26 项 markdown 行操作）/ 右侧所见即所得，防抖互转，**退出零损失**

**画板（mermaid）**
- 流程图 / 思维导图 / 时序图 / 甘特图 / UML，编辑器内实时渲染，源码即内容入库

**AI 面板**（适配器对接任意模型）
- 翻译 / 续写 / 摘要 / 优化 / 生成大纲 / 画流程图 / 画思维导图

**工程体验**
- 自动保存（localStorage，2s 防抖，提交即清理，断电可恢复）
- 粘贴/拖拽图片直传、Word 截图 `data:` URI 自动转文件重传、`wordimage` 批量转存远程图
- >5MB 文件自动分片上传（适配器可选实现）

---

## 三、快速上手

```bash
git clone <仓库地址> && cd lry-editor
npm install && npm run build
node demo/_serve.mjs     # → http://localhost:8123/demo/  零后端演示
```

或直接引 `dist/`（单文件 IIFE，无构建链要求）：

```html
<link rel="stylesheet" href="dist/lry-editor.css">
<div id="editor"></div>
<script src="dist/lry-editor.js"></script>
<script>
  LRYEditor.create({ mount: '#editor', textarea: 'content', height: 420 });
</script>
```

npm 场景：`import { LRYEditorAPI } from 'lry-editor'`（ESM 源码直出），lite 版 `import 'lry-editor/lite'`。

---

## 四、规格

| 项 | 值 |
|---|---|
| 内核 | TipTap v3（ProseMirror） |
| 语言 | 纯 ESM JavaScript，无框架依赖（Vue/React 可用包装） |
| 发行 | full 891KB / lite 433KB（gzip 138KB）单文件 IIFE + npm ESM；独立画板布局层 22KB |
| 构建 | Vite 6 库模式，target es2018（现代浏览器） |
| 运行时懒加载 | showdown（Markdown）/ mermaid（画板）/ katex（公式）/ highlight（代码高亮），按需加载不占首屏 |
| 后端契约 | 适配器（upload / uploadChunk / list / catch / ai），详见 docs/adapter.md |
| 安全 | 入口输入清洗 + 存储契约语义化 + 画板布局颜色/图片协议校验；建议服务端白名单过滤（纵深防御） |
| 测试 | jsdom 118 项 + 真实 Chromium 38 项 |
| 协议 | MIT |

---

## 五、链接

- 仓库：`<git@github.com:lirongyaoper/TiptapMarkdown.git>`
- 从 UEditor 迁移：发行包附带 YzmCMS 7.6 全站替换升级案例（含 UPGRADE.md）

---

*lry-editor — 老系统的编辑器，终于可以换了。*
