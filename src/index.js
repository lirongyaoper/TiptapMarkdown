/**
 * lry-editor 主入口:门面 API + 表单同步。
 *
 * 页面接入:
 *   LRYEditor.create({ mount:'#content_editor', textarea:'content', preset:'full',
 *                      value:'<p>初始</p>', wordCount:false, height:360 })
 *   LRYEditor.get('content') → { getContent, getText, setContent, insertHtml,
 *                                on('contentChange'), ready, focus, sync, destroy }
 *
 * 同步策略(根除旧 autoSyncData 仅 window blur 写回的丢稿类 bug):
 *   - 每次 transaction 防抖 200ms 写回隐藏 textarea
 *   - 所在 form 的 submit 事件(捕获阶段)强制同步 flush
 */
import { Editor } from '@tiptap/core';
import { TextSelection, Selection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { TextStyle, Color, FontSize, FontFamily, BackgroundColor } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';

import { FontBorder, LryMark, Kbd, LegacyStyle } from './extensions/marks.js';
import { LryStrike } from './extensions/strike.js';
import { TyporaRules } from './extensions/typora-rules.js';
import { LryMermaid, LryFold, LryFoldHead, LryFoldBody, LryCols, LryCol, LryStatus, LryFileCard } from './extensions/yuque-nodes.js';
import { LryTaskList, LryTaskItem } from './extensions/task-list.js';
import { RowHandle } from './ui/row-handle.js';
import { LryParagraph, LryHeading, LryBlockquote, PageBreak, BlockStyleCommands, FirstLineIndent } from './extensions/blocks.js';
import { LryImage, LryVideo, LryAudio, LryIframe, LryAttachment, LryAnchor } from './extensions/media.js';
import { LryCodeBlock, LryMathInline, LryMathBlock, LryFnSup, LryFnLabel, LryFootnotes } from './extensions/contract-nodes.js';
import { LryTable, LryTableRow, LryTableCell, LryTableHeader, LryTableResize } from './extensions/table.js';
import { normalizeLegacyHtml } from './legacy/normalize.js';
import { postprocessOutput } from './legacy/serialize.js';
import { TOOLBAR_FULL, TOOLBAR_MINI } from './config.js';
import { mountToolbar, typesetOptions, applyAutoTypeset } from './ui/toolbar.js';
import { DIALOGS } from './ui/dialogs.js';
import { mountBubbleMenu } from './ui/bubble.js';
import { openColorPanel } from './ui/color.js';
import { uploadFile, isImageFile } from './upload.js';
import { toast, popover } from './ui/dom.js';
import { mountMarkdownMode } from './md/mode.js';
import { mountSlashMenu } from './md/slash-menu.js';
import { OutlinePanel, mountOutlinePanel } from './ui/outline.js';
import { mountAutosave } from './ui/autosave.js';
import { handleMarkdownPaste, handlePasteEnhance, handleCodeBlockPaste, importMarkdownFile } from './md/paste.js';
import { mountAiPanel } from './ai/panel.js';
import { mountContextToolbar, resolveContext, contextTools } from './ui/context-toolbar.js';
import { mountFindReplace, collectMatches } from './ui/find-replace.js';
import { renderStatsPanel, computeStats, buildDocument, absoluteUrls } from './ui/exporters.js';
import { typesetDoc } from './ui/autotypeset.js';
import { indentCode } from './extensions/contract-nodes.js';
import { setCellBackground, cellBackgroundAt } from './ui/table-ops.js';
import { normalizeHref } from './ui/dialogs.js';
import { matchItems, buildGroups, isTrigger } from './md/slash-menu.js';
import { insertAiResult, looksMarkdown } from './ai/panel.js';
import { isWaitingLine } from './ui/row-handle.js';
import { tokenize, detectLanguage, themeClass } from './ui/code-highlight.js';
import './styles/lry-editor.css';

export const VERSION = '1.2.1';

function pickEl(target, doc) {
  if (!target) return null;
  if (typeof target === 'string') return doc.querySelector(target);
  return target;
}

function buildExtensions(options) {
  return [
    StarterKit.configure({
      paragraph: false,
      heading: false,
      blockquote: false,
      codeBlock: false,
      link: false,
      strike: false,
      /* v3 内置 TrailingNode 会在文档不以段落结尾时自动补 <p></p>,
         破坏 roundtrip 幂等,关闭 */
      trailingNode: false
    }),
    LryStrike,
    /* 行内格式 */
    TextStyle, Color, FontSize, FontFamily, BackgroundColor,
    Subscript, Superscript,
    Highlight.configure({ multicolor: true }),
    Link.configure({
      openOnClick: false, autolink: true, defaultProtocol: 'https',
      HTMLAttributes: { rel: null, target: null }
    }),
    FontBorder, LryMark, Kbd, LegacyStyle,
    TyporaRules,
    /* 语雀式多文稿块(2026-11-15) */
    LryMermaid, LryFold, LryFoldHead, LryFoldBody, LryCols, LryCol, LryStatus, LryFileCard,
    LryTaskList, LryTaskItem, RowHandle,
    OutlinePanel,
    /* 块级 */
    LryParagraph, LryHeading, LryBlockquote, BlockStyleCommands, PageBreak,
    FirstLineIndent,
    /* 契约节点 */
    LryCodeBlock, LryMathInline, LryMathBlock, LryFnSup, LryFnLabel, LryFootnotes,
    /* 嵌入 */
    LryImage, LryVideo, LryAudio, LryIframe, LryAttachment, LryAnchor,
    /* 表格 */
    LryTable.configure({ resizable: false }),
    LryTableRow, LryTableCell, LryTableHeader,
    /* 列宽拖拽(2026-11-23):写 td/th width 属性,不改 colgroup 契约 */
    LryTableResize,
    /* 功能 */
    CharacterCount.configure({ limit: options.maximumWords || null }),
    Placeholder.configure({ placeholder: options.placeholder || '' })
  ];
}

const instances = new Map();

/* ---------- 状态栏:元素路径 + 字数 ---------- */
function wireStatusbar(inst) {
  const ed = inst.editor;
  const pathEl = inst.wrapper.querySelector('.lry-elementpath');
  const wcEl = inst.wrapper.querySelector('.lry-wordcount');
  const limit = inst.options.maximumWords || 10000;
  const sync = () => {
    if (pathEl) {
      const { $from } = ed.state.selection;
      const parts = [];
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d);
        const label = n.type.name === 'heading' ? 'H' + n.attrs.level : n.type.name;
        parts.unshift(label);
      }
      pathEl.innerHTML = '';
      parts.forEach((p) => pathEl.appendChild(document.createElement('span')).textContent = p);
    }
    if (wcEl) {
      const n = ed.storage.characterCount ? ed.storage.characterCount.characters() : 0;
      wcEl.textContent = n + ' / ' + limit;
      wcEl.classList.toggle('lry-wc-over', n > limit);
    }
  };
  ed.on('selectionUpdate', sync);
  ed.on('update', sync);
  sync();
}

/* ---------- 文末空白区点击(2026-11-24) ----------
   末块是代码块/表格/原子块时,点它下方的空白不再把光标塞回块内——ProseMirror 的默认
   行为是落到最近的文本位置,对文末代码块而言正是代码块末尾,用户的感觉就是
   "点下面也出不来"。改为在其后补一个空段落并落进去;末块本身可承载光标时落到文末。 */
function blankClickAction(doc) {
  const last = doc.lastChild;
  if (!last) return 'atEnd';
  if (last.type.spec.code === true || last.type.name === 'table' || last.isAtom || last.isLeaf) return 'insert';
  return 'atEnd';
}
function wireEndOfDocClick(inst) {
  const ed = inst.editor;
  const dom = ed.view.dom;
  /* 挂在父级并走捕获:必须先于 ProseMirror 自带的 mousedown 处理,否则光标已被它落位 */
  const host = dom.parentNode || dom;
  const onDown = (e) => {
    if (e.button !== 0 || e.target !== dom) return; /* 只接落在编辑区根元素自身上的点击 */
    const { doc } = ed.state;
    const last = doc.lastChild;
    if (!last) return;
    const lastEl = ed.view.nodeDOM(doc.content.size - last.nodeSize);
    const bottom = lastEl && lastEl.getBoundingClientRect ? lastEl.getBoundingClientRect().bottom : 0;
    if (e.clientY < bottom - 1) return; /* 在根元素自身上但不在末块下沿之下(如首块上方的留白) */
    e.preventDefault();
    e.stopPropagation();
    const tr = ed.state.tr;
    if (blankClickAction(doc) === 'insert') {
      tr.insert(doc.content.size, ed.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, doc.content.size + 1));
    } else {
      tr.setSelection(Selection.atEnd(tr.doc));
    }
    ed.view.dispatch(tr);
    ed.view.focus();
  };
  host.addEventListener('mousedown', onDown, true);
  inst._endClickCleanup = () => host.removeEventListener('mousedown', onDown, true);
}

/* ---------- 字数详情(2026-11-23):点击状态栏字数弹出统计面板 ---------- */
function wireStats(inst) {
  const wcEl = inst.wrapper.querySelector('.lry-wordcount');
  if (!wcEl) return;
  wcEl.classList.add('lry-wordcount-btn');
  wcEl.title = '点击查看详细统计';
  wcEl.addEventListener('click', () => {
    /* 先关闭上次面板:popover 单例会自行处理 */
    popover(wcEl, renderStatsPanel(inst.editor.state.doc), { className: 'lry-stats-pop' });
  });
}

/* ---------- 粘贴/拖拽 ---------- */
const isVideoFile = (f) => /^video\//.test(f.type || '') || /\.(mp4|webm|ogv|m4v|mov)$/i.test(f.name || '');
const isAudioFile = (f) => /^audio\//.test(f.type || '') || /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i.test(f.name || '');

/* 上传完成后按文件类型落成对应节点(图片/视频/音频/附件) */
function insertUploaded(ed, file, r) {
  if (isImageFile(file)) return ed.chain().setImage({ src: r.url, title: r.title || '' }).run();
  if (isVideoFile(file)) return ed.chain().insertVideo({ src: r.url }).run();
  if (isAudioFile(file)) return ed.chain().insertAudio({ src: r.url }).run();
  return ed.chain().insertAttachment({ href: r.url, title: r.title || file.name }).run();
}

function wirePasteAndDrop(inst) {
  const ed = inst.editor;
  /* 非图片文件(视频/音频/附件)拖入或粘贴即上传:可用 options.dropFiles:false 关闭;
     .md/.markdown 文件始终接收(按 Markdown 转换导入,不占上传权限) */
  const dropFiles = inst.options.dropFiles !== false;
  const isMarkdownFile = (f) => /\.(md|markdown)$/i.test(f.name || '') && !isImageFile(f);
  const accept = (f) => isImageFile(f) || isMarkdownFile(f) || dropFiles;

  /* 右下角上传进度小条(大文件分片时按百分比刷新) */
  const setPill = (text) => {
    let pill = inst.wrapper.querySelector('.lry-upload-pill');
    if (!text) { if (pill) pill.remove(); return; }
    if (!pill) { pill = document.createElement('div'); pill.className = 'lry-upload-pill'; inst.wrapper.appendChild(pill); }
    pill.textContent = text;
  };
  const handleFiles = async (files) => {
    for (const f of files) {
      if (isMarkdownFile(f)) {
        const ok = await importMarkdownFile(inst, f);
        toast(ok ? 'Markdown 已导入' : 'Markdown 组件不可用,已按原文插入', ok ? 'success' : 'error');
        continue;
      }
      const label = f.name && f.name.length > 18 ? f.name.slice(0, 16) + '…' : (f.name || '文件');
      try {
        setPill('上传中:' + label);
        const r = await uploadFile(f, {
          filetype: isImageFile(f) ? 1 : 2, module: inst.options.module,
          onProgress: (p) => setPill('上传中 ' + p + '%:' + label)
        }, inst);
        insertUploaded(ed, f, r);
        setPill(null);
        if (!isImageFile(f)) toast('「' + label + '」已上传并插入', 'success');
      } catch (e) { setPill(null); toast('「' + label + '」上传失败:' + e.message, 'error'); }
    }
    setPill(null);
  };

  /* 粘贴后自动排版(2026-11-23):paste 时打时间戳,其后 3 秒内首个改动文档的事务
     视为粘贴落地(Markdown 识别是异步的,转换完才插),只排该事务改动的区间 */
  let typesetPending = 0;
  const markTypeset = () => { if (typesetOptions(inst).paste) typesetPending = Date.now(); };
  ed.on('transaction', ({ transaction }) => {
    if (!typesetPending) return;
    if (!transaction.docChanged) { if (Date.now() - typesetPending > 3000) typesetPending = 0; return; }
    typesetPending = 0;
    let from = Infinity, to = -Infinity;
    transaction.steps.forEach((step) => {
      if (!step.getMap) return;
      step.getMap().forEach((_os, _oe, ns, ne) => { from = Math.min(from, ns); to = Math.max(to, ne); });
    });
    if (to < 0) return;
    applyAutoTypeset(inst, { from, to });
  });

  /* data:URI 图片(Word/截图粘贴)自动转存 */
  const transformPastedHTML = (html) => {
    if (inst._pastePlain) return html.replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n');
    return html;
  };
  ed.on('create', () => {
    ed.view.dom.addEventListener('paste', markTypeset, true);
    ed.view.dom.addEventListener('paste', async (e) => {
      if (inst._pastePlain) return; /* transformPastedHTML 已处理;markdown 识别在 handlePaste */
      const items = e.clipboardData && e.clipboardData.files;
      if (items && items.length) {
        /* 仅"纯文件"剪贴板(截图、从文件管理器复制)走上传;剪贴板同时带文字/富文本
           (Word 图文混排等)走正常粘贴,其中的 data:URI 图片由下方延迟转存处理 */
        const plain = e.clipboardData.getData('text/plain');
        const html = e.clipboardData.getData('text/html');
        const hasText = !!(plain.trim() || html.replace(/<[^>]+>/g, '').trim());
        const files = [...items].filter(accept);
        if (files.length && !hasText) {
          e.preventDefault();
          handleFiles(files);
          return;
        }
      }
      /* 富文本粘贴中的 data:URI 图片延迟转存 */
      setTimeout(() => {
        ed.state.doc.descendants((node, pos) => {
          if (node.type.name === 'image' && node.attrs.src && node.attrs.src.startsWith('data:')) {
            (async () => {
              try {
                const blob = await (await fetch(node.attrs.src)).blob();
                const f = new File([blob], 'paste-' + Date.now() + '.png', { type: blob.type || 'image/png' });
                const r = await uploadFile(f, { filetype: 1, module: inst.options.module }, inst);
                ed.chain().command(({ tr }) => {
                  /* 重新定位避免坐标漂移 */
                  ed.state.doc.descendants((n2, p2) => {
                    if (n2 === node) tr.setNodeMarkup(p2, null, { ...n2.attrs, src: r.url });
                  });
                  return true;
                }).run();
              } catch (err) { console.warn('[lry-editor] 粘贴图转存失败', err); }
            })();
          }
        });
      }, 50);
    });
    ed.view.dom.addEventListener('drop', async (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      const list = [...files].filter(accept);
      if (!list.length) return;
      e.preventDefault();
      /* 落点即插入点(拖到哪插到哪);取不到坐标时用当前选区 */
      try {
        const hit = ed.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (hit && typeof hit.pos === 'number') ed.chain().setTextSelection(hit.pos).run();
      } catch (err) { /* ignore */ }
      markTypeset();
      handleFiles(list);
    });
  });
  /* 挂到 editorProps(纯文本开关)——setOptions 是浅合并,必须并入既有
     editorProps,否则 handlePaste(Markdown 识别)与 attributes(编辑区
     基础样式)会被整体覆盖丢失 */
  ed.setOptions({
    editorProps: {
      ...ed.options.editorProps,
      transformPastedHTML
    }
  });
}

/* 划词浮动工具条按钮集(2026-11-21 现代编辑器增强,full 版) */
const FULL_BUBBLE_TOOLS = [
  { icon: 'bold', title: '加粗 (Ctrl+B)', run: (ed) => ed.chain().focus().toggleBold().run(), active: 'bold' },
  { icon: 'italic', title: '斜体 (Ctrl+I)', run: (ed) => ed.chain().focus().toggleItalic().run(), active: 'italic' },
  { icon: 'underline', title: '下划线 (Ctrl+U)', run: (ed) => ed.chain().focus().toggleUnderline().run(), active: 'underline' },
  { icon: 'strikethrough', title: '删除线', run: (ed) => ed.chain().focus().toggleStrike().run(), active: 'strike' },
  { icon: 'code', title: '行内代码', run: (ed) => ed.chain().focus().toggleCode().run(), active: 'code' },
  '|',
  { icon: 'forecolor', title: '文字颜色', run: (ed, inst, btn) => openColorPanel(btn, 'fore', inst) },
  { icon: 'backcolor', title: '背景色', run: (ed, inst, btn) => openColorPanel(btn, 'back', inst) },
  { icon: 'marker', title: '高亮', run: (ed, inst, btn) => openColorPanel(btn, 'mark', inst), active: 'lryMark' },
  '|',
  { icon: 'link', title: '链接 (Ctrl+K)', run: (ed, inst) => DIALOGS.link(inst), active: 'link' },
  { icon: 'removeformat', title: '清除格式', run: (ed) => ed.chain().focus().unsetAllMarks().run() }
];

function create(options) {
  const doc = options.doc || document;
  const mount = pickEl(options.mount || options.element, doc);
  if (!mount) throw new Error('[lry-editor] mount 元素不存在');

  /* 隐藏表单域:优先复用页面既有的(form.class 产出),否则自建 */
  let textarea = pickEl(options.textarea, doc);
  if (!textarea && typeof options.textarea === 'string') {
    textarea = doc.querySelector('textarea[name="' + options.textarea + '"]');
  }

  const wrapper = doc.createElement('div');
  wrapper.className = 'lry-editor' + (options.className ? ' ' + options.className : '');
  const height = parseInt(options.height, 10) || 360;
  const html = [
    '<div class="lry-toolbar" data-lry-toolbar></div>',
    '<div class="lry-editor-content" style="min-height:' + height + 'px"></div>',
    '<div class="lry-statusbar">',
    (options.elementPath === false ? '' : '<span class="lry-elementpath"></span>'),
    (options.wordCount === false ? '' : '<span class="lry-wordcount"></span>'),
    '</div>'
  ].join('');
  wrapper.innerHTML = html;
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

  const contentEl = wrapper.querySelector('.lry-editor-content');
  const editor = new Editor({
    element: contentEl,
    extensions: buildExtensions(options),
    content: normalizeLegacyHtml(options.value || textarea.value || '', doc),
    editable: options.readonly !== true,
    editorProps: {
      /* 中文输入法回车/退格更贴合旧习惯;基础样式内联防 iOS 聚焦缩放 */
      attributes: {
        class: 'lry-editor-prose',
        style: 'font-size:16px'
      },
      /* Markdown 粘贴识别:官方入口,返回 true 阻止默认插入 */
      handlePaste: (view, event, slice) => {
        /* 粘贴增强(强制纯文本 / 网址转链接)→ 带代码块的 HTML 按块结构插入 → Markdown 识别;
           返回 true 阻止默认插入 */
        if (event.clipboardData && handlePasteEnhance(instance, event)) return true;
        if (handleCodeBlockPaste(instance, slice)) return true;
        if (event.clipboardData && handleMarkdownPaste(instance, event, event.clipboardData)) return true;
        return false;
      }
    }
  });

  /* ---------- 表单同步 ---------- */
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
  const form = textarea.form || (wrapper.closest && wrapper.closest('form'));
  let submitHandler = null;
  if (form) {
    submitHandler = () => flush();
    form.addEventListener('submit', submitHandler, true);
  }

  /* ---------- 事件桥:contentChange(旧页面脚本兼容事件名) ---------- */
  const changeHandlers = [];
  editor.on('update', () => changeHandlers.forEach((cb) => {
    try { cb(); } catch (e) { console.error('[lry-editor] contentChange 回调异常', e); }
  }));

  const instance = {
    editor,
    wrapper,
    textarea,
    form,
    options,
    version: VERSION,
    preset: options.preset || (options.toolbar ? 'custom' : 'full'),
    toolbarConfig: options.toolbar || (options.preset === 'mini' ? TOOLBAR_MINI : TOOLBAR_FULL),
    ready: Promise.resolve(),
    getContent() {
      if (this._mdFlush) this._mdFlush(); /* 分栏模式下源码侧脏改动立即转换 */
      return flush();
    },
    getText() { return editor.getText(); },
    getContentTxt() { return editor.getText(); },
    setContent(html) {
      editor.commands.setContent(normalizeLegacyHtml(html || '', doc));
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
      if (instance.mdApi && instance.mdApi.isActive()) instance.mdApi.toggle(); /* 退出分栏并 flush */
      if (instance._slashCleanup) instance._slashCleanup();
      if (instance._toolbarAdaptiveCleanup) instance._toolbarAdaptiveCleanup(); /* resize/orientation 监听 */
      if (instance._outlineCleanup) instance._outlineCleanup();
      if (instance._bubbleDestroy) instance._bubbleDestroy(); /* 划词浮动工具条 */
      if (instance._ctxCleanup) instance._ctxCleanup(); /* 链接/图片/表格上下文工具条 */
      if (instance._findCleanup) instance._findCleanup(); /* 查找替换浮动条与高亮插件 */
      if (instance._endClickCleanup) instance._endClickCleanup(); /* 文末空白区点击监听 */
      flush();
      editor.destroy();
      if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      if (instances.get(textarea.name) === instance) instances.delete(textarea.name);
    }
  };

  /* 工具栏/状态栏/Markdown 分栏/slash 菜单/AI 装配 */
  mountToolbar(instance);
  wireStatusbar(instance);
  mountMarkdownMode(instance);
  mountSlashMenu(instance);
  mountAiPanel(instance);
  mountOutlinePanel(instance);
  mountAutosave(instance);
  /* 查找替换浮动条(2026-11-23):readonly 态不挂(无可编辑内容) */
  if (options.readonly !== true) mountFindReplace(instance);
  wireStats(instance);
  /* 划词浮动工具条(2026-11-21)与上下文工具条(2026-11-23):readonly 态不装配 */
  if (options.readonly !== true) {
    instance._bubbleDestroy = mountBubbleMenu(instance, FULL_BUBBLE_TOOLS, {
      /* 选中图片时让位给上下文工具条 */
      suppress: () => !!(instance._ctxApi && instance._ctxApi.isImageSelected())
    });
    instance._ctxCleanup = mountContextToolbar(instance);
  }

  /* 粘贴与拖拽:Markdown 识别 / 纯文本模式 / data:URI 图片自动上传 / 图片文件直传 */
  wirePasteAndDrop(instance);
  /* 文末空白区点击:末块为代码块/表格等时在其后新起一段 */
  if (options.readonly !== true) wireEndOfDocClick(instance);

  /* 快捷键补充:Ctrl+K 链接 / Ctrl+F 查找 · Ctrl+H 替换(浮动条展开替换行)。
     Ctrl/⌘+Shift+H 是高亮(Ctrl+Shift+H 不是替换):带 Shift/Alt 的组合不在此处理——
     否则高亮生效后事件冒泡到此处仍会弹出替换栏并抢走焦点 */
  const keydown = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'k') {
      e.preventDefault();
      DIALOGS.link(instance);
    } else if (k === 'f' || k === 'h') {
      e.preventDefault();
      DIALOGS.searchreplace(instance, k === 'h' ? 'replace' : undefined);
    }
  };
  wrapper.addEventListener('keydown', keydown);

  const key = textarea.name || options.name;
  if (key) instances.set(key, instance);
  return instance;
}

export { setAdapter, getAdapter, createUrlAdapter, memoryAdapter } from './adapters.js';

export const LRYEditorAPI = {
  VERSION,
  create,
  get(name) { return instances.get(name) || null; },
  normalize: normalizeLegacyHtml,
  config: { TOOLBAR_FULL, TOOLBAR_MINI }
};

/* IIFE 直挂全局(页面 script 标签引入场景) */
if (typeof window !== 'undefined') {
  window.LRYEditor = window.LRYEditor || {};
  window.LRYEditor.VERSION = VERSION;
  window.LRYEditor.create = create;
  window.LRYEditor.get = (name) => instances.get(name) || null;
  window.LRYEditor.normalize = normalizeLegacyHtml;
  window.LRYEditor.instances = instances;
  /* 适配器全局入口(开源版):LRYEditor.setAdapter(...) / createUrlAdapter */
  import('./adapters.js').then((m) => {
    window.LRYEditor.setAdapter = m.setAdapter;
    window.LRYEditor.createUrlAdapter = m.createUrlAdapter;
    window.LRYEditor.memoryAdapter = m.memoryAdapter;
  });
  /* 纯逻辑钩子(判定/匹配/排版/导出等无 DOM 依赖的函数):供回归测试直接断言。
     不是公开 API,随时可能调整,业务代码勿依赖 */
  Object.defineProperty(window.LRYEditor, '_internals', {
    value: {
      resolveContext, contextTools, collectMatches, typesetDoc, indentCode,
      computeStats, buildDocument, absoluteUrls, setCellBackground, cellBackgroundAt,
      normalizeHref, matchItems, buildGroups, isTrigger, insertAiResult, looksMarkdown,
      isWaitingLine, blankClickAction, tokenize, detectLanguage, themeClass
    },
    enumerable: false
  });
  /* form.class.php 的内联初始化脚本可能先于本 bundle 执行,靠本事件解锁 */
  try { window.dispatchEvent(new Event('lry-editor-ready')); } catch (e) { /* IE 兜底忽略 */ }
}
