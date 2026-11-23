/**
 * 颜色面板:forecolor(文字色)/backcolor(背景色)/lrymark(高亮)/cell(单元格背景)共用。
 * 2026-11-23 v1.2.0:新增自定义取色(原生取色器 + 十六进制输入)与「最近使用」
 * (localStorage,最多 8 色);预设色格 .lry-color-cell 保持首位,既有调用方不受影响。
 */
import { h, popover, closePopover } from './dom.js';
import { COLORS } from '../config.js';
import { setCellBackground } from './table-ops.js';

const RECENT_KEY = 'lry-editor-recent-colors';
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function loadRecent() {
  try {
    const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(a) ? a.filter((c) => typeof c === 'string' && HEX_RE.test(c)).slice(0, 8) : [];
  } catch (e) { return []; }
}
function pushRecent(color) {
  try {
    const list = [color].concat(loadRecent().filter((c) => c.toLowerCase() !== color.toLowerCase())).slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (e) { /* 隐私模式忽略 */ }
}

/**
 * @param {HTMLElement} anchor 触发按钮
 * @param {string} mode 'fore' | 'back' | 'mark' | 'cell'
 * @param {object} inst LRYEditor 实例
 */
export function openColorPanel(anchor, mode, inst) {
  const ed = inst.editor;
  const isCell = mode === 'cell';
  /* 一次性应用:回车应用时弹层销毁会让输入框同步 blur,"失焦即应用"不得把同一颜色
     再应用一遍(否则多出一步撤销,且曾引发弹层重入销毁) */
  let done = false;
  const apply = (color) => {
    if (done) return;
    done = true;
    color = color ? String(color).toLowerCase() : null;
    if (mode === 'fore') {
      color ? ed.chain().focus().setColor(color).run() : ed.chain().focus().unsetColor().run();
    } else if (mode === 'back') {
      color ? ed.chain().focus().setBackgroundColor(color).run() : ed.chain().focus().unsetBackgroundColor().run();
    } else if (isCell) {
      setCellBackground(ed, color);
    } else {
      color ? ed.chain().focus().setLryMark(color).run() : ed.chain().focus().unsetMark('lryMark').run();
    }
    if (color) pushRecent(color);
    closePopover();
  };
  const clearText = mode === 'fore' ? '清除颜色' : (mode === 'back' ? '清除背景' : (isCell ? '清除单元格背景' : '清除高亮'));

  /* 自定义取色:原生取色器提交即应用;十六进制输入回车/失焦应用 */
  const native = h('input', { type: 'color', class: 'lry-color-native', value: '#1a66d6', title: '自定义颜色' });
  native.addEventListener('change', () => { if (HEX_RE.test(native.value)) apply(native.value); });
  const hexIn = h('input', { type: 'text', class: 'lry-input lry-color-hex', placeholder: '#1a66d6', spellcheck: 'false' });
  const applyHex = () => {
    if (done) return; /* 已应用过(含弹层销毁引发的 blur):不再处理 */
    let v = hexIn.value.trim().toLowerCase();
    if (!v) return;
    if (v[0] !== '#') v = '#' + v;
    /* 三位(#abc)/四位(#abcd)简写逐位展开为六位/八位 */
    if ((v.length === 4 || v.length === 5) && HEX_RE.test(v)) {
      v = '#' + v.slice(1).split('').map((ch) => ch + ch).join('');
    }
    if (!HEX_RE.test(v)) { hexIn.classList.add('lry-color-bad'); return; }
    apply(v);
  };
  hexIn.addEventListener('input', () => hexIn.classList.remove('lry-color-bad'));
  hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyHex(); } });
  hexIn.addEventListener('blur', applyHex);

  const grid = h('div', { class: 'lry-color-panel' },
    h('div', { class: 'lry-color-grid' },
      COLORS.map((c) => h('button', {
        type: 'button', class: 'lry-color-cell', style: { background: c },
        title: c, onclick: () => apply(c)
      }))));
  const recent = loadRecent();
  if (recent.length) {
    grid.appendChild(h('div', { class: 'lry-color-recent-label' }, '最近使用'));
    grid.appendChild(h('div', { class: 'lry-color-grid lry-color-recent' },
      recent.map((c) => h('button', {
        type: 'button', class: 'lry-color-cell', style: { background: c },
        title: c, onclick: () => apply(c)
      }))));
  }
  grid.appendChild(h('div', { class: 'lry-color-actions' },
    native, hexIn,
    h('button', { type: 'button', class: 'lry-btn', onclick: () => apply(null) }, clearText)));
  popover(anchor, grid);
}
