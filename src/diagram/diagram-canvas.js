/**
 * 画布基类(v1.3.0 可视化画布):Mermaid 实时渲染结果之上的交互层。
 *
 * 流程图(FlowEditor)与思维导图(MindEditor)共用这里的一套机制,各自只实现"结构怎么变":
 *   渲染管线   源码 → parse → 模型;改动 → serialize → 源码 → commit(写回文档,一个操作一个事务)→ 重渲染
 *   撤销重做   画布自己维护(栈里存源码);每次操作同时是文档的一个事务,正文级撤销也成立
 *   就地编辑   textarea 浮在节点的文字块上(屏幕坐标对齐),Enter 确定、Shift+Enter 换行、Esc 取消
 *   浮动工具条 跟随选中节点,重渲染后重新定位;按钮按下不抢画布焦点
 *   按键       挂在画布容器(可聚焦)上,事件不透传给 ProseMirror(见 mermaid-view.js 的 stopEvent)
 *   缩放       CSS zoom 作用在放 SVG 的那一层,布局尺寸随之变化,交互层用屏幕坐标对齐
 *   自由摆放   v1.4.0:节点可以拖到任意位置,坐标存进图源码末尾的布局块(layout-core.js);拖动中只改 DOM,松手才提交
 *
 * 模型里的节点是普通对象,操作直接改它,然后 mutate() 统一收尾。
 */
import { svgEl, canvasScale, toCanvasPoint } from './svg-map.js';
import { h } from '../ui/dom.js';
import { isEngineError } from '../ui/mermaid-loader.js';
import { emptyLayout, parseLayout, attachLayout, buildScene, applyLayout, setNodePos, rerouteEdges, fitCluster, fitViewBox, placeNear, avoidOverlap, renderItems, rectOf, nodeRectOf } from './layout-core.js';
import { installCanvasTools } from './canvas-tools.js';
import { ITEM_LABELS, offsetItem } from './items.js';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

/* 手柄里的小图标(手柄是 HTML 元素,图标用内联 SVG) */
const HANDLE_ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  dot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.5" fill="currentColor"/></svg>',
  ring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="12" r="5.5"/></svg>',
  /* 移动抓手(拖动节点用;触屏上只能靠它——浏览器只认 HTML 元素上的 touch-action) */
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  /* 缩放手柄(自由元素的八个角 / 边)与连线端点(v1.4.1) */
  sq: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="#fff" stroke="currentColor" stroke-width="2"/></svg>',
  end: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="#fff" stroke="currentColor" stroke-width="2.4"/></svg>'
};

export class DiagramCanvas {
  /**
   * @param {HTMLElement} stage  画布容器(可聚焦)
   * @param {{scaler:HTMLElement, ta:HTMLTextAreaElement, tools:HTMLElement, hint:HTMLElement}} ui
   * @param {object} ctx  宿主回调:
   *   getSource() 当前源码;commit(src, label) 写回文档;renderSvg(src) → Promise<{svg, renderId}>;
   *   onState(info) 通知顶栏(canUndo/canRedo/zoom/unsupported/busy/error);toast(msg);leaveCanvas() 离开画布回正文
   */
  constructor(stage, ui, ctx) {
    this.stage = stage;
    this.ui = ui;
    this.ctx = ctx;
    this.model = null;
    this.src = '';
    this.svg = null;
    this.renderId = '';
    this.sel = null;
    this.hover = null;
    this.editing = null;
    this.undoStack = [];
    this.redoStack = [];
    this.zoom = 1;
    this._k = 1; /* 画布单位 ↔ 屏幕像素的比例,见 syncScale */
    /* 布局(v1.4.0 自由画布):节点坐标 + 自由元素,随源码末尾的 %% 注释块存取(见 layout-core.js)。
       scene 是 Mermaid 渲染结果"认过图"之后的节点 / 连线 / 子表,拖动时直接在它上面改 DOM */
    this.layout = emptyLayout();
    this.scene = null;
    this.draggingNode = false;
    /* v1.4.1 自由画布:多选(sel 是主选中,selExtra 是其余选中的)、框选矩形、当前工具。
       这一套的交互(工具条 / 右键菜单 / 自由元素 / 剪贴板 / 平移缩放 / 导出)在 canvas-tools.js */
    this.selExtra = [];
    this.marquee = null;
    this.tool = 'select';
    this.renderSeq = 0;
    this.destroyed = false;
    stage.tabIndex = 0;
    /* 容器尺寸变了(窗口缩放、手机转屏):图的基准宽度要重算(见 syncBaseWidth),
       叠加层里的手柄 / 选中框要按新的比例重画。不重画的话它们会一直保持上一次的大小。
       观察的是画布容器而不是放 svg 的那一层——后者的宽度是写死的,窗口变窄时它不会跟着变。
       重算宽度会改容器自己的高度,在观察回调里直接改会触发浏览器的"ResizeObserver 循环"报错,挪到下一帧做 */
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => {
        if (this.destroyed || this.roPending) return;
        this.roPending = true;
        requestAnimationFrame(() => { this.roPending = false; if (!this.destroyed) this.resize(); });
      });
      this.ro.observe(stage);
    }

    this.onKeyDown = (e) => this.handleKey(e);
    this.onPointerDown = (e) => this.handlePointerDown(e);
    this.onDblClick = (e) => this.handleDblClick(e);
    this.onOver = (e) => this.handleOver(e);
    this.onOut = (e) => this.handleOut(e);
    this.onBlur = () => { this.holdSpace(false); if (!this.editing) { this.setHover(null); } };
    this.touching = false; /* 触屏上正按着画布(见 clearDynamic) */
    /*
     * 画布上的 click(捕获阶段,先于工具条按钮自己的处理):
     *  ① 图里带超链接的节点(流程图 / 类图的 click X href)被 Mermaid 包在 <a> 里:在画布里点它是"选中",不能跟着跳走。
     *  ② 触屏的"幽灵点击":手指抬起之后浏览器才补发 click,并按那一刻的位置重新找目标。轻点一个节点选中它,
     *     工具条 / 输入框恰好在手指下面弹出来,这一下就会落在它的某个按钮上——实测轻点流程图节点直接触发了
     *     「添加下游」,落点是「删除」的话节点当场被删。以手指按下的位置为准:click 的目标不是手指按下的那个元素、
     *     也不在它的里面 / 外层,就拦掉。(鼠标的 click 在抬起那一刻就发出,早于工具条出现,没有这个问题)
     */
    this.onClick = (e) => {
      const a = e.target.closest && e.target.closest('a');
      if (a && this.svg && this.svg.contains(a)) e.preventDefault();
      if (e.pointerType !== 'touch') return;
      const d = this.downTarget;
      this.downTarget = null;
      if (!d || !e.target || e.target === d) return;
      if (typeof d.contains === 'function' && (d.contains(e.target) || e.target.contains(d))) return;
      e.stopPropagation();
      e.preventDefault();
    };
    stage.addEventListener('keydown', this.onKeyDown);
    stage.addEventListener('pointerdown', this.onPointerDown);
    stage.addEventListener('dblclick', this.onDblClick);
    stage.addEventListener('pointerover', this.onOver);
    stage.addEventListener('pointerout', this.onOut);
    stage.addEventListener('blur', this.onBlur);
    stage.addEventListener('click', this.onClick, true);
    this.onKeyUp = (e) => { if (e.key === ' ') this.holdSpace(false); };
    stage.addEventListener('keyup', this.onKeyUp);
    /* 就地编辑框:按键/失焦由基类接管 */
    ui.ta.addEventListener('keydown', (e) => this.onEditKey(e));
    ui.ta.addEventListener('blur', () => { if (this.editing) this.endEdit(false); });
    ui.ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ui.ta.addEventListener('input', () => this.layoutEdit());
    this.initTools();
  }

  destroy() {
    this.destroyed = true;
    this.renderSeq++;
    const s = this.stage;
    s.removeEventListener('keydown', this.onKeyDown);
    s.removeEventListener('pointerdown', this.onPointerDown);
    s.removeEventListener('dblclick', this.onDblClick);
    s.removeEventListener('pointerover', this.onOver);
    s.removeEventListener('pointerout', this.onOut);
    s.removeEventListener('blur', this.onBlur);
    s.removeEventListener('click', this.onClick, true);
    s.removeEventListener('keyup', this.onKeyUp);
    this.endEdit(true);
    this.destroyTools();
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.hud) { this.hud.remove(); this.hud = null; }
  }

  /*
   * 一个画布单位(viewBox 单位)在屏幕上的像素数。**不是常量**:顶栏缩放(CSS zoom)和容器宽度变化
   * (图比容器宽时被缩到刚好放下)都会改它。只在渲染后量一次的话,缩放 / 改窗口之后手柄会跟着变大变小、
   * 就地输入框和工具条会偏到别处,直到下一次重渲染才恢复。所以每次重画叠加层(refresh)、
   * 每次把画布坐标换算成屏幕坐标(toStageRect)之前都重新量。
   */
  get k() { return this._k || 1; }
  syncScale() {
    this._k = this.svg ? (canvasScale(this.svg) || 1) : 1;
    return this._k;
  }

  /*
   * 图在画布里的基准宽度(v1.4.0)。
   * Mermaid 给的 svg 是 width="100%" + 内联 max-width。放 svg 的那一层宽度跟着内容走,这个 100% 没有可参照的宽度,
   * 浏览器就按"没有固有尺寸的替换元素"给它 300px——2026-11-24 实测:比 300 宽的图(思维导图、类图)在画布里
   * 一律被压成 300px 宽,类图只剩一半大,字看不清。
   * 这里按 viewBox 的宽度把图的宽度写死;图比画布容器还宽时,先缩到刚好放得下。顶栏缩放是在这个基准上乘的:
   * 100% = 原大(或刚好放下),放大超出容器之后可以滚动。
   */
  syncBaseWidth() {
    const svg = this.svg;
    if (!svg) return;
    const vb = (svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(parseFloat);
    if (!(vb[2] > 0)) return;
    const avail = this.innerSize().w;
    const w = avail > 80 ? Math.min(vb[2], avail) : vb[2];
    svg.style.maxWidth = 'none';
    svg.style.width = Math.round(w * 100) / 100 + 'px';
  }

  /* 画布容器扣掉内边距之后的大小 */
  innerSize() {
    const cs = this.stage.ownerDocument.defaultView.getComputedStyle(this.stage);
    const px = (v) => parseFloat(v) || 0;
    return { w: this.stage.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight), h: this.stage.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom) };
  }

  /* 容器尺寸变化(见构造函数里的 ResizeObserver) */
  resize() {
    this.syncBaseWidth();
    if (this.editing) this.layoutEdit();
    this.refresh();
  }

  /* ---------- 子类实现 ---------- */
  // parse(src) → { ok, model | reason }
  // serialize(model) → src
  // afterRender(svg, renderId)   渲染完成后重建映射与叠加层
  // refresh()                    叠加层随选中/悬停变化时重画动态部分
  // deleteSelection() editSelection() addChildFromSelection() addLoose()
  // items()                       可选中对象(方向键遍历)
  // selectionKey(sel)             选中对象在重渲染后如何找回(null = 找不回则清空)
  // toolsFor(sel)                 浮动工具条按钮定义

  /* ---------- 源码与渲染 ---------- */

  /** 宿主调用:节点源码变化(非本画布提交的)。返回 false = 这段源码不支持可视化编辑 */
  setSource(src, opts) {
    if (src === this.src && this.model) return true;
    const r = this.parse(src);
    if (!r.ok) { this.model = null; this.src = src; this.ctx.onState({ unsupported: r.reason }); return false; }
    this.model = r.model;
    this.src = src;
    this.layout = parseLayout(src);
    if (!opts || !opts.keepHistory) { this.undoStack = []; this.redoStack = []; }
    /* 外部改动(撤销、源码模式切回):模型被整体重建,旧选中对象随之作废,连同它的工具条一并收起 */
    this.select(null, { noFocus: true });
    this.render();
    this.state();
    return true;
  }

  render() {
    const seq = ++this.renderSeq;
    const src = this.src;
    this.pending = true; /* 新图还没回来:这期间选中的对象在旧图上找不到是正常的,不能据此清空选中 */
    this.ctx.onState({ busy: true });
    return Promise.resolve()
      .then(() => this.ctx.renderSvg(this.renderSource()))
      .then(({ svg, renderId }) => {
        if (seq !== this.renderSeq || this.destroyed) return;
        this.pending = false;
        this.ui.scaler.textContent = '';
        this.ui.scaler.appendChild(svg);
        this.svg = svg;
        this.renderId = renderId;
        this.syncBaseWidth(); /* 先定宽度:子类的 afterRender 要按图的实际大小建映射与叠加层 */
        this.afterRender(svg, renderId);
        this.syncBaseWidth(); /* 布局落完之后 viewBox 可能变了(画布大小重算),宽度跟着改 */
        this.hasImage = true;
        this.ctx.onState({ busy: false, error: '', hasImage: true });
        return true;
      })
      .catch((e) => {
        if (seq !== this.renderSeq || this.destroyed) return;
        /* 渲染出错保留上一次结果,源码不丢。Mermaid 的报错是多行英文,只留首行并点出出错行号 */
        this.pending = false;
        const raw = String((e && e.message) || e);
        const line = /line\s+(\d+)/i.exec(raw);
        const first = raw.split(/\r?\n/)[0].replace(/^Parse error\s*/i, '').trim();
        /* 引擎没加载上来(网络)与源码有误是两回事:前者说"图源有误"会把人引去改源码 */
        const error = isEngineError(e) ? '绘图引擎加载失败,请刷新页面重试'
          : line ? '第 ' + line[1] + ' 行附近有语法错误' : (first || '语法有误');
        this.ctx.onState({ busy: false, hasImage: !!this.hasImage, error });
        return false;
      });
  }

  /* 实际交给 Mermaid 渲染的源码。默认就是当前源码;子类可在"源码合法但 Mermaid 画不出来"时换成等价的可渲染写法 */
  renderSource() { return this.src; }

  /** 改动模型并收尾:入撤销栈、写回文档、重渲染 */
  mutate(label, fn) {
    const before = this.src;
    const after = fn(this.model);
    /* 布局块跟着源码一起走:结构变了,坐标表里已经不存在的节点顺手清掉 */
    const src = attachLayout(after === undefined ? this.serialize(this.model) : after, this.layout);
    if (src === before) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.apply(src, label);
    return true;
  }

  apply(src, label) {
    this.src = src;
    this.layout = parseLayout(src);
    /* 模型已是最新;只同步序列化基准 */
    this.ctx.commit(src, label);
    this.render();
    this.state();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.src);
    this.revert(prev);
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.src);
    this.revert(next);
    return true;
  }

  revert(src) {
    const r = this.parse(src);
    if (!r.ok) return;
    this.model = r.model;
    this.src = src;
    this.layout = parseLayout(src);
    this.select(null, { noFocus: true }); /* 统一走 select:残留的工具条会停在旧位置上 */
    this.ctx.commit(src);
    this.render();
    this.state();
  }

  state() {
    this.ctx.onState({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      zoom: this.zoom,
      busy: false
    });
  }

  setZoom(z) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 20) / 20));
    this.ui.scaler.style.zoom = this.zoom;
    this.state();
    this.refresh(); /* 手柄、选中框按新的比例重画(工具条的位置随之更新) */
  }

  focus() { this.stage.focus({ preventScroll: true }); }

  /*
   * 适应画布:缩放到整张图刚好放进可视区(不放大过 100%),再滚到居中。
   * 横向按图此刻的宽度算(比容器宽的图已经缩到刚放下了,见 syncBaseWidth——那种情况 100% 就是刚好放进);
   * 纵向按 viewBox 的高换算到同样的比例。滚动要等缩放引起的重排完成之后再做。
   */
  fitToView() {
    if (!this.svg || !this.scene) return false;
    const vb = (this.svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(parseFloat);
    const base = parseFloat(this.svg.style.width) || vb[2];
    const inner = this.innerSize();
    const availW = inner.w, availH = inner.h;
    if (!(availW > 0) || !(availH > 0) || !(vb[2] > 0) || !(vb[3] > 0)) return false;
    this.setZoom(Math.min(1, availW / base, availH * vb[2] / (vb[3] * base)));
    requestAnimationFrame(() => {
      if (this.destroyed) return;
      this.stage.scrollLeft = (this.stage.scrollWidth - this.stage.clientWidth) / 2;
      this.stage.scrollTop = (this.stage.scrollHeight - this.stage.clientHeight) / 2;
      this.refresh();
    });
    return true;
  }

  /* ---------- 布局(v1.4.0 自由画布) ---------- */

  /** 这张图是否已经进了"自由摆放":只要存过任何一个节点的坐标就算 */
  get free() { return !!(this.layout && this.layout.n && Object.keys(this.layout.n).length); }

  /** 渲染之后调用:认图、把布局落上去。子类的 afterRender 在建映射之后、建叠加层之前调 */
  setupScene(svg, kind) {
    this.scene = buildScene(svg, kind);
    applyLayout(svg, this.scene, this.layout);
    this.pruneLayout(); /* 被删掉的节点不再占坐标;下一次提交时写回源码 */
  }

  /* 刚加出来的节点在自由摆放的图里没坐标:挨着它的锚点节点放下(向下或向右),不和谁重叠。
     位置算出来就记进布局并写回文档——不用再渲染一次(DOM 已经在最终位置上) */
  placeSpawned() {
    const sp = this.spawn;
    this.spawn = null;
    if (!sp || !this.scene) return;
    const n = this.scene.byKey[sp.key];
    if (!n || this.layout.n[n.key]) return;
    if (sp.at) {
      /* 工具条 / 右键菜单「在这里添加」:用户点了哪儿就放哪儿(图还没进自由摆放的,先把其余节点的当前位置记下来) */
      if (!this.free) this.scene.nodes.forEach((nd) => { if (nd !== n) this.layout.n[nd.key] = [nd.x, nd.y]; });
      /* 别的节点的框要用 nodeRectOf 包过(带右边界 / 下边界):裸的 {x,y,w,h} 进了 avoidOverlap 永远判成不重叠 */
      const p = avoidOverlap(rectOf(sp.at[0], sp.at[1], n.w, n.h), this.scene.nodes.filter((o) => o !== n).map(nodeRectOf));
      this.layout.n[n.key] = p;
      this.paintLayout();
      this.amend();
      return;
    }
    if (!this.free) return;
    const p = placeNear(this.scene, n, sp.anchor ? this.scene.byKey[sp.anchor] : null, sp.vertical);
    this.layout.n[n.key] = p;
    this.paintLayout();
    this.amend();
  }

  /* 把内存里的布局整份重画到当前渲染结果上(不重新渲染) */
  paintLayout() {
    if (!this.scene || !this.svg) return;
    this.scene.nodes.forEach((nd) => {
      const p = this.layout.n[nd.key];
      if (p) setNodePos(nd, p[0], p[1]);
    });
    this.scene.clusters.forEach(fitCluster);
    rerouteEdges(this.scene);
    this.syncEdgeHits();
    /* 节点挪过之后画布大小要重算:新落位的节点、重画的连线文字可能落在原来的画布框之外
       (2026-11-24 实测:类图新关联类落位后画布比前台矮 30px——前台是按最终位置算的) */
    fitViewBox(this.svg, this.scene, (this.layout && this.layout.items) || []);
    this.syncBaseWidth();
  }

  /* 源码里的布局块换成内存里的这份,写回文档;不重渲染(撤销栈不动:它属于当前这一步) */
  amend() {
    const src = attachLayout(this.src, this.layout);
    if (src === this.src) return false;
    this.src = src;
    this.ctx.commit(src);
    return true;
  }

  /* 坐标表里已经没有对应节点的键(节点被删了)清掉 */
  pruneLayout() {
    if (!this.layout || !this.layout.n || !this.scene) return;
    Object.keys(this.layout.n).forEach((k) => { if (!this.scene.byKey[k]) delete this.layout.n[k]; });
  }

  /*
   * 布局改动提交成一步(可撤销):拖动节点、重新排版、增删改自由元素。
   * norender:图上的 DOM 已经是最新的(只动了自由元素),不必重渲染 Mermaid——撤销时照常重渲染。
   */
  commitLayout(label, opts) {
    this.pruneLayout();
    const src = attachLayout(this.src, this.layout);
    if (src === this.src) return false;
    this.undoStack.push(this.src);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    if (opts && opts.norender) {
      this.src = src;
      this.ctx.commit(src);
      this.state();
      return true;
    }
    this.apply(src, label);
    return true;
  }

  /** 重新排版:清掉所有节点坐标,回到自动排版(自由元素保留) */
  resetLayout() {
    this.layout.n = {};
    return this.commitLayout('重新排版');
  }

  /* 连线命中区跟着 Mermaid 的 path 走(流程图 / 类图在静态层里给每条连线画了一条加宽的透明线) */
  syncEdgeHits() {
    if (!this.edgePaths || !this.ov) return;
    this.edgePaths.forEach((p, i) => {
      if (!p) return;
      const hit = this.ov.querySelector('path.lry-ov-edgehit[data-edge="' + i + '"]');
      if (!hit) return;
      hit.setAttribute('d', p.getAttribute('d') || '');
      const tr = p.getAttribute('transform');
      if (tr) hit.setAttribute('transform', tr); else hit.removeAttribute('transform');
    });
  }

  /*
   * 拖动分三段:开始(记起点)→ 跟随指针 → 松手提交。
   * 拖动过程中只改 DOM(节点、连着它的线、子图框),松手才提交一次 mutate——撤销一步回到拖动前。
   * 拆成三段是因为思维导图要在同一次按住里决定"是挪位置还是换父节点"(按没按 Alt)。
   */
  /*
   * 一次拖动的开始。n 是被按住的节点;it 是被按住的自由元素(二者只给一个)。
   * 被按住的东西在多选里 → 选中的节点和自由元素整组一起挪,相对位置不变;不在 → 只挪它自己。
   * group 里的节点每帧按"起始位置 + 位移"摆放;itemSnaps 留着每个自由元素的起始副本(端点绑在节点上的连线,绑着的那头不动)。
   */
  dragStart(e, n, it) {
    this.draggingNode = true;
    let grouped = false;
    if (n) { this.beginFree(n); grouped = this.nodeSelected(n); }
    else grouped = this.isSelected({ kind: 'item', ref: it.id });
    const snap = (x) => ({ it: x, data: JSON.parse(JSON.stringify(x)) });
    const items = grouped ? this.selectedItems() : (it ? [it] : []);
    return {
      n: n || null, x0: n ? n.x : 0, y0: n ? n.y : 0, start: toCanvasPoint(this.svg, e.clientX, e.clientY),
      group: (grouped ? this.selectedSceneNodes() : (n ? [n] : [])).map((nd) => ({ nd, x0: nd.x, y0: nd.y })),
      itemSnaps: items.map(snap)
    };
  }

  dragTo(st, ev) {
    const p = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
    const dx = p.x - st.start.x, dy = p.y - st.start.y;
    st.group.forEach((g) => setNodePos(g.nd, g.x0 + dx, g.y0 + dy));
    if (st.itemSnaps.length) {
      st.itemSnaps.forEach((s) => {
        Object.keys(s.it).forEach((k) => { delete s.it[k]; });
        Object.assign(s.it, JSON.parse(JSON.stringify(s.data)));
        offsetItem(s.it, dx, dy);
      });
      renderItems(this.svg, this.scene, this.layout.items || []);
    }
    this.scene.clusters.forEach(fitCluster);
    rerouteEdges(this.scene, st.group.map((g) => g.nd.key));
    this.repaintBoundItems();
    this.syncEdgeHits();
    this.refresh();
  }

  dragEnd(st) {
    this.draggingNode = false;
    st.group.forEach((g) => { this.layout.n[g.nd.key] = [g.nd.x, g.nd.y]; });
    if (st.n) this.commitLayout('拖动节点');
    else {
      /* 只挪了自由元素:图本身没变,不用重渲染 Mermaid;重算一下画布大小、把布局块写回源码 */
      fitViewBox(this.svg, this.scene, this.layout.items || []);
      this.syncBaseWidth();
      this.commitLayout('拖动' + (ITEM_LABELS[st.itemSnaps[0].data.k] || '元素'), { norender: true });
    }
    this.refresh();
  }

  /** 按住节点拖动;没拖动就松手 = 选中 sel */
  dragNode(e, n, sel) {
    let st = null;
    this.trackPointer(e, {
      move: (ev, moved) => { if (!moved) return; if (!st) st = this.dragStart(e, n); this.dragTo(st, ev); },
      up: () => { if (!st) { if (sel) this.select(sel); return; } this.dragEnd(st); }
    });
  }

  /* 第一次拖动时把其它节点的当前位置也记下来:之后增删节点,它们不会跟着 Mermaid 重新排版跳动。
     思维导图的自动排版是确定性的树形,只记被拖过的节点 */
  beginFree(n) {
    if (this.scene.kind === 'mind' || this.free) return;
    this.scene.nodes.forEach((nd) => { this.layout.n[nd.key] = [nd.x, nd.y]; });
  }

  /* 移动抓手(画布坐标):HTML 元素,触屏靠它拖节点 */
  gripHandle(x, y, attrs) {
    if (!this.dyn) return;
    this.handle(this.dyn, x, y, 'grip', Object.assign({ 'data-act': 'move' }, attrs || {}), 20);
  }

  /* ---------- 选中与悬停 ---------- */

  select(sel, opts) {
    if (sel && opts && opts.add) { this.toggleSel(sel, opts); return; }
    this.selExtra = [];
    this.sel = sel || null;
    this.refresh();
    if (this.sel) this.showTools();
    else this.hideTools();
    if (sel && !(opts && opts.noFocus)) this.focus();
  }

  /* 多选里追加 / 取消一个(Shift 或 Ctrl 点选、框选时按着修饰键);取消的是主选中时,主选中顺延 */
  toggleSel(sel, opts) {
    const all = this.selectedRefs();
    const at = all.findIndex((r) => this.sameSel(r, sel));
    const wasPrimary = at >= 0 && this.sel && this.sameSel(this.sel, sel);
    if (at >= 0) all.splice(at, 1); else all.push(sel);
    if (!all.length) { this.selExtra = []; this.sel = null; }
    else if (at >= 0 && !wasPrimary) { this.selExtra = all.slice(1); this.sel = all[0]; } /* 移出的不是主选中:主选中不变(all 的第一项就是它) */
    else { this.selExtra = all.slice(0, -1); this.sel = all[all.length - 1]; } /* 加进来的(或移出的正是主选中):最后一项当主选中 */
    this.refresh();
    if (this.sel) this.showTools(); else this.hideTools();
    if (this.sel && !(opts && opts.noFocus)) this.focus();
  }

  /* 当前选中的全部对象(没有多选时就是主选中那一个,或者空) */
  selectedRefs() {
    return this.sel ? [this.sel].concat(this.selExtra.filter((r) => r && !this.sameSel(r, this.sel))) : [];
  }
  isSelected(ref) { return !!ref && this.selectedRefs().some((r) => this.sameSel(r, ref)); }

  /* ---------- 子类为多选 / 自由元素实现的钩子(流程图 / 思维导图 / 类图各自给出) ---------- */
  // refNodeKey(ref)      选中对象对应的节点在坐标表里的键(不是节点类对象时返回 null)
  // refRect(ref)         选中对象在画布里的矩形(对不上时返回 null)
  // selectableRefs()     可以被框选 / 全选的对象
  // isEmpty()            图是空的(点空白 = 加第一个节点,而不是框选)
  // deleteRefs(refs)     一次删掉一组对象(一个撤销步)
  // toolPlace(tool, …)   用工具条往画布上放东西

  setHover(ref) {
    if (this.hover === ref) return;
    this.hover = ref;
    this.refresh();
  }

  /* ---------- 就地文字编辑 ---------- */

  /**
   * 在 rect(相对画布容器的屏幕坐标)上浮出编辑框。
   * @returns {Promise<{value:string,cancelled:boolean}|null>}
   */
  editText(rect, value, opts) {
    this.endEdit(true);
    const o = opts || {};
    const ta = this.ui.ta;
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    ta.value = value === undefined || value === null ? '' : String(value);
    ta.placeholder = o.placeholder || '输入文字';
    ta.className = 'lry-diagram-ta' + (o.multiline ? ' lry-diagram-ta-multi' : '');
    ta.hidden = false;
    ta.style.zoom = this.zoom || 1;
    this.ui.tools.hidden = true;
    this.editing = { resolve, rect, multiline: !!o.multiline };
    this.layoutEdit();
    this.refresh();
    setTimeout(() => {
      if (!this.editing) return;
      ta.focus();
      if (o.selectAll !== false) ta.select();
      else ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
    return done;
  }

  layoutEdit() {
    const ed = this.editing;
    if (!ed) return;
    const ta = this.ui.ta;
    const z = this.zoom || 1;
    const availW = Math.max(1, this.stage.clientWidth - 16);
    const availH = Math.max(28, this.stage.clientHeight - 16);
    const maxW = availW / z;
    const maxH = availH / z;
    const width = Math.min(Math.max(ed.rect.w + 12, 80), availW) / z;
    const minH = Math.min(Math.max(ed.rect.h + 8, 28), availH) / z;
    /* 站点表单的全局 textarea 宽度规则(含移动端 !important)不能把节点输入框撑满画布 */
    ta.style.setProperty('width', width + 'px', 'important');
    ta.style.setProperty('max-width', maxW + 'px', 'important');
    ta.style.setProperty('min-height', minH + 'px', 'important');
    ta.style.setProperty('max-height', maxH + 'px', 'important');
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    const box = ta.getBoundingClientRect();
    const left = Math.min(Math.max(0, ed.rect.x - 6), Math.max(0, this.stage.clientWidth - box.width - 4));
    const top = Math.min(Math.max(0, ed.rect.y - 4), Math.max(0, this.stage.clientHeight - box.height - 8));
    /* left/top 会被编辑框自己的 zoom 再乘一次,先还原成未缩放坐标 */
    ta.style.left = (left + this.stage.scrollLeft) / z + 'px';
    ta.style.top = (top + this.stage.scrollTop) / z + 'px';
  }

  endEdit(cancel) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const ta = this.ui.ta;
    const value = ta.value;
    ta.hidden = true;
    ta.value = '';
    if (ed.resolve) ed.resolve({ value, cancelled: !!cancel });
    this.refresh();
    if (this.sel) this.showTools();
    if (!cancel) this.focus();
  }

  onEditKey(e) {
    if (!this.editing) return;
    e.stopPropagation();
    /* 输入法还在组字(拼音候选框开着):这时按回车是上屏 / 选词,不是"确定"。不拦的话中文类名还没选完就被提交 */
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); this.endEdit(true); return; }
    if (e.key === 'Enter' && (!this.editing.multiline || !e.shiftKey)) {
      e.preventDefault();
      /* Ctrl/Cmd+Enter 也确定;多行时 Shift+Enter 换行 */
      this.endEdit(false);
    }
  }

  /* ---------- 浮动工具条 ---------- */

  /**
   * defs: [{ label, title, icon(html), onPick, active, panel: [子按钮], key, danger }]
   * 带 panel 的按钮点击展开第二行(再次点击收起);同一选中对象上重绘后保持展开。
   */
  showTools() {
    const sel = this.sel;
    const tools = this.ui.tools;
    tools.textContent = '';
    const anchor = sel && this.toolsAnchor ? this.toolsAnchor() : null;
    if (!sel || !anchor) { tools.hidden = true; return; } /* 新建对象还没渲染出来:等 afterRender 再显示 */
    const defs = this.toolsFor(sel);
    if (!defs || !defs.length) { tools.hidden = true; return; }
    const row = (list, cls) => {
      const r = document.createElement('div');
      r.className = 'lry-diagram-tools-row' + (cls ? ' ' + cls : '');
      list.forEach((d) => {
        if (!d) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lry-diagram-tool' + (d.active ? ' lry-diagram-tool-on' : '') + (d.danger ? ' lry-diagram-tool-danger' : '') + (d.icon ? ' lry-diagram-tool-icon' : '');
        b.title = d.title || d.label || '';
        if (d.icon) b.innerHTML = d.icon;
        if (d.label) b.appendChild(h('span', { class: 'lry-diagram-tool-text' }, d.label)); /* 窄屏只留图标(见样式) */
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          /* 子面板按 key 记忆开合:按钮定义每次重绘都是新对象,不能按引用比较 */
          if (d.panel) { this.openPanel = this.openPanel === d.key ? null : d.key; this.showTools(); return; }
          try { d.onPick(); } catch (err) { console.error('[lry-editor] 画布操作失败', err); this.ctx.toast('操作失败:' + err.message); }
        });
        r.appendChild(b);
      });
      return r;
    };
    tools.appendChild(row(defs));
    const open = defs.find((d) => d && d.panel && d.key === this.openPanel);
    if (open) tools.appendChild(row(open.panel, 'lry-diagram-tools-sub'));
    tools.hidden = false;
    this.placeTools(anchor);
  }

  hideTools() {
    this.ui.tools.hidden = true;
    this.openPanel = null;
  }

  /**
   * 工具条定位。锚点矩形相对画布容器的可视区;工具条是容器内的绝对定位元素,
   * 所以落点要加上容器自身的滚动量。
   * 默认贴在选中对象上方(放不下放下方);锚点带 side 标记时(连线:锚点是整条连线的
   * 外接矩形,放上方会压住起点节点)优先贴一侧,再另一侧,都不行退回上下。
   * 先右后左;锚点再带 sideLeft 时先左后右(类图的成员行:右侧留给连线手柄和行尾的 ×)。
   */
  placeTools(anchorRect) {
    const tools = this.ui.tools;
    anchorRect = anchorRect || (this.sel && this.toolsAnchor ? this.toolsAnchor() : null);
    if (tools.hidden || !anchorRect) return;
    const stageRect = this.stage.getBoundingClientRect();
    /* 先归零再量:绝对定位元素的 shrink-to-fit 宽度受当前 left 影响 */
    tools.style.left = '0px';
    const tw = tools.offsetWidth || 200;
    const th = tools.offsetHeight || 34;
    /* 与节点留出手柄的位置:输入手柄画在节点上沿中点、输出手柄在下沿中点,工具条不能压住它们 */
    const gap = 22;
    const fits = (l, t) => l >= 0 && t >= 0 && l + tw <= stageRect.width && t + th <= stageRect.height;
    let left = null;
    let top = null;
    if (anchorRect.side) {
      const sides = anchorRect.sideLeft
        ? [anchorRect.x - tw - 10, anchorRect.x + anchorRect.w + 10]
        : [anchorRect.x + anchorRect.w + 10, anchorRect.x - tw - 10];
      if (fits(sides[0], anchorRect.y)) { left = sides[0]; top = anchorRect.y; }
      else if (fits(sides[1], anchorRect.y)) { left = sides[1]; top = anchorRect.y; }
    }
    if (left === null) {
      left = anchorRect.x + anchorRect.w / 2 - tw / 2;
      top = anchorRect.y - th - gap;
      if (!fits(left, top)) top = anchorRect.y + anchorRect.h + gap; /* 上方放不下 → 下方 */
    }
    /* 都放不下:收进画布可视区 */
    left = Math.max(4, Math.min(left, stageRect.width - tw - 4));
    top = Math.max(0, Math.min(top, stageRect.height - th - 4));
    /*
     * 收进来之后如果压住了选中对象(连同它的手柄,四周外扩 12px)——窄屏上工具条会折成好几行,上下都放不下时
     * 常常正好盖在节点上,节点边缘的 ⊕ / ○ 手柄就点不到了——挪到可视区里不压住它的上沿,再不行下沿。
     */
    const ex = { l: anchorRect.x - 12, t: anchorRect.y - 12, r: anchorRect.x + anchorRect.w + 12, b: anchorRect.y + anchorRect.h + 12 };
    const covers = (t) => left < ex.r && left + tw > ex.l && t < ex.b && t + th > ex.t;
    if (covers(top)) {
      if (!covers(4)) top = 4;
      else if (!covers(stageRect.height - th - 4)) top = stageRect.height - th - 4;
    }
    tools.style.left = left + this.stage.scrollLeft + 'px';
    tools.style.top = top + this.stage.scrollTop + 'px';
  }

  /*
   * 工具条落位(带避让):在上 / 下 / 左 / 右几个候选位置里挑第一个不压住别的框、也不出可视区的;都不行返回 false
   * (调用方退回 placeTools)。节点排得密的图(类图、思维导图)用——工具条压住邻居,用户想点邻居就点不到。
   * @param self   选中对象自己的框(相对画布容器可视区的屏幕矩形)
   * @param others 别的框(同上坐标)
   * @param preferUnder  true = 先试下方(思维导图的子节点在父节点右侧,下方多半是空的)
   * @returns {boolean} 是否找到了位置
   */
  placeToolsAvoid(anchorRect, self, others, preferUnder) {
    const tools = this.ui.tools;
    /* 先归零再量:绝对定位元素的 shrink-to-fit 宽度受当前 left 影响 */
    tools.style.left = '0px';
    const tw = tools.offsetWidth || 200;
    const th = tools.offsetHeight || 34;
    const stage = this.stage.getBoundingClientRect();
    const hits = (l, t) => l < 0 || t < 0 || l + tw > stage.width || t + th > stage.height
      || others.some((o) => l < o.x + o.w + 4 && l + tw > o.x - 4 && t < o.y + o.h + 4 && t + th > o.y - 4);
    /* 上下位置的候选间距:常规 12px 放不下时再收紧到 4px、贴边(框之间常常只有几十像素) */
    const cx = self.x + self.w / 2 - tw / 2;
    const over = [12, 4, 0].map((g) => [cx, self.y - th - g]);
    const under = [12, 4, 0].map((g) => [cx, self.y + self.h + g]);
    const left = [self.x - 16 - tw, self.y], right = [self.x + self.w + 16, self.y];
    /* 成员行这类"贴一侧"的锚点:先试框的左侧(对齐那一行),再上下,最后右侧 */
    const cands = anchorRect && anchorRect.sideLeft
      ? [[self.x - 16 - tw, anchorRect.y], ...under, ...over, [self.x + self.w + 16, anchorRect.y]]
      : (preferUnder ? [...under, right, left, ...over] : [...over, ...under, left, right]);
    const pick = cands.find((c) => !hits(c[0], c[1]));
    if (!pick) return false;
    tools.style.left = pick[0] + this.stage.scrollLeft + 'px';
    tools.style.top = pick[1] + this.stage.scrollTop + 'px';
    return true;
  }

  /* ---------- 指针 ---------- */

  /**
   * 统一的按住-拖动-松开:move/up 回调拿到事件与"是否已移动"。
   * 监听挂在窗口层(捕获阶段)而不用 setPointerCapture:捕获会把后续事件(含 pointerup)的目标
   * 改成画布容器,click / dblclick 的目标随之变成容器而不是节点,双击改文字就失效了;
   * 捕获本身还会触发一轮 pointerout / pointerover,打断"悬停"状态。
   * @param {{move?:Function, up?:Function}} handlers
   */
  trackPointer(e, handlers) {
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 5) moved = true;
      if (handlers.move) handlers.move(ev, moved);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      this.touching = false;
      /* 触屏长按已经出过菜单:这一次按下不再当作"点一下"处理(否则菜单刚出来选中就被取消) */
      if (this.skipUp) { this.skipUp = false; return; }
      if (handlers.up) handlers.up(ev, moved);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  /* 指针下方命中的节点 id(手柄/工具条等叠加层不算) */
  hitNode(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const g = el && el.closest ? el.closest('g.node, g.mindmap-node') : null;
    if (!g || !this.svg || !this.svg.contains(g)) return null;
    return g;
  }

  /*
   * 事件目标落在连线文字上时(文字块盖在连线中段,点文字到不了下面的命中线),按 data-id 找到那条连线在模型里的序号。
   * 流程图的 data-id 在 g.edgeLabel 上,类图在里面的 g.label 上,两处都看。找不到返回 -1。
   */
  edgeIndexAt(target) {
    const holder = target && target.closest ? target.closest('g.edgeLabels g.edgeLabel') : null;
    const inner = holder ? holder.querySelector('g.label') : null;
    const id = holder ? (holder.getAttribute('data-id') || (inner ? inner.getAttribute('data-id') : '') || '') : '';
    if (!id || !this.edgePaths || !this.svg) return -1;
    const p = [...this.svg.querySelectorAll('path.flowchart-link, path.relation')].find((x) => x.getAttribute('data-id') === id);
    return p ? this.edgePaths.indexOf(p) : -1;
  }

  handleOver(e) { /* 子类按需覆盖:悬停手柄 */ }
  handleOut(e) { /* 同上 */ }
  handlePointerDown(e) {
    if (e.button !== 0) return;
    /* 点在工具条/编辑框上:不处理 */
    const t = e.target;
    if (t.closest && (t.closest('.lry-diagram-tools') || t === this.ui.ta)) return;
    if (this.editing) { this.endEdit(false); e.preventDefault(); return; } /* 正在改文字:这一下只用来确定 */
    this.touching = e.pointerType === 'touch';
    /* 刚加的节点还没渲染出来(它的编辑框要等图出来才弹):这期间再点 ⊕ 不处理,快速连点两下只加一个 */
    if (this.pendingEdit) { e.preventDefault(); return; }
    this.downTarget = e.target; /* 触屏幽灵点击的判据,见 onClick */
    /* 阻止默认行为(焦点由下面显式设置):画板块被 ProseMirror 选中时整块是 draggable 的,
       不拦的话在画布里按住一拖,浏览器启动的是"拖动整块"的原生拖拽,指针事件随之中断 */
    e.preventDefault();
    this.focus();
    if (this.commonDown(e)) return; /* 工具条上的工具、自由元素、空白处框选;其余交给子类 */
    this.pointerDown(e);
  }

  handleDblClick(e) {
    const t = e.target;
    if (t.closest && t.closest('.lry-diagram-tools')) return;
    if (this.itemDblClick(e)) return; /* 自由元素:双击改文字 / 换表情 / 换图片 */
    this.dblClick(e);
  }

  /* ---------- 按键 ---------- */

  handleKey(e) {
    if (this.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === ' ') { this.holdSpace(true); e.preventDefault(); return true; } /* 空格按住期间 = 临时抓手 */
    if (mod && (k === 'z' || k === 'y')) {
      const done = (k === 'y' || e.shiftKey) ? this.redo() : this.undo();
      /* 画布自己没有可回退/重做的步骤时,转成正文级撤销重做(事件本身到不了 ProseMirror) */
      if (!done) this.ctx.docUndo(k === 'y' || e.shiftKey);
      e.preventDefault(); e.stopPropagation();
      return true;
    }
    /* v1.4.1:全选 / 剪切 / 粘贴。复制不在这里做——走浏览器的 copy 事件(不用申请剪贴板权限),见 canvas-tools.js */
    if (mod && k === 'a') { e.preventDefault(); e.stopPropagation(); this.selectAll(); return true; }
    if (mod && k === 'x') { e.preventDefault(); e.stopPropagation(); this.cutSelection(); return true; }
    if (mod && k === 'v') { e.preventDefault(); e.stopPropagation(); this.pasteSelection(null); return true; }
    if (mod) return false;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (this.cancelTransient()) return true; /* 正在用别的工具 / 框选 / 拉连线:先退回选择工具 */
      if (this.sel) { this.select(null); return true; }
      this.ctx.leaveCanvas();
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!this.sel) return false;
      e.preventDefault(); e.stopPropagation();
      this.deleteSelected(); /* 多选时整组删(一个撤销步);否则走各画板原来的删除 */
      return true;
    }
    if (e.key === 'Enter') {
      if (!this.sel) return false;
      e.preventDefault(); e.stopPropagation();
      this.enterSelection();
      return true;
    }
    if (e.key === 'Tab') {
      if (!this.sel) return false; /* 没有选中对象时 Tab 照常移出画布 */
      e.preventDefault(); e.stopPropagation();
      this.addChildFromSelection();
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const items = this.items();
      if (!items.length) return false;
      e.preventDefault(); e.stopPropagation();
      const cur = items.findIndex((it) => this.sameSel(it, this.sel));
      const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
      this.select(items[cur < 0 ? 0 : (cur + dir + items.length) % items.length]);
      return true;
    }
    return false;
  }

  /*
   * 重画动态叠加层前清空它。**触屏上正按着的时候不能直接移除里面的元素**:手指按着的往往是手柄,
   * 按下这一下就会触发重画;把被按住的元素从文档里摘掉之后,浏览器不再认它的 touch-action:none,
   * 指针一移动就接管成滚动手势(pointercancel),连线 / 改接拖不下去。鼠标没有这个问题。
   * 所以触摸期间把旧元素先挪进一个隐藏分组(仍在文档里),松手后的下一次重画再真正清掉。
   */
  clearDynamic() {
    if (this.touching && (this.dyn.childNodes.length || (this.hud && this.hud.childNodes.length))) {
      if (!this.grave) this.grave = svgEl('g', { class: 'lry-ov-old', visibility: 'hidden' }, this.ov);
      while (this.dyn.firstChild) this.grave.appendChild(this.dyn.firstChild);
      if (!this.hudGrave) { this.hudGrave = document.createElement('div'); this.hudGrave.className = 'lry-ov-old'; this.hud.appendChild(this.hudGrave); }
      while (this.hud.firstChild && this.hud.firstChild !== this.hudGrave) this.hudGrave.appendChild(this.hud.firstChild);
      return;
    }
    if (this.grave) this.grave.textContent = '';
    this.dyn.textContent = '';
    if (this.hud) this.hud.textContent = '';
  }

  /* 画布(viewBox)矩形 → 相对画布容器的屏幕矩形。先重量比例:上一次重画之后可能缩放或改过窗口 */
  toStageRect(r) {
    this.syncScale();
    const vb = (this.svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(parseFloat);
    const o = this.svg.getBoundingClientRect();
    const c = this.stage.getBoundingClientRect();
    const k = this.k;
    return { x: o.left - c.left + (r.x - vb[0]) * k, y: o.top - c.top + (r.y - vb[1]) * k, w: r.w * k, h: r.h * k };
  }

  /* ---------- 叠加层小工具 ---------- */

  newOverlay() {
    const root = this.svg.querySelector('g') || this.svg;
    const ov = svgEl('g', { class: 'lry-ov' }, root);
    this.syncScale();
    /* 手柄放在 HTML 浮层里(见 handle) */
    if (!this.hud || !this.hud.isConnected) {
      this.hud = document.createElement('div');
      this.hud.className = 'lry-ov-hud';
      this.stage.appendChild(this.hud);
    }
    return ov;
  }

  /*
   * 手柄(⊕ ○ × 改接端点):**HTML 元素**,浮在画布容器里、按屏幕像素定位;大小不随画布缩放变。
   * 不画成 SVG 图形是有原因的:触屏上"这次触摸不参与滚动手势"(touch-action:none)这种声明,浏览器只认
   * HTML 元素和外层 svg,不认 SVG 内部的图形。手柄要靠按住拖动来连线 / 改接,做成 SVG 图形的话手机上一拖就被
   * 浏览器接管成滚动页面(实测)。x / y 是画布坐标;size 为直径(px),默认 18。
   */
  handle(ov, x, y, glyph, attrs, size) {
    const d = size || 18;
    const el = document.createElement('div');
    el.className = 'lry-ov-handle';
    const pt = this.toStageRect({ x, y, w: 0, h: 0 }); /* 相对画布容器的可视区;定位要加上容器自身的滚动量 */
    el.style.left = pt.x + this.stage.scrollLeft + 'px';
    el.style.top = pt.y + this.stage.scrollTop + 'px';
    el.style.width = el.style.height = d + 'px';
    el.style.margin = (-d / 2) + 'px 0 0 ' + (-d / 2) + 'px';
    el.innerHTML = HANDLE_ICON[glyph] || '';
    if (attrs) Object.keys(attrs).forEach((k) => { const v = attrs[k]; if (v === undefined || v === null) return; if (k === 'class') el.className = v; else el.setAttribute(k, v); });
    if (this.hud) this.hud.appendChild(el);
    return el;
  }

  box(ov, r, cls, pad) {
    const k = this.k;
    const p = (pad || 0) / k;
    return svgEl('rect', { x: r.x - p, y: r.y - p, width: r.w + p * 2, height: r.h + p * 2, rx: 6 / k, class: cls, 'vector-effect': 'non-scaling-stroke' }, ov);
  }

  sameSel(a, b) {
    return !!a && !!b && a.kind === b.kind && a.ref === b.ref;
  }
}

/* 工具条用的小图标(16px 线性,与 ui/icons.js 同风格) */
export const toolIcon = (paths) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
export const MINI = {
  trash: toolIcon('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>'),
  edit: toolIcon('<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m13.5 7.5 3 3"/>'),
  up: toolIcon('<path d="m6 14 6-6 6 6"/>'),
  down: toolIcon('<path d="m6 10 6 6 6-6"/>'),
  plus: toolIcon('<path d="M12 5v14M5 12h14"/>'),
  branch: toolIcon('<circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8 11l8-4.2M8 13l8 4.2"/>'),
  sibling: toolIcon('<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2" stroke-dasharray="3 2"/>'),
  shape: {
    rect: toolIcon('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
    rounded: toolIcon('<rect x="4" y="6" width="16" height="12" rx="6"/>'),
    stadium: toolIcon('<rect x="3" y="7" width="18" height="10" rx="5"/>'),
    diamond: toolIcon('<path d="M12 4l8 8-8 8-8-8z"/>'),
    circle: toolIcon('<circle cx="12" cy="12" r="8"/>'),
    para: toolIcon('<path d="M8 6h12l-4 12H4z"/>'),
    sub: toolIcon('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M8 5v14M16 5v14"/>'),
    db: toolIcon('<path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>'),
    hex: toolIcon('<path d="M8 5h8l4 7-4 7H8l-4-7z"/>'),
    default: toolIcon('<path d="M5 12h14"/>'),
    square: toolIcon('<rect x="5" y="5" width="14" height="14" rx="1"/>'),
    bang: toolIcon('<path d="M12 3l2.2 5.6L20 6l-2.6 5.4L22 14l-5.8.6L17 20l-5-3-5 3 0.8-5.4L2 14l4.6-2.6L4 6l5.8 2.6z"/>'),
    cloud: toolIcon('<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4 4 0 0 1-.5 9z"/>')
  },
  line: {
    arrow: toolIcon('<path d="M4 12h14"/><path d="m14 8 4 4-4 4"/>'),
    line: toolIcon('<path d="M4 12h16"/>'),
    dotted: toolIcon('<path d="M4 12h16" stroke-dasharray="3 2.5"/>'),
    thick: toolIcon('<path d="M4 12h14" stroke-width="3.4"/><path d="m14 8 4 4-4 4"/>'),
    circle: toolIcon('<path d="M4 12h13"/><circle cx="19" cy="12" r="2.2"/>'),
    cross: toolIcon('<path d="M4 12h13"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/>')
  },
  text: toolIcon('<path d="M5 6h14M12 6v13"/>'),
  note: toolIcon('<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h5"/>'),
  braces: toolIcon('<path d="m9 7-5 5 5 5M15 7l5 5-5 5"/>'),
  swap: toolIcon('<path d="M4 8h13"/><path d="m14 4 4 4-4 4"/><path d="M20 16H7"/><path d="m10 12-4 4 4 4"/>'),
  card: toolIcon('<path d="M4 5h16v14H4z"/><path d="M8 9h.01M8 12h8M8 15h5"/>'),
  dirV: toolIcon('<path d="M12 4v14"/><path d="m8 14 4 4 4-4"/>'),
  dirH: toolIcon('<path d="M4 12h14"/><path d="m14 8 4 4-4 4"/>')
};

/* 第二层能力(多选 / 工具条 / 自由元素 / 右键菜单 / 剪贴板 / 平移缩放 / 导出)装在原型上,见 canvas-tools.js */
installCanvasTools(DiagramCanvas);
