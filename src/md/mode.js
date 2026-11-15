/**
 * Markdown 分栏模式(Tiptap 重建;2026-11-15 二轮修复:
 *  - showdown 加载校验(404 曾被当成功 → 源码栏空白)
 *  - 转换失败绝不动编辑器内容(曾导致退出清空全部内容)
 *  - 布局:pane 拉伸填充 + 并排/堆叠切换按钮(<640px 默认堆叠)
 * 同步设计:
 *  - 进入:htmlToMarkdown({richFormat}) 源码栏初值
 *  - 源码→预览:input 防抖 250ms → markdownToHtml → 顶层块前后缀差分替换
 *  - 预览→源码:editor update 防抖 400ms → htmlToMarkdown 写回(保光标尾)
 *  - 提交前 flush:getContent 强制转换源码脏改动,永不丢稿
 *  - 退出:零转换,预览内容原样保留
 */
import { ensureShowdown, safeMdToHtml, safeHtmlToMd, normalizeYuqueHtml } from './ensure.js';

/* mermaid 围栏与任务列表产物归一(实现见 md/ensure.js normalizeYuqueHtml) */
function normalizeMermaidHtml(html) {
  return normalizeYuqueHtml(html);
}
import { DOMSerializer } from '@tiptap/pm/model';
import { h, popover, closePopover, toast } from '../ui/dom.js';

const VIEW_KEY = 'lry-editor-md-view';

export function mountMarkdownMode(inst) {
  let active = false;
  let srcDirty = false;
  let suppressPreviewSync = false;
  let convertFailNotified = false;
  let timerSrc = null, timerPrev = null;
  let els = null;
  let previewHandler = null;

  async function enter() {
    if (active) return true;
    /* showdown 不可用:明确报错,绝不进入半瘫分栏 */
    try {
      await ensureShowdown();
    } catch (e) {
      toast('Markdown 模式不可用:' + e.message, 'error');
      return false;
    }
    const wrap = inst.wrapper;
    const contentEl = wrap.querySelector('.lry-editor-content');
    const md = safeHtmlToMd(inst.editor.getHTML());
    if (md === null) {
      toast('内容转换失败,未进入分栏(编辑器内容未受影响)', 'error');
      return false;
    }

    const bar = document.createElement('div');
    bar.className = 'lry-md-bar';
    bar.innerHTML = '<span class="lry-md-badge">MD</span>'
      + '<span class="lry-md-title">Markdown 分栏编辑</span>'
      + '<span class="lry-md-tip">左侧源码 / 右侧富文本,实时同步</span>'
      + '<button type="button" class="lry-btn lry-md-layout-btn" title="切换并排/上下堆叠">⇕ 堆叠</button>'
      + '<button type="button" class="lry-btn lry-md-exit">退出分栏</button>';

    const pane = document.createElement('div');
    pane.className = 'lry-md-pane';
    /* 源码栏:gutter(每行「+」行柄)+ textarea(行高严格对齐 13px/1.7) */
    const srcwrap = document.createElement('div');
    srcwrap.className = 'lry-md-srcwrap';
    const gutter = document.createElement('div');
    gutter.className = 'lry-md-gutter';
    const ta = document.createElement('textarea');
    ta.className = 'lry-md-src';
    ta.spellcheck = false;
    ta.value = md;
    ta.placeholder = '# 标题\n\n**加粗**、`代码`、- 列表、> 引用、```代码块```、$公式$、==高亮==';
    srcwrap.appendChild(gutter);
    srcwrap.appendChild(ta);
    pane.appendChild(srcwrap);
    /* gutter 同步:行数重建 + 滚动跟随 */
    const syncGutter = () => {
      const lines = ta.value.split('\n').length;
      if (gutter.childElementCount !== lines) {
        gutter.textContent = '';
        for (let i = 0; i < lines; i++) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'lry-md-rowbtn';
          b.title = '行操作';
          b.textContent = '+';
          b.dataset.line = String(i);
          b.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSrcLineMenu(inst, ta, i, b);
          });
          gutter.appendChild(b);
        }
      }
      gutter.scrollTop = ta.scrollTop;
    };
    ta.addEventListener('input', syncGutter);
    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
    syncGutter();

    wrap.classList.add('lry-md-mode');
    contentEl.parentNode.insertBefore(bar, contentEl);
    contentEl.parentNode.insertBefore(pane, contentEl);
    pane.appendChild(contentEl); /* 预览栏 = 编辑器本体(移动不重载) */

    /* 布局记忆:<640px 默认堆叠,其余并排;可手动切换并记忆 */
    let stacked = (wrap.clientWidth < 640)
      ? localStorage.getItem(VIEW_KEY) !== 'side'
      : localStorage.getItem(VIEW_KEY) === 'stack';
    const layoutBtn = bar.querySelector('.lry-md-layout-btn');
    const applyView = () => {
      wrap.classList.toggle('lry-md-stack', stacked);
      layoutBtn.textContent = stacked ? '⇔ 并排' : '⇕ 堆叠';
    };
    layoutBtn.addEventListener('click', () => {
      stacked = !stacked;
      localStorage.setItem(VIEW_KEY, stacked ? 'stack' : 'side');
      applyView();
    });
    applyView();
    bar.querySelector('.lry-md-exit').addEventListener('click', () => exit());

    els = { bar, pane, ta, gutter, syncGutter, contentEl };

    /* 源码 → 预览 */
    ta.addEventListener('input', () => {
      srcDirty = true;
      convertFailNotified = false;
      if (timerSrc) clearTimeout(timerSrc);
      timerSrc = setTimeout(renderToPreview, 250);
    });

    /* 预览 → 源码(源码侧脏时预览不回写) */
    previewHandler = () => {
      if (suppressPreviewSync || !active || srcDirty) return;
      if (timerPrev) clearTimeout(timerPrev);
      timerPrev = setTimeout(previewToSource, 400);
    };
    inst.editor.on('update', previewHandler);

    active = true;
    ta.focus();
    return true;
  }

  function renderToPreview() {
    if (!active || !els) return;
    const html = safeMdToHtml(els.ta.value);
    if (html === null) {
      if (!convertFailNotified) {
        convertFailNotified = true;
        toast('Markdown 转换失败,本次修改未同步到预览(内容未受影响)', 'error');
      }
      return; /* 绝不动编辑器 */
    }
    applyBlockDiff(normalizeMermaidHtml(html));
    srcDirty = false;
    inst.sync();
  }

  function previewToSource() {
    if (!active || srcDirty || !els) return;
    const md = safeHtmlToMd(inst.editor.getHTML());
    if (md === null) return;
    const pos = els.ta.selectionStart;
    const atEnd = pos >= els.ta.value.length;
    els.ta.value = md;
    if (atEnd) els.ta.selectionStart = els.ta.selectionEnd = els.ta.value.length;
  }

  /* 顶层块差分:仅替换中间变动段 */
  function applyBlockDiff(newHtml) {
    const ed = inst.editor;
    const dom = new DOMParser().parseFromString('<body>' + newHtml + '</body>', 'text/html');
    const newBlocks = [...dom.body.children].map((el) => el.outerHTML);
    const serializer = DOMSerializer.fromSchema(ed.schema);
    const oldBlocks = [];
    ed.state.doc.forEach((node) => {
      const div = document.createElement('div');
      div.appendChild(serializer.serializeNode(node));
      oldBlocks.push(div.innerHTML);
    });
    let p = 0;
    while (p < oldBlocks.length && p < newBlocks.length && oldBlocks[p] === newBlocks[p]) p++;
    let s = 0;
    while (s < oldBlocks.length - p && s < newBlocks.length - p
      && oldBlocks[oldBlocks.length - 1 - s] === newBlocks[newBlocks.length - 1 - s]) s++;
    const from = posOfTopBlock(ed, p);
    const to = posOfTopBlockEnd(ed, oldBlocks.length - s);
    if (from === null || to === null) {
      suppressPreviewSync = true;
      ed.commands.setContent(newHtml);
      suppressPreviewSync = false;
      return;
    }
    if (p + s === oldBlocks.length && p + s === newBlocks.length) return; /* 无变化 */
    const mid = newBlocks.slice(p, newBlocks.length - s).join('');
    if (!mid && from === to) return;
    suppressPreviewSync = true;
    ed.chain().focus().insertContentAt({ from, to }, mid || '<p></p>').run();
    suppressPreviewSync = false;
  }
  function posOfTopBlock(ed, idx) {
    let pos = 0, i = 0, ok = true;
    ed.state.doc.forEach((node, offset) => {
      if (i === idx && ok) { pos = offset; ok = false; }
      i++;
    });
    return ok ? null : pos;
  }
  function posOfTopBlockEnd(ed, idx) {
    let pos = null, i = 0;
    ed.state.doc.forEach((node, offset) => {
      if (i === idx) pos = offset + node.nodeSize;
      i++;
    });
    return pos;
  }

  function flushMd() {
    if (!active || !srcDirty || !els) return true;
    if (timerSrc) clearTimeout(timerSrc);
    const html = safeMdToHtml(els.ta.value);
    if (html === null) {
      toast('Markdown 转换失败,源码栏最新修改未能应用', 'error');
      return false;
    }
    suppressPreviewSync = true;
    inst.editor.commands.setContent(normalizeMermaidHtml(html));
    suppressPreviewSync = false;
    srcDirty = false;
    return true;
  }

  function exit() {
    if (!active) return true;
    /* 转换失败时阻止退出:源码栏脏改动会随 DOM 销毁而丢 */
    if (!flushMd()) {
      toast('请先修复网络/加载问题后再退出,否则源码栏未同步内容将丢失', 'error');
      return false;
    }
    active = false;
    if (timerSrc) clearTimeout(timerSrc);
    if (timerPrev) clearTimeout(timerPrev);
    if (previewHandler) inst.editor.off('update', previewHandler);
    const wrap = inst.wrapper;
    const contentEl = els.contentEl;
    wrap.classList.remove('lry-md-mode', 'lry-md-stack');
    wrap.insertBefore(contentEl, els.pane); /* 放回 pane 前的原位 */
    if (els.bar.parentNode) els.bar.parentNode.removeChild(els.bar);
    if (els.pane.parentNode) els.pane.parentNode.removeChild(els.pane);
    els = null;
    inst.sync();
    return true;
  }

  inst.mdApi = {
    toggle: async () => {
      try {
        return active ? exit() : await enter();
      } catch (e) {
        console.error('[lry-editor] markdown 模式异常', e);
        toast('Markdown 模式异常:' + e.message, 'error');
        return false;
      }
    },
    isActive: () => active,
    flush: flushMd,
    importDialog: () => importMdDialog(inst),
    exportDialog: () => exportMdDialog(inst)
  };
  inst._mdFlush = flushMd;
}

/* ---------- 导入(粘贴/拖入 .md → 转换插入) ---------- */
export async function importMdDialog(inst) {
  const { dialog } = await import('../ui/dom.js');
  try { await ensureShowdown(); } catch (e) { toast('Markdown 组件不可用:' + e.message, 'error'); return; }
  const ta = document.createElement('textarea');
  ta.className = 'lry-input';
  ta.rows = 10;
  ta.placeholder = '粘贴 Markdown 文本…(也支持直接拖入 .md 文件)';
  dialog({
    title: '导入 Markdown', width: '620px',
    body: ta,
    okText: '转换插入',
    onOk(api) {
      const md = ta.value.trim();
      if (!md) { toast('请先粘贴内容', 'error'); return false; }
      const html = safeMdToHtml(md);
      if (html === null) { toast('转换失败,内容未插入', 'error'); return false; }
      inst.editor.chain().focus().insertContent(html).run();
      toast('已插入', 'success');
    }
  });
  ta.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.md$/i.test(f.name)) {
      e.preventDefault();
      f.text().then((t) => { ta.value = t; });
    }
  });
}

/* ---------- 导出(htmlToMarkdown → 下载) ---------- */
export async function exportMdDialog(inst) {
  const { dialog } = await import('../ui/dom.js');
  try { await ensureShowdown(); } catch (e) { toast('Markdown 组件不可用:' + e.message, 'error'); return; }
  const md = safeHtmlToMd(inst.getContent());
  if (md === null) { toast('内容转换失败', 'error'); return; }
  const ta = document.createElement('textarea');
  ta.className = 'lry-input';
  ta.rows = 12;
  ta.value = md;
  ta.readOnly = true;
  dialog({
    title: '导出 Markdown', width: '620px', okText: '下载 .md',
    body: ta,
    onOk() {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lry-export-' + new Date().toISOString().slice(0, 10) + '.md';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    cancelText: '关闭'
  });
  ta.addEventListener('click', ta.select);
}

/* ---------- md 源码行菜单(每行「+」:对源码行做 markdown 语法操作) ---------- */

function setLinePrefix(ta, line, prefix, replaceRe) {
  const lines = ta.value.split('\n');
  let t = lines[line];
  if (replaceRe) t = t.replace(replaceRe, '');
  lines[line] = prefix + t;
  writeBack(ta, lines, line);
}
function wrapLines(ta, from, to, open, close) {
  const lines = ta.value.split('\n');
  const inner = lines.slice(from, to + 1);
  const out = lines.slice(0, from)
    .concat([open], inner, [close])
    .concat(lines.slice(to + 1));
  writeBack(ta, out, from);
}
function writeBack(ta, lines, focusLine) {
  ta.value = lines.join('\n');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  /* 光标落回操作行 */
  const pos = lines.slice(0, focusLine).join('\n').length + (focusLine ? 1 : 0);
  ta.focus();
  ta.setSelectionRange(pos, pos);
}
export function openSrcLineMenu(inst, ta, line, anchor) {
  const cur = () => ta.value.split('\n')[line] || '';
  const wrapSingleton = (open, close) => () => wrapLines(ta, line, line, open, close);
  const insertBelow = (text) => () => {
    const lines = ta.value.split('\n');
    lines.splice(line + 1, 0, text);
    writeBack(ta, lines, line + 1);
  };

  const G = (t) => h('div', { class: 'lry-row-group' }, t);
  const I = (label, fn, hint) => h('button', { type: 'button', class: 'lry-menu-item', onclick: () => { closePopover(); try { fn(); } catch (e) { toast('操作失败:' + e.message, 'error'); } } },
    h('span', { class: 'lry-menu-text' }, label), hint ? h('span', { class: 'lry-menu-hint' }, hint) : null);

  const menu = h('div', { class: 'lry-menu lry-row-menu' },
    G('转换为(markdown 语法)'),
    [1, 2, 3, 4, 5, 6].map((lv) => I('标题 H' + lv, () => setLinePrefix(ta, line, '#'.repeat(lv) + ' ', /^#{1,6}\s+/), '#'.repeat(lv))),
    I('高亮块·信息', wrapSingleton(':::info', ':::'), ':::info'),
    I('高亮块·成功', wrapSingleton(':::success', ':::'), ':::success'),
    I('高亮块·警示', wrapSingleton(':::warning', ':::'), ':::warning'),
    I('高亮块·危险', wrapSingleton(':::danger', ':::'), ':::danger'),
    I('引用', () => setLinePrefix(ta, line, '> ', /^>\s?/), '>'),
    I('无序列表', () => setLinePrefix(ta, line, '- ', /^[-*]\s+/), '-'),
    I('有序列表', () => setLinePrefix(ta, line, '1. ', /^\d+\.\s+/), '1.'),
    I('任务列表', () => setLinePrefix(ta, line, '- [ ] ', /^- \[[ xX]?\]\s+/), '- [ ]'),
    I('代码块', wrapSingleton('```', '```'), '```'),
    I('公式(块级)', wrapSingleton('$$', '$$'), '$$'),

    G('操作'),
    I('复制行', async () => { try { await navigator.clipboard.writeText(cur()); toast('已复制该行', 'success'); } catch (e) { toast('复制失败', 'error'); } }),
    I('剪切行', async () => { try { await navigator.clipboard.writeText(cur()); } catch (e) { /* 仍执行 */ } const lines = ta.value.split('\n'); lines.splice(line, 1); writeBack(ta, lines, Math.max(0, line - 1)); toast('已剪切', 'success'); }),
    I('删除行', () => { const lines = ta.value.split('\n'); lines.splice(line, 1); writeBack(ta, lines, Math.max(0, line - 1)); }),
    I('增加缩进', () => setLinePrefix(ta, line, '  ', /^\s{0,2}(?=\S)/)),
    I('减少缩进', () => { const lines = ta.value.split('\n'); lines[line] = lines[line].replace(/^ {1,2}/, ''); writeBack(ta, lines, line); }),

    G('插入(下方)'),
    I('分割线', insertBelow('---'), '---'),
    I('表格', insertBelow('| 列1 | 列2 |\n| --- | --- |\n|  |  |'), '| |'),
    I('画板(流程图)', insertBelow('```mermaid\ngraph TD\nA[开始] --> B{条件?}\nB -->|是| C[处理]\nB -->|否| D[结束]\n```'), 'mermaid'),
    I('思维导图', insertBelow('```mermaid\nmindmap\n  根主题\n    分支一\n      要点\n```'), 'mindmap'),
    I('UML 类图', insertBelow('```mermaid\nclassDiagram\nclass 文章 {\n  +标题\n}'), 'uml')
  );
  popover(anchor, menu, { className: 'lry-row-pop' });
}
