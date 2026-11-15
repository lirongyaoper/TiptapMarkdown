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
import { LryParagraph, LryHeading, LryBlockquote, PageBreak, BlockStyleCommands } from './extensions/blocks.js';
import { LryImage, LryVideo, LryAudio, LryIframe, LryAttachment, LryAnchor } from './extensions/media.js';
import { LryCodeBlock, LryMathInline, LryMathBlock, LryFnSup, LryFnLabel, LryFootnotes } from './extensions/contract-nodes.js';
import { LryTable, LryTableRow, LryTableCell, LryTableHeader } from './extensions/table.js';
import { normalizeLegacyHtml } from './legacy/normalize.js';
import { postprocessOutput } from './legacy/serialize.js';
import { TOOLBAR_FULL, TOOLBAR_MINI } from './config.js';
import { mountToolbar } from './ui/toolbar.js';
import { DIALOGS } from './ui/dialogs.js';
import { uploadFile, isImageFile } from './upload.js';
import { toast } from './ui/dom.js';
import { mountMarkdownMode } from './md/mode.js';
import { mountSlashMenu } from './md/slash-menu.js';
import { OutlinePanel, mountOutlinePanel } from './ui/outline.js';
import { mountAutosave } from './ui/autosave.js';
import { handleMarkdownPaste } from './md/paste.js';
import { mountAiPanel } from './ai/panel.js';
import './styles/lry-editor.css';

export const VERSION = '1.0.0';

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
    /* 契约节点 */
    LryCodeBlock, LryMathInline, LryMathBlock, LryFnSup, LryFnLabel, LryFootnotes,
    /* 嵌入 */
    LryImage, LryVideo, LryAudio, LryIframe, LryAttachment, LryAnchor,
    /* 表格 */
    LryTable.configure({ resizable: false }),
    LryTableRow, LryTableCell, LryTableHeader,
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

/* ---------- 粘贴/拖拽 ---------- */
function wirePasteAndDrop(inst) {
  const ed = inst.editor;
  const uploadAndInsert = async (file) => {
    try {
      const r = await uploadFile(file, { filetype: 1, module: inst.options.module }, inst);
      ed.chain().focus().setImage({ src: r.url }).run();
    } catch (e) { toast('图片上传失败:' + e.message, 'error'); }
  };
  /* data:URI 图片(Word/截图粘贴)自动转存 */
  const transformPastedHTML = (html) => {
    if (inst._pastePlain) return html.replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n');
    return html;
  };
  ed.on('create', () => {
    ed.view.dom.addEventListener('paste', async (e) => {
      if (inst._pastePlain) return; /* transformPastedHTML 已处理;markdown 识别在 handlePaste */
      const items = e.clipboardData && e.clipboardData.files;
      if (items && items.length) {
        const imgs = [...items].filter(isImageFile);
        if (imgs.length) {
          e.preventDefault();
          for (const f of imgs) await uploadAndInsert(f);
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
      const imgs = [...files].filter(isImageFile);
      if (!imgs.length) return;
      e.preventDefault();
      for (const f of imgs) await uploadAndInsert(f);
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
      handlePaste: (view, event) => {
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

  /* 粘贴与拖拽:Markdown 识别 / 纯文本模式 / data:URI 图片自动上传 / 图片文件直传 */
  wirePasteAndDrop(instance);

  /* 快捷键补充:Ctrl+K 打开链接对话框 */
  const keydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      DIALOGS.link(instance);
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
  /* form.class.php 的内联初始化脚本可能先于本 bundle 执行,靠本事件解锁 */
  try { window.dispatchEvent(new Event('lry-editor-ready')); } catch (e) { /* IE 兜底忽略 */ }
}
