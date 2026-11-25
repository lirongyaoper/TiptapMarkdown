import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';
const dom = new JSDOM('<body><div id="h"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;
w.Range.prototype.getClientRects = () => [];
w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
w.Text.prototype.getBoundingClientRect = function () { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; };
w.document.elementFromPoint = () => null;
w.eval(fs.readFileSync(new URL('../dist/lry-editor.js', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL ' + m); } };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const doc = w.document;

ok(!!w.LRYEditor && !!w.LRYEditor.create, 'global create');
ok(w.LRYEditor.VERSION === '1.4.1', 'version 1.4.1 (got ' + w.LRYEditor.VERSION + ')');
const inst = w.LRYEditor.create({ mount: doc.querySelector('#h'), textarea: 't', value: '<p>hello</p><ul class="lry-task"><li class="lry-task-item lry-task-done"><span class="lry-task-check">☑</span><div class="lry-task-body"><p>done</p></div></li></ul>', wordCount: false });
ok(inst.getContent().includes('hello') && inst.getContent().includes('lry-task-done'), 'contract roundtrip');
ok(inst.getContent().includes('task-done'), 'task done attr');

const { uploadFile, listAttachments } = await import('../src/upload.js');
const f = new w.File(['x'], 'a.png', { type: 'image/png' });
const r = await uploadFile(f, { filetype: 1 }, inst);
ok(r.url.startsWith('data:image/png'), 'memory adapter upload');
ok((await listAttachments(1, 0, inst)).total === 1, 'memory list');
/* 非图片文件经适配器:返回 filetype 2,且不进图库 */
const vf = new w.File(['v'], 'a.mp4', { type: 'video/mp4' });
const vr = await uploadFile(vf, { filetype: 2 }, inst);
ok(vr.filetype === 2 && vr.url.startsWith('data:video/mp4') && (await listAttachments(1, 0, inst)).total === 1, 'memory adapter: 非图片文件返回 filetype 2 且不进图库');

const { createUrlAdapter } = await import('../src/adapters.js');
ok(createUrlAdapter({ base: '/api/editor' }).name === 'url', 'createUrlAdapter factory');
ok(typeof w.LRYEditor.setAdapter === 'function' && typeof w.LRYEditor.createUrlAdapter === 'function', 'adapter 全局入口已挂到 window.LRYEditor');
/* URL 适配器:query 串基址的端点拼接(CMS 集成形态);上传表单只带可序列化字段
   (onProgress 回调、未定义的 module 不进表单)。fetch 在 Node 全局,桩掉看入参 */
{
  const { createUrlAdapter: mk, memoryAdapter: mem } = await import('../src/adapters.js');
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url, keys: [...init.body.keys()] }); return { json: async () => ({ status: 1, data: { url: '/up/a.png' } }) }; };
  try {
    const up = await mk({ base: '/index.php?m=attachment&c=lryeditor' })
      .upload(new File(['x'], 'a.png', { type: 'image/png' }), () => {}, { filetype: 1, module: undefined, onProgress: () => {} });
    ok(up.url === '/up/a.png' && seen[0].url === '/index.php?m=attachment&c=lryeditor&a=upload', 'url 适配器: query 串基址的上传端点(' + (seen[0] && seen[0].url) + ')');
    ok(seen[0].keys.includes('file') && seen[0].keys.includes('filetype') && !seen[0].keys.includes('onProgress') && !seen[0].keys.includes('module'),
      'url 适配器: 上传表单只带可序列化字段(' + seen[0].keys.join(',') + ')');
    globalThis.fetch = async (url) => { seen.push({ url }); return { json: async () => ({ status: 1, data: { list: [], total: 0 } }) }; };
    await mk({ base: '/index.php?m=attachment&c=lryeditor', listUrl: '/index.php?m=attachment&c=lryeditor&a=lists' }).list(1, 0);
    ok(seen[1].url === '/index.php?m=attachment&c=lryeditor&a=lists&filetype=1&start=0', 'url 适配器: 在线管理端点(' + seen[1].url + ')');
    /* REST 基址同样要正确拼接 action 与查询串 */
    globalThis.fetch = async (url) => { seen.push({ url }); return { ok: true, json: async () => ({ status: 1, data: { url: '/up/rest.png' } }) }; };
    await mk({ base: '/api/editor' }).upload(new File(['x'], 'rest.png', { type: 'image/png' }));
    ok(seen[seen.length - 1].url === '/api/editor/upload', 'url 适配器:REST 上传端点(' + seen[seen.length - 1].url + ')');
    await mk({ base: '/api/editor' }).list(1, 0);
    ok(seen[seen.length - 1].url === '/api/editor/list?filetype=1&start=0', 'url 适配器:REST 列表查询串(' + seen[seen.length - 1].url + ')');
    /* SSE:跨网络包的同一条 data 帧要等半包拼齐后再解析,两类 delta 都要回调 */
    const encoder = new TextEncoder();
    const aiChunks = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n',
      'data: {"type":"da',
      'ta","data":"好"}\n',
      'data: [DONE]\n'
    ].map((s) => encoder.encode(s));
    let aiIndex = 0;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      body: { getReader: () => ({ read: async () => aiIndex < aiChunks.length ? { done: false, value: aiChunks[aiIndex++] } : { done: true } }) }
    });
    const aiDeltas = [];
    const aiText = await mk({ aiUrl: '/api/ai' }).ai([{ role: 'user', content: 'hi' }], { onDelta: (d) => aiDeltas.push(d) });
    ok(aiText === '你好' && aiDeltas.join('') === '你好', 'url 适配器:AI SSE 半包解析与两类 delta(' + aiText + ')');
    /* 外部 AbortSignal 必须透传到 fetch */
    let abortSeen = false;
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const abortCtrl = new AbortController();
    const abortedRequest = mk({ aiUrl: '/api/ai' }).ai([], { signal: abortCtrl.signal });
    abortCtrl.abort();
    try { await abortedRequest; } catch (e) { abortSeen = /aborted/.test(e.message); }
    ok(abortSeen, 'url 适配器:AI 请求支持外部取消');
    /* 分片 init/part/finish:单片失败重试,进度按已完成分片推进 */
    const chunkCalls = [], chunkProgress = [];
    let failedPart = false;
    globalThis.fetch = async (url, init) => {
      const op = init.body.get('op');
      chunkCalls.push({ url, op, index: init.body.get('index'), csrf: init.body.get('lry_csrf_token') });
      if (op === 'init') return { ok: true, json: async () => ({ status: 1, data: { upload_id: 'u1', chunk_size: 3, chunk_total: 2 } }) };
      if (op === 'finish') return { ok: true, json: async () => ({ status: 1, data: { url: '/up/chunk.bin' } }) };
      if (!failedPart) { failedPart = true; return { ok: true, json: async () => ({ status: 0, message: '临时失败' }) }; }
      return { ok: true, json: async () => ({ status: 1, data: {} }) };
    };
    const chunkResult = await mk({ base: '/api/editor', chunked: true, csrfToken: 'tok', retryDelay: 0 })
      .uploadChunk(new File(['abcdef'], 'a.bin'), { filetype: 2, module: 'forum', onProgress: (p) => chunkProgress.push(p) });
    ok(chunkResult.url === '/up/chunk.bin' && chunkProgress.join(',') === '50,100', 'url 适配器:分片上传完成与进度(' + chunkProgress.join(',') + ')');
    ok(chunkCalls.length === 5 && chunkCalls[0].op === 'init' && chunkCalls.filter((c) => c.op === null).length === 3 && chunkCalls[chunkCalls.length - 1].op === 'finish'
      && chunkCalls.every((c) => c.url === '/api/editor/upload_chunk' && c.csrf === 'tok'), 'url 适配器:分片重试与 finish 协议');
  } finally { globalThis.fetch = realFetch; }
  /* 无 FileReader 的环境(Node / SSR):图转存走 Buffer 兜底 */
  if (typeof globalThis.FileReader === 'undefined') {
    const r = await mem.catch(['data:text/plain;base64,aGVsbG8=']);
    ok(r.list[0].state === 'SUCCESS' && r.list[0].url === 'data:text/plain;base64,aGVsbG8=', 'memory 适配器: 无 FileReader 环境下图转存走 Buffer 兜底(' + r.list[0].state + ')');
  }
}

inst.destroy();
ok(!doc.querySelector('.lry-editor'), 'destroy cleanup');

/* =====================================================================
 * 适配器贯穿:每个实例的 adapter 必须在该实例的每个上传/列表/抓图入口生效
 * (拖入/粘贴、对话框上传、在线管理、图转存)。合并站内版时这些调用点都必须
 * 带上实例——漏掉会静默回落到全局适配器。
 * ==================================================================== */
const calls = [];
const probe = {
  name: 'probe',
  async upload(file, onProgress, extra) { calls.push(['upload', file.name, extra.filetype]); return { url: '/probe/' + file.name, title: file.name, size: file.size, filetype: extra.filetype }; },
  async list(filetype) { calls.push(['list', filetype]); return { list: [{ url: '/probe/g.png', title: 'g.png' }], total: 1 }; },
  async catch(sources) { calls.push(['catch', sources[0]]); return { state: 'SUCCESS', list: sources.map((s) => ({ state: 'SUCCESS', url: '/probe/c.png', source: s })) }; },
  async ai() { calls.push(['ai']); return '## 标题\n\n- 项一\n\n```js\nconsole.log("<b>")\n```'; }
};
const host = doc.createElement('div'); doc.body.appendChild(host);
const P = w.LRYEditor.create({ mount: host, textarea: 'p1', value: '<p>文字</p><p><img src="/x/a.png"></p><p><img src="https://ext.example/a.png"></p>', adapter: probe });
await tick(); /* 粘贴/拖拽监听在 Tiptap 的 create 事件(下一拍)里挂载 */
const paste = (inst2, sel, flavors, files) => {
  if (sel != null) inst2.editor.chain().setTextSelection(sel).run();
  const ev = new w.Event('paste', { bubbles: true, cancelable: true });
  ev.clipboardData = { getData: (t) => (flavors && flavors[t]) || '', files: files || [] };
  inst2.editor.view.dom.dispatchEvent(ev);
  return ev;
};
const drop = async (inst2, files) => {
  const ev = new w.MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  ev.dataTransfer = { files };
  inst2.editor.view.dom.dispatchEvent(ev);
  await tick();
};
const I = w.LRYEditor._internals;
ok(!!I, 'window.LRYEditor._internals(纯逻辑测试钩子)');

/* 独立画板布局层:与编辑器共用同一份序列化,emoji/尖括号不会破坏 HTML 或 utf8 存储 */
w.eval(fs.readFileSync(new URL('../dist/lry-diagram-layout.js', import.meta.url), 'utf8'));
const DL = w.LryDiagramLayout;
ok(!!DL && DL.LAYOUT_VERSION === 1, '画板布局层独立构建可用');
const diagramSrc = 'graph TD\n  A-->B';
const diagramLayout = { v: 1, n: { A: [12.345, 20] }, items: [{ id: 's1', k: 'sticker', x: 3, y: 4, s: 40, t: '😀<&' }] };
const diagramEncoded = DL.attachLayout(diagramSrc, diagramLayout);
ok(DL.stripLayout(diagramEncoded) === diagramSrc && !!DL.parseLayout(diagramEncoded).n.A, '画板布局:写入图源并可解析');
const diagramJsonLine = diagramEncoded.split('\n').pop();
ok(!/😀|<|>/.test(diagramJsonLine) && DL.parseLayout(diagramEncoded).items[0].t === '😀<&', '画板布局:四字节字符与 HTML 尖括号转义后无损还原');
ok(DL.attachLayout(diagramSrc + '\r\n%% lry-layout v1\r\n%% {"v":1}', DL.emptyLayout()) === diagramSrc, '画板布局:空布局移除旧块并保留原源码');
const hostileSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
DL.renderItems(hostileSvg, { byKey: {} }, [
  { id: 't', k: 'text', t: '安全文字', c: 'red;background-image:url(https://evil.example/x)' },
  { id: 's', k: 'shape', fc: 'url(https://evil.example/x)', sc: '#123456' },
  { id: 'i', k: 'image', src: 'javascript:alert(1)' }
]);
const hostileMarkup = hostileSvg.outerHTML;
ok(!/background-image|javascript:|evil\.example/.test(hostileMarkup) && /color:\s*(?:#1f2329|rgb\(31, 35, 41\))/.test(hostileMarkup) && /fill="#ffffff"/.test(hostileMarkup), '画板布局:恶意颜色与图片协议被过滤');

/* 拖入图片与视频:走该实例的 adapter */
await drop(P, [new w.File(['i'], 'd.png', { type: 'image/png' }), new w.File(['v'], 'd.mp4', { type: 'video/mp4' })]);
ok(/<img src="\/probe\/d\.png"/.test(P.getContent()) && /<video[^>]*src="\/probe\/d\.mp4"/.test(P.getContent()), '拖入图片/视频:经实例 adapter 上传并插入(' + calls.filter((c) => c[0] === 'upload').map((c) => c[1]).join(',') + ')');
ok(calls.some((c) => c[0] === 'upload' && c[1] === 'd.mp4' && c[2] === 2), '视频以 filetype 2 交给 adapter');
calls.length = 0;
P.editor.chain().focus('end').run(); /* 上一步拖入已改变文档结构:不写死位置 */
paste(P, null, null, [new w.File(['i'], 'p.png', { type: 'image/png' })]);
await tick();
ok(calls.some((c) => c[0] === 'upload' && c[1] === 'p.png'), '粘贴截图文件:经实例 adapter 上传');
/* 工具栏「图转存」:外链图抓取(catch)经实例 adapter */
calls.length = 0;
P.wrapper.querySelector('[data-cmd=wordimage]').click();
await tick(40);
ok(calls.some((c) => c[0] === 'catch') && /\/probe\/c\.png/.test(P.getContent()), '图转存:catch 经实例 adapter(' + JSON.stringify(calls.map((c) => c[0])) + ')');
/* 图片上下文条 */
let imgPos = -1;
P.editor.state.doc.descendants((n, p) => { if (imgPos < 0 && n.type.name === 'image') imgPos = p; });
P.editor.chain().setNodeSelection(imgPos).run();
ok(imgPos >= 0 && P._ctxApi && P._ctxApi.isImageSelected() && I.resolveContext(P.editor).type === 'image', '上下文条:图片选中判定');
const imgTools = I.contextTools(P, I.resolveContext(P.editor));
ok(imgTools.length >= 12 && ['宽度 50%', '左浮动', '说明文字', '替换图片'].every((t) => imgTools.some((x) => (x.title || '').indexOf(t) === 0)), '图片条按钮齐全(' + imgTools.length + ')');
imgTools.find((x) => x.title === '宽度 50%').run();
ok(/<img[^>]* width="\d+"/.test(P.getContent()), '图片条宽度 50% 写 width');
/* 对话框上传入口(单图上传):file input 的 change 走实例 adapter。
   jsdom 弹不出文件框:临时接管 input.click,直接注入文件并触发 change */
calls.length = 0;
const origCreate = doc.createElement.bind(doc);
doc.createElement = function (tag, ...rest) {
  const el = origCreate(tag, ...rest);
  if (String(tag).toLowerCase() === 'input') el.click = function () {};
  return el;
};
P.wrapper.querySelector('[data-cmd=simpleupload]').click();
const fileInput = [...P.wrapper.querySelectorAll('input[type=file]')].pop();
if (fileInput) {
  Object.defineProperty(fileInput, 'files', { value: [new w.File(['i'], 's.png', { type: 'image/png' })], configurable: true });
  fileInput.dispatchEvent(new w.Event('change'));
  await tick(30);
}
doc.createElement = origCreate;
ok(calls.some((c) => c[0] === 'upload' && c[1] === 's.png') && /\/probe\/s\.png/.test(P.getContent()), '对话框单图上传:经实例 adapter 并插入');
/* 在线管理列表:经实例 adapter */
calls.length = 0;
P.wrapper.querySelector('[data-cmd=insertimage]').click();
await tick(30);
ok(calls.some((c) => c[0] === 'list') && !!doc.querySelector('.lry-gallery-item'), '在线管理列表:经实例 adapter(probe 返回的图出现在画廊)');
doc.querySelectorAll('.lry-dialog-x').forEach((x) => x.click());
await tick(200);
/* AI 结果智能插入(面板请求经 adapter.ai,此处直接验插入逻辑) */
w.eval(fs.readFileSync(new URL('../third-party/showdown.js', import.meta.url), 'utf8'));
await I.insertAiResult(P, '## 标题\n\n- 项一\n\n```js\nconsole.log("<b>")\n```');
ok(/<h2>标题<\/h2>/.test(P.getContent()) && /<ul>/.test(P.getContent()) && /&lt;b&gt;/.test(P.getContent()), 'AI 结果 Markdown 智能插入(代码里的标签保持为文本)');
const beforeDiv = (P.getContent().match(/<div/g) || []).length;
await I.insertAiResult(P, 'const a = "<div>";');
ok(/&lt;div&gt;/.test(P.getContent()) && (P.getContent().match(/<div/g) || []).length === beforeDiv, 'AI 纯文本结果按文本插入,不把 <div> 吞成真标签');
await I.insertAiResult(P, '%%{init: {"theme":"base"}}%%\ngraph TD\n  A-->B');
ok(/<pre class="lry-mermaid">%%\{init:/.test(P.getContent()) && /A--&gt;B/.test(P.getContent()), 'AI 结果:跳过 Mermaid 前置指令仍识别为画板');

/* 公式解析/原位编辑/形态切换/文末落位与折叠块开合 */
const M = w.LRYEditor.create({ mount: host, textarea: 'math', value: '<p>前 \\(x\\) 后</p><p class="lry-math lry-math-block">\\[y\\]</p><p></p>', wordCount: false });
let inlineMathPos = -1, blockMathPos = -1;
M.editor.state.doc.descendants((n, p) => {
  if (n.type.name === 'lryMathInline' && inlineMathPos < 0) inlineMathPos = p;
  if (n.type.name === 'lryMathBlock' && blockMathPos < 0) blockMathPos = p;
});
ok(inlineMathPos >= 0 && blockMathPos >= 0 && /<span class="lry-math">\\\(x\\\)<\/span>/.test(M.getContent()), '公式:裸定界符归一为可编辑节点');
M.editor.chain().setNodeSelection(blockMathPos).run();
ok(!!I.selectedMath(M.editor) && I.resolveContext(M.editor).type === 'math' && I.contextTools(M, I.resolveContext(M.editor)).length >= 5, '公式:节点选区命中公式上下文条');
ok(I.setMathForm(M.editor, false) && !/<p class="lry-math lry-math-block"/.test(M.getContent()), '公式:块级切换为行内并保持节点选中');
M.editor.commands.setContent('<p>正文</p>');
M.editor.chain().focus('end').run();
const insertedMathPos = I.applyMath(M.editor, 'E=mc^2', true, null, null);
ok(insertedMathPos !== null && /<p class="lry-math lry-math-block">\\\[E=mc\^2\\\]<\/p><p><\/p>$/.test(M.getContent())
  && M.editor.state.selection.$from.parent.type.name === 'paragraph', '公式:文末块级公式后自动补可写段落');
const Fold = w.LRYEditor.create({ mount: host, textarea: 'fold', value: '<div class="lry-fold"><div class="lry-fold-head">标题</div><div class="lry-fold-body"><p>正文</p></div></div>', wordCount: false });
let foldTextPos = -1;
Fold.editor.state.doc.descendants((n, p) => { if (n.isText && n.text === '正文') foldTextPos = p; });
Fold.editor.chain().setTextSelection(foldTextPos).run();
Fold.editor.commands.toggleFold();
ok(/lry-fold-close/.test(Fold.getContent()), '折叠块:正文内可切换为收起');
Fold.editor.commands.toggleFold();
ok(!/lry-fold-close/.test(Fold.getContent()), '折叠块:标题内可再次展开');
const Dg = w.LRYEditor.create({ mount: host, textarea: 'diagram', value: '<pre class="lry-mermaid">graph TD\n  A--&gt;B</pre>', wordCount: false });
ok(!!Dg.wrapper.querySelector('.lry-diagram') && !!Dg.wrapper.querySelector('.lry-diagram-tabs') && Dg.getContent() === '<pre class="lry-mermaid">graph TD\n  A--&gt;B</pre>', '画板:可视化编辑 DOM 接入且存储契约不变');
/* Markdown 容器可嵌套,折叠/分栏/画板导出再导入不丢外壳 */
const mdCore = await import('../src/md-core/index.js');
const { normalizeYuqueHtml } = await import('../src/md/ensure.js');
const prevDocument = globalThis.document, prevWindow = globalThis.window, prevShowdown = globalThis.showdown;
globalThis.document = doc; globalThis.window = w; globalThis.showdown = w.showdown;
try {
  const nestedMd = ':::fold 标题\n:::cols 2\n:::col\n```mermaid\ngraph TD\n  A-->B\n```\n:::\n:::col\n- 列表项\n:::\n:::\n:::';
  const nestedHtml = normalizeYuqueHtml(mdCore.markdownToHtml(nestedMd, {}));
  const nestedBack = mdCore.htmlToMarkdown(nestedHtml, { richFormat: true });
  ok(/lry-fold/.test(nestedHtml) && /lry-cols/.test(nestedHtml) && /lry-mermaid/.test(nestedHtml), 'Markdown:嵌套折叠/分栏/画板导入');
  ok(/:::fold 标题/.test(nestedBack) && /:::cols 2/.test(nestedBack) && /```mermaid/.test(nestedBack), 'Markdown:嵌套容器与画板类型导出保真');
} finally {
  if (prevDocument === undefined) delete globalThis.document; else globalThis.document = prevDocument;
  if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  if (prevShowdown === undefined) delete globalThis.showdown; else globalThis.showdown = prevShowdown;
}

/* =====================================================================
 * v1.2 功能(同步自站内版)
 * ==================================================================== */
/* 表格上下文条 + 单元格背景 + 列宽拖拽 */
const T = w.LRYEditor.create({ mount: host, textarea: 't2', value: '<table><tbody><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></tbody></table>', wordCount: false });
T.editor.chain().setTextSelection(4).run(); /* 单元格内段落的首字符前(位置 3 是段落边界,非法) */
const tc = I.resolveContext(T.editor);
ok(tc && tc.type === 'table' && I.contextTools(T, tc).length >= 13, '表格上下文条判定与按钮');
I.setCellBackground(T.editor, '#fff3cd');
ok(/background-color:\s*(#fff3cd|rgb\(255, 243, 205\))/.test(T.getContent()) && !/bgcolor/.test(T.getContent()), '单元格背景走 style');
T.editor.view.dom.querySelectorAll('.lry-col-resize')[0].dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }));
doc.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 180 }));
doc.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
ok(/<td width="\d+"/.test(T.getContent()), '列宽拖拽写入 width');

/* 斜杠面板:行首 "/" 触发、文档驱动过滤、回车选中 */
const S = w.LRYEditor.create({ mount: host, textarea: 't3', value: '<p>x</p>', wordCount: false });
S.editor.chain().setTextSelection(1).run();
S.editor.commands.insertContent('/');
ok(!!doc.querySelector('.lry-slash-pop'), '斜杠面板:行首 "/" 弹出');
S.editor.commands.insertContent('表格');
const labels = [...doc.querySelectorAll('.lry-slash-item .lry-menu-text')].map((e) => e.textContent);
ok(labels[0] === '表格', '斜杠面板:过滤"表格"最佳匹配居首(' + labels.join(',') + ')');
S.editor.view.dom.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
ok(/<table/.test(S.getContent()) && !/\/表格/.test(S.editor.state.doc.textContent) && !doc.querySelector('.lry-slash-pop'), '斜杠面板:回车插入表格,残字不留');
ok(I.matchItems(I.buildGroups(), 'todo')[0].it.label === '任务列表' && I.isTrigger({ parentType: 'codeBlock', parentOffset: 1, oldPos: 1, newPos: 2, oldEmpty: true }) === null, '斜杠面板:别名过滤;代码块内不触发');

/* 查找匹配(跨样式)+ 浮动条替换 */
const F = w.LRYEditor.create({ mount: host, textarea: 't4', value: '<p>Hello <strong>hel</strong>lo world</p>', wordCount: false });
ok(I.collectMatches(F.editor.state.doc, 'hello').matches.length === 2, '查找:跨 mark 边界匹配');
ok(I.collectMatches(F.editor.state.doc, 'hel+o', { regex: true }).matches.length === 2 && !!I.collectMatches(F.editor.state.doc, '(', { regex: true }).error, '查找:正则与非法正则');
F.findApi.open();
const fb = F.wrapper.querySelector('.lry-findbar');
fb.querySelector('.lry-find-q').value = 'hello';
fb.querySelector('.lry-find-q').dispatchEvent(new w.Event('input'));
fb.querySelector('[title^="展开"]').click();
fb.querySelector('.lry-find-r').value = 'hi';
fb.querySelectorAll('.lry-find-rep .lry-btn')[1].click();
ok(F.editor.state.doc.textContent === 'hi hi world', '查找条:全部替换(' + F.editor.state.doc.textContent + ')');
F.findApi.close(false);

/* 自动排版 / 统计 / 导出 / 网址校验 */
const AT = w.LRYEditor.create({ mount: host, textarea: 't5', value: '<p>\u3000甲\u3000</p><p></p><p></p><pre class="brush:js;toolbar:false;">  x</pre>', wordCount: false });
const atTr = AT.editor.state.tr;
const atStat = I.typesetDoc(atTr, { emptyParas: true, trimSpaces: true, mergeBlank: true });
AT.editor.view.dispatch(atTr);
ok(atStat && atStat.trimmed >= 1 && AT.getContent() === '<p>甲</p><pre class="brush:js;toolbar:false;">  x</pre>', '自动排版:清空格、删空段,代码块缩进不动(' + AT.getContent() + ')');
const st = I.computeStats(w.LRYEditor.create({ mount: host, textarea: 't6', value: '<h1>标题</h1><p>Hello world 你好,世界!</p>', wordCount: false }).editor.state.doc);
ok(st.cjk === 6 && st.latin === 2 && st.headings === 1 && st.paragraphs === 1 && st.minutes === 1, '字数统计(' + JSON.stringify(st) + ')');
ok(I.buildDocument('t', '<p>x</p>', true).indexOf('schemas-microsoft-com:office:word') > 0 && I.buildDocument('t', '<p>x</p>', false).indexOf('<!DOCTYPE html>') === 0, '导出:Word 带 Office 命名空间头;网页为完整文档');
ok(I.normalizeHref('javascript:alert(1)').error && I.normalizeHref('www.a.com/x').href === 'https://www.a.com/x', '网址校验');

/* 代码块:Tab 缩进、空行回车跳出、粘贴识别 */
const C = w.LRYEditor.create({ mount: host, textarea: 't7', value: '<pre class="brush:js;toolbar:false;">a\n  b</pre>', wordCount: false });
C.editor.view.focus();
C.editor.chain().setTextSelection({ from: 1, to: 6 }).run();
const cTr = C.editor.state.tr;
ok(I.indentCode(cTr, 1) && cTr.doc.firstChild.textContent === '\ta\n\t  b', '代码块多行选区 Tab 缩进');
const E = w.LRYEditor.create({ mount: host, textarea: 't8', value: '<pre class="brush:js;toolbar:false;">a</pre>', wordCount: false });
E.editor.chain().setTextSelection(2).run();
const press = () => E.editor.view.dom.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
press(); press();
ok(E.getContent() === '<pre class="brush:js;toolbar:false;">a</pre><p></p>' && E.editor.state.selection.$from.parent.type.name === 'paragraph', '代码块:连按两次回车跳出(' + E.getContent() + ')');
ok(I.detectLanguage('<?php\nfunction f($a) {\n  echo $a;\n}\n') === 'php' && I.detectLanguage('这是一段说明\n不是代码的两行文字内容\n') === null, '粘贴识别:确定性特征,普通文字不猜');
ok(I.tokenize('const a = 1;', 'js').length === 0, '高亮组件未加载时不高亮(不报错)');

/* 预告下一行 + 文末空白点击 */
const N = w.LRYEditor.create({ mount: host, textarea: 't9', value: '<p>段落</p><pre class="brush:js;toolbar:false;">a</pre>', wordCount: false });
ok(!!N.wrapper.querySelector('.lry-next-line') && I.blankClickAction(N.editor.state.doc) === 'insert', '预告下一行:末块为代码块时出现');
N.wrapper.querySelector('.lry-next-add').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
await tick(20);
ok(N.getContent() === '<p>段落</p><pre class="brush:js;toolbar:false;">a</pre><p></p>' && !!doc.querySelector('.lry-row-menu'), '预告行「+」:新起段落并弹出行菜单');
doc.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
ok(!N.wrapper.querySelector('.lry-next-line') && [...N.wrapper.querySelectorAll('.lry-row-handle:not(.lry-next-add)')].pop().classList.contains('lry-row-handle-next'), '新段落成为待写行,其行柄常显');
N.editor.chain().setContent('<p>段落</p><pre class="brush:js;toolbar:false;">a</pre>').run();
N.editor.view.dom.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
ok(/<\/pre><p><\/p>$/.test(N.getContent()), '点代码块下方空白:其后新起段落');

/* =====================================================================
 * 编辑态高亮:载入随包的 highlight.js 与调色板后着色;语言下拉;粘贴结构
 * ==================================================================== */
w.eval(fs.readFileSync(new URL('../third-party/highlight/lry-code-themes.js', import.meta.url), 'utf8'));
w.eval(fs.readFileSync(new URL('../third-party/highlight/highlight.min.js', import.meta.url), 'utf8'));
const H = w.LRYEditor.create({ mount: host, textarea: 't10', value: '<pre class="brush:js;toolbar:false;theme:monokai;">const a = "x"; // c</pre>', wordCount: false });
await tick(20);
const box = H.wrapper.querySelector('.lry-codebox');
ok(!!w.hljs && !!w.LryCodeThemes && box.classList.contains('theme-monokai'), '随包 highlight.js / 调色板可用,主题类挂到代码块');
const kw = box.querySelector('pre .hljs-keyword');
ok(kw && kw.textContent === 'const' && !!box.querySelector('pre .hljs-string'), '编辑区出现令牌装饰');
ok(H.getContent() === '<pre class="brush:js;toolbar:false;theme:monokai;">const a = "x"; // c</pre>', '着色不进序列化');
box.querySelector('.lry-codebar-lang').click();
const pop = doc.querySelector('.lry-codelang-pop');
ok(!!pop && pop.querySelectorAll('.lry-menu-item').length >= 50, '顶栏语言下拉(' + (pop && pop.querySelectorAll('.lry-menu-item').length) + ' 项)');
const search = pop.querySelector('.lry-codelang-search');
search.value = 'py'; search.dispatchEvent(new w.Event('input'));
pop.querySelector('.lry-menu-item').click();
ok(/brush:python;toolbar:false;theme:monokai;/.test(H.getContent()), '语言下拉:切换语言并保留主题');
/* 粘贴 <pre><code class="language-x">:按块结构插入,语言归一为编辑器标识 */
H.editor.chain().setContent('<p>锚点</p>').run();
paste(H, 3, { 'text/html': '<pre><code class="language-typescript">interface A {}</code></pre>', 'text/plain': 'interface A {}' });
await tick(20);
ok(H.getContent() === '<p>锚点</p><pre class="brush:ts;toolbar:false;">interface A {}</pre>', '粘贴网页形态代码块:按块结构插入(' + H.getContent() + ')');

/* ---------- 工具栏预设(CMS 集成的入口:create({ preset: 'full' | 'mini' })) ----------
 * 配置里有、注册表里没有的命令会被静默跳过——预设只能靠"配置的每个命令都渲染出按钮"来把关 */
const pre = doc.createElement('div');
pre.id = 'pre_host';
doc.body.appendChild(pre);
const mini = w.LRYEditor.create({ mount: '#pre_host', textarea: 'pre_content', preset: 'mini', wordCount: false, elementPath: false });
await tick();
const wantMini = mini.toolbarConfig.flat().filter((x) => x !== '|');
const gotMini = new Set([...doc.querySelectorAll('#pre_host .lry-tool-btn')].map((b) => b.getAttribute('data-cmd')));
ok(wantMini.length === 24 && wantMini.every((c) => gotMini.has(c)), 'preset mini: 配置的 24 个命令全部渲染(缺:' + wantMini.filter((c) => !gotMini.has(c)).join(',') + ')');
ok(!doc.querySelector('#pre_host .lry-wordcount') && !doc.querySelector('#pre_host .lry-elementpath'), 'preset mini: 关闭字数/元素路径时状态栏不出现');
mini.setContent('<p>段落文字</p><pre class="brush:js;toolbar:false;">const a = 1;</pre>');
await tick(20);
ok(!!doc.querySelector('#pre_host .lry-next-line') && typeof mini.findApi === 'object', 'preset mini: 预告下一行 / 查找条同样挂载');
mini.destroy();
const fullp = w.LRYEditor.create({ mount: '#pre_host', textarea: 'pre_content2', preset: 'full' });
await tick();
ok(fullp.toolbarConfig.flat().filter((x) => x !== '|').length === 90 && doc.querySelectorAll('#pre_host .lry-tool-btn').length === 90, 'preset full: 90 个命令全部渲染');
fullp.destroy();
/* CMS 集成形态(以 YzmCMS 升级包的 form::editor() 为准):挂在既有隐藏 textarea 上、不带 textarea 选项;
   资源平铺在 plugin/lry-editor/(无 dist/),包根由 window.LRY_EDITOR_BASE 指定。
   jsdom 不加载外部脚本,这里只看它去取什么地址 */
w.LRY_EDITOR_BASE = '/common/static/plugin/lry-editor';
const ta = doc.createElement('textarea');
ta.id = 'cms_content';
ta.name = 'content';
ta.setAttribute('style', 'display:none');
ta.value = '<p>旧文</p><pre class="brush:js;toolbar:false;">var a = 1;</pre>';
doc.body.appendChild(ta);
const cms = w.LRYEditor.create({ mount: '#cms_content', height: 400, preset: 'full' });
await tick(80);
ok(w.LRYEditor.get('content') === cms && cms.getContent().includes('<pre class="brush:js;toolbar:false;">var a = 1;</pre>'), 'CMS 形态: 挂在既有 textarea 上,按 name 取回实例并载入其内容');
const taAfter = doc.querySelector('textarea[name=content]');
ok(taAfter && taAfter.id === 'cms_content' && taAfter !== cms.editor.view.dom, 'CMS 形态: 隐藏域保留 name/id(页面既有校验与提交不感知)');
cms.setContent('<p>改</p>');
await tick(260);
ok(taAfter.value === '<p>改</p>', 'CMS 形态: 内容防抖写回原隐藏域(' + taAfter.value + ')');
cms.destroy();
/* 包根只在页面首次需要高亮时求值一次并缓存——主窗口里前面的用例已经触发过,
   LRY_EDITOR_BASE 的取值必须在干净窗口里测 */
const dom2 = new JSDOM('<body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w2 = dom2.window;
w2.Range.prototype.getClientRects = () => [];
w2.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
w2.Text.prototype.getBoundingClientRect = function () { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; };
w2.document.elementFromPoint = () => null;
w2.LRY_EDITOR_BASE = '/common/static/plugin/lry-editor';
w2.eval(fs.readFileSync(new URL('../dist/lry-editor.js', import.meta.url), 'utf8'));
const ta2 = w2.document.createElement('textarea');
ta2.id = 'content';
ta2.name = 'content';
ta2.value = '<p>旧文</p><pre class="brush:js;toolbar:false;">var a = 1;</pre>';
w2.document.body.appendChild(ta2);
const cms2 = w2.LRYEditor.create({ mount: '#content', height: 400, preset: 'full' });
await tick(80);
const hlReq = [...w2.document.querySelectorAll('script[src*="highlight/"]')].map((s) => s.getAttribute('src'));
ok(hlReq.length === 1 && hlReq[0] === '/common/static/plugin/lry-editor/third-party/highlight/lry-code-themes.js',
  'CMS 形态: 高亮资源取自 LRY_EDITOR_BASE 指定的包根(平铺布局,无 dist/)→ ' + hlReq.join(','));
cms2.setContent('<p>公式 <span class="lry-math">\\(x^2\\)</span></p><pre class="lry-mermaid">graph TD\n  A--&gt;B</pre>');
await tick(30);
const engineReq = [...w2.document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
const katexCss = [...w2.document.querySelectorAll('link[data-lry-katex]')].map((s) => s.getAttribute('href'));
ok(engineReq.includes('/common/static/plugin/lry-editor/third-party/katex/katex.min.js')
  && engineReq.includes('/common/static/plugin/lry-editor/third-party/mermaid.min.js')
  && katexCss[0] === '/common/static/plugin/lry-editor/third-party/katex/katex.min.css', 'CMS 形态:KaTeX/Mermaid 同样从 LRY_EDITOR_BASE 包根加载');
cms2.destroy();
dom2.window.close();
ok(!doc.querySelector('textarea[name=content]') || doc.querySelector('textarea[name=content]') === taAfter, 'CMS 形态: destroy 后不残留');

/* ---------- lry-editor-lite(留言/评论简约版,独立 IIFE bundle) ---------- */
[...w.LRYEditor.instances.values()].forEach((x) => { try { x.destroy(); } catch (e) { /* ignore */ } });
w.eval(fs.readFileSync(new URL('../dist/lry-editor-lite.js', import.meta.url), 'utf8'));
ok(!!w.LRYEditorLite && w.LRYEditorLite.VERSION === '1.4.1', 'lite: global create / version 1.4.1');
const div = doc.createElement('div');
div.id = 'lite_host';
doc.body.appendChild(div);
const lite = w.LRYEditorLite.create({
  mount: '#lite_host', textarea: 'lite_content', maximumWords: 50, height: 120,
  value: '<p>hi <strong>bold</strong> <a href="https://example.com" title="t">link</a></p><ul><li>item</li></ul><blockquote><p>quote</p></blockquote><ul class="lry-task"><li class="lry-task-item lry-task-done"><span class="lry-task-check">☑</span><div class="lry-task-body"><p>done</p></div></li></ul>'
});
ok(lite.getContent().includes('<strong>bold</strong>') && lite.getContent().includes('<a href="https://example.com"'), 'lite: roundtrip 保留行内格式/链接');
ok(lite.getContent().includes('<ul><li>item</li></ul>') && lite.getContent().includes('<blockquote>'), 'lite: 列表/引用');
ok(lite.getContent().includes('lry-task-done') && lite.getContent().includes('☑'), 'lite: 待办清单契约(☑/☐ 字符)');
ok(doc.querySelectorAll('#lite_host .lry-tool-btn').length === 15, 'lite: 工具栏 15 钮(含待办清单)');
ok(lite.getText().includes('bold'), 'lite: getText');
/* 输入清洗:script/on* 属性剥除 */
lite.setContent('<p>a</p><script>alert(1)</script><p onclick="x()">b</p>');
ok(!lite.getContent().includes('alert') && !lite.getContent().includes('onclick'), 'lite: 输入清洗剥 script/on*');
/* 字数上限:CharacterCount limit 阻断超限插入 */
lite.editor.commands.setContent('<p></p>');
lite.editor.chain().focus().insertContent(new Array(60).fill('字').join('')).run();
ok(lite.editor.getText().length <= 50, 'lite: maximumWords 硬上限');
ok(w.LRYEditorLite.get('lite_content') === lite, 'lite: get(name) 取回实例');
const liteTa = doc.querySelector('textarea[name=lite_content]');
ok(liteTa && liteTa.getAttribute('data-lry-lite') === '1', 'lite: 隐藏域 data 标记');
lite.destroy();
ok(!doc.querySelector('.lry-lite'), 'lite: destroy cleanup');
/* 贴图(images:true):工具栏多出贴图钮;上传必须走该实例自己的 adapter,
   漏传实例会静默回落到全局 memory 适配器(返回 dataURI 而非适配器给的地址) */
const liteCalls = [];
const div2 = doc.createElement('div');
div2.id = 'lite_host2';
doc.body.appendChild(div2);
const lite2 = w.LRYEditorLite.create({
  mount: '#lite_host2', textarea: 'lite_content2', images: true,
  adapter: {
    name: 'lite-probe',
    async upload(file, onProgress, extra) { liteCalls.push(['upload', file.name, extra.filetype]); return { url: '/lite-probe/' + file.name, filetype: 1 }; }
  }
});
ok(doc.querySelectorAll('#lite_host2 .lry-tool-btn').length === 16, 'lite: images:true 工具栏 16 钮(多出贴图钮)');
const imgBtn = [...doc.querySelectorAll('#lite_host2 .lry-tool-btn')].find((b) => b.title === '插入图片');
imgBtn.click();
const picker = doc.querySelector('input[type=file]');
ok(!!picker, 'lite: 点贴图钮弹出文件选择');
Object.defineProperty(picker, 'files', { value: [new w.File(['x'], 'a.png', { type: 'image/png' })] });
picker.dispatchEvent(new w.Event('change'));
await tick(40);
ok(liteCalls.length === 1 && liteCalls[0][1] === 'a.png' && liteCalls[0][2] === 1, 'lite: 贴图经该实例的 adapter 上传(filetype 1)');
ok(/<img src="\/lite-probe\/a\.png"/.test(lite2.getContent()), 'lite: 贴图后插入适配器返回的地址(' + lite2.getContent() + ')');
lite2.destroy();

console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
