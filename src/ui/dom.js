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

/**
 * 视口顶部被站点固定/粘性页头占据的高度(视口坐标,2026-11-24)。论坛皮肤等页面有
 * position:fixed 的页头(如 .lry_header,高 60px、z-index 1000),浮层贴近视口顶部时会
 * 与之重叠:查找条被压在页头下,高 z-index 的浮层则盖在页头上。定位时以其为上边界。
 * 做法:在视口顶边探三个点,命中(或其祖先为)fixed/sticky 的元素则取最大下沿;
 * 近乎全屏的遮罩层(高度 ≥ 视口 90%)不算页头。
 * @returns {number} 无固定页头返回 0
 */
export function fixedTopInset() {
  let bottom = 0;
  try {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    [24, Math.round(vw * 0.5), vw - 24].forEach((x) => {
      let el = document.elementFromPoint(x, 1);
      for (let i = 0; el && el !== document.body && i < 8; i++, el = el.parentElement) {
        if (!/fixed|sticky/.test(window.getComputedStyle(el).position)) continue;
        const r = el.getBoundingClientRect();
        if (r.height < vh * 0.9 && r.width > vw * 0.5) bottom = Math.max(bottom, r.bottom);
        break;
      }
    });
  } catch (e) { /* 无布局环境忽略 */ }
  return Math.round(bottom);
}

/* ---------------- 弹层(下拉菜单/颜色面板/表情) ---------------- */
let openPopover = null;
/* 刚关闭的那个弹层的落位信息(触发它的元素 + 弹层自身的位置),给"触发器不可见"的新弹层兜底。
   两种情况量到的触发器位置全是 0:行柄菜单的「表情」项(菜单先关,项随之脱离文档)、
   「更多」里点的原按钮(是 display:none)——面板会钉在页面左上角、脱离编辑区(2026-11-24 用户反馈)。
   只认 1 秒内的记录:委托触发是同步发生的,更早的不该再影响落位。 */
let lastClosed = null;

/* 元素的视口矩形;不可见(收进「更多」)或已脱离文档时返回 null */
function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  let r;
  try { r = el.getBoundingClientRect(); } catch (e) { return null; }
  if (!r || (!r.width && !r.height && !r.left && !r.top)) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

/* 不走 popover() 的自绘面板(斜杠面板)关闭前登记自己的位置:它里面的项若弹出一个"触发器不可见"的
   弹层(斜杠 → 表情,而表情按钮收进了「更多」),新弹层沿这里落位 */
export function rememberPopoverPlace(el) {
  const r = rectOf(el);
  if (r) lastClosed = { at: Date.now(), trigger: null, self: r };
}

export function closePopover() {
  /* 先清引用再销毁:销毁会让弹层内持有焦点的元素同步触发 blur,若其 blur 处理里再次
     关闭弹层(取色器十六进制输入框"失焦即应用"即此情形),重入时引用已空 → 空操作;
     否则会对同一节点二次 removeChild 抛 NotFoundError(浏览器实测发现) */
  const p = openPopover;
  openPopover = null;
  if (!p) return;
  lastClosed = { at: Date.now(), trigger: rectOf(p.triggerEl), self: rectOf(p.el) };
  p.destroy();
}
/**
 * anchorEl 下方弹出 content;点击外部/滚动关闭;单例。
 * opts: { className, onClose, at }——onClose 在弹层以任何方式关闭时调用;
 * at: { x, y } 按视口坐标落位(画布的右键菜单):菜单左上角贴着这个点,右边 / 下边放不下就翻到左 / 上。此时 anchorEl 只用来判断"点在外面"
 */
export function popover(anchorEl, content, opts) {
  /* 触发器的位置要在关旧弹层之前量:触发器本身可能就在旧弹层里,旧弹层一关它就脱离文档 */
  let rect = rectOf(anchorEl);
  closePopover();
  const onClose = opts && typeof opts.onClose === 'function' ? opts.onClose : null;
  const wrap = h('div', { class: 'lry-popover' + (opts && opts.className ? ' ' + opts.className : '') }, content);
  document.body.appendChild(wrap);
  const isMobile = window.innerWidth <= 640;
  if (opts && opts.at && !isMobile) {
    const left0 = opts.at.x, top0 = opts.at.y;
    let left = left0 + wrap.offsetWidth > window.innerWidth - 8 ? Math.max(8, left0 - wrap.offsetWidth) : Math.max(8, left0);
    let top = top0 + wrap.offsetHeight > window.innerHeight - 8 ? Math.max(fixedTopInset() + 4, top0 - wrap.offsetHeight) : Math.max(fixedTopInset() + 4, top0);
    wrap.style.left = left + 'px';
    wrap.style.top = top + 'px';
  } else if (isMobile) wrap.classList.add('lry-popover-sheet');
  else {
    /* 触发器不可见 / 已脱离文档:沿"是哪个弹层把它弹出来的"回落位——那个弹层的触发器
       (「更多」按钮、行柄「+」)优先,其次那个弹层自身的位置(斜杠面板),都没有才退到
       视口顶部居中。拿全 0 的矩形硬算,面板就钉在页面左上角 (8, 4) */
    if (!rect) {
      const lc = lastClosed;
      rect = (lc && Date.now() - lc.at < 1000 && (lc.trigger || lc.self)) || null;
    }
    if (!rect) {
      wrap.style.left = Math.max(8, Math.round((window.innerWidth - wrap.offsetWidth) / 2)) + 'px';
      wrap.style.top = (fixedTopInset() + 8) + 'px';
    } else {
      let left = Math.min(rect.left, window.innerWidth - wrap.offsetWidth - 8);
      wrap.style.left = Math.max(8, left) + 'px';
      /* 下方放不下(锚点贴近视口底部,如状态栏字数/末行按钮)且上方放得下 → 向上弹出。
         原先一律向下,贴底的锚点弹出的面板会被视口裁掉(2026-11-24 浏览器实测发现) */
      const below = rect.bottom + 4;
      const above = rect.top - wrap.offsetHeight - 4;
      wrap.style.top = (below + wrap.offsetHeight > window.innerHeight - 4 && above >= 4 ? above : below) + 'px';
    }
  }
  const onDoc = (e) => {
    if (!wrap.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) closePopover();
  };  /* 滚动关闭策略:仅当滚动发生在弹层与触发器之外时关闭——
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
    /* 也要听 pointerdown:画布在 pointerdown 上调了 preventDefault,浏览器就不再派发 mousedown 了——
       只听 mousedown 的话,在画布里点一下弹层永远不关(2026-11-24 右键菜单实测) */
    if (typeof window.PointerEvent === 'function') document.addEventListener('pointerdown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  }, 0);
  openPopover = {
    el: wrap,
    triggerEl: anchorEl,
    destroy() {
      document.removeEventListener('mousedown', onDoc);
      if (typeof window.PointerEvent === 'function') document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      window.removeEventListener('scroll', onScroll, { capture: true });
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      /* 关闭回调:无论因何关闭(外部点击/滚动/单例替换/显式关闭)都会触发,
         供触发方同步"开/合"状态(如代码块语言按钮) */
      if (onClose) onClose();
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
      class: 'lry-menu-item' + (it.disabled ? ' lry-menu-disabled' : '') + (it.danger ? ' lry-menu-danger' : ''),
      title: it.title || '',
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
