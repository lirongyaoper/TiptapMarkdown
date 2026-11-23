/**
 * 表格单元格样式操作(2026-11-23 v1.2.0)。
 *
 * 背景色走 style 属性而非 bgcolor:style 的 background-color/text-align 在服务端
 * rich 白名单(lry_safe_css)内,论坛发帖保存后存活;bgcolor 属性会被 remove_xss
 * 剥掉。存量 bgcolor 属性仅保留解析兼容,不再作为写入形态。
 * 单元格内容对齐复用段落级 setBlockStyle('align')(序列化为 p 的 text-align)。
 */
import { styleToObj, objToStyle } from '../extensions/blocks.js';

export function mergeCellStyle(attrs, patch) {
  const obj = styleToObj(attrs.style);
  Object.keys(patch).forEach((k) => {
    if (patch[k]) obj[k] = patch[k];
    else delete obj[k];
  });
  return objToStyle(obj) || null;
}

const isCell = (n) => n.type.name === 'tableCell' || n.type.name === 'tableHeader';

/**
 * 选区内(光标所在/单元格选区覆盖)的全部单元格设置样式。
 * @param {object} patch { 'background-color': '#fff3cd' | null }
 */
export function setCellStyle(ed, patch) {
  return ed.chain().focus().command(({ state, tr }) => {
    let touched = false;
    state.doc.nodesBetween(state.selection.from, state.selection.to, (n, pos) => {
      if (!isCell(n)) return;
      const style = mergeCellStyle(n.attrs, patch);
      if (style !== (n.attrs.style || null)) {
        tr.setNodeMarkup(pos, undefined, { ...n.attrs, style });
        touched = true;
      }
    });
    return touched;
  }).run();
}

export function setCellBackground(ed, color) {
  return setCellStyle(ed, { 'background-color': color || null });
}

/** 光标所在单元格的背景色(style 优先,存量 bgcolor 兜底);不在表格内返回 null */
export function cellBackgroundAt(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (!isCell(n)) continue;
    const bg = styleToObj(n.attrs.style)['background-color'];
    return bg || n.attrs.bgcolor || null;
  }
  return null;
}
