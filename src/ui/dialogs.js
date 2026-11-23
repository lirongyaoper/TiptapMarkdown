/**
 * 对话框全家桶:链接/图片(上传+在线+远程)/视频/音频/附件/iframe/锚点/
 * 查找替换/模板/帮助/预览/源码/表格属性/单元格属性/背景/Word图转存/代码语言。
 */
import { h, dialog, toast, field, textField, selectEl } from './dom.js';
import { NodeSelection } from '@tiptap/pm/state';
import { uploadFile, listAttachments, catchImages } from '../upload.js';
import { CODE_LANGS, TEMPLATES, SPECIAL_CHARS, COLORS } from '../config.js';
import { ICONS } from './icons.js';
import { mergeCellStyle, cellBackgroundAt } from './table-ops.js';

const D = {}; /* 注册表:name → (inst) => open */

/* 网址校验(2026-11-23):放行 http(s)/ftp(s)/mailto/tel、相对路径与页内锚点;
   www. 开头补 https;其余协议(javascript:/data: 等)一律拒绝,与服务端
   lry_safe_url 协议白名单一致——旧对话框用 insertContent 直塞 mark,绕过了官方校验 */
export function normalizeHref(raw) {
  let href = String(raw || '').trim();
  if (!href) return { href: '', error: '请填写链接地址' };
  if (/^www\./i.test(href)) href = 'https://' + href;
  if (/[\s<>"']/.test(href)) return { href: '', error: '链接地址不能包含空格或引号' };
  const m = /^([a-z][a-z0-9+.\-]*):/i.exec(href);
  if (m && !/^(https?|ftps?|mailto|tel)$/i.test(m[1])) return { href: '', error: '仅支持 http / https / mailto 等安全协议' };
  return { href };
}

/* ---------- 链接 ---------- */
D.link = (inst) => {
  const ed = inst.editor;
  const existing = ed.getAttributes('link');
  const sel = ed.state.selection;
  const selectedText = sel.empty ? '' : ed.state.doc.textBetween(sel.from, sel.to, '\n');
  const hrefIn = textField('https://', existing.href || '');
  const textIn = textField('链接文字(留空使用选中文本)', selectedText);
  const targetSel = selectEl([{ value: '', label: '当前窗口' }, { value: '_blank', label: '新窗口' }], existing.target || '_blank');
  dialog({
    title: existing.href ? '编辑链接' : '插入链接', width: '420px', body: h('div', null,
      field('地址', hrefIn), field('文字', textIn), field('打开方式', targetSel)),
    onOk(api) {
      const r = normalizeHref(hrefIn.value);
      if (r.error) { toast(r.error, 'error'); return false; }
      const target = targetSel.value || null;
      const attrs = { href: r.href, target, rel: target ? 'noopener' : null };
      const text = textIn.value.trim();
      if (!sel.empty && (!text || text === selectedText)) {
        /* 选区原样加链接:保留选区内既有格式(旧实现重建文本节点会丢加粗/颜色等) */
        ed.chain().focus().extendMarkRange('link').setLink(attrs).run();
      } else {
        ed.chain().focus().extendMarkRange('link').insertContent({
          type: 'text', text: text || r.href, marks: [{ type: 'link', attrs }]
        }).run();
      }
      api.close();
      return false;
    }
  });
};

/* ---------- 图片(上传/在线/远程 三页签) ---------- */
D.insertimage = (inst, arg) => openImageDialog(inst, arg && typeof arg === 'object' ? arg : undefined);
D.simpleupload = (inst) => {
  const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    toast('上传中…');
    try {
      const r = await uploadFile(f, { filetype: 1, module: inst.options.module }, inst);
      inst.editor.chain().focus().setImage({ src: r.url, title: r.title || '' }).run();
      toast('图片已上传', 'success');
    } catch (e) { toast(e.message, 'error'); }
    input.value = '';
    input.remove(); /* 防累积泄漏 */
  });
  inst.wrapper.appendChild(input);
  input.click();
};

function openImageDialog(inst, opts) {
  /* 编辑模式(2026-11-23):选中图片后双击/上下文条进入,原位更新属性而非新插一张 */
  const sel = inst.editor.state.selection;
  const editing = opts && opts.edit && sel instanceof NodeSelection && sel.node.type.name === 'image' ? sel.node : null;
  const urlIn = textField('/uploads/… 或 https://…', editing ? editing.attrs.src || '' : '');
  const altIn = textField('替代文本', editing ? (editing.attrs.alt || editing.attrs.title || '') : '');
  const wIn = textField('宽', editing && editing.attrs.width ? String(editing.attrs.width) : '', { type: 'number', min: 1 });
  const hIn = textField('高', editing && editing.attrs.height ? String(editing.attrs.height) : '', { type: 'number', min: 1 });
  let pickedUrl = null;
  const gallery = h('div', { class: 'lry-gallery' });
  const loadList = async () => {
    gallery.innerHTML = '<div class="lry-gallery-loading">加载中…</div>';
    try {
      const data = await listAttachments(1, 0, inst);
      gallery.innerHTML = '';
      if (!data.list.length) { gallery.innerHTML = '<div class="lry-gallery-empty">暂无已上传图片</div>'; return; }
      data.list.forEach((it) => {
        const cell = h('button', { type: 'button', class: 'lry-gallery-item', title: it.title || it.url, onclick: () => { pickedUrl = it.url; urlIn.value = it.url; [...gallery.children].forEach((c) => c.classList.remove('sel')); cell.classList.add('sel'); } },
          h('img', { src: it.url, loading: 'lazy', alt: '' }));
        gallery.appendChild(cell);
      });
    } catch (e) { gallery.innerHTML = '<div class="lry-gallery-empty">' + e.message + '</div>'; }
  };

  const uploadBtn = h('button', { type: 'button', class: 'lry-btn lry-btn-primary', onclick: async () => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
    inst.wrapper.appendChild(input);
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])];
      if (!files.length) return;
      uploadBtn.disabled = true; uploadBtn.textContent = '上传中…';
      try {
        const results = [];
        for (const f of files) results.push(await uploadFile(f, { filetype: 1, module: inst.options.module }, inst));
        if (results.length === 1) { urlIn.value = results[0].url; pickedUrl = results[0].url; }
        else if (editing) {
          inst.editor.chain().updateAttributes('image', { src: results[0].url })
            .focus().insertContent(results.slice(1).map((r) => ({ type: 'image', attrs: { src: r.url } }))).run();
          toast(results.length + ' 张图片已应用', 'success');
          dlgApi.close(); return;
        }
        else {
          inst.editor.chain().focus().insertContent(results.map((r) => ({ type: 'image', attrs: { src: r.url } }))).run();
          toast(results.length + ' 张图片已插入', 'success');
          dlgApi.close(); return;
        }
        toast('上传成功', 'success');
        loadList();
      } catch (e) { toast(e.message, 'error'); }
      uploadBtn.disabled = false; uploadBtn.textContent = '本地上传';
      input.remove();
    });
    input.click();
  } }, '本地上传');

  const tabs = [['在线管理', () => { pages.online.style.display = ''; pages.remote.style.display = 'none'; pages.up.style.display = 'none'; loadList(); }],
    ['本地上传', () => { pages.online.style.display = 'none'; pages.remote.style.display = 'none'; pages.up.style.display = ''; }],
    ['远程地址', () => { pages.online.style.display = 'none'; pages.remote.style.display = ''; pages.up.style.display = 'none'; }]];
  const tabBar = h('div', { class: 'lry-tabs' }, tabs.map(([t, fn], i) => h('button', { type: 'button', class: 'lry-tab' + (i === 0 ? ' lry-tab-active' : ''), onclick: (e) => { [...tabBar.children].forEach((c) => c.classList.remove('lry-tab-active')); e.currentTarget.classList.add('lry-tab-active'); fn(); } }, t)));
  const pages = {
    online: h('div', { class: 'lry-page' }, gallery),
    up: h('div', { class: 'lry-page', style: { display: 'none' } },
      h('div', { class: 'lry-upzone', onclick: () => uploadBtn.click() },
        h('div', { class: 'lry-upzone-icon', html: ICONS.upload }),
        h('div', null, '点击选择图片(可多选,支持拖入大文件自动分片)'))),
    remote: h('div', { class: 'lry-page', style: { display: 'none' } },
      field('图片地址', urlIn), field('替代文本', altIn),
      h('div', { class: 'lry-field-row' }, field('宽度(px)', wIn), field('高度(px)', hIn)),
      h('div', { class: 'lry-tip' }, '站内路径以 /uploads/ 开头;外链图片发布时可由服务端自动转存'))
  };
  /* 拖拽上传 */
  pages.up.addEventListener('dragover', (e) => { e.preventDefault(); pages.up.classList.add('drag'); });
  pages.up.addEventListener('dragleave', () => pages.up.classList.remove('drag'));
  pages.up.addEventListener('drop', async (e) => {
    e.preventDefault(); pages.up.classList.remove('drag');
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    for (const f of files) {
      try {
        const r = await uploadFile(f, { filetype: 1, module: inst.options.module }, inst);
        if (editing) inst.editor.chain().updateAttributes('image', { src: r.url }).run();
        else inst.editor.chain().focus().setImage({ src: r.url }).run();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  uploadBtn.style.display = 'none'; /* 触发器藏在拖拽区后,不独立展示 */
  const dlgApi = dialog({
    title: editing ? '编辑图片' : '插入图片', width: '560px',
    body: h('div', null, tabBar, pages.online, pages.up, pages.remote),
    onOk() {
      const src = (urlIn.value || '').trim() || pickedUrl;
      if (!src) { toast('请上传或填写图片地址', 'error'); return false; }
      const attrs = {
        src, alt: altIn.value || null, title: altIn.value || null,
        width: wIn.value || null, height: hIn.value || null
      };
      if (editing) inst.editor.chain().updateAttributes('image', attrs).run();
      else inst.editor.chain().focus().setImage(attrs).run();
    }
  });
  loadList();
}

/* ---------- 视频 / 音频 / 附件 / iframe / 锚点 ---------- */
D.insertvideo = (inst) => {
  const urlIn = textField('https://… .mp4(大文件自动分片上传)');
  const wIn = textField('宽', '640', { type: 'number' }); const hIn = textField('高', '360', { type: 'number' });
  const upBtn = h('button', { type: 'button', class: 'lry-btn', onclick: async () => {
    const input = h('input', { type: 'file', accept: 'video/*', style: { display: 'none' } });
    inst.wrapper.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      upBtn.disabled = true; upBtn.textContent = '上传中(分片)…';
      try {
        const r = await uploadFile(f, { filetype: 2, module: inst.options.module, onProgress: (p) => { upBtn.textContent = '上传中 ' + p + '%'; } }, inst);
        urlIn.value = r.url; toast('视频已上传', 'success');
      } catch (e) { toast(e.message, 'error'); }
      upBtn.disabled = false; upBtn.textContent = '上传视频文件';
    });
    input.remove();
    input.click();
  } }, '上传视频文件');
  dialog({
    title: '插入视频', width: '440px',
    body: h('div', null, field('视频地址', urlIn), h('div', { style: { margin: '8px 0' } }, upBtn),
      h('div', { class: 'lry-field-row' }, field('宽度', wIn), field('高度', hIn))),
    onOk() {
      if (!urlIn.value.trim()) { toast('请填写视频地址', 'error'); return false; }
      inst.editor.chain().focus().insertVideo({ src: urlIn.value.trim(), width: wIn.value || null, height: hIn.value || null }).run();
    }
  });
};

D.insertaudio = (inst) => {
  const urlIn = textField('https://… .mp3');
  const upBtn = h('button', { type: 'button', class: 'lry-btn', onclick: async () => {
    const input = h('input', { type: 'file', accept: 'audio/*', style: { display: 'none' } });
    inst.wrapper.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try { const r = await uploadFile(f, { filetype: 2, module: inst.options.module }, inst); urlIn.value = r.url; toast('上传成功', 'success'); }
      catch (e) { toast(e.message, 'error'); }
      input.remove();
    });
    input.click();
  } }, '上传音频文件');
  dialog({ title: '插入音频', width: '440px', body: h('div', null, field('音频地址', urlIn), h('div', { style: { margin: '8px 0' } }, upBtn)),
    onOk() {
      if (!urlIn.value.trim()) { toast('请填写音频地址', 'error'); return false; }
      inst.editor.chain().focus().insertAudio({ src: urlIn.value.trim() }).run();
    } });
};

D.attachment = (inst) => {
  const urlIn = textField('https://… /uploads/…');
  const titleIn = textField('附件名称');
  const upBtn = h('button', { type: 'button', class: 'lry-btn', onclick: async () => {
    const input = h('input', { type: 'file', style: { display: 'none' } });
    inst.wrapper.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const r = await uploadFile(f, { filetype: 2, module: inst.options.module }, inst);
        urlIn.value = r.url; titleIn.value = r.title || f.name; toast('上传成功', 'success');
      } catch (e) { toast(e.message, 'error'); }
      input.remove();
    });
    input.click();
  } }, '上传附件');
  dialog({ title: '插入附件', width: '440px', body: h('div', null, field('附件地址', urlIn), field('名称', titleIn), h('div', { style: { margin: '8px 0' } }, upBtn)),
    onOk() {
      if (!urlIn.value.trim()) { toast('请填写附件地址', 'error'); return false; }
      inst.editor.chain().focus().insertAttachment({ href: urlIn.value.trim(), title: titleIn.value.trim() || '附件' }).run();
    } });
};

D.insertframe = (inst) => {
  const urlIn = textField('https://…(仅允许可嵌入页面)');
  const wIn = textField('宽', '600', { type: 'number' }); const hIn = textField('高', '400', { type: 'number' });
  dialog({ title: '插入 iframe', width: '440px', body: h('div', null, field('页面地址', urlIn),
    h('div', { class: 'lry-field-row' }, field('宽度', wIn), field('高度', hIn)),
    h('div', { class: 'lry-tip' }, '前台仅管理员发布的内容允许 iframe 渲染')),
    onOk() {
      if (!/^https?:\/\//.test(urlIn.value.trim())) { toast('请填写 http(s) 地址', 'error'); return false; }
      inst.editor.chain().focus().insertIframe({ src: urlIn.value.trim(), width: wIn.value || 600, height: hIn.value || 400 }).run();
    } });
};

D.anchor = (inst) => {
  const nameIn = textField('锚点名称(英文数字)', '');
  dialog({ title: '插入锚点', width: '360px', body: field('名称', nameIn),
    onOk() {
      const n = nameIn.value.trim();
      if (!/^[a-zA-Z][\w-]*$/.test(n)) { toast('名称需以字母开头,仅含字母数字-_ ', 'error'); return false; }
      inst.editor.chain().focus().insertAnchor(n).run();
    } });
};

/* ---------- 查找替换:2026-11-23 起由编辑器内浮动条承担(ui/find-replace.js) ---------- */
D.searchreplace = (inst, mode) => (inst.findApi ? inst.findApi.open({ replace: mode === 'replace' }) : false);

/* ---------- 模板 ---------- */
D.template = (inst) => {
  const list = h('div', { class: 'lry-tpl-list' });
  TEMPLATES.forEach((t) => {
    list.appendChild(h('button', { type: 'button', class: 'lry-tpl-item', onclick: () => {
      inst.editor.chain().focus().insertContent(t.html).run();
      toast('模板已插入', 'success');
    } }, h('div', { class: 'lry-tpl-title' }, t.title), h('div', { class: 'lry-tpl-preview', html: t.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 60) })));
  });
  dialog({ title: '插入模板', width: '420px', noFooter: true, body: list });
};

/* ---------- 帮助 ---------- */
D.help = () => {
  dialog({ title: '帮助', width: '520px', noFooter: true, body: h('div', { class: 'lry-help' , html:
    '<p><b>常用快捷键</b>:Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+U 下划线 / Ctrl+K 链接 / Ctrl+Shift+H 高亮 / Ctrl+F 查找 / Ctrl+H 替换 / Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 / Ctrl+Shift+V 纯文本粘贴</p>' +
    '<p><b>插入</b>:行首或空格后输入 <code>/</code> 唤起插入面板(↑↓ 选择、回车确认);行首输入 <code>+</code> 同样可用</p>' +
    '<p><b>Markdown</b>:边写边转(# 标题、**加粗**、- 列表、&gt; 引用、``` 代码、$公式$、==高亮==);直接粘贴 Markdown 文本自动识别;工具栏「MD」进入分栏模式</p>' +
    '<p><b>表格</b>:光标进表格浮现行/列操作条,拖动列边界调列宽;Tab 切换单元格</p>' +
    '<p><b>图片</b>:点击图片出现对齐/宽度/说明操作条,拖右下角等比缩放,双击进入编辑</p>' +
    '<p><b>代码块</b>:点块顶栏的语言名切换语言(也可直接搜索);编辑时实时语法高亮,与发布后同色;向"纯文本"代码块粘贴多行代码会自动识别语言。Tab / Shift+Tab 缩进与反缩进(支持多行选区)</p>' +
    '<p><b>跳出代码块</b>:空行上按回车(连按两次回车即退出)、按 Esc、或在末行按 ↓;也可点击代码块下方的空白处</p>' +
    '<p><b>继续书写</b>:正文末尾始终预告着下一行——点它即新起一段,点行首的「+」插入图片/表格/画板等内容</p>' +
    '<p><b>大文件</b>:视频等超过 5MB 自动走分片上传,支持断点重试;拖入文件即可上传插入</p>' }) });
};

/* ---------- 预览 / 打印 ---------- */
D.preview = (inst) => {
  const html = inst.getContent();
  const frame = h('iframe', { class: 'lry-preview-frame', style: { width: '100%', height: '60vh', border: '0' } });
  const api = dialog({ title: '预览', width: '760px', noFooter: true, body: frame });
  frame.addEventListener('load', () => {
    frame.contentDocument.body.innerHTML = html;
    /* 懒加载前台渲染器(存在则用) */
    if (window.LryContentRender) window.LryContentRender.render(frame.contentDocument.body);
  });
  frame.srcdoc = '<!doctype html><meta charset="utf-8"><body></body>';
  /* 打印 */
  const printBtn = h('button', { type: 'button', class: 'lry-btn', style: { position: 'absolute', right: '44px', top: '10px' }, onclick: () => {
    frame.contentWindow.focus(); frame.contentWindow.print();
  } }, '打印');
  api.el.querySelector('.lry-dialog-title').after(printBtn);
};
D.print = (inst) => D.preview(inst);

/* ---------- 源码 ---------- */
D.source = (inst) => {
  const ta = h('textarea', { class: 'lry-input lry-source-ta', rows: 14, spellcheck: 'false' });
  ta.value = inst.getContent();
  dialog({ title: 'HTML 源码', width: '720px',
    body: h('div', null, ta, h('div', { class: 'lry-tip' }, '直接编辑 HTML 源码;不确定标签会被过滤')),
    onOk() { inst.setContent(ta.value); toast('源码已应用', 'success'); } });
};

/* ---------- 表格属性 / 单元格属性 ---------- */
D.edittable = (inst) => {
  const ed = inst.editor;
  const node = ed.state.selection.$from.node(-1);
  /* 找表格 */
  let table = null;
  ed.state.doc.nodesBetween(ed.state.selection.from, ed.state.selection.to, (n) => { if (n.type.name === 'table') table = n; });
  if (!table) { toast('请先将光标置于表格内', 'error'); return; }
  const wIn = textField('如 100% 或 600', table.attrs.width || '');
  const borderIn = textField('边框粗细 0/1', table.attrs.border === null ? '1' : String(table.attrs.border));
  const csIn = textField('间距', table.attrs.cellspacing === null ? '0' : String(table.attrs.cellspacing));
  const cpIn = textField('内边距', table.attrs.cellpadding === null ? '2' : String(table.attrs.cellpadding));
  dialog({ title: '表格属性', width: '420px',
    body: h('div', null, field('宽度', wIn), field('边框', borderIn),
      h('div', { class: 'lry-field-row' }, field('单元格间距', csIn), field('单元格边距', cpIn))),
    onOk() {
      ed.chain().focus().updateAttributes('table', {
        width: wIn.value || null, border: borderIn.value || null,
        cellspacing: csIn.value || null, cellpadding: cpIn.value || null
      }).run();
    } });
};
D.edittd = (inst) => {
  const ed = inst.editor;
  let cell = null, cellPos = -1;
  ed.state.doc.nodesBetween(ed.state.selection.from, ed.state.selection.to, (n, pos) => {
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') cell = n, cellPos = pos;
  });
  if (!cell) { toast('请先将光标置于单元格内', 'error'); return; }
  const wIn = textField('如 120 或 30%', cell.attrs.width || '');
  /* 背景色读写 style(服务端白名单内);存量 bgcolor 属性仅作初值兜底 */
  const bgIn = textField('#ffffff', cellBackgroundAt(ed.state) || '');
  dialog({ title: '单元格属性', width: '360px', body: h('div', null, field('宽度', wIn), field('背景色', bgIn),
    h('div', { class: 'lry-tip' }, '背景色支持 #1a66d6 / rgb(...) / 颜色名')),
    onOk() {
      const bg = bgIn.value.trim();
      if (bg && !/^(#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([^)]*\)|[a-z]{3,24})$/i.test(bg)) { toast('背景色格式有误', 'error'); return false; }
      const width = wIn.value.trim();
      if (width && !/^(?:\d{1,4}(?:\.\d+)?|\d{1,3}(?:\.\d+)?%)$/.test(width)) { toast('宽度请填数字或百分比', 'error'); return false; }
      const style = mergeCellStyle(cell.attrs, { 'background-color': bg || null });
      ed.chain().command(({ tr }) => {
        const node = tr.doc.nodeAt(cellPos);
        if (!node) return false;
        tr.setNodeMarkup(cellPos, undefined, { ...node.attrs, width: width || null, style });
        return true;
      }).run();
    } });
};

/* ---------- 背景(视觉预览;与旧实现一致不入库) ---------- */
D.background = (inst) => {
  const colorIn = textField('#f7f8fa');
  const colors = h('div', { class: 'lry-color-grid' },
    COLORS.slice(0, 12).map((c) => h('button', { type: 'button', class: 'lry-color-cell', style: { background: c }, onclick: () => { colorIn.value = c; } })));
  dialog({ title: '编辑区背景(预览用,不随内容保存)', width: '340px',
    body: h('div', null, field('颜色', colorIn), colors),
    onOk() {
      inst.wrapper.querySelector('.lry-editor-content').style.background = colorIn.value || '';
    } });
};

/* ---------- Word 图转存(扫描 data:/远程图 → 上传替换) ---------- */
D.wordimage = async (inst) => {
  const ed = inst.editor;
  const imgs = [];
  ed.state.doc.descendants((node) => {
    if (node.type.name === 'image' && node.attrs.src) {
      if (node.attrs.src.startsWith('data:')) imgs.push(node);
    }
  });
  /* 远程外链图批量转存走服务端 catch */
  const remotes = [];
  ed.state.doc.descendants((node) => {
    if (node.type.name === 'image' && /^https?:\/\//.test(node.attrs.src || '') && !node.attrs.src.includes(window.location.host)) remotes.push(node.attrs.src);
  });
  if (!imgs.length && !remotes.length) { toast('未发现待转存图片', 'error'); return; }
  toast('开始转存…');
  /* 上传/抓取均为异步:期间文档可能已变,收集结果后按 src 重新定位、
     用最新状态开一个事务一次写回(旧实现复用 await 之前创建的 tr,坐标会漂移) */
  const done = new Map(); /* 旧 src → 新 url */
  for (const node of imgs) {
    try {
      const blob = await (await fetch(node.attrs.src)).blob();
      const f = new File([blob], 'word-' + Date.now() + '.png', { type: blob.type || 'image/png' });
      const r = await uploadFile(f, { filetype: 1, module: inst.options.module }, inst);
      done.set(node.attrs.src, r.url);
    } catch (e) { console.warn('[lry-editor] wordimage data 转存失败', e); }
  }
  if (remotes.length) {
    try {
      const res = await catchImages(remotes, inst);
      (res.list || []).forEach((it) => { if (it.state === 'SUCCESS' && it.url) done.set(it.source, it.url); });
    } catch (e) { toast('远程图转存失败:' + e.message, 'error'); }
  }
  if (done.size) {
    ed.chain().command(({ tr }) => {
      let touched = false;
      tr.doc.descendants((n, p) => {
        const url = n.type.name === 'image' && done.get(n.attrs.src);
        if (url) { tr.setNodeMarkup(p, undefined, { ...n.attrs, src: url }); touched = true; }
      });
      return touched;
    }).run();
  }
  toast('转存完成 ' + done.size + ' 张', 'success');
};

/* ---------- 特殊字符(popover 形态由 toolbar 触发;此处提供对话框版) ---------- */
D.spechars = (inst) => {
  const grid = h('div', { class: 'lry-spechars' });
  SPECIAL_CHARS.forEach((group) => {
    [...group].forEach((ch) => {
      grid.appendChild(h('button', { type: 'button', class: 'lry-spechar', onclick: () => {
        inst.editor.chain().focus().insertContent(ch).run();
      } }, ch));
    });
  });
  dialog({ title: '特殊字符', width: '420px', noFooter: true, body: grid });
};

/* ---------- 代码语言(下拉而非对话框,toolbar 调用) ---------- */
D.insertcode = (inst, langId) => inst.editor.chain().focus().setCodeBlockLang(langId).run();

export const DIALOGS = D;
export { openImageDialog };
