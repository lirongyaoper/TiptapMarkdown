/**
 * lry-editor-lite 主入口:留言/评论用简约编辑器(与 full 版同包独立构建)。
 *
 * 页面接入(与 LRYEditor 同形,零学习成本):
 *   LRYEditorLite.create({ mount:'#msg_editor', textarea:'bookmsg',
 *                          value:'', placeholder:'请输入留言内容…',
 *                          maximumWords:500, height:140,
 *                          images:true, module:'forum' })
 *   LRYEditorLite.get('bookmsg') → { getContent, getText, setContent, insertHtml,
 *                                    on('contentChange'), focus, sync, destroy }
 *
 * 简约边界:纯文字排版(bold/italic/underline/strike/行内code/链接/引用/列表/
 * 表情);可选 images:true 开启贴图(2026-11-21,工具栏出现图片按钮,上传走
 * 经 adapter 上传(src/upload.js;默认 memoryAdapter);未开启时粘贴的图片按 schema 丢弃,
 * 与旧版行为一致)。无表格/代码块/标题/MD/AI;StarterKit 内置扩展按需关闭。
 * 同步策略与 full 版一致:transaction 防抖 200ms 写回 + form submit 捕获 flush。
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

import { h, toast, popover, closePopover } from './ui/dom.js';
import { ICONS } from './ui/icons.js';
import { openEmojiPicker } from './ui/emoji.js';
import { postprocessOutput } from './legacy/serialize.js';
import { uploadFile } from './upload.js';
import { LryTaskList, LryTaskItem } from './extensions/task-list.js';
import { mountBubbleMenu } from './ui/bubble.js';
import './styles/lry-editor-lite.css';

export const VERSION = '1.2.1';

/* ---------- 输入清洗:留言场景最小集(防御纵深,服务端仍需过滤输出) ---------- */
function sanitizeInput(html) {
  if (!html || html.indexOf('<') < 0) return html || '';
  const dom = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  const root = dom.body;
  root.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((a) => {
      const name = a.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  return root.innerHTML;
}

/* ---------- 链接:紧凑 popover(替代 full 版对话框形态) ---------- */
function openLinkPopover(anchor, inst) {
  const ed = inst.editor;
  const existing = ed.getAttributes('link');
  const input = h('input', {
    type: 'text', class: 'lry-input lry-lite-link-input',
    placeholder: 'https://…', value: existing.href || ''
  });
  const apply = () => {
    const href = input.value.trim();
    if (!href) { toast('请填写链接地址', 'error'); return; }
    if (ed.state.selection.empty) {
      /* 空选区:以地址为文字插入链接(full 版对话框同款行为) */
      ed.chain().focus().insertContent({
        type: 'text', text: href,
        marks: [{ type: 'link', attrs: { href } }]
      }).run();
    } else {
      ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    closePopover();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  popover(anchor, h('div', { class: 'lry-lite-link' },
    input,
    h('button', { type: 'button', class: 'lry-btn lry-btn-primary', onclick: apply }, '确定'),
    existing.href
      ? h('button', { type: 'button', class: 'lry-btn', onclick: () => {
          ed.chain().focus().extendMarkRange('link').unsetLink().run();
          closePopover();
        } }, '移除')
      : null
  ), { className: 'lry-lite-link-pop' });
  setTimeout(() => input.focus(), 60);
}

/* ---------- 贴图(可选):本地点选 → adapter 上传 → 插入 <img> ---------- */
function openImagePicker(anchor, inst) {
  if (anchor && anchor.dataset && anchor.dataset.lryUploading === '1') return;
  const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    if (!/\.(png|jpe?g|gif|bmp|webp|avif)$/i.test(file.name)) {
      toast('仅支持图片文件(png/jpg/gif/webp 等)', 'error');
      return;
    }
    if (anchor && anchor.dataset) anchor.dataset.lryUploading = '1';
    try {
      const r = await uploadFile(file, { filetype: 1, module: inst.options.module || '' }, inst);
      inst.insertHtml('<img src="' + String(r.url).replace(/"/g, '%22') + '" alt="图片">');
      inst.editor.commands.focus();
    } catch (e) {
      toast((e && e.message) || '图片上传失败', 'error');
    } finally {
      if (anchor && anchor.dataset) delete anchor.dataset.lryUploading;
    }
  });
  document.body.appendChild(input);
  input.click();
}

/* ---------- 工具栏:一行 13 钮(开启贴图 +1),无下拉无折叠,横向滚动自适应 ---------- */
const TOOLS = [
  { cmd: 'undo', icon: 'undo', title: '撤销' },
  { cmd: 'redo', icon: 'redo', title: '重做' },
  '|',
  { cmd: 'toggleBold', icon: 'bold', title: '加粗', active: 'bold' },
  { cmd: 'toggleItalic', icon: 'italic', title: '斜体', active: 'italic' },
  { cmd: 'toggleUnderline', icon: 'underline', title: '下划线', active: 'underline' },
  { cmd: 'toggleStrike', icon: 'strikethrough', title: '删除线', active: 'strike' },
  { cmd: 'toggleCode', icon: 'code', title: '行内代码', active: 'code' },
  '|',
  { icon: 'link', title: '链接(Ctrl+K)', active: 'link', open: openLinkPopover },
  { cmd: 'unsetLink', icon: 'unlink', title: '取消链接' },
  '|',
  { cmd: 'toggleBlockquote', icon: 'blockquote', title: '引用', active: 'blockquote' },
  { cmd: 'toggleBulletList', icon: 'unorderedlist', title: '无序列表', active: 'bulletList' },
  { cmd: 'toggleOrderedList', icon: 'orderedlist', title: '有序列表', active: 'orderedList' },
  { cmd: 'toggleTaskList', icon: 'checklist', title: '待办清单', active: 'taskList' },
  '|',
	{ icon: 'emotion', title: '表情', open: (anchor, inst) => openEmojiPicker(anchor, inst) },
	'|',
	{ cmd: 'unsetAllMarks', icon: 'removeformat', title: '清除格式' }
];
/* 贴图钮(仅 options.images 开启时拼进工具栏,插入表情钮之前) */
const IMAGE_TOOL = { icon: 'image', title: '插入图片', open: openImagePicker };

function mountToolbar(inst) {
  const bar = inst.wrapper.querySelector('.lry-lite-toolbar');
  if (!bar) return;
  const ed = inst.editor;
  const buttons = [];
  /* 贴图开启:插在表情之前,与其共用一个分隔段 */
  const tools = inst.options.images
    ? TOOLS.slice(0, TOOLS.length - 2).concat([IMAGE_TOOL], TOOLS.slice(-2))
    : TOOLS;
  tools.forEach((tool) => {
    if (tool === '|') { bar.appendChild(h('span', { class: 'lry-toolbar-sep' })); return; }
    const btn = h('button', {
      type: 'button', class: 'lry-tool-btn', title: tool.title,
      onclick: (e) => {
        if (tool.open) { tool.open(e.currentTarget, inst); return; }
        ed.chain().focus()[tool.cmd]().run();
      }
    }, h('span', { class: 'lry-tool-icon', html: ICONS[tool.icon] || '' }));
    if (tool.active) buttons.push({ btn, name: tool.active });
    bar.appendChild(btn);
  });
  const sync = () => buttons.forEach(({ btn, name }) =>
    btn.classList.toggle('lry-btn-tool-active', ed.isActive(name)));
  ed.on('selectionUpdate', sync);
  ed.on('transaction', sync);
  sync();
}

/* ---------- 字数计数 ---------- */
function wireCounter(inst) {
  const el = inst.wrapper.querySelector('.lry-lite-count');
  if (!el) return;
  const limit = inst.options.maximumWords;
  const sync = () => {
    const n = inst.editor.storage.characterCount ? inst.editor.storage.characterCount.characters() : 0;
    el.textContent = limit ? (n + ' / ' + limit) : (n + ' 字');
    el.classList.toggle('lry-wc-over', !!limit && n > limit);
  };
  inst.editor.on('update', sync);
  sync();
}

function pickEl(target, doc) {
  if (!target) return null;
  if (typeof target === 'string') return doc.querySelector(target);
  return target;
}

const instances = new Map();

function create(options) {
  options = options || {};
  const doc = options.doc || document;
  const mount = pickEl(options.mount || options.element, doc);
  if (!mount) throw new Error('[lry-editor-lite] mount 元素不存在');

  /* 隐藏表单域:优先复用页面既有的,否则自建(逻辑与 full 版一致) */
  let textarea = pickEl(options.textarea, doc);
  if (!textarea && typeof options.textarea === 'string') {
    textarea = doc.querySelector('textarea[name="' + options.textarea + '"]');
  }
  const readonly = options.readonly === true;
  const wrapper = doc.createElement('div');
  wrapper.className = 'lry-lite' + (readonly ? ' lry-lite-readonly' : '') + (options.className ? ' ' + options.className : '');
  const height = parseInt(options.height, 10) || 140;
  wrapper.innerHTML = [
    (readonly ? '' : '<div class="lry-lite-toolbar"></div>'),
    '<div class="lry-lite-content" style="min-height:' + height + 'px"></div>',
    (options.wordCount === false ? '' : '<div class="lry-lite-status"><span class="lry-lite-count"></span></div>')
  ].join('');
  if (mount.tagName === 'TEXTAREA') {
    textarea = textarea || mount;
    mount.parentNode.insertBefore(wrapper, mount);
  } else {
    mount.appendChild(wrapper);
  }
  if (!textarea) {
    textarea = doc.createElement('textarea');
    textarea.name = options.textarea || options.name || 'content';
    textarea.style.display = 'none';
    wrapper.parentNode.insertBefore(textarea, wrapper.nextSibling);
  }
  textarea.style.display = 'none';
  textarea.classList.add('lry-editor-field');
  /* 隐藏域带 required 会阻断原生表单提交(不可聚焦校验),编辑器自身负责空值提示;
     data 标记供页面校验器识别该字段已由编辑器接管 */
  textarea.removeAttribute('required');
  textarea.setAttribute('data-lry-lite', '1');

  const editor = new Editor({
    element: wrapper.querySelector('.lry-lite-content'),
    extensions: [
      StarterKit.configure({
        heading: false,          /* 留言不需要标题:粘贴标题降为段落 */
        codeBlock: false,        /* 无代码块,仅保留行内 code mark */
        horizontalRule: false,
        link: false,             /* 换自配置 Link(不自动打开) */
        trailingNode: false      /* 与 full 版同因:保证 roundtrip 幂等 */
      }),
      Link.configure({
        openOnClick: false, autolink: true, defaultProtocol: 'https',
        HTMLAttributes: { rel: null, target: null }
      }),
      /* 待办清单(2026-11-21):契约序列化同 full 版(ul.lry-task + ☑/☐ 字符),
         评论/留言侧服务端剥 class 后字符仍在,语义不损 */
      LryTaskList,
      LryTaskItem,
      /* 贴图(2026-11-21):仅 images:true 时注册;未注册时粘贴图片按 schema 丢弃(与旧版一致) */
      options.images ? Image.configure({ inline: false, allowBase64: false }) : null,
      CharacterCount.configure({ limit: options.maximumWords || null }),
      Placeholder.configure({ placeholder: options.placeholder || '请输入内容…' })
    ].filter(Boolean),
    content: sanitizeInput(options.value || textarea.value || ''),
    editable: !readonly,
    editorProps: {
      /* 基础样式内联防 iOS 聚焦缩放(同 full 版) */
      attributes: { class: 'lry-lite-prose', style: 'font-size:16px' }
    }
  });

  /* ---------- 表单同步:防抖写回 + blur/submit 强制 flush ----------
     blur flush:页面既有校验器(check_comm/lry_submit 等)直接读 textarea 值,
     点击提交按钮必先触发编辑区失焦,此处同步消除 200ms 防抖窗口的取值过期 */
  let syncTimer = null;
  const flush = () => {
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    textarea.value = postprocessOutput(editor.getHTML(), doc);
    return textarea.value;
  };
  editor.on('update', () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(flush, 200);
  });
  editor.on('blur', flush);
  const form = textarea.form || (wrapper.closest && wrapper.closest('form'));
  let submitHandler = null;
  if (form) {
    submitHandler = () => flush();
    form.addEventListener('submit', submitHandler, true);
  }

  /* ---------- 事件桥:contentChange(与 full 版兼容事件名) ---------- */
  const changeHandlers = [];
  editor.on('update', () => changeHandlers.forEach((cb) => {
    try { cb(); } catch (e) { console.error('[lry-editor-lite] contentChange 回调异常', e); }
  }));

  const instance = {
    editor,
    wrapper,
    textarea,
    form,
    options,
    version: VERSION,
    ready: Promise.resolve(),
    getContent() { return flush(); },
    getText() { return editor.getText(); },
    getContentTxt() { return editor.getText(); },
    setContent(html) {
      editor.commands.setContent(sanitizeInput(html || ''));
      flush();
    },
    focus() { editor.commands.focus(); },
    blur() { editor.commands.blur(); },
    hasContents() { return !editor.isEmpty; },
    insertHtml(html) {
      editor.chain().focus().insertContent(html).run();
    },
    on(event, cb) {
      if (event === 'contentChange' || event === 'update') changeHandlers.push(cb);
      return this;
    },
    sync() { flush(); return this; },
    destroy() {
      if (submitHandler && form) form.removeEventListener('submit', submitHandler, true);
      if (instance._bubbleDestroy) instance._bubbleDestroy();
      flush();
      editor.destroy();
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      if (instances.get(textarea.name) === instance) instances.delete(textarea.name);
    }
  };

  if (!readonly) {
    mountToolbar(instance);
    /* Ctrl+K 打开链接 popover(同 full 版快捷键约定) */
    wrapper.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openLinkPopover(wrapper.querySelector('[title^="链接"]') || wrapper, instance);
      }
    });
    /* 划词迷你气泡条(2026-11-21 现代编辑器增强):选中文本浮现常用格式 */
    instance._bubbleDestroy = mountBubbleMenu(instance, [
      { icon: 'bold', title: '加粗', run: (ed) => ed.chain().focus().toggleBold().run(), active: 'bold' },
      { icon: 'italic', title: '斜体', run: (ed) => ed.chain().focus().toggleItalic().run(), active: 'italic' },
      { icon: 'underline', title: '下划线', run: (ed) => ed.chain().focus().toggleUnderline().run(), active: 'underline' },
      { icon: 'strikethrough', title: '删除线', run: (ed) => ed.chain().focus().toggleStrike().run(), active: 'strike' },
      { icon: 'code', title: '行内代码', run: (ed) => ed.chain().focus().toggleCode().run(), active: 'code' },
      '|',
      { icon: 'link', title: '链接', run: (ed, inst, btn) => openLinkPopover(btn, inst), active: 'link' }
    ]);
  }
  wireCounter(instance);

  const key = textarea.name || options.name;
  if (key) instances.set(key, instance);
  return instance;
}

export const LRYEditorLiteAPI = {
  VERSION,
  create,
  get(name) { return instances.get(name) || null; }
};

/* IIFE 直挂全局(页面 script 标签引入场景) */
if (typeof window !== 'undefined') {
  window.LRYEditorLite = window.LRYEditorLite || {};
  window.LRYEditorLite.VERSION = VERSION;
  window.LRYEditorLite.create = create;
  window.LRYEditorLite.get = (name) => instances.get(name) || null;
  window.LRYEditorLite.instances = instances;
  /* form.class.php 的内联初始化脚本可能先于本 bundle 执行,靠本事件解锁 */
  try { window.dispatchEvent(new Event('lry-editor-lite-ready')); } catch (e) { /* IE 兜底忽略 */ }
}
