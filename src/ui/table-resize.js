/**
 * 表格列宽拖拽(2026-11-23 v1.2.0)。
 *
 * 每个单元格右内侧渲染一个列边界手柄(widget decoration 置于单元格内容末尾,
 * CSS 绝对定位压在右边框上);拖拽期间只改 DOM 行内宽度做实时预览,松手后单事务
 * 把该列各单元格的 width 属性写成像素整数,并清除预览样式。
 *
 * 宽度走 td/th 的 width 属性(存量 UEditor 同形态;服务端 rich 白名单已放行),
 * 不用官方 resizable 的 colgroup/colwidth——那会改变表格序列化契约(roundtrip 门)。
 * 右边界恰为被拖拽边界的跨列单元格:有数值宽度的按同增量调整,否则跳过。
 * 手柄事件经 handleDOMEvents 接管(返回 true = PM 不再处理,选区不丢)。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { TableMap } from '@tiptap/pm/tables';

const MIN_W = 40;
const MAX_W = 2400;
const key = new PluginKey('lryTableColResize');

function buildHandles(doc) {
  const decos = [];
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.type.name !== 'table') return true;
    const map = TableMap.get(node);
    node.forEach((row, roff, r) => {
      let col = 0;
      row.forEach((cell, coff) => {
        const rightCol = col + (cell.attrs.colspan || 1) - 1;
        col += cell.attrs.colspan || 1;
        if (rightCol >= map.width - 1) return; /* 表格最右边界不设手柄 */
        decos.push(Decoration.widget(
          pos + 1 + roff + coff + cell.nodeSize - 1,
          (view, getPos) => { const el = makeHandle(); el.__lryGetPos = getPos; return el; },
          { side: 1, ignoreSelection: true, key: 'lrycol:' + pos + ':' + r + ':' + rightCol }
        ));
      });
    });
    return false; /* 不下钻(嵌套表格不支持列宽) */
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

function makeHandle() {
  const el = document.createElement('div');
  el.className = 'lry-col-resize';
  el.title = '拖拽调整列宽';
  el.contentEditable = 'false';
  return el;
}

function containsTable(doc) {
  let found = false;
  doc.nodesBetween(0, doc.content.size, (node) => {
    if (node.type.name === 'table') { found = true; return false; }
    return true;
  });
  return found;
}

/* widgetPos = 手柄所在单元格的内容末尾位置 */function startDrag(view, event, widgetPos) {
  if (event.button !== 0) return;
  const state = view.state;
  const $w = state.doc.resolve(widgetPos);
  /* 手柄位于单元格内容末尾:光标解析落在最内层块(单元格内的段落)上,
     需沿祖先链找出单元格本体,不能假定固定深度 */
  let cellDepth = 0;
  for (let d = $w.depth; d > 0; d--) {
    const role = $w.node(d).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') { cellDepth = d; break; }
  }
  if (cellDepth < 3) return;
  const table = $w.node(cellDepth - 2);
  if (table.type.name !== 'table') return;
  const tableStart = $w.before(cellDepth - 2) + 1;
  const anchorCellPos = $w.before(cellDepth);
  const map = TableMap.get(table);
  const rect = map.findCell(anchorCellPos - tableStart);
  if (!rect) return;
  const col = rect.right - 1;
  if (col < 0 || col >= map.width - 1) return;

  /* 各行中右边界落在该边界上的单元格 */
  const targets = [];
  for (let r = 0; r < map.height; r++) {
    const cOff = map.map[r * map.width + col];
    const cr = map.findCell(cOff);
    if (!cr || cr.right !== col + 1) continue;
    const cellPos = tableStart + cOff;
    const node = state.doc.nodeAt(cellPos);
    const dom = view.nodeDOM(cellPos);
    if (!node || !dom || typeof dom.getBoundingClientRect !== 'function') continue;
    targets.push({
      pos: cellPos, node, dom,
      startW: dom.getBoundingClientRect().width,
      sameSpan: cr.left === rect.left,
      numeric: parseInt(node.attrs.width, 10) || 0
    });
  }
  const anchor = targets.find((t) => t.pos === anchorCellPos);
  if (!anchor) return;
  const anchorW = anchor.startW || anchor.numeric || MIN_W;
  const startX = event.clientX;
  let lastW = anchorW;
  let done = false;

  const preview = (w) => {
    const delta = w - anchorW;
    targets.forEach((t) => {
      t.dom.style.width = (t.sameSpan ? w : Math.max(MIN_W, t.startW + delta)) + 'px';
    });
  };
  const move = (ev) => {
    lastW = Math.max(MIN_W, Math.min(MAX_W, Math.round(anchorW + ev.clientX - startX)));
    preview(lastW);
  };
  const up = () => {
    if (done) return;
    done = true;
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    view.dom.classList.remove('lry-col-resizing');
    targets.forEach((t) => { t.dom.style.width = ''; });
    const tr = view.state.tr;
    const delta = lastW - anchorW;
    let changed = false;
    targets.forEach((t) => {
      const node = tr.doc.nodeAt(t.pos);
      if (!node) return;
      let width;
      if (t.sameSpan) width = lastW;
      else if (t.numeric) width = Math.max(MIN_W, t.numeric + delta);
      else return;
      width = String(width);
      if (width !== node.attrs.width) {
        tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, width });
        changed = true;
      }
    });
    if (changed) view.dispatch(tr);
  };
  view.dom.classList.add('lry-col-resizing');
  preview(anchorW);
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

export function tableResizePlugin() {
  return new Plugin({
    key,
    state: {
      init: (_, state) => (containsTable(state.doc) ? buildHandles(state.doc) : DecorationSet.empty),
      apply(tr, value) {
        if (!tr.docChanged) return value;
        return containsTable(tr.doc) ? buildHandles(tr.doc) : DecorationSet.empty;
      }
    },
    props: {
      decorations(state) { return key.getState(state); },
      handleDOMEvents: {
        mousedown(view, event) {
          if (!view.editable) return false; /* 只读态不接管:手柄不可拖 */
          const t = event.target;
          if (!t || !t.classList || !t.classList.contains('lry-col-resize')) return false;
          const getPos = t.__lryGetPos;
          if (!getPos) return false;
          let pos = null;
          try { pos = getPos(); } catch (e) { pos = null; }
          if (typeof pos !== 'number') return false;
          startDrag(view, event, pos);
          return true;
        }
      }
    }
  });
}
