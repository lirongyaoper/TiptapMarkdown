# lry-editor

An open-source multi-document rich text editor — Tiptap core, Yuque-style experience, **zero backend assumptions**.

- **Markdown dual-pane**: source on the left (per-line "+" gutter handle), WYSIWYG on the right, debounced two-way sync, lossless exit
- **Diagrams**: mermaid flowcharts / mindmaps / sequence / gantt / UML, rendered live in the editor
- **Yuque-style blocks**: folding blocks, column layouts, task lists, status chips, file cards, 4-color callout cards, code blocks (line numbers + language + copy), LaTeX math
- **Row-handle "+" menu**: 31 block operations (H1-H6 / callouts / quote / lists / tasks / code / fold / copy / cut / delete / indent / diagrams / formulas…)
- **Slash menu**: type `/` on an empty line, 47 cards in 6 groups
- **AI panel**: translate / continue / summarize / polish / outline / flowchart / mindmap (via adapter to any model)
- **Toolbar**: 89 buttons; full display on desktop, 3-row adaptive with "more" on mobile
- **Auto outline & heading fold, autosave, format painter, find & replace, fullscreen, multi-theme code highlighting**

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
LRYEditor.get('content')
```

## Storage HTML Contract

Output HTML is library-agnostic and database-ready; every custom block uses semantic `lry-*` classes:

```html
<pre class="lry-mermaid">graph TD; A-->B</pre>
<div class="lry-fold"><div class="lry-fold-head">…</div><div class="lry-fold-body">…</div></div>
<div class="lry-cols lry-cols-2"><div class="lry-col">…</div></div>
<ul class="lry-task"><li class="lry-task-item lry-task-done"><span class="lry-task-check">☑</span>…</li></ul>
<span class="lry-status lry-status-ok">done</span>
<blockquote class="lry-card lry-card-info">…</blockquote>
<pre class="brush:js;toolbar:false;">…</pre>
```

## Build

```bash
npm install && npm run build   # emits dist/lry-editor.js + lry-editor.css (IIFE single file)
```

## License

MIT. Bundled runtime libs (showdown / mermaid / KaTeX) are all MIT — see [LICENSE](LICENSE).
