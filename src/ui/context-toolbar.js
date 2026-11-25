/**
 * 上下文工具条(2026-11-23 v1.2.0)。
 *
 * 划词 bubble 管"文本选区格式",这里管"节点态":光标落在链接内 / 选中图片 /
 * 选中公式 / 光标或单元格选区在表格内时,在锚点上方浮现对应操作条。单例条按上下文切换
 * 按钮组,三态天然互斥不叠层;readonly 态不装配。
 * - 链接条:点击链接或光标在链接内 → 网址 · 打开 · 编辑 · 复制 · 移除
 * - 图片条:对齐(默认/左浮/居中/右浮)· 宽度 25/50/75/100% · 说明 · 替换 · 删除;
 *   双击图片进入图片编辑对话框
 * - 公式条(2026-11-24):编辑 · 行内/块级切换 · 删除;双击公式或选中后回车进入公式对话框
 * - 表格条:上/下插行 · 左/右插列 · 删行/删列 · 合并/拆分 · 表头行 · 背景色 · 对齐
 *
 * 定位取原生 getBoundingClientRect / coordsAtPos(fixed 坐标);无布局环境(jsdom)
 * 锚点矩形为空则不显示——判定与按钮行为均为纯函数,单测不依赖定位。
 */
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { h, dialog, field, textField, toast, fixedTopInset } from './dom.js';
import { ICONS } from './icons.js';
import { DIALOGS, openImageDialog } from './dialogs.js';
import { openColorPanel } from './color.js';
import { setCellBackground } from './table-ops.js';
import { uploadFile } from '../upload.js';
import { MATH_TYPES } from './math-nodeview.js';
import { openFormulaDialog, setMathForm } from './formula.js';

/* ---------------- 判定(纯函数) ---------------- */

/** 光标所在的连续链接区间:[from,to] 含两端边界;不在文本块或不在链接上返回 null */
export function linkSegmentAt($pos) {
  const parent = $pos.parent;
  if (!parent || !parent.isTextblock) return null;
  const off = $pos.parentOffset;
  const base = $pos.start();
  const segs = [];
  let cur = null;
  parent.forEach((child, offset) => {
    const mark = child.marks && child.marks.find((m) => m.type.name === 'link');
    if (mark) {
      const end = base + offset + child.nodeSize;
      if (cur) cur.to = end;
      else {
        cur = { from: base + offset, to: end, href: (mark.attrs && mark.attrs.href) || '' };
        segs.push(cur);
      }
    } else cur = null;
  });
  /* 优先严格包含(光标在链接文字中间),其次边界相邻 */
  let adj = null;
  for (const s of segs) {
    if (off > s.from - base && off < s.to - base) return s;
    if (off >= s.from - base && off <= s.to - base && !adj) adj = s;
  }
  return adj;
}

function tablePosOf($from) {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') return $from.before(d);
  }
  return null;
}

/* 节点的 DOM 外壳 → 文档位置(双击图片/公式时反查) */
function posOfNodeDom(ed, el) {
  let pos = null;
  ed.state.doc.descendants((n, p) => { if (pos === null && ed.view.nodeDOM(p) === el) pos = p; });
  return pos;
}

/** 返回 { type:'image'|'math'|'link'|'table', ...锚点信息 } 或 null */
export function resolveContext(ed) {
  const { selection } = ed.state;
  if (selection instanceof NodeSelection) {
    const name = selection.node.type.name;
    if (name === 'image') return { type: 'image', pos: selection.from };
    if (MATH_TYPES.indexOf(name) >= 0) return { type: 'math', pos: selection.from };
    return null;
  }
  if (selection.empty) {
    const seg = linkSegmentAt(selection.$from);
    if (seg) return { type: 'link', from: seg.from, to: seg.to, href: seg.href };
  }
  const tp = tablePosOf(selection.$from);
  if (tp !== null && (selection instanceof CellSelection || selection.empty)) {
    return { type: 'table', pos: tp };
  }
  return null;
}

/* ---------------- 按钮组 ---------------- */

function imageMetrics(inst) {
  const ed = inst.editor;
  const sel = ed.state.selection;
  const node = sel instanceof NodeSelection ? sel.node : null;
  const dom = node ? ed.view.nodeDOM(sel.from) : null;
  const img = dom && dom.querySelector ? dom.querySelector('img') : null;
  /* 可用宽度 = 编辑区 clientWidth 减去左右内边距(含行柄「+」占的 30px 左内边距) */
  const content = inst.wrapper.querySelector('.lry-editor-content');
  const pm = content && content.querySelector('.ProseMirror');
  let cw = 0;
  if (pm && pm.clientWidth) {
    const cs = (pm.ownerDocument.defaultView || window).getComputedStyle(pm);
    cw = pm.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }
  /* 无布局环境(jsdom)回落 */
  if (!cw) cw = Math.max(240, (inst.wrapper.clientWidth || 0) - 2) || 800;
  let ratio = null;
  if (img && img.naturalWidth) ratio = img.naturalHeight / img.naturalWidth;
  else if (node && node.attrs.width && node.attrs.height) {
    ratio = parseInt(node.attrs.height, 10) / parseInt(node.attrs.width, 10);
  }
  return { cw, ratio };
}

function imageTools(inst) {
  const ed = inst.editor;
  const node = () => {
    const s = ed.state.selection;
    return s instanceof NodeSelection && s.node.type.name === 'image' ? s.node : null;
  };
  /* 写属性后在同一事务里恢复节点选中:PM 在"被选中节点被替换"时会把 NodeSelection
     降级成光标,不恢复的话点一次按钮图片就脱离选中、上下文条消失,无法连续操作 */
  const set = (patch) => {
    const pos = ed.state.selection.from;
    return ed.chain().updateAttributes('image', patch).setNodeSelection(pos).run();
  };
  const alignOf = () => {
    const n = node();
    return n ? (n.attrs.float || (n.attrs.center ? 'center' : '')) : null;
  };
  /* 宽度预设 = 编辑区宽度的百分比(25/50/75/100%),不按原图宽封顶——封顶会让小图的
     50% 与 75% 算出同一个值而同时"激活"。回显按实际显示宽度判断:未显式设宽时取渲染宽度 */
  const displayedWidth = () => {
    const n = node();
    if (!n) return 0;
    const w = parseInt(n.attrs.width, 10);
    if (w) return w;
    const dom = ed.view.nodeDOM(ed.state.selection.from);
    const img = dom && dom.querySelector ? dom.querySelector('img') : null;
    return img ? Math.round(img.getBoundingClientRect().width) : 0;
  };
  const sizeTarget = (pct) => Math.max(40, Math.round(imageMetrics(inst).cw * pct));
  const applySize = (pct) => {
    const w = sizeTarget(pct);
    const ratio = imageMetrics(inst).ratio;
    set({ width: String(w), height: ratio ? String(Math.round(w * ratio)) : null });
  };
  const sizeActive = (pct) => Math.abs(displayedWidth() - sizeTarget(pct)) <= 2;
  const replace = () => {
    const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      toast('上传中…');
      try {
        const r = await uploadFile(f, { filetype: 1, module: inst.options.module }, inst);
        set({ src: r.url });
        toast('图片已替换', 'success');
      } catch (e) { toast(e.message, 'error'); }
    });
    inst.wrapper.appendChild(input);
    input.click();
  };
  const caption = () => {
    const n = node();
    const altIn = textField('替代文本(读屏/图裂时显示)', n ? n.attrs.alt || '' : '');
    const titleIn = textField('描述(鼠标悬停提示)', n ? n.attrs.title || '' : '');
    dialog({
      title: '图片说明', width: '420px',
      body: h('div', null, field('替代文本', altIn), field('描述', titleIn)),
      onOk() { set({ alt: altIn.value.trim() || null, title: titleIn.value.trim() || null }); }
    });
  };
  return [
    { icon: 'imagenone', title: '默认(不浮动)', active: () => alignOf() === '', run: () => set({ float: null, center: false }) },
    { icon: 'imageleft', title: '左浮动', active: () => alignOf() === 'left', run: () => set({ float: 'left', center: false }) },
    { icon: 'imagecenter', title: '居中', active: () => alignOf() === 'center', run: () => set({ float: null, center: true }) },
    { icon: 'imageright', title: '右浮动', active: () => alignOf() === 'right', run: () => set({ float: 'right', center: false }) },
    '|',
    { label: '25%', title: '宽度 25%', active: () => sizeActive(0.25), run: () => applySize(0.25) },
    { label: '50%', title: '宽度 50%', active: () => sizeActive(0.5), run: () => applySize(0.5) },
    { label: '75%', title: '宽度 75%', active: () => sizeActive(0.75), run: () => applySize(0.75) },
    { label: '100%', title: '宽度 100%', active: () => sizeActive(1), run: () => applySize(1) },
    '|',
    { icon: 'caption', title: '说明文字', run: caption },
    { icon: 'upload', title: '替换图片', run: replace },
    { icon: 'trash', title: '删除图片', run: () => ed.chain().deleteSelection().run() }
  ];
}

function linkTools(inst, ctx) {
  const ed = inst.editor;
  const href = ctx.href || '';
  return [
    { href, label: href || '(空链接)', title: '在新标签页打开:' + href },
    '|',
    { icon: 'edit', title: '编辑链接 (Ctrl+K)', run: () => DIALOGS.link(inst) },
    {
      icon: 'copy', title: '复制地址', run: () => {
        const done = () => toast('地址已复制', 'success');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(href).then(done, () => toast('复制失败', 'error'));
        } else toast('当前环境不支持自动复制', 'error');
      }
    },
    { icon: 'unlink', title: '移除链接', run: () => ed.chain().extendMarkRange('link').unsetLink().run() }
  ];
}

/* 公式条(2026-11-24):编辑 / 行内↔块级切换 / 删除。切换后保持节点选中,可连续操作 */
function mathTools(inst) {
  const ed = inst.editor;
  const isBlock = () => {
    const s = ed.state.selection;
    return s instanceof NodeSelection && s.node.type.name === 'lryMathBlock';
  };
  return [
    { icon: 'edit', title: '编辑公式 (双击或回车)', run: () => openFormulaDialog(inst) },
    '|',
    { label: '行内', title: '切换为行内公式', active: () => !isBlock(), run: () => setMathForm(ed, false) },
    { label: '块级', title: '切换为块级公式', active: () => isBlock(), run: () => setMathForm(ed, true) },
    '|',
    { icon: 'trash', title: '删除公式', run: () => ed.chain().deleteSelection().run() }
  ];
}

function inHeaderRow(state) {
  const { $from } = state.selection;
  const tp = tablePosOf($from);
  if (tp === null) return false;
  const table = state.doc.nodeAt(tp);
  const row = table && table.firstChild;
  return !!(row && row.firstChild && row.firstChild.type.name === 'tableHeader');
}

function alignOfCell(state) {
  const { $from } = state.selection;
  return ($from.parent.attrs && $from.parent.attrs.align) || null;
}

function tableTools(inst) {
  const ed = inst.editor;
  const align = (v) => () => ed.chain().focus().setBlockStyle('align', v).run();
  return [
    { icon: 'insertrow', title: '上方插入行', flip: true, run: () => ed.chain().addRowBefore().run() },
    { icon: 'insertrow', title: '下方插入行', run: () => ed.chain().addRowAfter().run() },
    '|',
    { icon: 'insertcol', title: '左侧插入列', flip: true, run: () => ed.chain().addColumnBefore().run() },
    { icon: 'insertcol', title: '右侧插入列', run: () => ed.chain().addColumnAfter().run() },
    '|',
    { icon: 'deleterow', title: '删除行', run: () => ed.chain().deleteRow().run() },
    { icon: 'deletecol', title: '删除列', run: () => ed.chain().deleteColumn().run() },
    '|',
    {
      icon: 'mergecells', title: '合并单元格(选中多个单元格后可合并;再点拆分)',
      active: () => ed.state.selection instanceof CellSelection && ed.state.selection.selectedCellCount > 1,
      run: () => ed.chain().mergeOrSplit().run()
    },
    { icon: 'tableheader', title: '表头行开关', active: () => inHeaderRow(ed.state), run: () => ed.chain().toggleHeaderRow().run() },
    { icon: 'forecolor', title: '单元格背景色', run: (e, i, btn) => openColorPanel(btn, 'cell', i) },
    '|',
    { icon: 'alignleft', title: '左对齐', active: () => alignOfCell(ed.state) === 'left', run: align('left') },
    { icon: 'aligncenter', title: '居中对齐', active: () => alignOfCell(ed.state) === 'center', run: align('center') },
    { icon: 'alignright', title: '右对齐', active: () => alignOfCell(ed.state) === 'right', run: align('right') },
    '|',
    { icon: 'edit', title: '表格属性', run: () => DIALOGS.edittable(inst) }
  ];
}

/* ---------------- 装配 ---------------- */

function anchorRect(ed, ctx) {
  try {
    const view = ed.view;
    if (ctx.type === 'link') {
      const a = view.coordsAtPos(ctx.from);
      const b = view.coordsAtPos(ctx.to);
      const sameLine = Math.abs(a.top - b.top) < 6;
      const right = sameLine ? b.right : Math.min(a.left + 240, window.innerWidth - 8);
      return { top: a.top, bottom: a.bottom, left: a.left, right, width: right - a.left, height: a.bottom - a.top };
    }
    const dom = view.nodeDOM(ctx.pos);
    return dom && typeof dom.getBoundingClientRect === 'function' ? dom.getBoundingClientRect() : null;
  } catch (e) { return null; }
}

/** 按上下文取按钮组(工具条渲染与回归测试共用) */
export function contextTools(inst, ctx) {
  if (ctx.type === 'image') return imageTools(inst);
  if (ctx.type === 'math') return mathTools(inst);
  if (ctx.type === 'link') return linkTools(inst, ctx);
  return tableTools(inst);
}

/**
 * 装配上下文工具条;返回清理函数(宿主 destroy 时调用)。
 * inst._ctxApi = { visible(), type() } 供划词 bubble 抑制等外部判断
 */
export function mountContextToolbar(inst) {
  const ed = inst.editor;
  const bar = h('div', { class: 'lry-ctxbar' });
  /* 按钮按下不抢焦点、不丢选区 */
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.style.display = 'none';
  (inst.options.doc || document).body.appendChild(bar);

  let ctxType = null;
  let tools = [];
  let shown = false;
  let clickedLink = false;
  let lastHref = null;

  const hide = () => {
    if (shown) bar.style.display = 'none';
    shown = false;
  };

  const rebuild = (ctx) => {
    ctxType = ctx.type;
    lastHref = ctx.type === 'link' ? ctx.href : null;
    bar.textContent = '';
    tools = contextTools(inst, ctx);
    tools.forEach((t) => {
      if (t === '|') { bar.appendChild(h('span', { class: 'lry-bubble-sep' })); return; }
      let btn;
      if (t.href !== undefined) {
        btn = h('a', {
          class: 'lry-ctx-link', href: t.href || '#', title: t.title,
          onclick: (e) => {
            e.preventDefault();
            if (t.href) window.open(t.href, '_blank', 'noopener');
          }
        }, t.label);
      } else {
        btn = h('button', {
          type: 'button', class: 'lry-bubble-btn' + (t.label ? ' lry-ctx-txt' : '') + (t.flip ? ' lry-ctx-flip' : ''),
          title: t.title || t.label,
          disabled: t.disabled || false,
          onclick: (e) => {
            e.preventDefault();
            try { t.run(ed, inst, btn); } catch (err) { console.error('[lry-editor] 上下文工具条命令异常', err); toast('操作失败:' + err.message, 'error'); }
          }
        }, t.icon ? h('span', { class: 'lry-bubble-icon', html: ICONS[t.icon] || '' }) : null, t.label ? h('span', null, t.label) : null);
      }
      t._btn = btn;
      bar.appendChild(btn);
    });
  };

  const syncActive = () => tools.forEach((t) => {
    if (!t._btn || !t.active) return;
    let on = false;
    try { on = !!t.active(); } catch (e) { on = false; }
    t._btn.classList.toggle('lry-bubble-on', on);
  });

  const place = (rect) => {
    bar.style.display = 'flex';
    const bw = bar.offsetWidth || 260;
    const bh = bar.offsetHeight || 34;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left + Math.min(rect.width, 600) / 2 - bw / 2;
    left = Math.max(8, Math.min(left, vw - bw - 8));
    /* 不得盖住工具栏与站点固定页头:上边界取两者下沿的较大值 */
    const content = inst.wrapper.querySelector('.lry-editor-content');
    const minTop = Math.max(8, fixedTopInset() + 4, content ? content.getBoundingClientRect().top + 4 : 8);
    let top = rect.top - bh - 8;
    if (top < minTop) {
      /* 上方放不下:矮锚点(链接文字)翻到锚点下方;高锚点(图片/表格)压在锚点顶边内侧,
         表格顶边滚出视口时贴编辑区顶边 */
      const below = rect.bottom + 8;
      top = rect.height <= 80 && below + bh <= vh - 8 ? below : Math.max(minTop, rect.top);
    }
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
  };

  const update = () => {
    const ctx = resolveContext(ed);
    if (!ctx || ctx.type !== 'link') clickedLink = false;
    let show = !!ctx && ed.isFocused;
    if (show && ctx.type === 'link' && !clickedLink) {
      const { from } = ed.state.selection;
      if (!(from > ctx.from && from < ctx.to)) show = false; /* 仅停在链接端点:不弹 */
    }
    if (!show) { hide(); return; }
    if (ctx.type !== ctxType || (ctx.type === 'link' && ctx.href !== lastHref)) rebuild(ctx);
    const rect = anchorRect(ed, ctx);
    if (!rect || (!rect.width && !rect.height) || rect.bottom < 0 || rect.top > window.innerHeight) { hide(); return; }
    syncActive();
    place(rect);
    shown = true;
  };

  const onDown = (e) => { clickedLink = !!(e.target.closest && e.target.closest('a[href]')); };
  const onDblClick = (e) => {
    /* 公式:双击进入公式对话框(KaTeX 渲染后的内部结构任意一处双击均可) */
    const math = e.target.closest && e.target.closest('.lry-math');
    if (math && inst.options.readonly !== true && ed.view.dom.contains(math)) {
      const pos = posOfNodeDom(ed, math);
      if (pos !== null) { ed.chain().setNodeSelection(pos).run(); openFormulaDialog(inst); }
      return;
    }
    const img = e.target.closest && e.target.closest('img');
    if (!img || inst.options.readonly === true) return;
    const wrap = img.closest('.lry-imgwrap') || img;
    const dom = ed.view.dom;
    if (!dom.contains(wrap)) return;
    const pos = posOfNodeDom(ed, wrap);
    if (pos === null) return;
    ed.chain().setNodeSelection(pos).run();
    openImageDialog(inst, { edit: true });
  };
  const reposition = () => { if (shown) update(); };

  ed.on('selectionUpdate', update);
  ed.on('transaction', update);
  ed.on('blur', hide);
  ed.view.dom.addEventListener('mousedown', onDown);
  ed.view.dom.addEventListener('touchstart', onDown, { passive: true });
  ed.view.dom.addEventListener('dblclick', onDblClick);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);

  inst._ctxApi = {
    visible: () => shown,
    type: () => ctxType,
    /* 划词 bubble 抑制判定(无状态,实时算,避免事件先后造成的滞后) */
    isImageSelected: () => {
      const c = resolveContext(ed);
      return !!(c && c.type === 'image' && ed.isFocused);
    },
    isMathSelected: () => {
      const c = resolveContext(ed);
      return !!(c && c.type === 'math' && ed.isFocused);
    }
  };
  return () => {
    ed.off('selectionUpdate', update);
    ed.off('transaction', update);
    ed.off('blur', hide);
    ed.view.dom.removeEventListener('mousedown', onDown);
    ed.view.dom.removeEventListener('touchstart', onDown);
    ed.view.dom.removeEventListener('dblclick', onDblClick);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  };
}

export { setCellBackground };
