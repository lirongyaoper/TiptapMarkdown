/**
 * 对话框全家桶:链接/图片(上传+在线+远程)/视频/音频/附件/iframe/锚点/
 * 查找替换/模板/帮助/预览/源码/表格属性/单元格属性/背景/Word图转存/代码语言。
 */
import { h, dialog, toast, field, textField, selectEl } from './dom.js';
import { uploadFile, listAttachments, catchImages } from '../upload.js';
import { CODE_LANGS, TEMPLATES, SPECIAL_CHARS, COLORS } from '../config.js';
import { ICONS } from './icons.js';

const D = {}; /* 注册表:name → (inst) => open */

/* ---------- 链接 ---------- */
D.link = (inst) => {
  const ed = inst.editor;
  const existing = ed.getAttributes('link');
  const hrefIn = textField('https://', existing.href || '');
  const textIn = textField('链接文字(留空使用选中文本)', ed.state.selection.empty ? '' : ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to));
  const targetSel = selectEl([{ value: '', label: '当前窗口' }, { value: '_blank', label: '新窗口' }], existing.target || '_blank');
  dialog({
    title: '插入链接', width: '420px', body: h('div', null,
      field('地址', hrefIn), field('文字', textIn), field('打开方式', targetSel)),
    onOk(api) {
      const href = hrefIn.value.trim();
      if (!href) { toast('请填写链接地址', 'error'); return false; }
      ed.chain().focus().extendMarkRange('link')
        .insertContent({
          type: 'text',
          text: textIn.value.trim() || href,
          marks: [{ type: 'link', attrs: { href, target: targetSel.value || null, rel: targetSel.value ? 'noopener' : null } }]
        }).run();
      api.close();
      return false;
    }
  });
};

/* ---------- 图片(上传/在线/远程 三页签) ---------- */
D.insertimage = (inst) => openImageDialog(inst, true);
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

function openImageDialog(inst) {
  const urlIn = textField('/uploads/… 或 https://…');
  const altIn = textField('替代文本');
  const wIn = textField('宽', '', { type: 'number', min: 1 });
  const hIn = textField('高', '', { type: 'number', min: 1 });
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
        inst.editor.chain().focus().setImage({ src: r.url }).run();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  uploadBtn.style.display = 'none'; /* 触发器藏在拖拽区后,不独立展示 */
  const dlgApi = dialog({
    title: '插入图片', width: '560px',
    body: h('div', null, tabBar, pages.online, pages.up, pages.remote),
    onOk() {
      const src = (urlIn.value || '').trim() || pickedUrl;
      if (!src) { toast('请上传或填写图片地址', 'error'); return false; }
      inst.editor.chain().focus().setImage({
        src, alt: altIn.value || null, title: altIn.value || null,
        width: wIn.value || null, height: hIn.value || null
      }).run();
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
        const r = await uploadFile(f, { filetype: 2, module: inst.options.module, onProgress: (p) => { upBtn.textContent = '上传中 ' + p + '%'; } });
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

/* ---------- 查找替换 ---------- */
D.searchreplace = (inst) => {
  const ed = inst.editor;
  const findIn = textField('查找内容');
  const repIn = textField('替换为');
  const info = h('div', { class: 'lry-tip' }, '');
  let matches = [], pos = -1;

  const countMatches = () => {
    const q = findIn.value;
    matches = [];
    if (!q) { info.textContent = ''; return; }
    ed.state.doc.descendants((node, nodePos) => {
      if (!node.isText || !node.text) return;
      let idx = node.text.indexOf(q);
      while (idx >= 0) { matches.push({ from: nodePos + idx, to: nodePos + idx + q.length }); idx = node.text.indexOf(q, idx + q.length); }
    });
    info.textContent = matches.length ? (matches.length + ' 处匹配' + (pos >= 0 ? ',' + (pos + 1) + '/' + matches.length : '')) : '无匹配';
  };
  const focusMatch = (dir) => {
    if (!matches.length) return;
    pos = (pos + dir + matches.length) % matches.length;
    const m = matches[pos];
    ed.chain().focus().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
    info.textContent = matches.length + ' 处匹配,' + (pos + 1) + '/' + matches.length;
  };
  const replaceOne = () => {
    if (pos < 0 || !matches[pos]) { toast('请先定位一处匹配', 'error'); return; }
    const m = matches[pos];
    ed.chain().insertContentAt({ from: m.from, to: m.to }, repIn.value).run();
    countMatches(); pos = pos - 1; focusMatch(1);
  };
  const replaceAll = () => {
    if (!matches.length) { toast('无匹配', 'error'); return; }
    let n = 0;
    /* 从后往前替换避免坐标漂移 */
    [...matches].reverse().forEach((m) => { ed.chain().insertContentAt({ from: m.from, to: m.to }, repIn.value).run(); n++; });
    countMatches();
    toast('已替换 ' + n + ' 处', 'success');
  };
  findIn.addEventListener('input', () => { pos = -1; countMatches(); });
  findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusMatch(1); } });

  dialog({ title: '查找替换', width: '440px', noFooter: true,
    body: h('div', null, field('查找', findIn), field('替换', repIn), info,
      h('div', { class: 'lry-btn-row' },
        h('button', { type: 'button', class: 'lry-btn', onclick: () => focusMatch(-1) }, '上一个'),
        h('button', { type: 'button', class: 'lry-btn', onclick: () => focusMatch(1) }, '下一个'),
        h('button', { type: 'button', class: 'lry-btn', onclick: replaceOne }, '替换'),
        h('button', { type: 'button', class: 'lry-btn lry-btn-primary', onclick: replaceAll }, '全部替换')))
  });
};

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
  dialog({ title: '帮助', width: '460px', noFooter: true, body: h('div', { class: 'lry-help' , html:
    '<p><b>快捷键</b>:Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+U 下划线 / Ctrl+K 链接 / Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 / Tab 表格切换单元格</p>' +
    '<p><b>Markdown</b>:直接粘贴 Markdown 文本会自动识别;工具栏「MD」进入分栏模式</p>' +
    '<p><b>代码块</b>:插入后在块内可选择语言,前台自动高亮</p>' +
    '<p><b>大文件</b>:视频等超过 5MB 自动走分片上传,支持断点重试</p>' }) });
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
  let cell = null;
  ed.state.doc.nodesBetween(ed.state.selection.from, ed.state.selection.to, (n) => {
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') cell = n;
  });
  if (!cell) { toast('请先将光标置于单元格内', 'error'); return; }
  const wIn = textField('如 120 或 30%', cell.attrs.width || '');
  const bgIn = textField('#ffffff', cell.attrs.bgcolor || '');
  dialog({ title: '单元格属性', width: '360px', body: h('div', null, field('宽度', wIn), field('背景色', bgIn)),
    onOk() {
      ed.chain().focus().updateAttributes(cell.type.name, { width: wIn.value || null, bgcolor: bgIn.value || null }).run();
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
  const tr = ed.state.tr;
  let done = 0;
  /* data: URI → upload */
  for (const node of imgs) {
    try {
      const blob = await (await fetch(node.attrs.src)).blob();
      const f = new File([blob], 'word-' + Date.now() + '.png', { type: blob.type || 'image/png' });
      const r = await uploadFile(f, { filetype: 1, module: inst.options.module }, inst);
      const pos = ed.state.doc.node === node ? -1 : null;
      /* 重新定位(文档可能已变) */
      ed.state.doc.descendants((n, p) => { if (n === node) tr.setNodeMarkup(p, null, { ...n.attrs, src: r.url }); });
      done++;
    } catch (e) { console.warn('[lry-editor] wordimage data 转存失败', e); }
  }
  /* 远程 → catch */
  if (remotes.length) {
    try {
      const res = await catchImages(remotes, inst);
      (res.list || []).forEach((it) => {
        if (it.state !== 'SUCCESS') return;
        ed.state.doc.descendants((n, p) => {
          if (n.type.name === 'image' && n.attrs.src === it.source) tr.setNodeMarkup(p, null, { ...n.attrs, src: it.url });
        });
        done++;
      });
    } catch (e) { toast('远程图转存失败:' + e.message, 'error'); }
  }
  if (tr.docChanged) ed.view.dispatch(tr);
  toast('转存完成 ' + done + ' 张', 'success');
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
