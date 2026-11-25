/**
 * 流程图可视化编辑(v1.3.0;v1.4.0 起可自由摆放)。在 Mermaid 渲染结果上叠加交互层,改的是结构模型(节点/连线)。
 * 没拖过节点时布局由 Mermaid 自动完成;拖过之后位置记在图源码末尾的布局块里(diagram/layout-core.js),
 * 新加的节点挨着锚点节点落位、不和谁重叠,其余节点保持不动——编辑器里看到的就是发布后的样子。
 *
 *   悬停节点(选择工具下):输出侧出 ⊕、输入侧出 ○。点 ⊕ = 加一个下游节点并连线(随即进入文字编辑);
 *             从任一手柄按住拖到另一个节点 = 连线(输入侧手柄 = 把对方连到本节点)。
 *   双击节点改文字;单击选中出工具条(添加下游 / 改文字 / 形状 / 配色 / 同层换序 / 删除)。
 *   按住节点(或选中后上方的移动抓手)拖 = 挪位置,连着它的线和连线文字跟着走;松手算一步,可撤销。
 *   连线可点选:线型、端点、文字、删除;拖动两端的小圆点可改接。
 *   按键:Tab 加下游节点、Enter 改文字、Delete 删除、↑↓ 换选中、Ctrl+Z / Ctrl+Shift+Z、Esc 取消。
 *
 * v1.4.1 自由画布:多选 / 框选 / 左侧工具条 / 右键菜单 / 复制粘贴 / 平移缩放 / 导出是三种图共用的,在 canvas-tools.js。
 * 流程图自己的部分:工具条的「图形」放的是**真实节点**(能连线,形状按工具里选的来);「连线」两头都落在节点上时
 * 连的是真实连线,否则是自由的连线元素;复制粘贴带走节点、选中的节点之间的连线、它们的位置。
 */
import { DiagramCanvas, MINI } from './diagram-canvas.js';
import { parseFlow, serializeFlow, nextNodeId, SHAPES, EDGE_TYPES, FLOW_LABELS, flowAdd, flowAddEdge, flowReconnect, flowRemoveNode, flowRemoveEdge, flowShift } from './flow-syntax.js';
import { svgEl, nodeRect, labelRect, toCanvasPoint, mapFlowSvg, rectIn } from './svg-map.js';
import { nodeRectOf } from './layout-core.js';
import { getItem, itemBox } from './items.js';

/* 配色档(浅色底,默认主题的深色字可读);null = 主题默认 */
const FILLS = [null, '#E8F1FF', '#FFF1DE', '#E6F7EC', '#FDE8EC', '#EFE9FF', '#EFF1F4'];
const swatch = (fill) => '<span class="lry-diagram-swatch' + (fill ? '' : ' lry-diagram-swatch-none') + '"' + (fill ? ' style="background:' + fill + '"' : '') + '></span>';
const r2 = (v) => Math.round(v * 100) / 100;

export class FlowEditor extends DiagramCanvas {
  parse(src) { return parseFlow(src); }
  serialize(m) { return serializeFlow(m); }

  render() {
    return super.render().then((applied) => {
      /* 新建的节点:等它渲染出来再进入文字编辑。被更新的渲染取代的那一次不算 */
      if (!applied) return;
      const id = this.pendingEdit;
      this.pendingEdit = null;
      if (id && this.model && this.model.byId[id] && this.svg) this.editNode(this.model.byId[id]);
    });
  }

  /* ---------- 渲染后:映射 + 叠加层 ---------- */

  afterRender(svg, renderId) {
    const { nodeEls, edgePaths } = mapFlowSvg(svg, renderId, this.model);
    this.nodeEls = nodeEls;
    this.edgePaths = edgePaths;
    this.setupScene(svg, 'flow'); /* 认图 + 落布局(自由摆放的节点归位、连线重画) */
    this.placeSpawned();
    this.ov = this.newOverlay();
    const base = svgEl('g', { class: 'lry-ov-static' }, this.ov);
    this.dyn = svgEl('g', { class: 'lry-ov-dyn' }, this.ov);
    /* 连线命中区:加宽的透明线叠在原连线上 */
    this.edgePaths.forEach((p, i) => {
      if (p) svgEl('path', { d: p.getAttribute('d'), class: 'lry-ov-edgehit', 'data-edge': i }, base);
    });
    this.ctx.onState({ empty: !this.model.nodes.length });
    this.refresh();
    if (this.sel) this.showTools(); /* 图变了位置:工具条跟着重定位 */
    else this.hideTools();
  }

  idOf(g) {
    const prefix = this.renderId + '-flowchart-';
    const id = g.getAttribute('id') || '';
    return id.indexOf(prefix) === 0 ? id.slice(prefix.length).replace(/-\d+$/, '') : null;
  }

  /* 输出 / 输入手柄在画布坐标里的位置(随图的方向) */
  portOf(r, side) {
    const vertical = this.model.direction !== 'LR' && this.model.direction !== 'RL';
    const flip = this.model.direction === 'BT' || this.model.direction === 'RL';
    const out = side === 'out' ? !flip : flip;
    if (vertical) return out ? { x: r.cx, y: r.y + r.h } : { x: r.cx, y: r.y };
    return out ? { x: r.x + r.w, y: r.cy } : { x: r.x, y: r.cy };
  }

  refresh() {
    if (!this.dyn || !this.svg) return;
    this.syncScale(); /* 缩放 / 改过窗口之后,比例可能变了 */
    this.clearDynamic();
    const sel = this.sel;
    if (sel && sel.kind === 'node') {
      const g = this.nodeEls[sel.ref];
      if (!g) { if (!this.pending) this.loseSelection(); }
      else {
        this.box(this.dyn, nodeRect(g), 'lry-ov-selbox', 3);
        /* 选中节点的移动抓手:纵向图放左侧、横向图放上方,不和出入手柄(底 / 顶、右 / 左)打架 */
        const nd = this.scene && this.scene.byKey[sel.ref];
        if (nd && !this.editing) {
          if (this.model.direction === 'LR' || this.model.direction === 'RL') this.gripHandle(nd.x + nd.w / 2, nd.y - 12, { 'data-ref': sel.ref });
          else this.gripHandle(nd.x - 14, nd.y + nd.h / 2, { 'data-ref': sel.ref });
        }
      }
    } else if (sel && sel.kind === 'edge') {
      const p = this.edgePaths[sel.index];
      if (!p) { if (!this.pending) this.loseSelection(); }
      else {
        svgEl('path', { d: p.getAttribute('d'), class: 'lry-ov-edgesel', 'vector-effect': 'non-scaling-stroke' }, this.dyn);
        const d = p.getAttribute('d');
        const nums = (String(d || '').match(/-?[\d.]+/g) || [0, 0, 0, 0]).map(Number);
        const ends = [
          { x: nums[0], y: nums[1], end: 'from' },
          { x: nums[nums.length - 2], y: nums[nums.length - 1], end: 'to' }
        ];
        ends.forEach((o) => this.handle(this.dyn, o.x, o.y, 'dot', { 'data-act': 'end', 'data-end': o.end, 'data-edge': sel.index, 'data-x': o.x, 'data-y': o.y }));
      }
    }
    /* 出手柄的节点:悬停优先(选中着别的节点时也要能从其它节点起拖),没有悬停时是选中的节点。
       用别的工具(抓手 / 文字 / 连线…)时不画——那几下按住不是"连线" */
    const hov = this.picking ? (this.hover || (sel && sel.kind === 'node' ? sel.ref : null)) : null;
    const g = hov && this.nodeEls[hov];
    if (g && !this.editing) {
      const r = nodeRect(g);
      [['out', 'plus'], ['in', 'ring']].forEach(([side, glyph]) => {
        const o = this.portOf(r, side);
        this.handle(this.dyn, o.x, o.y, glyph, { 'data-act': side, 'data-ref': hov, 'data-x': o.x, 'data-y': o.y });
      });
    }
    /* 拖拽连线的橡皮筋 */
    const c = this.connect;
    if (c) {
      const end = c.targetEl ? nodeRect(c.targetEl) : null;
      svgEl('line', { x1: c.x, y1: c.y, x2: end ? end.cx : c.pt.x, y2: end ? end.cy : c.pt.y, class: 'lry-ov-rubber', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': (6 / this.k) + ' ' + (4 / this.k) }, this.dyn);
      if (end) this.box(this.dyn, end, 'lry-ov-target', 3);
    }
    if (this.sel) this.placeTools();
    this.drawExtra(); /* 多选框、自由元素的手柄、框选矩形、工具的草稿(见 canvas-tools.js) */
  }

  /*
   * 工具条落位(带避让,v1.4.0):自由摆放之后节点之间常常只隔几十像素,工具条贴在选中节点上方会压住邻居
   * (2026-11-24 实测:新加的下游节点紧挨着上游节点,工具条正好盖住上游节点的文字)。
   * 上 / 下 / 左 / 右几个位置里挑第一个不压住别的节点的;都不行退回基类。连线的工具条仍按基类的"贴一侧"。
   */
  placeTools(anchorRect) {
    anchorRect = anchorRect || (this.sel && this.toolsAnchor ? this.toolsAnchor() : null);
    if (this.ui.tools.hidden || !anchorRect || !this.scene || !this.sel || this.sel.kind !== 'node') { super.placeTools(anchorRect); return; }
    const others = this.scene.nodes.filter((n) => n.key !== this.sel.ref).map((n) => this.toStageRect(nodeRectOf(n)));
    if (!this.placeToolsAvoid(anchorRect, anchorRect, others, false)) super.placeTools(anchorRect);
  }

  /* 选中对象在重渲染后不在了 */
  loseSelection() {
    this.sel = null;
    this.selExtra = [];
    this.hideTools();
  }

  /* ---------- 指针 ---------- */

  handleOver(e) {
    const t = e.target;
    const h = t.closest && t.closest('.lry-ov-handle');
    if (h && h.getAttribute('data-ref')) { this.setHover(h.getAttribute('data-ref')); return; }
    const g = t.closest && t.closest('g.node');
    const id = g ? this.idOf(g) : null;
    if (id && this.nodeEls[id]) this.setHover(id);
  }

  handleOut(e) {
    const g = e.target.closest && e.target.closest('g.node');
    if (!g) return;
    const to = e.relatedTarget;
    /* 移到本节点的手柄上(手柄画在节点外侧)不算离开 */
    if (to && g.contains(to)) return;
    if (to && to.closest && to.closest('.lry-ov-handle') && to.closest('.lry-ov-handle').getAttribute('data-ref') === this.idOf(g)) return;
    this.setHover(null);
  }

  pointerDown(e) {
    if (this.commonDown(e)) return; /* 工具条上的工具、自由元素、空白处框选(见 canvas-tools.js) */
    const h = e.target.closest('.lry-ov-handle');
    if (h) {
      e.preventDefault();
      const act = h.getAttribute('data-act');
      const ref = h.getAttribute('data-ref');
      if (act === 'out') this.startConnect(e, { from: ref, tap: () => this.addLinked(ref, 'out') }, h);
      else if (act === 'in') this.startConnect(e, { to: ref }, h);
      else if (act === 'end') this.startReconnect(e, +h.getAttribute('data-edge'), h.getAttribute('data-end'), h);
      else if (act === 'move') { const nd = this.scene && this.scene.byKey[ref]; if (nd) this.dragNode(e, nd, { kind: 'node', ref }); }
      return;
    }
    const hit = e.target.closest('.lry-ov-edgehit');
    if (hit) { this.select({ kind: 'edge', index: +hit.getAttribute('data-edge') }); return; }
    const li = this.edgeIndexAt(e.target); /* 点在连线文字上:同样选中这条连线 */
    if (li >= 0) { this.select({ kind: 'edge', index: li }); return; }
    const ng = e.target.closest('g.node');
    if (!ng) { this.select(null); return; } /* 走到这儿的空白不多见(框选已在 commonDown 里处理) */
    const id = this.idOf(ng);
    if (!id) return;
    const nd = this.scene && this.scene.byKey[id];
    if (nd) { this.nodeDown(e, nd, { kind: 'node', ref: id }); return; } /* 按住拖 = 挪位置(多选时整组);没拖动就松手 = 选中 */
    this.trackPointer(e, { up: (ev, moved) => { if (!moved) this.select({ kind: 'node', ref: id }); } });
  }

  dblClick(e) {
    /* 按坐标命中而不是看事件目标:前面的按下-松开可能让事件目标变成容器 */
    const ng = this.hitNode(e.clientX, e.clientY);
    if (ng) {
      const id = this.idOf(ng);
      if (id && this.model.byId[id]) this.editNode(this.model.byId[id]);
      return;
    }
    const hit = e.target.closest('.lry-ov-edgehit');
    const li = this.edgeIndexAt(document.elementFromPoint(e.clientX, e.clientY)); /* 双击连线文字 */
    if (hit) this.editEdgeLabel(+hit.getAttribute('data-edge'));
    else if (li >= 0) this.editEdgeLabel(li);
    else if (!this.model.nodes.length) this.addLoose();
  }

  /* 拖动期间的统一收尾:记录指针下的节点,重画橡皮筋 */
  trackAim(e, c, onUp) {
    this.trackPointer(e, {
      move: (ev) => {
        const g = this.hitNode(ev.clientX, ev.clientY);
        c.pt = toCanvasPoint(this.svg, ev.clientX, ev.clientY);
        c.targetEl = g;
        c.target = g ? this.idOf(g) : null;
        this.refresh();
      },
      up: (ev, moved) => {
        this.connect = null;
        onUp(c, moved);
        this.refresh();
      }
    });
  }

  /* 从手柄按住拖动:拖到另一个节点上松手 = 连线;原地松手(没拖动)= 点击 */
  startConnect(e, spec, handleEl) {
    spec.x = parseFloat(handleEl.getAttribute('data-x'));
    spec.y = parseFloat(handleEl.getAttribute('data-y'));
    spec.pt = { x: spec.x, y: spec.y };
    spec.target = null;
    this.connect = spec;
    this.refresh();
    this.trackAim(e, spec, (c, moved) => {
      if (!moved) { if (c.tap) c.tap(); return; }
      if (!c.target) return;
      if (c.from) this.link(c.from, c.target);
      else this.link(c.target, c.to);
    });
  }

  /* 拖动连线端点改接:橡皮筋从不动的那一端画起 */
  startReconnect(e, index, end, handleEl) {
    const c = { index, end, x: 0, y: 0, pt: null, target: null, targetEl: null };
    const p = this.edgePaths[index];
    const nums = (String(p.getAttribute('d') || '').match(/-?[\d.]+/g) || [0, 0, 0, 0]).map(Number);
    const fixed = end === 'from' ? { x: nums[nums.length - 2], y: nums[nums.length - 1] } : { x: nums[0], y: nums[1] };
    c.x = fixed.x; c.y = fixed.y; c.pt = { x: c.x, y: c.y };
    this.connect = c;
    this.refresh();
    this.trackAim(e, c, (cc, moved) => {
      if (moved && cc.target) this.reconnect(index, end, cc.target);
    });
  }

  /* ---------- 结构操作(模型怎么变在 flow-syntax.js,这里只管选中与提示) ---------- */

  /* 加一个节点(可选同时连一条线),写进 group 所在的块。建成后选中它并进入文字编辑 */
  addNode(label, shape, group, edge) {
    let id = null, anchor = null;
    this.mutate('添加节点', (m) => {
      const n = { id: nextNodeId(m), label, shape, fill: null, styleRest: null };
      const spec = edge ? Object.assign({ type: 'arrow', label: '' }, edge(n.id)) : null;
      if (spec) anchor = spec.from === n.id ? spec.to : spec.from; /* 新节点挨着与它相连的那个放 */
      flowAdd(m, n, spec, group);
      id = n.id;
      this.pendingEdit = n.id;
    });
    if (id) {
      /* 图已经在自由摆放:渲染出来后把它放到锚点旁边(见 placeSpawned)。竖图向下、横图向右 */
      const vertical = this.model.direction !== 'LR' && this.model.direction !== 'RL';
      this.spawn = { key: id, anchor, vertical };
      this.select({ kind: 'node', ref: id });
    }
    return id;
  }

  /* 加一个与 node 相连的节点:side=out 为下游(node → 新节点),in 为上游 */
  addLinked(nodeId, side) {
    const from = this.model.byId[nodeId];
    if (!from) return;
    this.addNode('新节点', 'rect', from.group, side === 'out' ? (id) => ({ from: nodeId, to: id }) : (id) => ({ from: id, to: nodeId }));
  }

  addLoose() {
    this.addNode('开始', 'stadium', null, null);
  }

  link(a, b) {
    if (a === b) { this.ctx.toast('不能连到节点自己'); return; }
    const ma = this.model.byId[a];
    const mb = this.model.byId[b];
    if (!ma || !mb) return;
    if (this.model.edges.some((e) => e.from === a && e.to === b)) { this.ctx.toast('这两个节点之间已有连线'); return; }
    this.mutate('连线', (m) => { flowAddEdge(m, { from: a, to: b, type: 'arrow', label: '' }, ma, mb); });
    this.select({ kind: 'edge', index: this.model.edges.length - 1 });
  }

  reconnect(index, end, target) {
    const e = this.model.edges[index];
    if (!e) return;
    const from = end === 'from' ? target : e.from;
    const to = end === 'to' ? target : e.to;
    if (from === to) { this.ctx.toast('不能连到节点自己'); return; }
    if (!this.model.byId[from] || !this.model.byId[to]) return;
    if (this.model.edges.some((x, i) => i !== index && x.from === from && x.to === to)) { this.ctx.toast('这两个节点之间已有连线'); return; }
    this.mutate('改接连线', (m) => { flowReconnect(m, index, from, to); });
  }

  removeNode(node) {
    if (!node) return;
    this.select(null);
    this.mutate('删除节点', (m) => { flowRemoveNode(m, node.id); });
  }

  removeEdge(index) {
    this.select(null);
    this.mutate('删除连线', (m) => { flowRemoveEdge(m, index); });
  }

  /* 同层换序:与相邻的同层节点、且彼此没有直接连线的节点互换先后(定义提前,连线顺序不动) */
  shift(node, dir) {
    if (!node) return;
    const done = this.mutate('同层换序', (m) => { flowShift(m, node, dir); });
    if (!done) this.ctx.toast(dir < 0 ? '已经在同层最上方' : '已经在同层最下方');
  }

  setDirection(d) {
    if (this.model.direction === d) return;
    this.mutate('切换方向', (m) => { m.direction = d; });
  }

  /* 顶栏的方向按钮:纵向(TD / BT)与横向(LR / RL)互切 */
  flipDirection() { this.setDirection(this.model.direction === 'LR' ? 'TD' : 'LR'); }

  /* 进入文字编辑(全选原文字,直接输入即整体替换;要追加先按 → 把光标移到末尾) */
  editNode(node) {
    if (!node || !this.nodeEls) return; /* 图还没渲染出来(引擎加载中):无从定位编辑框 */
    const g = this.nodeEls[node.id];
    if (!g) return;
    const fo = g.querySelector('foreignObject');
    /* 编辑框贴着文字块;没有文字块时贴着整个节点 */
    const rect = fo ? this.toStageRect(labelRect(g)) : this.toStageRect(nodeRect(g));
    this.editText(rect, node.label, { multiline: true }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'node', ref: node.id }); return; }
      this.mutate('改文字', (m) => { if (m.byId[node.id]) m.byId[node.id].label = res.value; });
      this.select({ kind: 'node', ref: node.id });
    });
  }

  editEdgeLabel(index) {
    if (!this.edgePaths) return; /* 图还没渲染出来 */
    const p = this.edgePaths[index];
    const e = this.model.edges[index];
    if (!p || !e) return;
    const r = rectIn(p, this.stage);
    this.editText({ x: r.x + r.w / 2 - 70, y: r.y + r.h / 2 - 15, w: 140, h: 30 }, e.label, { placeholder: '连线文字,如:是 / 否' }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'edge', index }); return; }
      this.mutate('改连线文字', (m) => { if (m.edges[index]) m.edges[index].label = res.value.replace(/[\r\n]+/g, ' '); });
      this.select({ kind: 'edge', index });
    });
  }

  /* ---------- 选中对象的默认动作(按键与工具条共用) ---------- */

  deleteSelection() {
    if (!this.sel) return;
    if (this.sel.kind === 'node') this.removeNode(this.model.byId[this.sel.ref]);
    else if (this.sel.kind === 'edge') this.removeEdge(this.sel.index);
    else this.deleteRefs([this.sel]);
  }

  enterSelection() {
    if (!this.sel) return;
    if (this.sel.kind === 'node') this.editNode(this.model.byId[this.sel.ref]);
    else this.editEdgeLabel(this.sel.index);
  }

  addChildFromSelection() {
    if (this.sel && this.sel.kind === 'node' && this.model.byId[this.sel.ref]) this.addLinked(this.sel.ref, 'out');
  }

  items() {
    return this.selectableRefs();
  }

  toolsAnchor() {
    if (!this.sel || !this.nodeEls) return null;
    if (this.sel.kind === 'item') { const r = this.itemBoxOf(this.sel.ref); return r ? this.toStageRect(r) : null; }
    if (this.sel.kind === 'node') {
      const g = this.nodeEls[this.sel.ref];
      return g ? this.toStageRect(nodeRect(g)) : null;
    }
    const p = this.edgePaths[this.sel.index];
    if (!p) return null;
    /* 锚在整条连线的外接矩形上:工具条贴着连线上沿之上,与两端的改接手柄留出间距
       (锚在中点的话,竖向连线的工具条会正好压住起点手柄) */
    return Object.assign(rectIn(p, this.stage), { side: true });
  }

  toolsFor(sel) {
    const m = this.model;
    if (sel.kind === 'item') return this.itemTools(sel);
    if (sel.kind === 'node') {
      const node = m.byId[sel.ref];
      if (!node) return null;
      const patch = (label, fn) => this.mutate(label, (mm) => { if (mm.byId[node.id]) fn(mm.byId[node.id]); });
      return [
        { label: '添加下游', title: '添加下游节点并连线 (Tab)', icon: MINI.plus, onPick: () => this.addLinked(node.id, 'out') },
        { label: '改文字', title: '修改文字 (Enter 或双击)', icon: MINI.edit, onPick: () => this.editNode(node) },
        {
          key: 'shape', label: '形状', title: '切换形状', icon: MINI.shape[SHAPES[node.shape] ? node.shape : 'rect'],
          panel: Object.keys(SHAPES).map((k) => ({
            title: FLOW_LABELS.shapes[k], icon: MINI.shape[k], active: node.shape === k,
            onPick: () => patch('切换形状', (n) => { n.shape = k; })
          }))
        },
        {
          key: 'fill', label: '配色', title: '节点底色', icon: swatch(node.fill),
          panel: FILLS.map((f) => ({
            title: f ? '底色 ' + f : '主题默认', icon: swatch(f), active: (node.fill || null) === f,
            onPick: () => patch('节点配色', (n) => { n.fill = f; })
          }))
        },
        { icon: MINI.up, title: '与上一个同层节点换序', onPick: () => this.shift(node, -1) },
        { icon: MINI.down, title: '与下一个同层节点换序', onPick: () => this.shift(node, 1) },
        { icon: MINI.trash, title: '删除节点(连同它的连线) (Delete)', danger: true, onPick: () => this.removeNode(node) }
      ];
    }
    const e = m.edges[sel.index];
    if (!e) return null;
    const setType = (t) => this.mutate('切换连线样式', (mm) => { if (mm.edges[sel.index]) mm.edges[sel.index].type = t; });
    return [
      ...['arrow', 'line', 'dotted', 'thick'].map((t) => ({ title: FLOW_LABELS.edges[t], icon: MINI.line[t], active: e.type === t, onPick: () => setType(t) })),
      { label: '文字', title: '连线文字', icon: MINI.text, onPick: () => this.editEdgeLabel(sel.index) },
      ...['circle', 'cross'].map((t) => ({ title: FLOW_LABELS.edges[t], icon: MINI.line[t], active: e.type === t, onPick: () => setType(t) })),
      { icon: MINI.trash, title: '删除连线 (Delete)', danger: true, onPick: () => this.removeEdge(sel.index) }
    ];
  }

  /* ---------- 多选 / 剪贴板 / 工具条(钩子的约定见 diagram-canvas.js) ---------- */

  refNodeKey(ref) { return ref && ref.kind === 'node' ? ref.ref : null; }
  refRect(ref) {
    if (!ref) return null;
    if (ref.kind === 'item') return this.itemBoxOf(ref.ref);
    if (ref.kind === 'node') { const g = this.nodeEls && this.nodeEls[ref.ref]; return g ? nodeRect(g) : null; }
    return null; /* 连线不参与框选 / 多选 */
  }
  selectableRefs() {
    const out = this.model.nodes.map((n) => ({ kind: 'node', ref: n.id }));
    (this.layout.items || []).forEach((it) => { if (it && it.id) out.push({ kind: 'item', ref: it.id }); });
    return out;
  }
  isEmpty() { return !this.model.nodes.length; }
  edgeRefAt(i) { return this.model.edges[i] ? { kind: 'edge', index: i } : null; }
  nodeRefAt(t) {
    const g = t.closest('g.node');
    const id = g ? this.idOf(g) : null;
    return id && this.model.byId[id] ? { kind: 'node', ref: id } : null;
  }

  /* 一次删掉一组:节点(连同它们的连线)、单独选中的连线、自由元素。一个撤销步 */
  deleteRefs(refs) {
    const ids = refs.filter((r) => r.kind === 'node').map((r) => r.ref).filter((id) => this.model.byId[id]);
    const edges = refs.filter((r) => r.kind === 'edge').map((r) => this.model.edges[r.index]).filter(Boolean);
    const iids = refs.filter((r) => r.kind === 'item').map((r) => r.ref);
    if (!ids.length && !edges.length && !iids.length) return false;
    this.select(null);
    if (iids.length) this.layout.items = (this.layout.items || []).filter((it) => iids.indexOf(it.id) < 0);
    this.mutate('删除', (m) => {
      ids.forEach((id) => flowRemoveNode(m, id));
      /* 删节点会让连线重新编号:按对象找回剩下的那几条,从后往前删 */
      edges.map((e) => m.edges.indexOf(e)).filter((i) => i >= 0).sort((a, b) => b - a).forEach((i) => flowRemoveEdge(m, i));
    });
    return true;
  }

  /* 复制:选中的节点、它们之间的连线、各自的位置、选中的自由元素 */
  buildCopyPayload(refs) {
    const nodeRefs = refs.filter((r) => r.kind === 'node');
    if (!nodeRefs.length && !refs.some((r) => r.kind === 'item')) return null;
    const plain = (o) => { const out = {}; Object.keys(o).forEach((k) => { const v = o[k]; if (v === null || /^(string|number|boolean)$/.test(typeof v)) out[k] = v; }); return out; };
    const ids = new Set(nodeRefs.map((r) => r.ref));
    const nodes = this.model.nodes.filter((n) => ids.has(n.id)).map((n) => plain(n));
    const edges = this.model.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => plain(e));
    const pos = {};
    nodes.forEach((n) => { const nd = this.scene && this.scene.byKey[n.id]; const p = this.layout.n[n.id] || (nd && [nd.x, nd.y]); if (p) pos[n.id] = [p[0], p[1]]; });
    return { kind: 'flow', nodes, edges, items: this.copyItems(refs), pos };
  }

  /* 粘贴:节点换新 id,连线的两端跟着换;位置整体平移(贴到右键点的地方,或原位偏 24) */
  applyPaste(payload, at) {
    if (payload.kind !== 'flow') {
      if (!(payload.items || []).length) { this.ctx.toast('只能粘贴到流程图画板(剪贴板里是' + ({ mind: '思维导图', class: '类图' }[payload.kind] || '别的') + ')'); return false; }
      const off = this.pasteOffset(payload, at);
      this.pasteItems(payload, off, null, null);
      this.repaintItems();
      this.commitLayout('粘贴', { norender: true });
      this.ctx.toast('已粘贴 ' + this.countCopied(payload));
      return true;
    }
    const off = this.pasteOffset(payload, at);
    const newIds = (payload.nodes || []).map(() => nextNodeId(this.model));
    const map = {};
    (payload.nodes || []).forEach((n, i) => {
      map[n.id] = newIds[i];
      const p = (payload.pos || {})[n.id] || [0, 0];
      this.layout.n[newIds[i]] = [r2(p[0] + off.dx), r2(p[1] + off.dy)];
    });
    const endPointOf = (key) => { const nd = this.scene && this.scene.byKey[key]; const r = nd ? { x: nd.x, y: nd.y, w: nd.w, h: nd.h } : null; return r ? [r.x + r.w, r.y + r.h / 2] : [0, 0]; };
    const made = this.pasteItems(payload, off, (k) => map[k], endPointOf);
    this.mutate('粘贴', (m) => {
      (payload.nodes || []).forEach((n, i) => {
        const node = { id: newIds[i], label: n.label, shape: SHAPES[n.shape] ? n.shape : 'rect', fill: n.fill || null, styleRest: n.styleRest || null };
        flowAdd(m, node, null, null);
      });
      (payload.edges || []).forEach((e) => {
        if (map[e.from] && map[e.to]) flowAddEdge(m, { from: map[e.from], to: map[e.to], type: EDGE_TYPES.indexOf(e.type) >= 0 ? e.type : 'arrow', label: e.label || '' }, m.byId[map[e.from]], m.byId[map[e.to]]);
      });
    });
    /* 选中的是刚贴进来的:主选中是最后一个节点 */
    const sel = newIds.map((id) => ({ kind: 'node', ref: id })).concat(made.map((it) => ({ kind: 'item', ref: it.id })));
    this.selExtra = sel.slice(0, -1);
    this.sel = sel[sel.length - 1] || null;
    this.ctx.toast('已粘贴 ' + this.countCopied(payload));
    return true;
  }

  /* 工具条「添加节点」/ 右键「在这里添加节点」:新节点落在点的地方,随后进入文字编辑 */
  placeNodeAt(x, y) { return this.addNodeAt(x, y, 'rect'); }

  /* 工具条「图形」在流程图里是真实节点(能连线):形状跟着工具里选的来 */
  addShapeAt(x, y) {
    return this.addNodeAt(x, y, { rect: 'rect', rounded: 'rounded', ellipse: 'circle', diamond: 'diamond', para: 'para', hex: 'hex' }[this.form] || 'rect');
  }

  addNodeAt(x, y, shape) {
    let id = null;
    this.mutate('添加节点', (m) => {
      const n = { id: nextNodeId(m), label: '新节点', shape, fill: null, styleRest: null };
      flowAdd(m, n, null, null);
      id = n.id;
      this.pendingEdit = n.id;
    });
    if (id) {
      this.spawn = { key: id, at: [x, y] }; /* 渲染出来后落到点的地方,见 diagram-canvas.js 的 placeSpawned */
      this.select({ kind: 'node', ref: id });
    }
    return id;
  }

  /* 工具条「连线」:两头都落在节点上 = 连一条真实连线;否则是自由的连线元素 */
  addLine(a, b) {
    if (a && b && a.n && b.n) { this.link(a.n, b.n); return null; }
    return super.addLine(a, b);
  }
}
