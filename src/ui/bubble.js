/**
 * 划词浮动工具条(BubbleMenu,2026-11-21 现代编辑器增强)。
 *
 * 设计(Notion/语雀/飞书同款交互):编辑区内选中文本时,在选区上方浮现
 * 快捷格式条;空选区/编辑器失焦时隐藏;按钮 mousedown 阻止默认,点击
 * 后选区保持,可连续施加多种格式。
 *
 * 实现:full 与 lite 共用,按钮集由调用方注入(图标复用 ui/icons.js);
 * 自研零新增依赖——定位取原生 Selection 的 Range 矩形(fixed 坐标),
 * 无布局环境(jsdom)或折叠选区时退化为隐藏,不参与定位计算。
 * 滚动/resize 随动重定位;destroy 返回清理函数由宿主实例销毁时调用。
 */
import { h, fixedTopInset } from './dom.js';
import { ICONS } from './icons.js';

/**
 * @param {object} inst  LRYEditor/LRYEditorLite 实例
 * @param {Array}  tools 按钮定义:{icon,title,run(ed,inst,btnEl),active?}
 *                       active 为编辑器 mark/node 名,用于高亮回显;
 *                       '|' 为分隔符
 * @param {{suppress?: () => boolean}} [opts]
 *                       suppress 返回 true 时强制隐藏(2026-11-23:选中图片时让位给
 *                       上下文工具条,避免两条浮层叠加)
 * @returns {function}   destroy 清理函数
 */
export function mountBubbleMenu(inst, tools, opts) {
  if (!tools || !tools.length) return () => {};
  const ed = inst.editor;

  const bar = h('div', { class: 'lry-bubble' });
  /* mousedown 阻止默认:防止点按钮先触发编辑器 blur 丢选区 */
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  const actives = [];
  tools.forEach((t) => {
    if (t === '|') { bar.appendChild(h('span', { class: 'lry-bubble-sep' })); return; }
    const btn = h('button', {
      type: 'button', class: 'lry-bubble-btn', title: t.title,
      onclick: (e) => {
        e.preventDefault();
        try { t.run(ed, inst, btn); } catch (err) { console.error('[lry-editor] bubble 命令异常', err); }
        /* 命令后主动同步高亮(部分命令不触发 selectionUpdate) */
        syncActive();
      }
    }, h('span', { class: 'lry-bubble-icon', html: ICONS[t.icon] || '' }));
    if (t.active) actives.push({ btn, name: t.active });
    bar.appendChild(btn);
  });
  bar.style.display = 'none';
  (inst.options.doc || document).body.appendChild(bar);

  function place() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { bar.style.display = 'none'; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r || (!r.width && !r.height)) { bar.style.display = 'none'; return; }
    const bw = bar.offsetWidth || 200;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    bar.style.left = left + 'px';
    /* 选区上方优先;上方放不下(贴视口顶,或选区在首行会盖住工具栏/站点固定页头)→ 选区下方;
       下方也放不下 → 贴上边界 */
    const above = r.top - (bar.offsetHeight || 32) - 8;
    const below = r.bottom + 8;
    const content = inst.wrapper.querySelector('.lry-editor-content, .lry-lite-content');
    const minTop = Math.max(8, fixedTopInset() + 4, content ? content.getBoundingClientRect().top + 4 : 8);
    bar.style.top = (above >= minTop ? above : (below + (bar.offsetHeight || 32) <= window.innerHeight - 8 ? below : minTop)) + 'px';
  }

  function syncActive() {
    actives.forEach(({ btn, name }) => btn.classList.toggle('lry-bubble-on', ed.isActive(name)));
  }

  function update() {
    const { empty } = ed.state.selection;
    const suppressed = opts && typeof opts.suppress === 'function' && opts.suppress();
    if (empty || !ed.isFocused || suppressed) { bar.style.display = 'none'; return; }
    syncActive();
    bar.style.display = 'flex';
    place();
  }
  const hide = () => { bar.style.display = 'none'; };

  const reposition = () => { if (bar.style.display !== 'none') place(); };
  ed.on('selectionUpdate', update);
  ed.on('transaction', update);
  /* 失焦即隐藏(点击编辑器外/切换窗口),防气泡残留 */
  ed.on('blur', hide);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);

  return () => {
    ed.off('selectionUpdate', update);
    ed.off('transaction', update);
    ed.off('blur', hide);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  };
}
