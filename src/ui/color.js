/**
 * 颜色面板:forecolor(文字色)/backcolor(背景色)/lrymark(高亮)共用。
 */
import { h, popover, closePopover } from './dom.js';
import { COLORS } from '../config.js';

/**
 * @param {HTMLElement} anchor 触发按钮
 * @param {string} mode 'fore' | 'back' | 'mark'
 * @param {object} inst LRYEditor 实例
 */
export function openColorPanel(anchor, mode, inst) {
  const ed = inst.editor;
  const apply = (color) => {
    ed.chain().focus();
    if (mode === 'fore') {
      color ? ed.chain().focus().setColor(color).run() : ed.chain().focus().unsetColor().run();
    } else if (mode === 'back') {
      color ? ed.chain().focus().setBackgroundColor(color).run() : ed.chain().focus().unsetBackgroundColor().run();
    } else {
      color ? ed.chain().focus().setLryMark(color).run() : ed.chain().focus().unsetMark('lryMark').run();
    }
    closePopover();
  };
  const grid = h('div', { class: 'lry-color-panel' },
    h('div', { class: 'lry-color-grid' },
      COLORS.map((c) => h('button', {
        type: 'button', class: 'lry-color-cell', style: { background: c },
        title: c, onclick: () => apply(c)
      }))),
    h('div', { class: 'lry-color-actions' },
      h('button', { type: 'button', class: 'lry-btn', onclick: () => apply(null) },
        mode === 'fore' ? '清除颜色' : (mode === 'back' ? '清除背景' : '清除高亮'))));
  popover(anchor, grid);
}
