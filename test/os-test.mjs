import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';
const dom = new JSDOM('<body><div id="h"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;
w.Range.prototype.getClientRects = () => [];
w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
w.Text.prototype.getBoundingClientRect = function () { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; };
w.eval(fs.readFileSync(new URL('../dist/lry-editor.js', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL ' + m); } };

ok(!!w.LRYEditor && !!w.LRYEditor.create, 'global create');
const inst = w.LRYEditor.create({ mount: w.document.querySelector('#h'), textarea: 't', value: '<p>hello</p><ul class="lry-task"><li class="lry-task-item lry-task-done"><span class="lry-task-check">☑</span><div class="lry-task-body"><p>done</p></div></li></ul>', wordCount: false });
ok(inst.getContent().includes('hello') && inst.getContent().includes('lry-task-done'), 'contract roundtrip');
ok(inst.getContent().includes('task-done'), 'task done attr');

const { uploadFile, listAttachments } = await import('../src/upload.js');
const f = new w.File(['x'], 'a.png', { type: 'image/png' });
const r = await uploadFile(f, { filetype: 1 }, inst);
ok(r.url.startsWith('data:image/png'), 'memory adapter upload');
ok((await listAttachments(1, 0, inst)).total === 1, 'memory list');

const { createUrlAdapter } = await import('../src/adapters.js');
ok(createUrlAdapter({ base: '/api/editor' }).name === 'url', 'createUrlAdapter factory');

inst.destroy();
ok(!w.document.querySelector('.lry-editor'), 'destroy cleanup');

/* ---------- lry-editor-lite(留言/评论简约版,独立 IIFE bundle) ---------- */
w.eval(fs.readFileSync(new URL('../dist/lry-editor-lite.js', import.meta.url), 'utf8'));
ok(!!w.LRYEditorLite && !!w.LRYEditorLite.create, 'lite: global create');
ok(!w.document.querySelector('.lry-editor'), 'lite: 与 full 版 DOM 作用域隔离(.lry-lite)');
const div = w.document.createElement('div');
div.id = 'lite_host';
w.document.body.appendChild(div);
const lite = w.LRYEditorLite.create({
  mount: '#lite_host', textarea: 'lite_content', maximumWords: 50, height: 120,
  value: '<p>hi <strong>bold</strong> <a href="https://example.com" title="t">link</a></p><ul><li>item</li></ul><blockquote><p>quote</p></blockquote>'
});
ok(lite.getContent().includes('<strong>bold</strong>') && lite.getContent().includes('<a href="https://example.com"'), 'lite: roundtrip 保留行内格式/链接');
ok(lite.getContent().includes('<ul><li>item</li></ul>') && lite.getContent().includes('<blockquote>'), 'lite: 列表/引用');
ok(w.document.querySelectorAll('#lite_host .lry-tool-btn').length === 14, 'lite: 工具栏 14 钮');
ok(lite.getText().includes('bold'), 'lite: getText');
/* 输入清洗:script/on* 属性剥除 */
lite.setContent('<p>a</p><script>alert(1)</script><p onclick="x()">b</p>');
ok(!lite.getContent().includes('alert') && !lite.getContent().includes('onclick'), 'lite: 输入清洗剥 script/on*');
/* 字数上限:CharacterCount limit 阻断超限插入 */
lite.editor.commands.setContent('<p></p>');
lite.editor.chain().focus().insertContent(new Array(60).fill('字').join('')).run();
ok(lite.editor.getText().length <= 50, 'lite: maximumWords 硬上限');
ok(w.LRYEditorLite.get('lite_content') === lite, 'lite: get(name) 取回实例');
const liteTa = w.document.querySelector('textarea[name=lite_content]');
ok(liteTa && liteTa.getAttribute('data-lry-lite') === '1', 'lite: 隐藏域 data 标记');
lite.destroy();
ok(!w.document.querySelector('.lry-lite'), 'lite: destroy cleanup');

console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
