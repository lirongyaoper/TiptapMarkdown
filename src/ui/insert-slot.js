/**
 * 行柄「插入」的落位规则(2026-11-24):
 * - 当前块是空段落 → 新内容原位替换它(上方不留一个空行;Notion/语雀在空行上插入块即如此)
 * - 否则插在当前块之后
 * - 块级内容落在文末 → 其后补一个空段落、光标放进去:插完直接继续写,不必再找出口
 *   (公式/画板/分割线这类原子块自身放不进光标)
 * 供行柄菜单与公式对话框(行柄入口)共用。
 */
import { TextSelection } from '@tiptap/pm/state';

export function isBlankParagraph(node) {
  return !!node && node.type.name === 'paragraph' && node.content.size === 0;
}

/** 写入区间:空段落原位替换,否则紧随其后 */
export function slotRange(node, pos) {
  return isBlankParagraph(node) ? { from: pos, to: pos + node.nodeSize } : { from: pos + node.nodeSize, to: pos + node.nodeSize };
}

/**
 * 块级节点已写到 [at, at+size) 后安排光标:文末块 → 补空段落并落进去;否则落到其后第一个文本位置。
 * 调用方在同一个 tr 上先完成写入再调用。
 */
export function settleAfterBlock(tr, at, size) {
  const end = at + size;
  if (end >= tr.doc.content.size) {
    tr.insert(tr.doc.content.size, tr.doc.type.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1), 1));
  }
}
