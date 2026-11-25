/**
 * 工具栏:90 按钮全量注册(对齐旧 UEditor 默认工具栏),含下拉组。
 * toolbarConfig 为 [['cmd'|'cmd:arg'|'|', …]] 二维数组(多行)。
 */
import { h, popover, closePopover, toast } from './dom.js';
import { CellSelection } from '@tiptap/pm/tables';
import { ICONS } from './icons.js';
import { FONTS, FONT_SIZES, LINE_HEIGHTS, LETTER_SPACINGS, ROW_SPACINGS, CODE_LANGS } from '../config.js';
import { DIALOGS } from './dialogs.js';
import { openColorPanel } from './color.js';
import { openEmojiPicker } from './emoji.js';
import { openFormulaDialog } from './formula.js';
import { openScrawlDialog } from './scrawl.js';
import { typesetDoc, TYPESET_DEFAULTS } from './autotypeset.js';
import { openExportMenu } from './exporters.js';

/* ---------- 命令实现 ---------- */
function indentBlock(ed, dir) {
  const { state } = ed;
  const { from, to } = state.selection;
  /* 列表内:升降级列表项(taskItem 用对类型,错类型静默失败) */
  let itemTypeName = null;
  state.doc.nodesBetween(from, to, (n) => {
    if (n.type.name === 'taskItem') itemTypeName = 'taskItem';
    else if (n.type.name === 'listItem' && itemTypeName !== 'taskItem') itemTypeName = 'listItem';
  });
  if (itemTypeName) return dir > 0 ? ed.chain().focus().sinkListItem(itemTypeName).run() : ed.chain().focus().liftListItem(itemTypeName).run();
  /* 段落:margin-left 步进 2em */
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.type.name === 'paragraph') {
      const cur = parseFloat(n.attrs.indentLeft) || 0;
      const next = Math.max(0, Math.min(10, cur + dir * 2));
      tr.setNodeMarkup(pos, null, { ...n.attrs, indentLeft: next ? next + 'em' : null });
    }
  });
  if (tr.docChanged) ed.view.dispatch(tr);
  return tr.docChanged;
}

function transformCase(ed, upper) {
  const { state } = ed;
  const { from, to } = state.selection;
  if (from === to) { toast('请先选中要转换的文本', 'error'); return; }
  const text = state.doc.textBetween(from, to);
  const converted = upper ? text.toUpperCase() : text.toLowerCase();
  ed.chain().insertContentAt({ from, to }, converted).run();
}

function setImageAlign(inst, mode) {
  const ed = inst.editor;
  const { state } = ed;
  let done = false;
  const tr = state.tr;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (n, pos) => {
    if (n.type.name === 'image') {
      tr.setNodeMarkup(pos, null, {
        ...n.attrs,
        float: mode === 'left' || mode === 'right' ? mode : null,
        center: mode === 'center'
      });
      done = true;
    }
  });
  if (!done) { toast('请先选中图片', 'error'); return; }
  ed.view.dispatch(tr);
}

/* 表格:向右/向下合并(构造 CellSelection 后 mergeCells) */
function mergeDirection(ed, dir) {
  const { state } = ed;
  const $from = state.selection.$from;
  let cellDepth = -1, cellNode = null;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.spec.tableRole === 'cell' || n.type.spec.tableRole === 'header_cell') { cellDepth = d; cellNode = n; break; }
  }
  if (!cellNode) { toast('请先将光标置于表格内', 'error'); return; }
  const row = $from.node(cellDepth - 1);
  const cellStart = $from.before(cellDepth);
  /* 行内索引 */
  let cellIndex = -1, acc = 0;
  row.forEach((c, _, i) => { if (c === cellNode) cellIndex = i; });
  if (cellIndex < 0) return;
  if (dir === 'right') {
    if (cellIndex >= row.childCount - 1) { toast('已是最右单元格', 'error'); return; }
    const rightStart = cellStart + cellNode.nodeSize;
    ed.view.dispatch(state.tr.setSelection(CellSelection.create(state.doc, cellStart, rightStart)));
    ed.chain().mergeCells().run();
  } else {
    /* down: 在下一行找同列起点 */
    const tableDepth = cellDepth + 2; /* row 的父是 table(row=depth-1, table=depth+1?保守:向上找 tableRole=table) */
    let d = cellDepth + 1;
    while (d <= $from.depth && $from.node(d).type.spec.tableRole !== 'table') d++;
    if (d > $from.depth) return;
    const rowStart = $from.before(cellDepth - 1);
    const nextRowStart = rowStart + row.nodeSize;
    if (nextRowStart >= $from.end(d)) { toast('已是最后一行', 'error'); return; }
    /* 下一行内第 cellIndex 个 cell 的位置(考虑 colspan 简化为按 cell 序) */
    const nextRow = state.doc.nodeAt(nextRowStart);
    if (!nextRow) return;
    let pos = nextRowStart + 1;
    for (let i = 0; i < cellIndex && i < nextRow.childCount; i++) pos += nextRow.child(i).nodeSize;
    if (cellIndex >= nextRow.childCount) { toast('下列单元格不足', 'error'); return; }
    ed.view.dispatch(state.tr.setSelection(CellSelection.create(state.doc, cellStart, pos)));
    ed.chain().mergeCells().run();
  }
}

function insertParagraphBeforeTable(ed) {
  const { state } = ed;
  let tablePos = null;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (n, pos) => {
    if (n.type.name === 'table' && tablePos === null) tablePos = pos;
  });
  if (tablePos === null) {
    /* 光标在表首 cell 时:$from 向上找 */
    const $from = state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'table') { tablePos = $from.before(d); break; }
    }
  }
  if (tablePos === null) { toast('未找到表格', 'error'); return; }
  ed.chain().insertContentAt(tablePos, { type: 'paragraph' }).setTextSelection(tablePos).run();
}

/* 格式刷状态机 */
function formatPainter(inst, btn) {
  if (inst._painter) { inst._painter = null; btn.classList.remove('lry-btn-tool-active'); return; }
  const ed = inst.editor;
  const { from, to, $from } = ed.state.selection;
  if (from === to) { toast('格式刷:请先选中带格式的文本', 'error'); return; }
  inst._painter = {
    marks: $from.marks(),
    block: $from.parent.type.name,
    blockAttrs: { ...$from.parent.attrs }
  };
  btn.classList.add('lry-btn-tool-active');
  toast('已拾取格式,选中目标文本后自动应用');
}
function engagePainter(inst) {
  if (!inst._painter || inst.editor.state.selection.empty) return;
  const ed = inst.editor;
  const p = inst._painter;
  const chain = ed.chain().focus();
  ['bold', 'italic', 'underline', 'strike', 'code', 'superscript', 'subscript', 'fontBorder', 'lryMark', 'kbd', 'link'].forEach((mn) => {
    const picked = p.marks.find((m) => m.type.name === mn);
    if (picked) chain.setMark(mn, picked.attrs);
    else chain.unsetMark(mn);
  });
  /* textStyle 家族(color/字号/字体/背景)整组重放 */
  const ts = p.marks.find((m) => m.type.name === 'textStyle');
  if (ts) chain.setMark('textStyle', ts.attrs);
  chain.run();
  if (p.block === 'paragraph' || p.block.startsWith('heading')) {
    ed.chain().focus().updateAttributes(p.block, p.blockAttrs).run();
  }
  inst._painter = null;
  const btn = inst.wrapper.querySelector('[data-cmd=formatmatch]');
  if (btn) btn.classList.remove('lry-btn-tool-active');
}

/* ---------- 按钮注册表 ---------- */
const ED = (inst) => inst.editor;

const REG = {
  undo: { icon: 'undo', title: '撤销', cmd: 'undo' },
  redo: { icon: 'redo', title: '重做', cmd: 'redo' },
  bold: { icon: 'bold', title: '加粗', cmd: 'toggleBold' },
  italic: { icon: 'italic', title: '斜体', cmd: 'toggleItalic' },
  underline: { icon: 'underline', title: '下划线', cmd: 'toggleUnderline' },
  strikethrough: { icon: 'strikethrough', title: '删除线', cmd: 'toggleStrike' },
  fontborder: { icon: 'fontborder', title: '文字边框', cmd: 'toggleFontBorder' },
  superscript: { icon: 'superscript', title: '上标', cmd: 'toggleSuperscript' },
  subscript: { icon: 'subscript', title: '下标', cmd: 'toggleSubscript' },
  removeformat: { icon: 'removeformat', title: '清除格式', cmd: 'unsetAllMarks' },
  blockquote: { icon: 'blockquote', title: '引用', cmd: 'toggleBlockquote' },
  insertorderedlist: { icon: 'orderedlist', title: '有序列表', cmd: 'toggleOrderedList' },
  insertunorderedlist: { icon: 'unorderedlist', title: '无序列表', cmd: 'toggleBulletList' },
  selectall: { icon: 'selectall', title: '全选', fn: (i) => ED(i).chain().focus().selectAll().run() },
  cleardoc: { icon: 'cleardoc', title: '清空文档', fn: (i) => { if (window.confirm('确定清空全部内容?')) ED(i).chain().clearContent(true).run(); } },
  unlink: { icon: 'unlink', title: '取消链接', cmd: 'unsetLink' },
  horizontal: { icon: 'horizontal', title: '分隔线', cmd: 'setHorizontalRule' },
  pagebreak: { icon: 'pagebreak', title: '分页符', cmd: 'insertPageBreak' },
  fullscreen: { icon: 'fullscreen', title: '全屏', toggle: 'fullscreen' },
  source: { icon: 'source', title: '源码', dlg: 'source' },
  preview: { icon: 'preview', title: '预览', dlg: 'preview' },
  print: { icon: 'print', title: '打印', dlg: 'print' },
  help: { icon: 'help', title: '帮助', dlg: 'help' },
  template: { icon: 'template', title: '模板', dlg: 'template' },
  insertframe: { icon: 'iframe', title: '插入 iframe', dlg: 'insertframe' },
  anchor: { icon: 'anchor', title: '锚点', dlg: 'anchor' },
  link: { icon: 'link', title: '链接', dlg: 'link' },
  insertimage: { icon: 'image', title: '插入图片', dlg: 'insertimage' },
  simpleupload: { icon: 'upload', title: '单图上传', dlg: 'simpleupload' },
  emotion: { icon: 'emotion', title: '表情', custom: (inst, btn) => openEmojiPicker(btn, inst) },
  scrawl: { icon: 'scrawl', title: '涂鸦', custom: (inst) => openScrawlDialog(inst) },
  formula: { icon: 'formula', title: '公式', custom: (inst) => openFormulaDialog(inst) },
  insertvideo: { icon: 'video', title: '视频', dlg: 'insertvideo' },
  insertaudio: { icon: 'audio', title: '音频', dlg: 'insertaudio' },
  attachment: { icon: 'attachment', title: '附件', dlg: 'attachment' },
  wordimage: { icon: 'wordimage', title: '图转存', dlg: 'wordimage' },
  spechars: { icon: 'spechars', title: '特殊字符', dlg: 'spechars' },
  date: { icon: 'date', title: '日期', fn: (i) => ED(i).chain().focus().insertContent(new Date().toLocaleDateString('zh-CN')).run() },
  time: { icon: 'time', title: '时间', fn: (i) => ED(i).chain().focus().insertContent(new Date().toLocaleTimeString('zh-CN', { hour12: false })).run() },
  searchreplace: { icon: 'searchreplace', title: '查找替换', dlg: 'searchreplace' },
  background: { icon: 'background', title: '背景', dlg: 'background' },
  edittable: { icon: 'table', title: '表格属性', dlg: 'edittable' },
  edittd: { icon: 'table', title: '单元格属性', dlg: 'edittd' },
  deletetable: { icon: 'table', title: '删除表格', cmd: 'deleteTable' },
  insertrow: { icon: 'insertrow', title: '插入行(下方)', cmd: 'addRowAfter' },
  insertcol: { icon: 'insertcol', title: '插入列(右侧)', cmd: 'addColumnAfter' },
  deleterow: { icon: 'deleterow', title: '删除行', cmd: 'deleteRow' },
  deletecol: { icon: 'deletecol', title: '删除列', cmd: 'deleteColumn' },
  mergecells: { icon: 'mergecells', title: '合并单元格', cmd: 'mergeCells' },
  splittocells: { icon: 'splitcells', title: '拆分单元格', cmd: 'splitCell' },
  splittorows: { icon: 'splitcells', title: '拆分成行', cmd: 'splitCell' },
  splittocols: { icon: 'splitcells', title: '拆分成列', cmd: 'splitCell' },
  insertparagraphbeforetable: { icon: 'paragraph', title: '表格前插段', fn: (i) => insertParagraphBeforeTable(ED(i)) },
  mergeright: { icon: 'mergeright', title: '向右合并', fn: (i) => mergeDirection(ED(i), 'right') },
  mergedown: { icon: 'mergedown', title: '向下合并', fn: (i) => mergeDirection(ED(i), 'down') },
  inserttable: { icon: 'table', title: '插入表格', cmd: 'insertTable', args: { rows: 3, cols: 3, withHeaderRow: true } },
  indent: { icon: 'indent', title: '增加缩进', fn: (i) => indentBlock(ED(i), 1) },
  outdent: { icon: 'outdent', title: '减少缩进', fn: (i) => indentBlock(ED(i), -1) },
  /* 首行自动缩进:全文模式开关(开启后新段落自动续用,详见 extensions/blocks.js FirstLineIndent) */
  firstlineindent: { icon: 'firstlineindent', title: '首行缩进(全文)', cmd: 'toggleFirstLineIndent' },
  justifyleft: { icon: 'alignleft', title: '居左', blockStyle: ['align', 'left'] },
  justifycenter: { icon: 'aligncenter', title: '居中', blockStyle: ['align', 'center'] },
  justifyright: { icon: 'alignright', title: '居右', blockStyle: ['align', 'right'] },
  justifyjustify: { icon: 'alignjustify', title: '两端对齐', blockStyle: ['align', 'justify'] },
  directionalityltr: { icon: 'direction', title: '从左到右', blockStyle: ['dir', 'ltr'] },
  directionalityrtl: { icon: 'direction', title: '从右到左', blockStyle: ['dir', 'rtl'] },
  touppercase: { icon: 'caseupper', title: '转大写', fn: (i) => transformCase(ED(i), true) },
  tolowercase: { icon: 'caselower', title: '转小写', fn: (i) => transformCase(ED(i), false) },
  imagenone: { icon: 'imagenone', title: '图片:取消浮动', fn: (i) => setImageAlign(i, 'none') },
  imageleft: { icon: 'imageleft', title: '图片:左浮动', fn: (i) => setImageAlign(i, 'left') },
  imagecenter: { icon: 'imagecenter', title: '图片:居中', fn: (i) => setImageAlign(i, 'center') },
  imageright: { icon: 'imageright', title: '图片:右浮动', fn: (i) => setImageAlign(i, 'right') },
  formatmatch: { icon: 'formatmatch', title: '格式刷', custom: formatPainter },
  pasteplain: { icon: 'pasteplain', title: '纯文本粘贴', toggle: 'pastePlain' },
  autotypeset: { icon: 'autotypeset', title: '自动排版', custom: autoTypesetPopover },
  forecolor: { icon: 'forecolor', title: '文字颜色', custom: (i, b) => openColorPanel(b, 'fore', i) },
  backcolor: { icon: 'backcolor', title: '背景色', custom: (i, b) => openColorPanel(b, 'back', i) },
  lrymark: { icon: 'marker', title: '高亮', custom: (i, b) => openColorPanel(b, 'mark', i) },
  /* 下拉组 */
  fontfamily: { dropdown: 'fontfamily', label: '字体' },
  fontsize: { dropdown: 'fontsize', label: '字号' },
  paragraph: { dropdown: 'paragraph', label: '段落' },
  customstyle: { dropdown: 'customstyle', label: '样式' },
  lineheight: { dropdown: 'lineheight', label: '行距', icon: 'lineheight' },
  letterspacing: { dropdown: 'letterspacing', label: '字距', icon: 'letterspacing' },
  rowspacingtop: { dropdown: 'rowspacingtop', label: '段前', icon: 'lineheight' },
  rowspacingbottom: { dropdown: 'rowspacingbottom', label: '段后', icon: 'lineheight' },
  insertcode: { dropdown: 'codelang', label: '代码', icon: 'code' },
  /* phase5 钩子(md/ai 由 md-core 就绪后接管) */
  markdown: { icon: 'markdown', title: 'Markdown 分栏', custom: (i) => (i.mdApi && i.mdApi.toggle) ? i.mdApi.toggle() : toast('Markdown 模块加载中') },
  ai: { icon: 'ai', title: 'AI 助手', custom: (i) => (i.aiApi && i.aiApi.open) ? i.aiApi.open() : toast('AI 面板加载中') },
  contentimport: { icon: 'import', title: '导入 Markdown 文件', custom: (i) => (i.mdApi && i.mdApi.importDialog) ? i.mdApi.importDialog() : toast('Markdown 模块加载中') },
  /* 导出(2026-11-23):Markdown/网页/Word/纯文本;exportmd 保留给自定义工具栏配置 */
  export: { icon: 'exportmd', title: '导出', custom: (i, b) => openExportMenu(b, i) },
  exportmd: { icon: 'exportmd', title: '导出 Markdown', custom: (i) => (i.mdApi && i.mdApi.exportDialog) ? i.mdApi.exportDialog() : toast('导出模块加载中') }
};

/** 实例的自动排版选项(面板与"粘贴时自动应用"共用) */
export function typesetOptions(inst) {
  if (!inst._autotypeset) inst._autotypeset = { ...TYPESET_DEFAULTS, ...(inst.options.autoTypeset || {}) };
  return inst._autotypeset;
}

/**
 * 执行自动排版。range 给定时只排该区间内的段落(粘贴场景)。
 * @returns {{removed:number,merged:number,trimmed:number}|null} 无改动返回 null
 */
export function applyAutoTypeset(inst, range) {
  const ed = inst.editor;
  const tr = ed.state.tr;
  const stats = typesetDoc(tr, typesetOptions(inst), range || null);
  if (stats) ed.view.dispatch(tr);
  return stats;
}

/* ---------- 下拉数据源 ---------- */
function dropdownItems(kind, inst) {
  const ed = inst.editor;
  switch (kind) {
    case 'fontfamily': return FONTS.map((f) => ({
      label: f.label, hint: '', value: f.value,
      html: '<span style="font-family:' + (f.value || 'inherit') + '">' + f.label + '</span>',
      pick: () => f.value ? ed.chain().focus().setFontFamily(f.value).run() : ed.chain().focus().unsetFontFamily().run()
    }));
    case 'fontsize': return FONT_SIZES.map((s) => ({
      label: s.label, value: s.value,
      pick: () => ed.chain().focus().setFontSize(s.value).run()
    }));
    case 'paragraph': return [
      { label: '正文', pick: () => ed.chain().focus().setParagraph().run() },
      { label: '标题1', html: '<span style="font-size:1.7em">标题1</span>', pick: () => ed.chain().focus().toggleHeading({ level: 1 }).run() },
      { label: '标题2', html: '<span style="font-size:1.45em">标题2</span>', pick: () => ed.chain().focus().toggleHeading({ level: 2 }).run() },
      { label: '标题3', html: '<span style="font-size:1.25em">标题3</span>', pick: () => ed.chain().focus().toggleHeading({ level: 3 }).run() },
      { label: '标题4', html: '<span style="font-size:1.1em">标题4</span>', pick: () => ed.chain().focus().toggleHeading({ level: 4 }).run() },
      { label: '标题5', pick: () => ed.chain().focus().toggleHeading({ level: 5 }).run() },
      { label: '标题6', pick: () => ed.chain().focus().toggleHeading({ level: 6 }).run() },
      { label: '代码块', pick: () => ed.chain().focus().setCodeBlockLang('plain').run() },
      { label: '引用段', pick: () => ed.chain().focus().toggleBlockquote().run() }
    ];
    case 'customstyle': return [
      { label: '标题一', html: '<b style="font-size:1.5em">标题一</b>', pick: () => ed.chain().focus().toggleHeading({ level: 2 }).run() },
      { label: '标题二', html: '<b style="font-size:1.3em">标题二</b>', pick: () => ed.chain().focus().toggleHeading({ level: 3 }).run() },
      { label: '标题三', html: '<b>标题三</b>', pick: () => ed.chain().focus().toggleHeading({ level: 4 }).run() },
      { label: '正文', pick: () => ed.chain().focus().setParagraph().run() }
    ];
    case 'lineheight': return LINE_HEIGHTS.map((v) => ({
      label: v, pick: () => ed.chain().focus().updateAttributes('paragraph', { lineHeight: v === '1' ? null : v }).run()
    }));
    case 'letterspacing': return LETTER_SPACINGS.map((v) => ({
      label: v, pick: () => ed.chain().focus().updateAttributes('paragraph', { letterSpacing: v === '0' ? null : v }).run()
    }));
    case 'rowspacingtop': return ROW_SPACINGS.map((v) => ({
      label: v, pick: () => ed.chain().focus().updateAttributes('paragraph', { marginTop: v === '0' ? null : v }).run()
    }));
    case 'rowspacingbottom': return ROW_SPACINGS.map((v) => ({
      label: v, pick: () => ed.chain().focus().updateAttributes('paragraph', { marginBottom: v === '0' ? null : v }).run()
    }));
    case 'codelang': return Object.keys(CODE_LANGS).map((id) => ({
      label: CODE_LANGS[id], hint: id,
      pick: () => ed.chain().focus().setCodeBlockLang(id).run()
    }));
    default: return [];
  }
}

/* ---------- 自动排版 ---------- */
function autoTypesetPopover(inst, btn) {
  const opts = typesetOptions(inst);
  const box = h('div', { class: 'lry-autotypeset' });
  const rows = [['emptyParas', '删除空段落'], ['trimSpaces', '清除行首尾空格'], ['mergeBlank', '合并连续空行'], ['paste', '粘贴时自动应用']];
  rows.forEach(([key, label]) => {
    box.appendChild(h('label', { class: 'lry-check' },
      h('input', { type: 'checkbox', checked: !!opts[key], onchange: (e) => { opts[key] = e.target.checked; } }), label));
  });
  box.appendChild(h('div', { class: 'lry-tip' }, '代码块内的缩进不受影响'));
  box.appendChild(h('div', { class: 'lry-btn-row', style: { marginTop: 8 } },
    h('button', { type: 'button', class: 'lry-btn lry-btn-primary', onclick: () => {
      closePopover();
      const s = applyAutoTypeset(inst);
      toast(s ? ('排版完成:删空段 ' + s.removed + '、并空行 ' + s.merged + '、清空格 ' + s.trimmed) : '内容已是规范排版,无需调整', s ? 'success' : undefined);
    } }, '立即执行')));
  popover(btn, box);
}

/* ---------- 渲染 ---------- */
/* 自适应策略(2026-11-15 三轮):
   PC(≥1024):wrap 全量显示;
   移动端(<1024):wrap 多行显示,前 3 行直出,超出按钮加 .lry-tool-folded
   由「更多」按钮弹出(委托原按钮 click)。行测量按 offsetTop 分组,
   resize/转屏防抖重测;「更多」自身若掉出 3 行则折叠它前一个按钮腾位。 */

function isMobileLayout() {
  return typeof window !== 'undefined' && window.innerWidth < 1024;
}

/** 行测量收纳:返回折叠的按钮数组 */
function measureToolbar(bar, moreBtn) {
  const btns = [...bar.querySelectorAll('.lry-tool-btn')].filter((b) => b !== moreBtn);
  /* 先清折叠再测量 */
  btns.forEach((b) => b.classList.remove('lry-tool-folded'));
  moreBtn.classList.remove('lry-tool-folded');
  if (!isMobileLayout()) return [];
  /* 布局不可用环境(jsdom:offsetTop 恒 0 且 clientWidth 0)不做收纳 */
  if (!bar.clientWidth || !btns[0] || btns[0].offsetTop === undefined) return [];
  const rowLimit = 3;
  const topOf = (b) => b.offsetTop;
  let tops = [];
  btns.forEach((b) => {
    const t = topOf(b);
    if (!tops.some((x) => Math.abs(x - t) < 8)) tops.push(t);
  });
  tops.sort((a, b) => a - b);
  const visibleTops = tops.slice(0, rowLimit);
  let folded = btns.filter((b) => !visibleTops.some((t) => Math.abs(t - topOf(b)) < 8));
  folded.forEach((b) => b.classList.add('lry-tool-folded'));
  /* 「更多」若被挤出 3 行(在 wrap 流中位于末尾):折叠一个可见按钮腾位,重排一次 */
  for (let guard = 0; guard < 6 && moreBtn.offsetTop > (visibleTops[visibleTops.length - 1] || 0) + 8; guard++) {
    const lastVisible = btns.filter((b) => !b.classList.contains('lry-tool-folded')).pop();
    if (!lastVisible) break;
    lastVisible.classList.add('lry-tool-folded');
    folded.push(lastVisible);
  }
  return folded;
}

export function mountToolbar(inst) {
  const bar = inst.wrapper.querySelector('.lry-toolbar');
  if (!bar || inst._toolbarMounted) return;
  inst._toolbarMounted = true;
  const ed = inst.editor;
  const config = inst.toolbarConfig && inst.toolbarConfig.length ? inst.toolbarConfig : [Object.keys(REG).slice(0, 20)];

  config.forEach((row) => {
    row.forEach((token) => {
      if (token === '|') { bar.appendChild(h('span', { class: 'lry-toolbar-sep' })); return; }
      const [cmd, arg] = token.split(':');
      const spec = REG[cmd];
      if (!spec) return;
      let btn;
      const base = { type: 'button', class: 'lry-tool-btn', 'data-cmd': cmd, title: spec.title || (spec.label || cmd) + (spec.dropdown ? ' ▾' : '') };
      if (spec.dropdown) {
        btn = h('button', Object.assign({}, base, {
          onclick: (e) => {
            const items = dropdownItems(spec.dropdown, inst);
            popover(e.currentTarget, h('div', { class: 'lry-menu lry-menu-scroll' },
              items.map((it) => h('button', { type: 'button', class: 'lry-menu-item', onclick: () => { it.pick(); closePopover(); } },
                it.html ? h('span', { class: 'lry-menu-html', html: it.html }) : null,
                h('span', { class: 'lry-menu-text' }, it.label),
                it.hint ? h('span', { class: 'lry-menu-hint' }, it.hint) : null))));
          }
        }),
        spec.icon ? h('span', { class: 'lry-tool-icon', html: ICONS[spec.icon] }) : null,
        h('span', { class: 'lry-tool-label' }, spec.label),
        h('span', { class: 'lry-tool-caret', html: ICONS.caret }));
      } else {
        btn = h('button', Object.assign({}, base, {
          onclick: (e) => {
            const b = e.currentTarget;
            if (spec.dlg) { DIALOGS[spec.dlg](inst, arg); return; }
            if (spec.custom) { spec.custom(inst, b); return; }
            if (spec.toggle === 'fullscreen') { toggleFullscreen(inst, b); return; }
            if (spec.toggle === 'pastePlain') {
              inst._pastePlain = !inst._pastePlain;
              b.classList.toggle('lry-btn-tool-active', inst._pastePlain);
              toast(inst._pastePlain ? '已开启纯文本粘贴' : '已关闭纯文本粘贴');
              return;
            }
            if (spec.blockStyle) { ed.chain().focus().setBlockStyle(spec.blockStyle[0], spec.blockStyle[1]).run(); return; }
            if (spec.fn) { spec.fn(inst); return; }
            const chain = ed.chain().focus();
            const c = spec.args ? chain[spec.cmd](spec.args) : chain[spec.cmd]();
            c.run();
          }
        }), h('span', { class: 'lry-tool-icon', html: ICONS[spec.icon] || '' }));
      }
      bar.appendChild(btn);
    });
  });

  /* 「更多」按钮:弹出 3 行之外的按钮(委托原按钮 click,行为完全一致);
     布局不可用环境(测试)兜底列出全部 */
  const moreBtn = h('button', {
    type: 'button', class: 'lry-tool-btn lry-tool-more', title: '更多功能',
    onclick: (e) => {
      let hidden = [...bar.querySelectorAll('.lry-tool-btn.lry-tool-folded')].filter((b) => b !== moreBtn);
      if (!hidden.length) hidden = [...bar.querySelectorAll('.lry-tool-btn')].filter((b) => b !== moreBtn && b.offsetParent === null);
      if (!hidden.length) hidden = [...bar.querySelectorAll('.lry-tool-btn')].filter((b) => b !== moreBtn);
      const grid = h('div', { class: 'lry-more-grid' });
      hidden.forEach((b) => {
        grid.appendChild(h('button', {
          type: 'button', class: 'lry-more-item', title: b.title,
          onclick: () => { closePopover(); b.click(); }
        },
        h('span', { class: 'lry-tool-icon', html: b.querySelector('.lry-tool-icon') ? b.querySelector('.lry-tool-icon').innerHTML : '' }),
        h('span', { class: 'lry-more-label' }, (b.title || '').split(' ')[0])));
      });
      if (!grid.children.length) { toast('全部功能已在工具栏上'); return; }
      popover(e.currentTarget, grid, { className: 'lry-more-pop' });
    }
  }, h('span', { class: 'lry-tool-icon', html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>' }));
  bar.appendChild(moreBtn);

  /* 自适应测量:初始 + resize/转屏防抖重测;「更多」仅在有折叠时可见 */
  const applyAdaptive = () => {
    const folded = measureToolbar(bar, moreBtn);
    moreBtn.classList.toggle('lry-tool-none', isMobileLayout() && folded.length === 0);
  };
  requestAnimationFrame(applyAdaptive);
  setTimeout(applyAdaptive, 600); /* 字体加载后复测 */
  let rzTimer = null;
  const onRz = () => {
    if (rzTimer) clearTimeout(rzTimer);
    rzTimer = setTimeout(applyAdaptive, 200);
  };
  window.addEventListener('resize', onRz);
  window.addEventListener('orientationchange', onRz);
  inst._toolbarAdaptiveCleanup = () => {
    window.removeEventListener('resize', onRz);
    window.removeEventListener('orientationchange', onRz);
  };

  /* 激活态同步 */
  const sync = () => {
    bar.querySelectorAll('.lry-tool-btn').forEach((b) => {
      const cmd = b.dataset.cmd;
      const spec = REG[cmd];
      if (!spec || spec.dropdown) return;
      let active = false;
      if (spec.cmd === 'toggleBold') active = ed.isActive('bold');
      else if (spec.cmd === 'toggleItalic') active = ed.isActive('italic');
      else if (spec.cmd === 'toggleUnderline') active = ed.isActive('underline');
      else if (spec.cmd === 'toggleStrike') active = ed.isActive('strike');
      else if (spec.cmd === 'toggleSuperscript') active = ed.isActive('superscript');
      else if (spec.cmd === 'toggleSubscript') active = ed.isActive('subscript');
      else if (spec.cmd === 'toggleFontBorder') active = ed.isActive('fontBorder');
      else if (spec.cmd === 'toggleBlockquote') active = ed.isActive('blockquote');
      else if (spec.cmd === 'toggleFirstLineIndent') active = !!(ed.storage.lryFirstLineIndent && ed.storage.lryFirstLineIndent.enabled);
      else if (spec.cmd === 'toggleOrderedList') active = ed.isActive('orderedList');
      else if (spec.cmd === 'toggleBulletList') active = ed.isActive('bulletList');
      else if (spec.blockStyle && spec.blockStyle[0] === 'align') {
        const $from = ed.state.selection.$from;
        active = $from.parent.attrs && $from.parent.attrs.align === spec.blockStyle[1];
      } else if (spec.blockStyle && spec.blockStyle[0] === 'dir') {
        const $from = ed.state.selection.$from;
        active = $from.parent.attrs && $from.parent.attrs.dir === spec.blockStyle[1];
      }
      b.classList.toggle('lry-btn-tool-active', active);
    });
  };
  ed.on('selectionUpdate', sync);
  ed.on('transaction', sync);
  sync();

  /* 格式刷:应用一次后自动退出 */
  ed.on('selectionUpdate', () => engagePainter(inst));
}

function toggleFullscreen(inst, btn) {
  const w = inst.wrapper;
  const on = w.classList.toggle('lry-fullscreen');
  btn.classList.toggle('lry-btn-tool-active', on);
  if (on) {
    inst._fsPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!inst._fsEsc) {
      inst._fsEsc = (e) => {
        if (e.key === 'Escape' && inst.wrapper.classList.contains('lry-fullscreen')) {
          toggleFullscreen(inst, btn);
        }
      };
      document.addEventListener('keydown', inst._fsEsc);
    }
  } else {
    document.body.style.overflow = inst._fsPrevOverflow || '';
    if (inst._fsEsc) { document.removeEventListener('keydown', inst._fsEsc); inst._fsEsc = null; }
  }
}
