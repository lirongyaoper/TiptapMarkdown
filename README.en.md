# lry-editor

An open-source multi-document rich text editor — Tiptap core, Yuque-style experience, **zero backend assumptions**.

- **Markdown dual-pane**: source on the left (per-line "+" gutter handle), WYSIWYG on the right, debounced two-way sync without stealing focus, lossless exit, and direct `.md` / `.markdown` import
- **Diagrams**: mermaid flowcharts / mindmaps / sequence / gantt / UML, rendered live in the editor
- **Visual free canvas**: edit flowcharts, mindmaps and UML class diagrams directly; multi-select, marquee selection, text/shapes/connectors/stickers/images, context menus, clipboard, zoom and PNG/SVG export. Layout travels with the Mermaid source and shares one layout layer with the renderer
- **Yuque-style blocks**: folding blocks, column layouts, task lists, status chips, file cards, 4-color callout cards, code blocks (**syntax highlighting while typing** + line numbers + language dropdown + copy), LaTeX math (**live KaTeX preview and editing**)
- **Next-line preview**: when the document ends with a code block, table or diagram, a waiting line with an always-visible "+" appears below it — click and keep writing; leaving a code block is always possible (Enter on an empty line / `Esc` / `↓`)
- **Row-handle "+" menu**: 31 block operations (H1-H6 / callouts / quote / lists / tasks / code / fold / copy / cut / delete / indent / diagrams / formulas…)
- **Slash menu**: type `/` on an empty line, 51 cards in 6 groups
- **Context toolbars**: a toolbar appears above the link under the caret / the selected image / inside a table; table columns are drag-resizable
- **Selection toolbar**: a format bar pops up above selected text
- **AI panel**: translate / continue / summarize / polish / outline / flowchart / mindmap (via adapter to any model)
- **Toolbar**: 90 buttons; full display on desktop, 3-row adaptive with "more" on mobile
- **Auto outline & heading fold, autosave, format painter, floating find & replace, fullscreen, export (Markdown / HTML / Word / plain text), multi-theme code highlighting**

> For guestbook / comment / reply scenarios see the **[lite edition](#lite-edition-comments--guestbook)**: text-only formatting, a single 433KB file, same-shape API as the full editor.

## Quick Start (no backend)

```bash
git clone <repo> && cd lry-editor
npm install && npm run build
node demo/_serve.mjs        # → http://localhost:8123/demo/
```

Or include `dist/` directly:

```html
<link rel="stylesheet" href="dist/lry-editor.css">
<div id="editor"></div>
<script src="dist/lry-editor.js"></script>
<script>
  LRYEditor.create({
    mount: '#editor',
    textarea: 'content',          // form field name (hidden textarea auto-created & synced on submit)
    height: 420
  });
</script>
```

> Deploy `third-party/` next to `dist/`: showdown / mermaid / KaTeX / highlight.js are lazy-loaded at runtime, with the base path inferred from the `<script src>` above (the parent of `…/dist/`). If your layout differs, set `window.LRY_EDITOR_BASE = '/static/lry-editor/'` before loading the editor script; the highlight resources can be overridden separately via `window.LRY_EDITOR_HIGHLIGHT_BASE`. To restore canvas layout on the published page, optionally load `dist/lry-diagram-layout.js` (`window.LryDiagramLayout`).

The default **memory adapter** stores images as dataURI and serves a mock AI — perfect for demos and evaluation.

## Connecting a Real Backend (Adapters)

```js
// Option 1: factory (URL + optional CSRF)
LRYEditor.setAdapter(LRYEditor.createUrlAdapter({
  base: '/api/editor',                  // appends /upload /list /catch
  aiUrl: '/api/ai',                     // OpenAI-compatible SSE
  csrfHeader: 'X-CSRF-TOKEN',
  csrfToken: () => window.myToken,
  jsonPath: (r) => r.data
}));

// Option 2: fully custom object (chunked upload supported)
LRYEditor.setAdapter({
  async upload(file, onProgress, extra) { /* → { url, title?, size?, filetype? } */ },
  async list(filetype, start)  { /* → { list:[{url,title,mtime}], total } */ },
  async catch(sources)         { /* → { state, list:[{state,url,source}] } */ },
  async ai(messages)          { /* → string (full model output) */ },
  // optional: async uploadChunk(file, {filetype, onProgress }) — auto-used for >5MB files
});
```

Full contract: [docs/adapter.md](docs/adapter.md). Chinese README: [README.md](README.md).

## API

```js
const inst = LRYEditor.create({ mount, textarea, value, height, wordCount, elementPath, adapter });
inst.getContent() | getText() | setContent(html) | insertHtml(html)
inst.on('contentChange', cb) | sync() | destroy()
inst.mdApi.toggle()   // Markdown dual-pane
inst.aiApi.open()     // AI panel
inst.findApi.open()   // floating find & replace (Ctrl+F / Ctrl+H)
LRYEditor.get('content')
```

Further `create()` options: `adapter` (an adapter used only by this instance, taking precedence over the global one), `dropFiles: false` (disables upload on drop/paste of video, audio and attachments; on by default), `autoTypeset: { emptyParas, trimSpaces, mergeBlank, paste }` (auto-typeset defaults; with `paste: true` it is applied after every paste).

## Storage HTML Contract

Output HTML is library-agnostic and database-ready; every custom block uses semantic `lry-*` classes:

```html
<pre class="lry-mermaid">graph TD; A-->B</pre>
<div class="lry-fold"><div class="lry-fold-head">…</div><div class="lry-fold-body">…</div></div>
<div class="lry-cols lry-cols-2"><div class="lry-col">…</div></div>
<ul class="lry-task"><li class="lry-task-item lry-task-done"><span class="lry-task-check">☑</span>…</li></ul>
<span class="lry-status lry-status-ok">done</span>
<blockquote class="lry-card lry-card-info">…</blockquote>
<pre class="brush:js;toolbar:false;">…</pre>            <!-- code block (theme:xxx picks the highlight theme) -->
```

> Canvas coordinates and free elements are stored in a `%% lry-layout v1` comment at the end of the Mermaid source. Mermaid ignores it, so ordinary Markdown tools still render an auto-layout diagram. Load `dist/lry-diagram-layout.js` on the published page to restore the editor layout.

> If your server applies an HTML whitelist, it must keep `colspan` / `rowspan` / `width` / `style` on `td`/`th` and `a[name]` (in-page anchors) — otherwise merged cells are split on save, column widths and cell backgrounds are lost, and anchors stop working.

## lite edition (comments / guestbook)

A standalone build for lightweight input scenarios — guestbooks, article comments, forum replies: `dist/lry-editor-lite.js` (**433KB / 138KB gzip** vs 891KB full), global `window.LRYEditorLite`, **API identical in shape** to the full editor.

- **Text-only formatting**: bold / italic / underline / strike / inline code · link (Ctrl+K) / unlink · quote / ordered & bullet lists · to-do list · Unicode emoji · clear formatting
- **Selection toolbar** (6 buttons): a format bar pops up above selected text
- **No** image upload, tables, headings, code blocks, diagrams, Markdown or AI by default — a minimal surface that only needs a narrow server-side whitelist filter; for guestbooks/comments that need images pass `images: true` (adds one image button, uploads go through the adapter)
- Word limit (`maximumWords` hard-blocks typing), placeholder, read-only mode, live character counter
- Form sync identical to the full editor: 200ms debounced write-back + forced flush on blur/submit; when mounted on an existing `<textarea>` the hidden field keeps its name/id, so existing page validators keep working
- Built-in input sanitizing (strips `script` / `on*` / `javascript:`); the server should still whitelist-filter (defense in depth)

```html
<link rel="stylesheet" href="dist/lry-editor-lite.css">
<div id="comment_editor"></div>
<script src="dist/lry-editor-lite.js"></script>
<script>
  LRYEditorLite.create({
    mount: '#comment_editor',
    textarea: 'content',        // form field name
    maximumWords: 500,          // word limit (hard block + counter)
    height: 140,
    placeholder: 'Leave a comment…'
  });
</script>
```

Via npm: `import { LRYEditorLiteAPI } from 'lry-editor/lite'`. Demo: [demo/lite.html](demo/lite.html).

## Build

```bash
npm install
npm run build         # dist/lry-editor.js (full, IIFE single file)
npm run build:lite    # dist/lry-editor-lite.js (lite edition)
npm run build:diagram # dist/lry-diagram-layout.js (shared published-page layout)
npm test              # jsdom regression (contract / adapter pass-through / feature entry points)
npm run test:browser  # real-browser regression (needs a local Chromium: CHROME_PATH, else ~/.cache/ms-playwright)
```

## License

- MIT. Bundled runtime libs: showdown / mermaid / KaTeX are MIT, highlight.js is BSD-3-Clause; license texts are in `third-party/mermaid.LICENSE`, `third-party/katex/LICENSE` and `third-party/highlight/LICENSE`. The third-party list is in [LICENSE](LICENSE).
- **Important**: If you use this rich text plugin in a project related to you, please be sure to write to me with a simple thank-you to encourage me to continue updating and optimizing this project(contact@lirongyaoper.com).

---

## Contact

| Channel | Details |
|---|---|
| Author | 轩鸿青 |
| Email | contact@lirongyaoper.com |
| Website / Blog | https://lirongyaoper.com |