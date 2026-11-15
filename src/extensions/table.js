/**
 * 表格扩展:官方 TableKit 之上加存量属性透传(width/border/cellspacing/
 * cellpadding/style 于 table;width/style 于 td/th)。
 * 这些是真 HTML 属性(非 style 组合),attr 名即属性名,自动 parse/render。
 */
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';

const passthrough = (attrs) => {
  const spec = {};
  attrs.forEach((a) => {
    spec[a] = { default: null, parseHTML: (el) => el.getAttribute(a) };
  });
  return spec;
};

export const LryTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...passthrough(['width', 'border', 'cellspacing', 'cellpadding', 'style'])
    };
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
