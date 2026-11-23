/**
 * 表格扩展:官方 TableKit 之上加存量属性透传(width/border/cellspacing/
 * cellpadding/style 于 table;width/style 于 td/th)。
 * 这些是真 HTML 属性(非 style 组合),attr 名即属性名,自动 parse/render。
 * LryTableResize(2026-11-23):列宽拖拽,写 td/th 的 width 属性(实现见 ui/table-resize.js)。
 */
import { Extension } from '@tiptap/core';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { tableResizePlugin } from '../ui/table-resize.js';

const passthrough = (attrs) => {
  const spec = {};
  attrs.forEach((a) => {
    spec[a] = { default: null, parseHTML: (el) => el.getAttribute(a) };
  });
  return spec;
};

export const LryTableResize = Extension.create({
  name: 'lryTableResize',
  addProseMirrorPlugins() {
    return [tableResizePlugin()];
  }
});

export const LryTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...passthrough(['width', 'border', 'cellspacing', 'cellpadding', 'style'])
    };
  },
  addKeyboardShortcuts() {
    const base = this.parent?.() || {};
    /* Tab / Shift+Tab 在单元格内的代码块里让位给代码块缩进(官方 Tab 默认跳格,
       会抢在代码块扩展之前处理;常规单元格内行为不变) */
    const inCode = () => {
      const { $from } = this.editor.state.selection;
      return !!($from.parent.type && $from.parent.type.spec.code);
    };
    const guard = (fn) => () => (typeof fn === 'function' && !inCode() ? fn() : false);
    return { ...base, Tab: guard(base.Tab), 'Shift-Tab': guard(base['Shift-Tab']) };
  }
});

export const LryTableRow = TableRow;

export const LryTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...passthrough(['width', 'style', 'bgcolor']) };
  }
});

export const LryTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...passthrough(['width', 'style', 'bgcolor']) };
  }
});
