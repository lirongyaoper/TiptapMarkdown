/**
 * 浏览器回归(真实 Chromium + 真实鼠标键盘):验证 jsdom 测不到、且与开源包形态强相关的部分——
 * 第三方资源按 <script src> 推断包根再懒加载(highlight.js / showdown / mermaid)、
 * 浮层显隐与定位、拖拽、真实按键、默认 memory 适配器下的粘贴/拖入上传。
 *
 * 运行:npm run test:browser
 * 浏览器:环境变量 CHROME_PATH(或 PUPPETEER_EXECUTABLE_PATH)> ~/.cache/ms-playwright 下版本最高的
 *        Chromium > /snap/bin/chromium;都找不到时报错退出(不静默跳过)。
 * 自带静态服务(随机端口)提供仓库根目录,页面用 demo/index.html 与 demo/lite.html;
 * 另合成一个只有编辑器脚本的空白页 /demo/__blank.html,用来测"文档里没有代码块时不加载 highlight.js"
 * (demo 首页自带代码块样例,首屏就会加载)。
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const env = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env) return env;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => parseInt(b.split('-')[1], 10) - parseInt(a.split('-')[1], 10));
    for (const d of dirs) {
      const p = path.join(base, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) { /* ignore */ }
  if (fs.existsSync('/snap/bin/chromium')) return '/snap/bin/chromium';
  return null;
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.json': 'application/json' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL ' + m); } };

const chrome = findChrome();
if (!chrome) {
  console.error('未找到 Chromium:请设置 CHROME_PATH,或安装 Playwright Chromium(~/.cache/ms-playwright)');
  process.exit(2);
}

const server = http.createServer((req, res) => {
  const route = req.url.split('?')[0];
  if (route === '/demo/__blank.html') { /* 合成的空白页:只有编辑器脚本,文档里没有代码块 */
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="../dist/lry-editor.css"></head>'
      + '<body><div id="editor"></div><script src="../dist/lry-editor.js"></script>'
      + '<script>window.__blank = LRYEditor.create({ mount: "#editor", textarea: "c", value: "<p>没有代码块的文档</p>" });</script></body></html>');
    return;
  }
  const p = path.join(ROOT, decodeURIComponent(route.replace(/^\//, '')));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lry-editor-browser-'));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'], userDataDir: profile });
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });

  /* ================= 合成空白页:文档无代码块时不加载 highlight.js ================= */
  await page.goto(base + '/demo/__blank.html', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(800);
  const lazy0 = await page.evaluate(() => ({ has: !!window.__blank, hljs: !!window.hljs, hlReq: performance.getEntriesByType('resource').some((e) => /highlight/.test(e.name)) }));
  ok(lazy0.has && !lazy0.hljs && !lazy0.hlReq, '按需懒加载:文档里没有代码块时不请求 highlight.js');
  await page.evaluate(() => window.__blank.setContent('<p>说明</p><pre class="brush:js;toolbar:false;">function hi(name) {\n  return "hi " + name;\n}</pre>'));
  await sleep(1500);
  const lazy1 = await page.evaluate(() => ({ hljs: !!window.hljs, url: (performance.getEntriesByType('resource').map((e) => e.name).find((u) => /highlight\.min\.js$/.test(u)) || '').replace(/^https?:\/\/[^/]+/, '') }));
  ok(lazy1.hljs && /\/third-party\/highlight\/highlight\.min\.js$/.test(lazy1.url), '出现代码块后才从包内 third-party/highlight/ 加载(' + lazy1.url + ')');

  /* ================= demo/index.html(full 版) ================= */
  await page.goto(base + '/demo/index.html', { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(500);
  let s = await page.evaluate(() => ({
    version: window.LRYEditor.VERSION, buttons: document.querySelectorAll('.lry-tool-btn').length,
    adapterGlobals: typeof window.LRYEditor.setAdapter + '/' + typeof window.LRYEditor.createUrlAdapter,
    mermaid: !!window.mermaid, hasInst: !!window.LRYEditor.instances.size, hljs: !!window.hljs,
    diagram: !!document.querySelector('.lry-editor .lry-diagram'),
    diagramKind: (document.querySelector('.lry-editor .lry-diagram') || {}).dataset && document.querySelector('.lry-editor .lry-diagram').dataset.kind,
    diagramTools: document.querySelectorAll('.lry-editor .lry-diagram-dock-btn').length,
    diagramCanvas: !!(document.querySelector('.lry-editor .lry-diagram') || {}).__lryCanvas
  }));
  ok(s.version === '1.4.1', 'full: 版本 1.4.1(' + s.version + ')');
  ok(s.buttons >= 80 && s.hasInst, 'full: 工具栏 ' + s.buttons + ' 钮,实例已建');
  ok(s.adapterGlobals === 'function/function', 'full: 适配器全局入口(setAdapter / createUrlAdapter)');
  ok(s.mermaid, 'third-party 基址推断:mermaid 已从包内 third-party/ 加载');
  ok(s.diagram && s.diagramKind === 'flow' && s.diagramCanvas && s.diagramTools === 8, '画板:流程图可视化编辑与 8 个自由画布工具已接入');

  /* ---- 画板工具切换 / 源码模式隐藏并恢复布局块 ---- */
  await page.evaluate(() => { window.__inst = [...window.LRYEditor.instances.values()][0]; });
  const diagramTool = await page.evaluate(() => {
    const d = document.querySelector('.lry-editor .lry-diagram');
    d.querySelector('[data-tool="text"]').click();
    const picked = d.querySelector('.lry-diagram-stage').dataset.tool;
    d.querySelector('[data-tool="select"]').click();
    return { picked, restored: d.querySelector('.lry-diagram-stage').dataset.tool };
  });
  ok(diagramTool.picked === 'text' && diagramTool.restored === 'select', '画板:自由工具可切换并退回选择');
  await page.evaluate(() => {
    const d = document.querySelector('.lry-editor .lry-diagram');
    [...d.querySelectorAll('.lry-diagram-tab')].find((b) => b.textContent === '源码').click();
    const ta = d.querySelector('.lry-diagram-src-ta');
    ta.value = 'graph TD\n  A-->B\n%% lry-layout v1\n%% {"v":1,"n":{"A":[10,20]},"items":[]}';
    ta.dispatchEvent(new Event('input'));
  });
  await sleep(600);
  await page.evaluate(() => {
    const d = document.querySelector('.lry-editor .lry-diagram');
    [...d.querySelectorAll('.lry-diagram-tab')].find((b) => b.textContent === '可视化').click();
  });
  await sleep(1200);
  const diagramLayout = await page.evaluate(() => window.__inst.getContent());
  ok(/%% lry-layout v1/.test(diagramLayout) && /"A":\[10,20\]/.test(diagramLayout), '画板:源码模式隐藏布局,切回可视化后原样写回');

  /* ---- 编辑态高亮:demo 首页自带代码块样例,载入即着色;资源取自 third-party/highlight/ ---- */
  ok(s.hljs, 'demo 首页自带代码块样例:载入即着色(highlight.js 随首屏加载)');
  await page.evaluate(() => {
    window.__inst = [...window.LRYEditor.instances.values()][0];
    window.__inst.setContent('<p>说明</p><pre class="brush:js;toolbar:false;theme:monokai;">function hi(name) {\n  // 打招呼\n  return "hi " + name;\n}\nconsole.log(hi("a"));</pre>');
  });
  await sleep(1500);
  const hl = await page.evaluate(() => {
    const box = document.querySelector('.lry-editor .lry-codebox');
    const kw = box.querySelector('pre .hljs-keyword');
    const str = box.querySelector('pre .hljs-string');
    const res = performance.getEntriesByType('resource').map((e) => e.name);
    return {
      hljs: !!window.hljs, themes: !!window.LryCodeThemes,
      hljsUrl: res.find((u) => /highlight\.min\.js$/.test(u)) || '', themesUrl: res.find((u) => /lry-code-themes\.js$/.test(u)) || '',
      style: !!document.querySelector('style[data-lry-code-themes="editor"]'), themeClass: box.className,
      kw: kw ? { text: kw.textContent, color: getComputedStyle(kw).color } : null,
      str: str ? { text: str.textContent, color: getComputedStyle(str).color } : null,
      label: box.querySelector('.lry-codebar-lang').textContent,
      html: window.__inst.getContent()
    };
  });
  ok(hl.hljs && hl.themes, 'highlight.js 与调色板就绪');
  ok(/\/third-party\/highlight\/highlight\.min\.js$/.test(hl.hljsUrl) && /\/third-party\/highlight\/lry-code-themes\.js$/.test(hl.themesUrl),
    '高亮资源取自包内 third-party/highlight/(' + hl.hljsUrl.replace(/^https?:\/\/[^/]+/, '') + ')');
  ok(hl.style && /theme-monokai/.test(hl.themeClass) && hl.label === 'JavaScript', '主题类与顶栏语言名');
  ok(hl.kw && hl.kw.text === 'function' && hl.str && hl.str.text === '"hi "', '编辑区令牌装饰(关键字/字符串)');
  const want = await page.evaluate(() => {
    const p = window.LryCodeThemes.palette('monokai');
    const probe = document.createElement('span'); document.body.appendChild(probe);
    probe.style.color = p.token.keyword; const kw = probe.style.color;
    probe.style.color = p.token.string; const str = probe.style.color; probe.remove();
    return { kw, str };
  });
  ok(hl.kw.color === want.kw && hl.str.color === want.str, '令牌颜色即该代码块主题(monokai)的调色板(' + hl.kw.color + ' / ' + hl.str.color + ')');
  ok(/<pre class="brush:js;toolbar:false;theme:monokai;">function hi\(name\) \{\n  \/\/ 打招呼/.test(hl.html) && !/<pre[^>]*>[\s\S]*<span/.test(hl.html), '着色不进序列化');

  /* ---- 顶栏语言下拉 ---- */
  const lb = await page.evaluate(() => { const b = document.querySelector('.lry-editor .lry-codebar-lang'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(lb.x, lb.y);
  await sleep(300);
  const pop = await page.evaluate(() => { const p = document.querySelector('.lry-codelang-pop'); return p ? { n: p.querySelectorAll('.lry-menu-item').length, active: (p.querySelector('.lry-menu-active .lry-menu-text') || {}).textContent } : null; });
  ok(!!pop && pop.n >= 50 && pop.active === 'JavaScript', '语言下拉弹出(' + (pop && pop.n) + ' 项,当前 ' + (pop && pop.active) + ')');
  await page.keyboard.type('py');
  await page.keyboard.press('Enter');
  await sleep(300);
  const afterPick = await page.evaluate(() => ({ label: document.querySelector('.lry-editor .lry-codebar-lang').textContent, html: window.__inst.getContent().slice(0, 70), pop: !!document.querySelector('.lry-codelang-pop') }));
  ok(afterPick.label === 'Python' && /brush:python;toolbar:false;theme:monokai;/.test(afterPick.html) && !afterPick.pop, '搜索并回车:切换为 Python,保留主题');

  /* ---- 公式 KaTeX 编辑态 / 符号面板 ---- */
  await page.evaluate(() => window.__inst.setContent('<p>公式 <span class="lry-math">\\(x^2\\)</span></p>'));
  await sleep(1200);
  const formula = await page.evaluate(() => ({
    rendered: !!document.querySelector('.lry-editor .lry-math .katex'),
    html: window.__inst.getContent()
  }));
  ok(formula.rendered && /<span class="lry-math">\\\(x\^2\\\)<\/span>/.test(formula.html), '公式:KaTeX 编辑态渲染且序列化保持定界符契约');
  await page.evaluate(() => document.querySelector('.lry-editor [data-cmd="formula"]').click());
  await sleep(250);
  const formulaPalette = await page.evaluate(() => ({
    open: !!document.querySelector('.lry-formula'),
    symbols: document.querySelectorAll('.lry-formula-sym').length,
    tabs: document.querySelectorAll('.lry-formula-tabs .lry-tab').length
  }));
  ok(formulaPalette.open && formulaPalette.symbols >= 20 && formulaPalette.tabs >= 5, '公式:对话框符号面板与实时预览入口');
  await page.evaluate(() => document.querySelectorAll('.lry-dialog-x').forEach((x) => x.click()));
  await sleep(200);

  /* ---- 预告下一行 / 回车跳出 ---- */
  await page.evaluate(() => { window.__inst.setContent('<p>段落文字</p><pre class="brush:js;toolbar:false;">const a = 1;</pre>'); });
  await sleep(300);
  const nl = await page.evaluate(() => {
    const line = document.querySelector('.lry-editor .lry-next-line');
    if (!line) return null;
    const r = line.getBoundingClientRect(); const add = line.querySelector('.lry-next-add');
    return { x: r.left + r.width / 2, y: r.top + 13, opacity: getComputedStyle(add).opacity, hint: line.querySelector('.lry-next-hint').textContent };
  });
  ok(!!nl && nl.opacity !== '0' && /继续输入/.test(nl.hint), '文末代码块下方出现预告下一行,「+」常显');
  await page.mouse.click(nl.x, nl.y);
  await page.keyboard.type('下一行');
  const afterNext = await page.evaluate(() => window.__inst.getContent());
  ok(/<\/pre><p>下一行<\/p>$/.test(afterNext), '点预告行:新起段落并可直接输入');
  await page.evaluate(() => { const ed = window.__inst.editor; ed.chain().setContent('<pre class="brush:js;toolbar:false;">a</pre>').setTextSelection(2).run(); });
  await page.evaluate(() => window.__inst.editor.view.focus());
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Z');
  ok((await page.evaluate(() => window.__inst.getContent())) === '<pre class="brush:js;toolbar:false;">a</pre><p>Z</p>', '连按两次回车跳出代码块');

  /* ---- 默认 memory 适配器:粘贴图片 / 拖入视频 ---- */
  await page.evaluate(() => { const ed = window.__inst.editor; ed.chain().setContent('<p>锚点</p>').setTextSelection(3).run(); ed.view.focus(); });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])], 'p.png', { type: 'image/png' }));
    window.__inst.editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  });
  await sleep(400);
  const pasted = await page.evaluate(() => window.__inst.getContent());
  ok(/<img src="data:image\/png;base64,/.test(pasted), '粘贴图片:经默认 memory 适配器转 dataURI 插入');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['video-bytes'], 'v.mp4', { type: 'video/mp4' }));
    window.__inst.editor.view.dom.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 50, clientY: 200 }));
  });
  await sleep(400);
  const dropped = await page.evaluate(() => ({ html: window.__inst.getContent(), pill: !!document.querySelector('.lry-upload-pill') }));
  ok(/<video[^>]*src="data:video\/mp4;base64,/.test(dropped.html) && !dropped.pill, '拖入视频:经适配器插入 video,进度条已移除');
  await page.evaluate(() => { window.__inst.editor.view.focus(); });
  const ib = await page.evaluate(() => { const b = document.querySelector('.lry-editor [data-cmd=insertimage]'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(ib.x, ib.y);
  await sleep(400);
  ok(await page.evaluate(() => !!document.querySelector('.lry-gallery-item img[src^="data:image/png"]')), '在线管理画廊列出已上传图片(memory 适配器 list)');
  await page.evaluate(() => document.querySelectorAll('.lry-dialog-x').forEach((x) => x.click()));
  await sleep(300);

  /* ---- 链接上下文条 / 查找条(真实鼠标键盘) ---- */
  await page.evaluate(() => window.__inst.setContent('<p>前文<a href="https://example.com/page">站内链接</a>后文</p>'));
  await sleep(300);
  const al = await page.evaluate(() => { const a = document.querySelector('.lry-editor .ProseMirror a[href]'); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(al.x, al.y);
  await sleep(350);
  const ctx = await page.evaluate(() => { const b = document.querySelector('.lry-ctxbar'); return b ? { display: getComputedStyle(b).display, text: b.textContent, top: Math.round(b.getBoundingClientRect().top), tb: Math.round(document.querySelector('.lry-toolbar').getBoundingClientRect().bottom) } : null; });
  ok(ctx && ctx.display === 'flex' && /example\.com\/page/.test(ctx.text) && ctx.top >= ctx.tb, '点击链接:链接上下文条出现,不盖工具栏');
  await page.evaluate(() => { const ed = window.__inst.editor; ed.view.focus(); ed.chain().setTextSelection(1).run(); });
  await page.keyboard.down('Control'); await page.keyboard.press('f'); await page.keyboard.up('Control');
  await sleep(300);
  await page.keyboard.type('链接');
  await sleep(400);
  ok(await page.evaluate(() => document.querySelectorAll('.lry-find-match, .lry-find-active').length === 1), 'Ctrl+F 查找条:匹配高亮');
  await page.keyboard.press('Escape');

  /* ---- Markdown 分栏(showdown 同样走 third-party 基址推断) ---- */
  await page.evaluate(() => { const ed = window.__inst.editor; ed.view.focus(); ed.chain().setTextSelection(1).run(); });
  await page.evaluate(() => document.querySelector('.lry-editor [data-cmd=markdown]').click());
  await sleep(800);
  const md = await page.evaluate(() => ({ mode: !!document.querySelector('.lry-editor.lry-md-mode'), showdown: !!window.showdown, src: (document.querySelector('.lry-md-src') || {}).value || '' }));
  ok(md.mode && md.showdown && /站内链接/.test(md.src), 'Markdown 分栏:showdown 从 third-party 加载,源码栏有内容');
  await page.evaluate(() => { window.__inst.mdApi.toggle(); });
  await sleep(300);

  /* ---- 移动端视口 ---- */
  await page.setViewport({ width: 390, height: 800 });
  await page.evaluate(() => window.__inst.setContent('<p>移动端</p><pre class="brush:js;toolbar:false;">const a = 1;</pre>'));
  await sleep(500);
  const mob = await page.evaluate(() => { const a = document.querySelector('.lry-next-add'); const r = a.getBoundingClientRect(); const t = document.querySelector('.lry-next-hint').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth, textLeft: Math.round(t.left) }; });
  ok(mob.left >= 0 && mob.right <= mob.vw && mob.right <= mob.textLeft, '390px:预告行「+」在视口内且不压文字(' + JSON.stringify(mob) + ')');
  await page.setViewport({ width: 1280, height: 900 });

  /* ================= demo/lite.html(lite 版) ================= */
  await page.goto(base + '/demo/lite.html', { waitUntil: 'networkidle0' });
  await sleep(400);
  const lite = await page.evaluate(() => ({ version: window.LRYEditorLite.VERSION, buttons: document.querySelectorAll('.lry-lite .lry-tool-btn').length, has: !!document.querySelector('.lry-lite') }));
  ok(lite.version === '1.4.1' && lite.has, 'lite: 版本 1.4.1,已挂载');
  ok(lite.buttons === 15, 'lite: 工具栏 15 钮(' + lite.buttons + ')');

  ok(pageErrors.length === 0, '全程零 pageerror(' + pageErrors.slice(0, 3).join(' | ') + ')');
} catch (e) {
  fail++;
  console.error('  EXCEPTION ' + (e && e.stack || e));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
console.log('BROWSER PASS ' + pass + ' / FAIL ' + fail + '  (chrome: ' + chrome + ')');
process.exit(fail ? 1 : 0);
