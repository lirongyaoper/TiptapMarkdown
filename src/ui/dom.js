/**
 * UI 基建:元素构建 / 弹层定位 / 对话框框架(桌面居中,≤640px 底部抽屉)。
 * 原生 JS,零依赖;toast 优先复用页面 layer.msg(lry-api 约定),缺省退 alert。
 */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
  }
  children.flat().forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
}

export function toast(msg, type) {
  const w = typeof window !== 'undefined' ? window : null;
  if (w && w.layer && w.layer.msg) w.layer.msg(msg, { icon: type === 'error' ? 2 : (type === 'success' ? 1 : 0), time: type === 'error' ? 3500 : 2200 });
  else if (w && w.LRY && w.LRY.toast) w.LRY.toast(msg, type);
  else console.log('[lry-editor]', msg);
}

/* ---------------- 弹层(下拉菜单/颜色面板/表情) ---------------- */
let openPopover = null;
export function closePopover() {
  if (openPopover) { openPopover.destroy(); openPopover = null; }
}
/**
 * anchorEl 下方弹出 content;点击外部/滚动关闭;单例。
 */
export function popover(anchorEl, content, opts) {
  closePopover();
  const wrap = h('div', { class: 'lry-popover' + (opts && opts.className ? ' ' + opts.className : '') }, content);
  document.body.appendChild(wrap);
  const rect = anchorEl.getBoundingClientRect();
  const isMobile = window.innerWidth <= 640;
  if (isMobile) wrap.classList.add('lry-popover-sheet');
  else {
    let left = Math.min(rect.left, window.innerWidth - wrap.offsetWidth - 8);
    wrap.style.left = Math.max(8, left) + 'px';
    wrap.style.top = (rect.bottom + 4) + 'px';
  }
  const onDoc = (e) => {
    if (!wrap.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) closePopover();
  };
  /* 滚动关闭策略:仅当滚动发生在弹层与触发器之外时关闭——
     弹层自身滚动(菜单列表/颜色面板)与页面滚动(斜杠菜单跟随性)不关闭;
     编辑器内容区滚动会导致锚点错位,该场景关闭。 */
  const onScroll = (e) => {
    const t = e.target;
    if (t === document || t === window) return; /* 页面级滚动:保持菜单 */
    if (wrap.contains(t)) return; /* 弹层自身滚动 */
    if (anchorEl.contains(t) || t === anchorEl) return;
    /* 其余元素(编辑器内容区等)滚动 → 关闭 */
    closePopover();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  }, 0);
  openPopover = {
    el: wrap,
    destroy() {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      window.removeEventListener('scroll', onScroll, { capture: true });
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }
  };
  return openPopover;
}

/* ---------------- 对话框 ---------------- */
const openDialogs = [];
/**
 * opts: { title, body(元素/HTML), width, onOk, okText, cancelText, noFooter, onClose, fullscreenable }
 * 返回 { close, el, bodyEl }
 */
export function dialog(opts) {
  const body = typeof opts.body === 'string' ? h('div', { html: opts.body }) : opts.body;
  const overlay = h('div', { class: 'lry-dialog-overlay' });
  const dlg = h('div', { class: 'lry-dialog', style: opts.width ? { width: opts.width } : null },
    h('div', { class: 'lry-dialog-head' },
      h('span', { class: 'lry-dialog-title' }, opts.title || ''),
      h('button', { type: 'button', class: 'lry-dialog-x', onclick: () => close() }, '×')
    ),
    h('div', { class: 'lry-dialog-body' }, body)
  );
  if (!opts.noFooter) {
    const foot = h('div', { class: 'lry-dialog-foot' });
    if (opts.onOk) {
      foot.appendChild(h('button', { type: 'button', class: 'lry-btn lry-btn-primary', onclick: () => opts.onOk(api) }, opts.okText || '确定'));
    }
    foot.appendChild(h('button', { type: 'button', class: 'lry-btn', onclick: () => close() }, opts.cancelText || (opts.onOk ? '取消' : '关闭')));
    dlg.appendChild(foot);
  }
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
  const close = () => {
    overlay.classList.add('lry-dialog-out');
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 120);
    const i = openDialogs.indexOf(api);
    if (i >= 0) openDialogs.splice(i, 1);
    if (opts.onClose) opts.onClose();
  };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  const api = { close, el: dlg, body: body };
  openDialogs.push(api);
  /* 焦点入框 */
  const focusable = dlg.querySelector('input, textarea, select');
  if (focusable) setTimeout(() => focusable.focus(), 50);
  return api;
}

/* ---------------- 通用小部件 ---------------- */
export function field(labelText, inputEl) {
  return h('label', { class: 'lry-field' }, h('span', { class: 'lry-field-label' }, labelText), inputEl);
}
export function textField(placeholder, value, attrs) {
  return h('input', Object.assign({ type: 'text', class: 'lry-input', placeholder: placeholder || '', value: value === undefined ? '' : value }, attrs || {}));
}
export function selectEl(options, value) {
  const s = h('select', { class: 'lry-input' });
  options.forEach((o) => {
    const opt = h('option', { value: o.value === undefined ? o : o.value }, o.label === undefined ? o : o.label);
    if ((o.value === undefined ? o : o.value) === value) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}
export function menuList(items, onPick, activeFn) {
  const ul = h('div', { class: 'lry-menu' });
  items.forEach((it) => {
    if (it === '-') { ul.appendChild(h('div', { class: 'lry-menu-sep' })); return; }
    const item = h('button', {
      type: 'button',
      class: 'lry-menu-item' + (it.disabled ? ' lry-menu-disabled' : ''),
      onclick: () => { if (!it.disabled) { onPick(it); closePopover(); } }
    },
    it.html ? h('span', { class: 'lry-menu-html', html: it.html }) : null,
    it.icon ? h('span', { class: 'lry-menu-icon', html: it.icon }) : null,
    h('span', { class: 'lry-menu-text' }, it.label),
    it.hint ? h('span', { class: 'lry-menu-hint' }, it.hint) : null
    );
    if (activeFn && activeFn(it)) item.classList.add('lry-menu-active');
    ul.appendChild(item);
  });
  return ul;
}
