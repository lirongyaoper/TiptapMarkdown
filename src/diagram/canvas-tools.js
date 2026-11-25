/**
 * 画布的第二层能力(v1.4.1 自由画布)。装在 DiagramCanvas 的原型上,三种图(流程图 / 思维导图 / 类图)共用:
 *   多选      Shift / Ctrl 点选、空白处拖出框选、Ctrl+A;整组拖动、整组删除、整组复制
 *   工具条    画布左侧:选择 / 抓手 / 添加节点 / 文字 / 图形 / 连线 / 贴纸 / 图片(选中工具后点画布即放置,Esc 退回选择)
 *   自由元素  文字 / 图形 / 连线 / 贴纸 / 图片:选中、拖动、八向缩放、连线端点(可绑在节点上)、双击改文字 / 换表情 / 换图片
 *   右键菜单  按点中的东西出菜单(触屏长按);节点 / 连线那一栏直接用各画布工具条的按钮定义,同一份代码
 *   剪贴板    Ctrl+C / X / V 与右键菜单;内容见 clipboard.js
 *   平移缩放  抓手拖动、按住空格拖动、Ctrl + 滚轮缩放(指针位置不动)
 *   导出      画布 → PNG(见 export.js)
 *
 * 各画布要给的钩子(refRect / selectableRefs / deleteRefs / buildCopyPayload / applyPaste / placeNodeAt …)见 diagram-canvas.js 里的注释。
 * 自由元素的模型与默认样子在 items.js;只动自由元素时不重渲染 Mermaid——改完直接重画 g.lry-items,把布局块写回源码即可。
 */
import { h, popover, closePopover, menuList } from '../ui/dom.js';
import { openEmojiPicker } from '../ui/emoji.js';
import { DIALOGS } from '../ui/dialogs.js';
import { svgEl, toCanvasPoint } from './svg-map.js';
import { renderItems, fitViewBox, rectOf, unionRect, itemRect } from './layout-core.js';
import {
  makeItem, getItem, nextItemId, cloneItem, offsetItem, resizeRect, resizeSticker, nearestSide, itemBox, linePoints, itemHasText,
  ITEM_LABELS, FORM_LABELS, FORMS, ITEM_FILLS, ITEM_STROKES, LINE_WIDTHS, FONT_SIZES, RESIZE_DIRS
} from './items.js';
import { encodeClipboard, decodeClipboard, setMemory, getMemory, copyToSystem, readSystem } from './clipboard.js';
import { exportDiagramImage, renderDiagramImage } from './export.js';
import { MINI } from './diagram-canvas.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const KIND_LABEL = { flow: '流程图', mind: '思维导图', class: '类图' };
const LONG_PRESS = 480; /* 触屏长按出右键菜单 */

/* ---------- 图标 ---------- */
const ico = (paths) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
export const TOOL_ICON = {
  select: ico('<path d="M5.5 3.5l13.5 7.8-6 1.7-2.7 5.8z"/>'),
  hand: ico('<path d="M8.5 12V6.5a1.4 1.4 0 0 1 2.8 0V11"/><path d="M11.3 11V4.6a1.4 1.4 0 0 1 2.8 0V11"/><path d="M14.1 11V6.2a1.4 1.4 0 0 1 2.8 0v7.6"/><path d="M8.5 12l-1.6-1.9a1.5 1.5 0 0 0-2.4 1.8l3.6 5.8a5.6 5.6 0 0 0 4.8 2.7h.8a4.7 4.7 0 0 0 4.7-4.7"/>'),
  node: ico('<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M12 9.5v5M9.5 12h5"/>'),
  text: ico('<path d="M5 6h14M12 6v13"/>'),
  shape: {
    rect: ico('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
    rounded: ico('<rect x="4" y="6" width="16" height="12" rx="4"/>'),
    ellipse: ico('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
    diamond: ico('<path d="M12 4l8 8-8 8-8-8z"/>'),
    para: ico('<path d="M8 6h12l-4 12H4z"/>'),
    hex: ico('<path d="M8 5h8l4 7-4 7H8l-4-7z"/>')
  },
  line: {
    arrow: ico('<path d="M6 18L18 6"/><path d="M11 6h7v7"/>'),
    plain: ico('<path d="M6 18L18 6"/>'),
    dotted: ico('<path d="M6 18L18 6" stroke-dasharray="3 2.5"/>')
  },
  sticker: ico('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
  image: ico('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5"/>'),
  copy: ico('<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  cut: ico('<circle cx="7" cy="7" r="2.5"/><circle cx="7" cy="17" r="2.5"/><path d="M9 8.5L19 19M9 15.5L19 5"/>'),
  paste: ico('<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V3h6v2"/><path d="M9.5 12h5M9.5 16h5"/>'),
  all: ico('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/>'),
  export: ico('<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>')
};
/* 工具条上的工具;null = 分隔。more:点一下先选出哪一种(图形的形状 / 连线的样式) */
export const TOOLS = [
  { name: 'select', label: '选择', title: '选择 / 拖动节点(Esc 回到这里)' },
  { name: 'hand', label: '抓手', title: '抓手:拖动平移画布(任何时候按住空格拖动也行)' },
  null,
  { name: 'node', label: '添加节点', title: '添加节点:点一下画布,新节点落在那里(随后直接输入文字)' },
  { name: 'text', label: '文字', title: '文字:点一下放一段文字,或拖出一个范围' },
  { name: 'shape', label: '图形', title: '图形:点一下或拖出大小', more: '图形的形状' },
  { name: 'line', label: '连线', title: '连线:从一个点拖到另一个点;落在节点上就绑在节点上,节点挪了它跟着走', more: '连线的样式' },
  { name: 'sticker', label: '贴纸', title: '贴纸:点一下,选一个表情' },
  { name: 'image', label: '图片', title: '图片:点一下,上传或选一张图' }
];
/* 小色块(与节点配色的色块同一个样式) */
const swatch = (bg, border) => '<span class="lry-diagram-swatch' + (bg || border ? '' : ' lry-diagram-swatch-none') + '" style="' + (bg ? 'background:' + bg : '') + (border ? ';box-shadow:inset 0 0 0 2px ' + border : '') + '"></span>';
const colorName = (c) => (c === '#ffffff' ? '白色' : c === '#1f2329' ? '深色' : c === '#8f959e' ? '灰色' : c);
const r2 = (v) => Math.round(v * 100) / 100;
/* 工具条按钮定义 → 右键菜单项:带子面板的(形状 / 配色…)摊平成一串"形状 · 矩形";只有图标的按钮用 title 当文字 */
function toolsToMenu(defs) {
  const out = [];
  (defs || []).forEach((d) => {
    if (!d) return;
    if (d.panel) {
      if (out.length) out.push('-');
      d.panel.forEach((p) => out.push({ label: (d.label ? d.label + ' · ' : '') + (p.title || p.label || ''), icon: p.icon, active: p.active, run: p.onPick }));
      out.push('-');
      return;
    }
    /* 有自己的文字的(添加下游 / 改文字 / 形状…)直接用;只有图标的从 title 里拆:「上移(同级内换序)」→ 文字「上移」、提示「(同级内换序)」 */
    const t = String(d.title || d.label || '').trim();
    const m = /^([^((]*?)\s*([(（].*)?$/.exec(t);
    out.push({ label: d.label || (m ? m[1] : t), hint: d.label ? '' : (m && m[2] ? m[2] : ''), icon: d.icon, active: d.active, danger: d.danger, run: d.onPick });
  });
  while (out.length && out[out.length - 1] === '-') out.pop();
  return out;
}
/* 框 / 元素的八向手柄位置 */
function handlePoint(r, dir) {
  return {
    x: dir.indexOf('w') >= 0 ? r.x : dir.indexOf('e') >= 0 ? r.x + r.w : r.x + r.w / 2,
    y: dir.indexOf('n') >= 0 ? r.y : dir.indexOf('s') >= 0 ? r.y + r.h : r.y + r.h / 2
  };
}

export function installCanvasTools(DiagramCanvas) {
  const P = DiagramCanvas.prototype;

  /* ================= 工具条 ================= */

  P.initTools = function () {
    this.form = 'rounded'; /* 「图形」工具当前用的形状 */
    this.lineStyle = 'arrow'; /* 「连线」工具当前的样式:arrow / plain / dotted */
    this.spaceHeld = false;
    const dock = h('div', { class: 'lry-diagram-dock', oncontextmenu: (e) => e.preventDefault() });
    TOOLS.forEach((t) => {
      if (!t) { dock.appendChild(h('span', { class: 'lry-diagram-dock-sep' })); return; }
      const b = h('button', {
        type: 'button', class: 'lry-diagram-dock-btn', 'data-tool': t.name, title: t.label + ' · ' + t.title, 'aria-label': t.label,
        onmousedown: (e) => e.preventDefault(), /* 不抢画布的焦点 */
        /* 图形 / 连线:点一下先选出哪一种形状 / 样式(选完就是用这个工具);再点一次已在用的工具 = 回到选择 */
        onclick: () => (t.more ? this.toolMenu(t.name, b) : this.pickTool(t.name))
      });
      const icon = h('span', { class: 'lry-diagram-dock-icon' });
      b.appendChild(icon);
      b._icon = icon;
      dock.appendChild(b);
    });
    this.dock = dock;
    /* 插在画布容器前面而不是末尾:宽屏下它绝对定位、位置与 DOM 顺序无关;窄屏下它变成普通排版的一行,要在画布上方 */
    (this.ui.host || this.stage.parentElement || this.stage).insertBefore(dock, this.stage);
    this.onContextMenu = (e) => this.showContextMenu(e);
    this.onWheel = (e) => this.wheelZoom(e);
    this.onCopy = (e) => this.copyEvent(e);
    this.stage.addEventListener('contextmenu', this.onContextMenu);
    this.stage.addEventListener('wheel', this.onWheel, { passive: false });
    this.stage.addEventListener('copy', this.onCopy);
    this.updateDock();
    this.placeDock();
  };

  P.destroyTools = function () {
    if (this.lpTimer) clearTimeout(this.lpTimer);
    closePopover();
    this.stage.removeEventListener('contextmenu', this.onContextMenu);
    this.stage.removeEventListener('wheel', this.onWheel);
    this.stage.removeEventListener('copy', this.onCopy);
    this.stage.classList.remove('lry-space', 'lry-panning');
    if (this.dock) { this.dock.remove(); this.dock = null; }
  };

  P.toolIcon = function (name) {
    if (name === 'shape') return TOOL_ICON.shape[this.form] || TOOL_ICON.shape.rounded;
    if (name === 'line') return TOOL_ICON.line[this.lineStyle] || TOOL_ICON.line.arrow;
    return TOOL_ICON[name] || '';
  };

  P.updateDock = function () {
    if (!this.dock) return;
    this.dock.querySelectorAll('.lry-diagram-dock-btn').forEach((b) => {
      const name = b.getAttribute('data-tool');
      b.classList.toggle('lry-diagram-dock-on', name === this.tool);
      b._icon.innerHTML = this.toolIcon(name);
    });
    if (this.stage) this.stage.dataset.tool = this.tool || 'select';
  };

  /* 工具条上点一下 = 用这个工具;再点一次已在用的工具 = 回到选择 */
  P.pickTool = function (name) {
    if (name === this.tool) this.setTool('select'); else this.setTool(name);
  };

  P.setTool = function (name) {
    this.tool = name || 'select';
    this.marquee = null; this.ghost = null; this.lineDraft = null; this.linePending = null;
    closePopover();
    this.setHover(null);
    this.updateDock();
    this.refresh();
    if (this.tool !== 'select') this.focus();
  };

  /* 工具旁的下拉:图形的形状 / 连线的样式。选完直接用这个工具 */
  P.toolMenu = function (name, anchor) {
    const pick = (v) => { if (name === 'shape') this.form = v; else this.lineStyle = v; this.setTool(name); };
    const list = name === 'shape'
      ? FORMS.map((f) => ({ label: FORM_LABELS[f], icon: TOOL_ICON.shape[f], active: this.form === f, run: () => pick(f) }))
      : [['arrow', '带箭头'], ['plain', '直线'], ['dotted', '虚线']].map(([v, label]) => ({ label, icon: TOOL_ICON.line[v], active: this.lineStyle === v, run: () => pick(v) }));
    popover(anchor, menuList(list, (it) => it.run(), (it) => !!it.active));
  };

  /* 选择工具(或没选工具)时才是"在图上点选 / 拖节点";别的工具下不画悬停手柄 */
  Object.defineProperty(P, 'picking', { get() { return !this.tool || this.tool === 'select'; }, configurable: true });

  /* 工具条贴在画布左侧、竖向居中。它挂在画板框上而不是画布容器里:容器会滚动,工具条不该跟着滚 */
  P.placeDock = function () {
    const dock = this.dock;
    if (!dock) return;
    const hidden = !this.stage.offsetParent; /* 源码模式下画布不显示 */
    dock.hidden = !!hidden;
    if (hidden) return;
    if (typeof window !== 'undefined' && window.innerWidth <= 640) { dock.style.top = ''; return; } /* 窄屏:横排在底部(见样式) */
    const host = this.ui.host || this.stage.parentElement;
    const room = Math.min(this.stage.offsetHeight, host.clientHeight - this.stage.offsetTop);
    /* 画布矮(空画板 / 小图)时一列放不下:排成两列 */
    dock.classList.remove('lry-diagram-dock-grid');
    let hgt = dock.offsetHeight;
    if (hgt > room - 4) { dock.classList.add('lry-diagram-dock-grid'); hgt = dock.offsetHeight; }
    dock.style.top = Math.max(4, Math.round(this.stage.offsetTop + room / 2 - hgt / 2)) + 'px';
  };

  /* 空格按住期间 = 临时抓手(松开 / 失焦恢复) */
  P.holdSpace = function (on) {
    if (this.spaceHeld === on) return;
    this.spaceHeld = on;
    if (this.stage) this.stage.classList.toggle('lry-space', on);
  };

  /* ================= 指针的第一道分流 ================= */

  /* 各画板的 pointerDown 一上来先调它;返回 true = 这一按已经处理完(工具、自由元素、空白处) */
  P.commonDown = function (e) {
    const t = e.target;
    if (e.pointerType === 'touch') this.armLongPress(e); /* 触屏没有右键:按住不动出菜单 */
    const h = t.closest && t.closest('.lry-ov-handle');
    if (h) {
      const act = h.getAttribute('data-act');
      if (act === 'resize' || act === 'iend') { e.preventDefault(); this.itemHandleDown(e, h); return true; }
      return false;
    }
    if (this.spaceHeld || this.tool === 'hand') { this.startPan(e); return true; }
    if (this.tool && this.tool !== 'select') { this.toolDown(e); return true; }
    const ig = t.closest && t.closest('g.lry-item');
    if (ig && ig.getAttribute('data-iid')) { this.itemDown(e, ig.getAttribute('data-iid')); return true; }
    if (this.isBlankTarget(t)) { this.blankDown(e); return true; }
    return false;
  };

  /* 触屏长按(按住约半秒没挪) = 右键。手指挪动 / 抬起就取消;菜单出来之后这一次按下不再当作"点一下" */
  P.armLongPress = function (e) {
    clearTimeout(this.lpTimer);
    const x = e.clientX, y = e.clientY, target = e.target;
    const off = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', cancel, true);
      window.removeEventListener('pointercancel', cancel, true);
    };
    const cancel = () => { clearTimeout(this.lpTimer); this.lpTimer = null; off(); };
    const onMove = (ev) => { if (Math.abs(ev.clientX - x) > 8 || Math.abs(ev.clientY - y) > 8) cancel(); };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', cancel, true);
    window.addEventListener('pointercancel', cancel, true);
    this.lpTimer = setTimeout(() => {
      off();
      this.lpTimer = null;
      this.skipUp = true;
      this.showContextMenu({ clientX: x, clientY: y, target, preventDefault() {} });
      /*
       * 手指抬起时浏览器补发的 click 会落在刚弹出的菜单项上(菜单就从手指底下开始,窄屏上是贴底的整幅面板)——
       * 不拦的话长按等于"点了菜单第一项"(2026-11-24 实测:长按节点直接多出一个下游节点)。
       * 在窗口的捕获阶段拦掉紧接着的这一下 click;手指确实抬起来之后再点菜单,是另一次点击,不受影响
       */
      const swallow = (ev) => { window.removeEventListener('click', swallow, true); ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 800);
    }, LONG_PRESS);
  };

  /* 点的不是图里的东西:空白处(节点、连线、连线文字、自由元素之外)。提示条 / 选择图型的按钮也不算空白 */
  P.isBlankTarget = function (t) {
    if (!t || !t.closest) return true;
    return !t.closest('g.node, g.mindmap-node, g.lry-item, .lry-ov-edgehit, g.edgeLabels, g.edgeTerminals, text, .lry-diagram-hint, .lry-diagram-chooser, .lry-diagram-loading');
  };

  /* 空白处按下:拖出框选矩形;没拖动就松手 = 取消选中。图是空的时候 = 加第一个节点(原有行为) */
  P.blankDown = function (e) {
    if (this.isEmpty()) { this.addLoose(); return; }
    const p0 = toCanvasPoint(this.svg, e.clientX, e.clientY);
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    this.trackPointer(e, {
      move: (ev, moved) => {
        if (!moved) return;
        const p = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
        this.marquee = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
        this.refresh();
      },
      up: (ev, moved) => {
        const r = this.marquee;
        this.marquee = null;
        if (!moved) { this.select(null); return; }
        const hit = this.selectableRefs().filter((ref) => { const b = this.refRect(ref); return !!b && b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h; });
        let all = hit;
        if (add) { all = this.selectedRefs(); hit.forEach((x) => { if (!all.some((y) => this.sameSel(x, y))) all.push(x); }); }
        this.selExtra = all.slice(0, -1);
        this.sel = all.length ? all[all.length - 1] : null;
        this.refresh();
        if (this.sel) this.showTools(); else this.hideTools();
        this.focus();
      }
    });
  };

  /* 按住节点(选择工具下)。拖 = 挪位置(节点在多选里就整组挪);没拖动就松手 = 选中;
     按着 Shift / Ctrl 点 = 加进 / 移出多选。已经在多选里的节点,直接点一下保持多选不变 */
  P.nodeDown = function (e, nd, selRef) {
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
    let st = null;
    this.trackPointer(e, {
      move: (ev, moved) => { if (!moved) return; if (!st) st = this.dragStart(e, nd); this.dragTo(st, ev); },
      up: () => {
        if (st) { this.dragEnd(st); return; }
        if (toggle) this.select(selRef, { add: true });
        else if (!this.nodeSelected(nd)) this.select(selRef);
      }
    });
  };

  P.selectedNodeKeys = function () { const s = new Set(); this.selectedRefs().forEach((r) => { const k = this.refNodeKey(r); if (k) s.add(k); }); return s; };
  P.nodeSelected = function (n) { return !!n && this.selectedNodeKeys().has(n.key); };
  P.selectedSceneNodes = function () { const s = this.selectedNodeKeys(); return this.scene ? this.scene.nodes.filter((n) => s.has(n.key)) : []; };
  P.selectedItems = function () { return this.selectedRefs().filter((r) => r.kind === 'item').map((r) => this.itemOf(r)).filter(Boolean); };

  /* ================= 工具条上的工具:点画布放置 ================= */

  P.toolDown = function (e) {
    const tool = this.tool;
    const p0 = toCanvasPoint(this.svg, e.clientX, e.clientY);
    if (this.linePending) { /* 右键菜单的「从这里连线」:起点已定,这一下点的是终点 */
      const a = this.linePending;
      this.linePending = null;
      const g = this.hitNode(e.clientX, e.clientY);
      this.placeAt('line', a, g ? this.boundPoint(g, p0) : [r2(p0.x), r2(p0.y)]);
      this.setTool('select');
      return;
    }
    if (tool === 'line') { this.drawLineTool(e, p0); return; }
    if (tool === 'sticker') { this.setTool('select'); this.pickSticker((emoji) => this.addSticker(p0, emoji)); return; } /* 先切回选择工具再弹面板:切工具会关掉弹层 */
    if (tool === 'image') { this.setTool('select'); this.pickImage((src) => this.addImage(p0, src)); return; }
    /* 添加节点 / 文字 / 图形:按住拖出大小;点一下用默认大小 */
    let ghost = null;
    this.trackPointer(e, {
      move: (ev, moved) => {
        if (!moved) return;
        const p = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
        ghost = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
        this.ghost = ghost;
        this.refresh();
      },
      up: () => {
        const g = this.ghost;
        this.ghost = null;
        this.placeAt(tool, p0, g && (g.w >= 12 || g.h >= 12) ? Math.max(40, g.w) : 0, g && (g.w >= 12 || g.h >= 12) ? Math.max(20, g.h) : 0);
        this.refresh();
      }
    });
  };

  /* 连线工具:从按下的点拖到松手的点。按下 / 松手落在节点上,那一端绑在节点离它最近的一条边上 */
  P.drawLineTool = function (e, p0) {
    const g0 = this.hitNode(e.clientX, e.clientY);
    const k0 = g0 ? this.nodeKeyOfEl(g0) : null;
    const a = k0 ? this.boundPoint(g0, p0) : [r2(p0.x), r2(p0.y)];
    const draft = { a, from: k0, pt: p0, target: null };
    this.lineDraft = draft;
    this.refresh();
    this.trackPointer(e, {
      move: (ev) => {
        draft.pt = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
        const g = this.hitNodeClear(ev.clientX, ev.clientY);
        draft.target = g && this.nodeKeyOfEl(g) !== k0 ? g : null;
        this.refresh();
      },
      up: (ev, moved) => {
        this.lineDraft = null;
        if (!moved) { this.refresh(); return; }
        const p = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
        this.placeAt('line', a, draft.target ? this.boundPoint(draft.target, p) : [r2(p.x), r2(p.y)]);
        this.refresh();
      }
    });
  };

 /*
  * 指针下的节点,不算叠在上面的手柄:拖动连线端点时,端点手柄自己正好在指针底下,
  * 直接问浏览器"这一点是什么"得到的永远是手柄。量的时候先把放手柄的那一层藏起来
  */
  P.hitNodeClear = function (x, y) {
    const hud = this.hud, items = this.svg ? this.svg.querySelector('g.lry-items') : null;
    const d0 = hud ? hud.style.display : '', p0 = items ? items.style.pointerEvents : '';
    if (hud) hud.style.display = 'none';
    if (items) items.style.pointerEvents = 'none'; /* 自由连线自己的命中线(加宽的)端点正在指针下 */
    try { return this.hitNode(x, y); } finally {
      if (hud) hud.style.display = d0;
      if (items) items.style.pointerEvents = p0;
    }
  };

  /* 节点元素 → 它在坐标表里的键(按 scene 里的 el 找,三种图通用) */
  P.nodeKeyOfEl = function (g) { const n = this.scene && this.scene.nodes.find((x) => x.el === g); return n ? n.key : null; };
  P.boundPoint = function (g, p) { const key = this.nodeKeyOfEl(g); const r = key ? this.nodeRectByKey(key) : null; return { n: key, s: r ? nearestSide(r, p) : 'r' }; };

  /* 放完一样东西就回到选择工具:所有工具都是"放一次"。这样刚放上去的元素马上能拖、能缩放
     (留在原工具里的话,在它上面按下又成了"再放一个") */
  P.placeAt = function (tool, pt, w, h) {
    if (tool === 'node') { if (this.placeNodeAt) this.placeNodeAt(pt.x, pt.y); }
    else if (tool === 'text') this.addTextAt(pt.x, pt.y, w, h);
    else if (tool === 'shape') this.addShapeAt(pt.x, pt.y, w, h);
    else if (tool === 'line') this.addLine(pt, w); /* pt = 起点,w = 终点 */
    this.setTool('select');
  };

  /* ================= 平移 / 缩放 ================= */

  P.startPan = function (e) {
    e.preventDefault();
    const s = this.stage;
    const sl = s.scrollLeft, st = s.scrollTop;
    s.classList.add('lry-panning');
    this.trackPointer(e, {
      move: (ev, moved) => { if (!moved) return; s.scrollLeft = sl - (ev.clientX - e.clientX); s.scrollTop = st - (ev.clientY - e.clientY); },
      up: () => { s.classList.remove('lry-panning'); this.refresh(); }
    });
  };

  /* Ctrl + 滚轮(触控板的双指张合也是这个事件):缩放,指针指着的那一点不动 */
  P.wheelZoom = function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!this.svg) return;
    const x = e.clientX, y = e.clientY;
    const before = toCanvasPoint(this.svg, x, y); /* 指针指着画布里的哪一点 */
    const z0 = this.zoom;
    this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.002));
    if (this.zoom === z0) return;
    /* 把那一点拉回指针底下:每次按"还差多少"补,补两遍也不会过头 */
    const keep = () => {
      if (this.destroyed || !this.svg) return;
      const now = toCanvasPoint(this.svg, x, y);
      /* 那一点现在跑到了指针左 / 上边多少,就把画布往右 / 下滚多少 */
      const st = this.stage;
      const needX = (before.x - now.x) * this.k, needY = (before.y - now.y) * this.k;
      const sl = st.scrollLeft, tp = st.scrollTop;
      st.scrollLeft += needX; st.scrollTop += needY;
      /* 画布容器滚不动的部分(它的高度跟着内容走,竖向滚不动),让页面滚:这样指针指着的那一点真的不动 */
      const restX = needX - (st.scrollLeft - sl), restY = needY - (st.scrollTop - tp);
      if (Math.abs(restX) > 0.5 || Math.abs(restY) > 0.5) window.scrollBy(restX, restY);
    };
    keep();
    /* 刚改完缩放,可滚动范围还是旧的,第一下可能被夹掉(2026-11-24 实测):布局更新之后再补一次 */
    requestAnimationFrame(keep);
  };

  /* ================= 选中:全选 / 删除 ================= */

  P.selectAll = function () {
    const all = this.selectableRefs();
    if (!all.length) return false;
    this.selExtra = all.slice(0, -1);
    this.sel = all[all.length - 1];
    this.refresh();
    this.showTools();
    this.focus();
    return true;
  };

  /* 删除当前选中的全部(一个撤销步)。只有主选中一个、又是节点 / 连线这类老对象时走各画板原来的删除 */
  P.deleteSelected = function () {
    const refs = this.selectedRefs();
    if (!refs.length) return false;
    if (refs.length === 1 && refs[0].kind !== 'item') return this.deleteSelection();
    return this.deleteRefs(refs);
  };

  /* ================= 自由元素 ================= */

  P.itemOf = function (ref) { return ref ? getItem(this.layout.items || [], ref.ref) : null; };
  P.nodeRectByKey = function (key) { const n = this.scene && this.scene.byKey[key]; return n ? rectOf(n.x, n.y, n.w, n.h) : null; };
  P.itemBoxOf = function (id) { const it = getItem(this.layout.items || [], id); return it ? itemBox(it, (k) => this.nodeRectByKey(k)) : null; };

  /*
   * 只动了自由元素:不重渲染 Mermaid,直接重画 g.lry-items、重算画布大小、重画叠加层。
   * refit 传 false = 先不重算画布大小(拖动 / 缩放的过程中):画布一大一缩放比例就变,指针换算成画布坐标会越走越远
   * (2026-11-24 实测:在右边缘拖右下角手柄,越拖越大)。松手之后(dragEnd / 手柄松手)再重算一次。
   */
  P.repaintItems = function (refit) {
    if (!this.svg || !this.scene) return;
    renderItems(this.svg, this.scene, this.layout.items || []);
    this.fitTextItems();
    if (refit !== false) {
      fitViewBox(this.svg, this.scene, this.layout.items || []);
      this.syncBaseWidth();
    }
    this.refresh();
  };
  P.hasBoundItems = function () { return (this.layout.items || []).some((it) => it && it.k === 'line' && [it.a, it.b].some((p) => p && !Array.isArray(p) && p.n)); };
  /* 节点拖动中:绑在节点上的自由连线跟着重画(没有这类连线就什么都不做) */
  P.repaintBoundItems = function () {
    if (this.svg && this.scene && this.hasBoundItems()) renderItems(this.svg, this.scene, this.layout.items || []);
  };
  /* 文字元素的高度跟着文字走(只长不缩:缩是用户拖手柄的事) */
  P.fitTextItems = function () {
    let changed = false;
    (this.layout.items || []).forEach((it) => {
      if (!it || it.k !== 'text' || !it.id) return;
      const div = this.svg.querySelector('g.lry-item[data-iid="' + it.id + '"] [data-lry-text]');
      if (!div) return;
      const need = Math.ceil(div.scrollHeight);
      if (need > it.h + 1) { it.h = need; changed = true; }
    });
    if (changed) renderItems(this.svg, this.scene, this.layout.items || []);
  };

  /*
   * 加一个自由元素:写进布局、重画、记一步撤销、选中它。
   * nocommit:先不写回源码、不记撤销(刚放的文字元素要等文字写完才算加上——取消的话直接撤掉,不留一步空的)
   */
  P.addItem = function (it, label, nocommit) {
    this.layout.items = this.layout.items || [];
    this.layout.items.push(it);
    this.repaintItems();
    if (!nocommit) this.commitLayout(label, { norender: true });
    this.select({ kind: 'item', ref: it.id });
    return it;
  };

  P.addTextAt = function (x, y, w, h) {
    const it = this.addItem(makeItem('text', x, y, { id: nextItemId(this.layout.items), t: '', w: w || 120, h: h || 24 }), '添加文字', true);
    this.editItem(it, true);
    return it;
  };
  P.addShapeAt = function (x, y, w, h, form) {
    return this.addItem(makeItem('shape', x, y, { id: nextItemId(this.layout.items), w: w || 120, h: h || 56, f: form || this.form }), '添加图形');
  };
  /* a / b:坐标 [x, y] 或 { n: 节点键, s: 边 } */
  P.addLine = function (a, b) {
    if (!a || !b) return null;
    const st = this.lineStyle;
    return this.addItem(makeItem('line', 0, 0, { id: nextItemId(this.layout.items), a, b, c: '#8f959e', sw: 1.5, arrow: st !== 'plain', dash: st === 'dotted', t: '' }), '添加连线');
  };
  P.addSticker = function (p, emoji) {
    const s = 48;
    return this.addItem(makeItem('sticker', p.x - s / 2, p.y - s / 2, { id: nextItemId(this.layout.items), s, e: emoji || '😀' }), '添加贴纸');
  };
  P.addImage = function (p, src) {
    if (!src) return null;
    const it = this.addItem(makeItem('image', p.x, p.y, { id: nextItemId(this.layout.items), src }), '添加图片');
    /* 按图片的真实比例定大小(最长 320 宽 / 240 高);量不到就保持默认的 160 × 120 */
    const im = new Image();
    im.onload = () => {
      if (!im.naturalWidth || !im.naturalHeight || getItem(this.layout.items || [], it.id) !== it) return;
      const k = Math.min(320 / im.naturalWidth, 240 / im.naturalHeight, 1);
      it.w = Math.round(im.naturalWidth * k); it.h = Math.round(im.naturalHeight * k);
      this.repaintItems();
      this.commitLayout('图片大小', { norender: true });
    };
    im.src = src;
    return it;
  };

  P.pickSticker = function (onPick) {
    const anchor = (this.dock && this.dock.querySelector('[data-tool="sticker"]')) || this.stage;
    openEmojiPicker(anchor, this.ctx.inst, { onPick, title: '选一个表情贴到画布上' });
  };
  P.pickImage = function (onPick) {
    if (!this.ctx.inst || !DIALOGS) { this.ctx.toast('这个页面没有接图片上传,不能往画板里放图片'); return; }
    DIALOGS.insertimage(this.ctx.inst, { onPick: (src) => onPick(src), title: '放到画板上的图片' }); /* 对话框把图片地址(字符串)交回来 */
  };

  /* 改元素上的文字。fresh:刚放上去的空文字框——取消或留空就把这个框去掉 */
  P.editItem = function (it, fresh) {
    const box = this.itemBoxOf(it.id);
    if (!box) return;
    const isLine = it.k === 'line';
    const r = isLine ? this.lineLabelRect(it) : this.toStageRect(box);
    this.editText(r, it.t || '', {
      multiline: !isLine,
      placeholder: it.k === 'shape' ? '图形里的文字(可留空)' : isLine ? '连线文字' : '输入文字'
    }).then((res) => {
      if (!res || res.cancelled) { this.finishEditItem(it, false, fresh); return; }
      it.t = isLine ? res.value.replace(/[\r\n]+/g, ' ') : res.value;
      this.finishEditItem(it, true, fresh);
    });
  };
  P.finishEditItem = function (it, changed, fresh) {
    /* 文字元素不留空框:新放的没写内容、或把已有的文字删光了,都把这个元素去掉。
       新放的还没写回源码(见 addItem 的 nocommit):直接撤掉就行,不占撤销步 */
    if (it.k === 'text' && !String(it.t || '').trim()) {
      this.layout.items = (this.layout.items || []).filter((x) => x !== it);
      this.repaintItems();
      if (!fresh) this.commitLayout('删除文字', { norender: true });
      this.select(null);
      return;
    }
    this.repaintItems();
    if (changed || fresh) this.commitLayout(fresh ? '添加文字' : '改文字', { norender: true });
    this.select({ kind: 'item', ref: it.id });
  };
  /* 连线文字的输入框:落在连线中点 */
  P.lineLabelRect = function (it) {
    const e = linePoints(it, (k) => this.nodeRectByKey(k));
    const c = this.toStageRect({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, w: 0, h: 0 });
    return { x: c.x - 70, y: c.y - 15, w: 140, h: 30 };
  };

  /* 双击自由元素:改文字 / 换表情 / 换图片 */
  P.itemDblClick = function (e) {
    const ig = e.target && e.target.closest ? e.target.closest('g.lry-item') : null;
    if (!ig || !ig.getAttribute('data-iid')) return false;
    if (this.tool && this.tool !== 'select') return true;
    const it = this.itemOf({ ref: ig.getAttribute('data-iid') });
    if (!it) return false;
    this.select({ kind: 'item', ref: it.id });
    if (itemHasText(it)) this.editItem(it, false);
    else if (it.k === 'sticker') this.pickSticker((emoji) => { it.e = emoji; this.repaintItems(); this.commitLayout('换表情', { norender: true }); this.select({ kind: 'item', ref: it.id }); });
    else if (it.k === 'image') this.pickImage((src) => { it.src = src; this.repaintItems(); this.commitLayout('换图片', { norender: true }); this.select({ kind: 'item', ref: it.id }); });
    return true;
  };

  /* 按住自由元素:拖 = 挪位置(在多选里就整组挪);没拖动就松手 = 选中(Shift / Ctrl 点 = 加进 / 移出多选) */
  P.itemDown = function (e, id) {
    const it = this.itemOf({ ref: id });
    if (!it) return;
    const ref = { kind: 'item', ref: id };
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
    let st = null;
    this.trackPointer(e, {
      move: (ev, moved) => { if (!moved) return; if (!st) st = this.dragStart(e, null, it); this.dragTo(st, ev); },
      up: () => {
        if (st) { this.dragEnd(st); return; }
        if (toggle) this.select(ref, { add: true });
        else if (!this.isSelected(ref)) this.select(ref);
        else this.refresh();
      }
    });
  };

  /* 选中自由元素后的手柄:八个角 / 边(贴纸只有四个角);连线是两个端点 */
  P.drawItemHandles = function (it, r) {
    if (it.k === 'line') {
      const e = linePoints(it, (k) => this.nodeRectByKey(k));
      [['a', e.a], ['b', e.b]].forEach(([end, p]) => this.handle(this.dyn, p.x, p.y, 'end', { 'data-act': 'iend', 'data-end': end, 'data-iid': it.id }, 14));
      return;
    }
    (it.k === 'sticker' ? ['nw', 'ne', 'se', 'sw'] : RESIZE_DIRS).forEach((dir) => {
      const p = handlePoint(r, dir);
      this.handle(this.dyn, p.x, p.y, 'sq', { 'data-act': 'resize', 'data-dir': dir, 'data-iid': it.id }, 10);
    });
  };

  P.itemHandleDown = function (e, h) {
    const it = this.itemOf({ ref: h.getAttribute('data-iid') });
    if (!it) return;
    const p0 = toCanvasPoint(this.svg, e.clientX, e.clientY);
    if (h.getAttribute('data-act') === 'resize') {
      const dir = h.getAttribute('data-dir');
      const start = Object.assign({}, this.itemBoxOf(it.id));
      const s0 = +it.s || 0;
      this.trackPointer(e, {
        move: (ev, moved) => {
          if (!moved) return;
          const p = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
          if (it.k === 'sticker') {
            const r = resizeSticker({ x: start.x, y: start.y, s: s0 }, dir, p.x - p0.x, p.y - p0.y);
            it.x = r2(r.x); it.y = r2(r.y); it.s = r2(r.s);
          } else {
            const r = resizeRect(start, dir, p.x - p0.x, p.y - p0.y);
            it.x = r2(r.x); it.y = r2(r.y); it.w = r2(r.w); it.h = r2(r.h);
          }
          this.repaintItems(false);
        },
        up: (ev, moved) => { this.repaintItems(); if (moved) this.commitLayout('调整' + ITEM_LABELS[it.k] + '大小', { norender: true }); this.refresh(); }
      });
      return;
    }
    /* 连线的端点 */
    const end = h.getAttribute('data-end');
    const other = end === 'a' ? 'b' : 'a';
    this.trackPointer(e, {
      move: (ev, moved) => {
        if (!moved) return;
        const p = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
        it[end] = [r2(p.x), r2(p.y)];
        this.repaintItems(false);
      },
      up: (ev, moved) => {
        if (moved) {
          /* 松手时落在某个节点上:这一端绑到它身上 */
          const g = this.hitNodeClear(ev.clientX, ev.clientY);
          const key = g ? this.nodeKeyOfEl(g) : null;
          if (key && !(it[other] && it[other].n === key)) {
            const p = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
            it[end] = this.boundPoint(g, p);
          }
          this.commitLayout('调整连线', { norender: true });
        }
        this.repaintItems();
        this.refresh();
      }
    });
  };

  /* 选中自由元素时浮动工具条上的按钮 */
  P.itemTools = function (sel) {
    const it = this.itemOf(sel);
    if (!it) return null;
    const patch = (label, fn) => { fn(it); this.repaintItems(); this.commitLayout(label, { norender: true }); this.select(sel); };
    const out = [];
    if (itemHasText(it)) out.push({ label: '文字', title: it.k === 'shape' ? '图形里的文字 (双击)' : it.k === 'line' ? '连线文字 (双击)' : '修改文字 (Enter 或双击)', icon: MINI.text, onPick: () => this.editItem(it, false) });
    if (it.k === 'shape') {
      out.push({
        key: 'form', label: '形状', title: '换一种形状', icon: TOOL_ICON.shape[it.f] || TOOL_ICON.shape.rounded,
        panel: FORMS.map((f) => ({ title: FORM_LABELS[f], icon: TOOL_ICON.shape[f], active: it.f === f, onPick: () => patch('切换形状', (x) => { x.f = f; }) }))
      });
      out.push({
        key: 'fill', label: '填充', title: '填充色', icon: swatch(it.fc),
        panel: ITEM_FILLS.map((c) => ({ title: colorName(c), icon: swatch(c), active: (it.fc || '#ffffff') === c, onPick: () => patch('填充色', (x) => { x.fc = c; }) }))
      });
      out.push({
        key: 'stroke', label: '描边', title: '描边色', icon: swatch(null, it.sc),
        panel: ITEM_STROKES.map((c) => ({ title: colorName(c), icon: swatch(null, c), active: (it.sc || '#8f959e') === c, onPick: () => patch('描边色', (x) => { x.sc = c; }) }))
      });
    }
    if (it.k === 'text') {
      out.push({ key: 'fs', label: '字号', title: '字号', icon: MINI.text, panel: FONT_SIZES.map((n) => ({ title: n + ' px', label: n + ' px', active: (+it.s || 14) === n, onPick: () => patch('字号', (x) => { x.s = n; }) })) });
      out.push({ key: 'color', label: '颜色', title: '文字颜色', icon: swatch(null, it.c), panel: ITEM_STROKES.map((c) => ({ title: colorName(c), icon: swatch(null, c), active: (it.c || '#1f2329') === c, onPick: () => patch('文字颜色', (x) => { x.c = c; }) })) });
    }
    if (it.k === 'line') {
      const style = (dash, arrow, title, icon) => ({ title, icon, active: !!it.dash === dash && !!it.arrow === arrow, onPick: () => patch('连线样式', (x) => { x.dash = dash; x.arrow = arrow; }) });
      out.push(style(false, false, '直线', TOOL_ICON.line.plain), style(true, false, '虚线', TOOL_ICON.line.dotted), style(false, true, '带箭头', TOOL_ICON.line.arrow), style(true, true, '虚线带箭头', TOOL_ICON.line.arrow));
      out.push({ key: 'lw', label: '粗细', title: '连线粗细', icon: MINI.line.thick, panel: LINE_WIDTHS.map((n) => ({ title: n + ' px', label: n + ' px', active: (+it.sw || 1.5) === n, onPick: () => patch('连线粗细', (x) => { x.sw = n; }) })) });
      out.push({ key: 'lc', label: '颜色', title: '连线颜色', icon: swatch(null, it.c), panel: ITEM_STROKES.map((c) => ({ title: colorName(c), icon: swatch(null, c), active: (it.c || '#8f959e') === c, onPick: () => patch('连线颜色', (x) => { x.c = c; }) })) });
    }
    if (it.k === 'sticker') out.push({ label: '换表情', title: '换一个表情 (双击)', icon: TOOL_ICON.sticker, onPick: () => this.pickSticker((emoji) => patch('换表情', (x) => { x.e = emoji; })) });
    if (it.k === 'image') out.push({ label: '换图片', title: '换一张图片 (双击)', icon: TOOL_ICON.image, onPick: () => this.pickImage((src) => patch('换图片', (x) => { x.src = src; })) });
    out.push({ label: '复制', title: '复制 (Ctrl+C)', icon: TOOL_ICON.copy, onPick: () => this.copySelection(false) });
    out.push({ icon: MINI.trash, title: '删除 (Delete)', danger: true, onPick: () => this.deleteRefs([sel]) });
    return out;
  };

  /* 自由元素的右键菜单 */
  P.itemMenu = function (sel) {
    const it = this.itemOf(sel);
    if (!it) return [];
    const patch = (label, fn) => { fn(it); this.repaintItems(); this.commitLayout(label, { norender: true }); };
    const list = [];
    if (itemHasText(it)) list.push({ label: it.k === 'shape' ? (it.t ? '改图形里的文字' : '给图形加文字') : it.k === 'line' ? (it.t ? '改连线文字' : '给连线加文字') : '改文字', icon: TOOL_ICON.text, run: () => this.editItem(it, false) });
    const panel = (label, opts, get, set) => {
      list.push('-');
      opts.forEach((o) => list.push({ label: label + ' · ' + o.title, icon: o.icon, active: o.title === get(), run: () => patch(label, (x) => set(x, o.v)) }));
    };
    if (it.k === 'shape') {
      panel('形状', FORMS.map((f) => ({ v: f, title: FORM_LABELS[f], icon: TOOL_ICON.shape[f] })), () => FORM_LABELS[it.f || 'rect'], (x, v) => { x.f = v; });
      panel('填充', ITEM_FILLS.map((c) => ({ v: c, title: colorName(c), icon: swatch(c) })), () => colorName(it.fc || '#ffffff'), (x, v) => { x.fc = v; });
      panel('描边', ITEM_STROKES.map((c) => ({ v: c, title: colorName(c), icon: swatch(null, c) })), () => colorName(it.sc || '#8f959e'), (x, v) => { x.sc = v; });
    }
    if (it.k === 'text') {
      panel('字号', FONT_SIZES.map((n) => ({ v: n, title: n + ' px', icon: MINI.text })), () => (+it.s || 14) + ' px', (x, v) => { x.s = v; });
      panel('颜色', ITEM_STROKES.map((c) => ({ v: c, title: colorName(c), icon: swatch(null, c) })), () => colorName(it.c || '#1f2329'), (x, v) => { x.c = v; });
    }
    if (it.k === 'line') {
      panel('线型', [[false, false, '直线'], [true, false, '虚线'], [false, true, '带箭头'], [true, true, '虚线带箭头']].map(([dash, arrow, title]) => ({ v: (dash ? 'd' : '') + (arrow ? 'a' : ''), title, icon: arrow ? TOOL_ICON.line.arrow : dash ? TOOL_ICON.line.dotted : TOOL_ICON.line.plain })), () => (it.dash ? 'd' : '') + (it.arrow ? 'a' : ''), (x, v) => { x.dash = v.indexOf('d') >= 0; x.arrow = v.indexOf('a') >= 0; });
      panel('粗细', LINE_WIDTHS.map((n) => ({ v: n, title: n + ' px', icon: MINI.line.thick })), () => (+it.sw || 1.5) + ' px', (x, v) => { x.sw = v; });
      panel('颜色', ITEM_STROKES.map((c) => ({ v: c, title: colorName(c), icon: swatch(null, c) })), () => colorName(it.c || '#8f959e'), (x, v) => { x.c = v; });
    }
    if (it.k === 'sticker') list.push(list.length ? '-' : null, { label: '换表情', icon: TOOL_ICON.sticker, run: () => this.pickSticker((emoji) => patch('换表情', (x) => { x.e = emoji; })) });
    if (it.k === 'image') list.push(list.length ? '-' : null, { label: '换图片', icon: TOOL_ICON.image, run: () => this.pickImage((src) => patch('换图片', (x) => { x.src = src; })) });
    return list.filter(Boolean);
  };

  /* ================= 剪贴板 ================= */

  /* 浏览器的 copy 事件(键盘 Ctrl+C):不用申请权限就能写系统剪贴板。cutSelection() 里的 execCommand 也会走到这里 */
  P.copyEvent = function (e) {
    if (this.editing || e.target === this.ui.ta) return; /* 就地编辑框里:复制的是文字,与画布无关 */
    let text = this.clipText;
    if (!text) {
      const payload = this.buildCopyPayload(this.selectedRefs());
      if (!payload || (!(payload.nodes || []).length && !(payload.items || []).length)) return; /* 没选中可复制的东西:不动系统剪贴板 */
      setMemory(payload);
      text = encodeClipboard(payload);
    }
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };

  P.copySelection = function (cut) {
    const refs = this.selectedRefs();
    const payload = this.buildCopyPayload(refs);
    if (!payload || (!(payload.nodes || []).length && !(payload.items || []).length)) { this.ctx.toast('先选中要复制的内容'); return false; }
    setMemory(payload);
    /* 系统剪贴板:退路 execCommand 会同步触发一次 copy 事件(焦点在画布上),copyEvent 认得这份文本就原样写进去 */
    this.clipText = encodeClipboard(payload);
    copyToSystem(this.clipText).then(() => { this.clipText = null; });
    const n = this.countCopied(payload);
    if (cut) {
      this.deleteRefs(refs);
      this.ctx.toast('已剪切 ' + n);
    } else this.ctx.toast('已复制 ' + n);
    return true;
  };
  P.cutSelection = function () { return this.copySelection(true); };

  /* at:贴到哪里(画布坐标);不给 = 原位向右下偏 24 */
  P.pasteSelection = function (at) {
    const mem = getMemory();
    const go = (payload) => {
      if (!payload) { this.ctx.toast('剪贴板里没有可粘贴到画板的内容'); return false; }
      return this.applyPaste(payload, at || null);
    };
    if (mem) return go(mem.payload); /* 返回"是否真的贴进去了"(图型不对等情况返回 false) */
    readSystem().then((text) => go(decodeClipboard(text)));
    return true;
  };

  /* 哪些对象能复制:节点类的和自由元素;连线不单独复制(两端节点一起复制时它自然跟过去) */
  P.copyableRef = function (ref) { return !!ref && (ref.kind === 'item' || !!this.refNodeKey(ref)); };

  P.countCopied = function (payload) {
    const a = (payload.nodes || []).length, b = (payload.rels || payload.edges || []).length, c = (payload.notes || []).length, d = (payload.items || []).length;
    const parts = [];
    if (a) parts.push(a + ' 个节点');
    if (b) parts.push(b + ' 条连线');
    if (c) parts.push(c + ' 个便签');
    if (d) parts.push(d + ' 个' + (d > 1 ? '元素' : ITEM_LABELS[payload.items[0].k]));
    return parts.join('、') || '内容';
  };

  /* 复制:选中的自由元素各留一份副本 */
  P.copyItems = function (refs) {
    return this.selectedItems().filter((it) => refs.some((r) => r.kind === 'item' && r.ref === it.id)).map((it) => JSON.parse(JSON.stringify(it)));
  };
  /* 复制出来的内容整体的左上角 */
  P.payloadOrigin = function (payload) {
    const xs = [], ys = [];
    Object.keys(payload.pos || {}).forEach((k) => { const p = payload.pos[k]; if (p) { xs.push(p[0]); ys.push(p[1]); } });
    /* 自由连线只有写死坐标的端点才算(两端都绑在节点上的,位置随节点走,不占地方)——否则会被算成 (0, 0),整体落点就偏了 */
    (payload.items || []).forEach((it) => { const b = itemRect(it); if (b) { xs.push(b.x); ys.push(b.y); } });
    (payload.nodes || []).forEach((n) => { if (n.__pos) { xs.push(n.__pos[0]); ys.push(n.__pos[1]); } });
    if (!xs.length) return { x: 0, y: 0 };
    return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys) };
  };
  /* 粘贴的偏移:给了落点,内容的左上角对齐落点;没给,右下偏 24 */
  P.pasteOffset = function (payload, at) {
    const o = this.payloadOrigin(payload);
    return at ? { dx: at.x - o.x, dy: at.y - o.y } : { dx: 24, dy: 24 };
  };
  /* 把复制内容里的自由元素贴进来(三种图共用)。mapKey:旧节点键 → 新节点键;endPointOf:绑着的端点现在在哪 */
  P.pasteItems = function (payload, off, mapKey, endPointOf) {
    const made = [];
    this.layout.items = this.layout.items || [];
    (payload.items || []).forEach((src) => {
      const it = cloneItem(src, nextItemId(this.layout.items), mapKey, endPointOf);
      offsetItem(it, off.dx, off.dy);
      this.layout.items.push(it);
      made.push(it);
    });
    return made;
  };

  /* ================= 右键菜单(触屏长按) ================= */

  P.showContextMenu = function (e) {
    e.preventDefault();
    /* 触屏:我们自己的长按计时器与浏览器(安卓)的长按各报一次,同一下只出一个菜单 */
    if (this.menuAt && Date.now() - this.menuAt.t < 800 && Math.hypot(e.clientX - this.menuAt.x, e.clientY - this.menuAt.y) < 16) return;
    if (this.editing) this.endEdit(true);
    closePopover();
    this.menuAt = { x: e.clientX, y: e.clientY, t: Date.now() };
    const at = { x: e.clientX, y: e.clientY };
    const target = e.target && e.target.closest ? e.target : document.elementFromPoint(at.x, at.y);
    const ref = this.refAt(target);
    if (ref && !this.isSelected(ref)) this.select(ref, { noFocus: true }); /* 右键点的是没选中的对象:选中它;点在已选中的上:保留多选 */
    const list = this.menuFor(ref, at);
    if (!list.length) return;
    /* 动作挪到菜单关掉之后执行:弹层是单例,菜单项如果自己要弹面板(选表情 / 选形状),在菜单还开着时弹出来会随菜单一起被关掉 */
    popover(this.dock || this.stage, menuList(list, (it) => { if (it.run) setTimeout(it.run, 0); }, (it) => !!it.active), { at, className: 'lry-diagram-menu' });
    this.focus();
  };

  /* 事件目标 → 选中的对象(自由元素 / 连线 / 节点);点在空白上返回 null */
  P.refAt = function (t) {
    if (!t || !t.closest) return null;
    const ig = t.closest('g.lry-item');
    if (ig && ig.getAttribute('data-iid')) return { kind: 'item', ref: ig.getAttribute('data-iid') };
    if (t.closest('.lry-ov-handle')) return null;
    const hit = t.closest('.lry-ov-edgehit');
    if (hit) return this.edgeRefAt(+hit.getAttribute('data-edge'));
    const li = this.edgeIndexAt(t);
    if (li >= 0) return this.edgeRefAt(li);
    return this.nodeRefAt(t);
  };

  P.menuFor = function (ref, at) {
    const list = [];
    const multi = this.selExtra.length > 0;
    const n = this.selectedRefs().length;
    const point = () => toCanvasPoint(this.svg, at.x, at.y);
    const mem = !!getMemory();
    const pasteItem = () => ({ label: multi || ref ? '粘贴到这里' : '粘贴', hint: 'Ctrl+V', icon: TOOL_ICON.paste, disabled: !mem, run: () => this.pasteSelection(point()) });
    if (multi) {
      list.push({ label: '复制', hint: 'Ctrl+C · ' + n + ' 项', icon: TOOL_ICON.copy, run: () => this.copySelection(false) });
      list.push({ label: '剪切', hint: 'Ctrl+X', icon: TOOL_ICON.cut, run: () => this.cutSelection() });
      list.push(pasteItem(), '-');
      /* 多选时只列"添加"类的操作(加下游 / 加子级…),它们只作用于右键点的那个对象 */
      list.push.apply(list, toolsToMenu((this.toolsFor(ref) || []).filter((d) => d && d.label && /^(添加|子级|同级)/.test(d.label))));
      list.push('-');
      list.push({ label: '删除', hint: n + ' 项 · Delete', danger: true, run: () => this.deleteSelected() });
    } else if (ref) {
      if (ref.kind === 'item') list.push.apply(list, this.itemMenu(ref));
      else list.push.apply(list, toolsToMenu((this.toolsFor(ref) || []).filter((d) => !d || !d.danger)));
      if (this.extraMenu && this.extraMenu(ref).length) { list.push('-'); list.push.apply(list, this.extraMenu(ref)); }
      list.push('-');
      list.push({ label: '复制', hint: 'Ctrl+C', icon: TOOL_ICON.copy, disabled: ref.kind === 'item' ? false : !this.copyableRef(ref), run: () => this.copySelection(false) });
      list.push({ label: '剪切', hint: 'Ctrl+X', icon: TOOL_ICON.cut, disabled: ref.kind === 'item' ? false : !this.copyableRef(ref), run: () => this.cutSelection() });
      list.push(pasteItem());
      list.push('-');
      list.push({ label: '删除', hint: 'Delete', danger: true, run: () => this.deleteSelected() });
    } else {
      list.push(pasteItem());
      if (this.selectableRefs().length) list.push('-');
      list.push({ label: '在这里添加节点', icon: TOOL_ICON.node, run: () => { if (this.placeNodeAt) this.placeNodeAt(point().x, point().y); } });
      list.push({ label: '在这里添加文字', icon: TOOL_ICON.text, run: () => this.addTextAt(point().x, point().y) });
      list.push({ label: '在这里添加图形', icon: TOOL_ICON.shape[this.form], run: () => this.addShapeAt(point().x, point().y, 0, 0) });
      /* 「从这里连线」:起点就是右键点的位置,切到连线工具,再点一下终点 */
      list.push({ label: '从这里连线', icon: TOOL_ICON.line[this.lineStyle], run: () => { const p = point(); this.setTool('line'); this.linePending = [r2(p.x), r2(p.y)]; this.ctx.toast('再点一下连线的终点(按 Esc 取消)'); } });
      list.push({ label: '在这里添加贴纸', icon: TOOL_ICON.sticker, run: () => this.pickSticker((emoji) => this.addSticker(point(), emoji)) });
      list.push({ label: '在这里添加图片', icon: TOOL_ICON.image, run: () => this.pickImage((src) => this.addImage(point(), src)) });
    }
    list.push('-');
    if (!multi && !ref) list.push({ label: '全选', hint: 'Ctrl+A', icon: TOOL_ICON.all, run: () => this.selectAll() }, '-');
    list.push({ label: '适应画布', run: () => this.fitToView() });
    list.push({ label: '重新排版', disabled: !this.free, run: () => this.resetLayout() });
    list.push({ label: '导出图片', icon: TOOL_ICON.export, run: () => this.exportImage() });
    while (list.length && list[0] === '-') list.shift();
    return list;
  };

  /* ================= 叠加层:多选框、自由元素手柄、框选矩形、工具的草稿 ================= */

  P.drawExtra = function () {
    if (!this.dyn || !this.svg) return;
    /* 重渲染之后对不上的(已经删掉的)从多选里拿掉 */
    this.selExtra = this.selExtra.filter((r) => r && this.refRect(r));
    this.selExtra.forEach((r) => this.box(this.dyn, this.refRect(r), 'lry-ov-selbox lry-ov-selbox-extra', 3));
    if (this.sel && this.sel.kind === 'item') {
      const it = this.itemOf(this.sel);
      const r = it ? this.itemBoxOf(it.id) : null;
      if (!r) { this.loseSelection(); return; }
      this.box(this.dyn, r, 'lry-ov-selbox', 3);
      if (!this.editing && this.picking) this.drawItemHandles(it, r);
    }
    const m = this.marquee;
    if (m) svgEl('rect', { x: m.x, y: m.y, width: m.w, height: m.h, class: 'lry-ov-marquee', 'vector-effect': 'non-scaling-stroke' }, this.dyn);
    const g = this.ghost;
    if (g) svgEl('rect', { x: g.x, y: g.y, width: g.w, height: g.h, class: 'lry-ov-ghost', 'vector-effect': 'non-scaling-stroke' }, this.dyn);
    const d = this.lineDraft;
    if (d) {
      const a = Array.isArray(d.a) ? { x: d.a[0], y: d.a[1] } : (linePoints({ a: d.a, b: d.a }, (k) => this.nodeRectByKey(k)).a);
      const end = d.target ? this.nodeRectByKey(this.nodeKeyOfEl(d.target)) : null;
      const to = end ? { x: end.x + end.w / 2, y: end.y + end.h / 2 } : d.pt;
      svgEl('line', { x1: a.x, y1: a.y, x2: to.x, y2: to.y, class: 'lry-ov-rubber', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': (6 / this.k) + ' ' + (4 / this.k) }, this.dyn);
      if (end) this.box(this.dyn, end, 'lry-ov-target', 3);
    }
    this.placeDock();
  };

  /* Esc:正在框选 / 拉连线 / 用别的工具 → 退回选择工具(返回 true 表示吃掉了这一次 Esc) */
  P.cancelTransient = function () {
    if (this.marquee || this.ghost || this.lineDraft || this.linePending) {
      this.marquee = null; this.ghost = null; this.lineDraft = null; this.linePending = null;
      if (this.tool !== 'select') this.setTool('select'); else this.refresh();
      return true;
    }
    if (this.tool !== 'select') { this.setTool('select'); return true; }
    /* 画布里弹出的菜单 / 形状选项 / 表情面板:点菜单外面会关,Esc 也该关 */
    if (typeof document !== 'undefined' && document.querySelector('.lry-popover')) { closePopover(); return true; }
    return false;
  };

  /* ================= 导出 ================= */

  P.kindLabel = function () { return KIND_LABEL[(this.scene && this.scene.kind) || ''] || '画板'; };
  P.exportImage = function () {
    if (!this.svg) return Promise.resolve(null);
    return exportDiagramImage(this.svg, 'lry-editor-' + this.kindLabel()).then((r) => {
      if (r.kind === 'png') this.ctx.toast('已导出图片(' + r.width + ' × ' + r.height + ')');
      else this.ctx.toast('导出图片失败,已改为导出 SVG 文件');
      return r;
    });
  };
  /* 只要图像数据、不下载(回归测试用) */
  P.renderImage = function (scale) { return this.svg ? renderDiagramImage(this.svg, scale || 2) : Promise.reject(new Error('图还没渲染出来')); };
}
