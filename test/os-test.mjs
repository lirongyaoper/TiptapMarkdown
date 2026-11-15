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
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
