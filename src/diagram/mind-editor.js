/**
 * 思维导图可视化编辑(v1.3.0;v1.4.0 起自由摆放)。在 Mermaid 渲染结果上叠加交互层,改的是树模型。
 * 布局不靠 Mermaid(它的力导向布局每加一个节点整图重排):layout-core.js 按树形左→右排,确定性。
 * 自动模式每次结构变化都重新居中;手动拖过之后才冻结现有位置,只给新节点腾地方。
 * 拖过的节点记住位置,存进图源码末尾的布局块。
 *
 *   悬停节点右侧出 ⊕:点击 = 加一个子节点(随即进入文字编辑)。
 *   双击节点改文字;选中出工具条(+子级 / +同级 / 形状 / 上下移 / 挂到… / 删除)和移动抓手。
 *   直接拖动节点 = 挪位置;按住 Alt 拖到另一个节点上松手 = 移为它的子节点。
 *   按键:Tab 加子节点、Enter 加同级、Delete 删除、↑↓ 换选中、Ctrl+Z / Ctrl+Shift+Z、Esc 取消。
 *
 * v1.4.1 自由画布:多选 / 框选 / 左侧工具条 / 右键菜单 / 复制粘贴 / 平移缩放 / 导出是三种图共用的,在 canvas-tools.js。
 * 思维导图自己的部分:复制粘贴带走选中的节点和它们的子树(祖先也被选中的不重复带走)、各自的位置;
 * 右键多一项「选中整棵子树」;工具条的「添加节点」= 给选中的节点(没选中就是根)加一个子节点:
 * 自动排版交给树形布局,自由摆放尊重点击位置。
 */
import { DiagramCanvas, MINI } from './diagram-canvas.js';
import { parseMind, serializeMind, flattenMind, sibling, detachMind, containsMind, MIND_LABELS } from './mind-syntax.js';
import { svgEl, nodeRect, labelRect, toCanvasPoint, mapMindSvg } from './svg-map.js';
import { nodeRectOf, mindPlaceSubtree, mindSubtree, mindSwapSlots, mindCloseGap, groupRect, tidyLayout, setNodePos } from './layout-core.js';

const SHAPES = ['default', 'square', 'rounded', 'circle', 'hexagon', 'bang', 'cloud'];
const r2 = (v) => Math.round(v * 100) / 100;

export class MindEditor extends DiagramCanvas {
  parse(src) { return parseMind(src); }
  serialize(m) { return serializeMind(m); }

  /*
   * 坐标表里的键 = 从根出发的下标路径("0/2/1")。加 / 删 / 换父 / 换序都会让路径变:按节点对象身份,
   * 在改动前后各取一次键,坐标跟着对象走。
   */
  mutate(label, fn) {
    const before = this.mindKeys();
    /* 自动模式不写坐标,让 tidyLayout 在每次渲染时重排;进入自由摆放后才冻结其它节点 */
    if (this.free) this.snapshotMind();
    return super.mutate(label, (m) => {
      const r = fn(m);
      const after = this.mindKeys();
      const n = {};
      after.forEach((key, node) => {
        const old = before.get(node);
        /* 改动前不在这个图里的节点是新加的:它此刻的键多半是别的节点刚让出来的(中间插入同级),不能把那个节点的旧位置算到它头上 */
        if (old !== undefined && this.layout.n[old] !== undefined) n[key] = this.layout.n[old];
      });
      this.layout.n = n;
      return r;
    });
  }

  /*
   * 自由摆放模式下,把图上所有节点的当前位置记进坐标表。此后新增节点只在父节点旁腾位置,
   * 不触发整棵树重排;图还没渲染出来时(引擎加载中)什么都不做。
   */
  snapshotMind() {
    if (!this.scene || !this.model || !this.model.root) return;
    const keys = this.mindKeys();
    this.flat().forEach((x, i) => {
      const nd = this.scene.nodes[i], k = keys.get(x.node);
      if (nd && k !== undefined && this.layout.n[k] === undefined) this.layout.n[k] = [nd.x, nd.y];
    });
  }

  /*
   * 图渲染出来之后,把"这一步的结构变化"落到位置上(图已经在自由摆放时;否则树形排布自己就排好了):
   *   place 新节点 / 整棵子树挂到别的节点下 → 放到新父节点最后一个子节点下面,下面的节点让位
   *   swap  两个同级换序 → 两棵子树上下对调
   *   close 删除节点 → 排在它后面的同级(连同子树)上移补位
   *   at    落在指定的位置(工具条 / 右键添加节点、粘贴)
   * 位置按节点对象记,渲染之后才换成图上的那一项。
   */
  afterLayout() {
    const job = this.job;
    this.job = null;
    if (!job || !this.scene || !this.free) return;
    const sub = (node) => { const nd = this.sceneNode(node); return nd ? mindSubtree(this.scene, nd) : []; };
    let moved = false;
    if (job.type === 'at') {
      /* 落在指定的位置(工具条 / 右键「在这里添加节点」、粘贴):位置随对象记,渲染出来再落到图上 */
      job.place.forEach((p) => {
        const nd = this.sceneNode(p.node);
        if (!nd) return;
        setNodePos(nd, p.x, p.y);
        this.layout.n[nd.key] = [p.x, p.y];
        moved = true;
      });
    }
    if (job.type === 'place') {
      const parent = this.sceneNode(job.parent);
      const nodes = sub(job.node);
      if (parent && nodes.length) {
        /* 子树内部按树形排布的相对位置摆(挂到别处时顺手理整齐),再整体放到新父节点旁边 */
        const tidy = tidyLayout(nodes.map((n) => ({ w: n.w, h: n.h, children: n.children.map((c) => nodes.indexOf(c)) })));
        nodes.forEach((n, i) => setNodePos(n, tidy[i][0], tidy[i][1]));
        const after = job.after ? this.sceneNode(job.after) : null;
        mindPlaceSubtree(this.scene, nodes, parent, after && after !== nodes[0] ? after : null, this.layout);
        moved = true;
      }
    } else if (job.type === 'swap') {
      moved = mindSwapSlots(this.scene, sub(job.a), sub(job.b), this.layout);
    } else if (job.type === 'close') {
      if (job.height > 0) { mindCloseGap(this.scene, job.followers.map((f) => this.sceneNode(f)).filter(Boolean), job.height, this.layout); moved = true; }
    }
    if (!moved) return;
    this.paintLayout();
    this.amend();
  }

  /* 节点对象 → 路径键(与 layout-core 的 buildMind 同一套规则) */
  mindKeys() {
    const map = new Map();
    const walk = (node, key) => { map.set(node, key); node.children.forEach((c, j) => walk(c, key + '/' + j)); };
    if (this.model && this.model.root) walk(this.model.root, '0');
    return map;
  }

  /* 节点在布局里的那一项 */
  sceneNode(node) {
    const i = this.indexOf(node);
    return this.scene && i >= 0 ? this.scene.nodes[i] || null : null;
  }

  /* 节点在画布上的框:按文字块算(无框节点的圆角底框已经透明,框大了选中和工具条都会离文字太远) */
  nodeBox(node) {
    const nd = this.sceneNode(node);
    const g = this.nodeEls ? this.nodeEls[this.indexOf(node)] : null;
    return nd || (g && nodeRect(g)) ? (nd ? nodeRectOf(nd) : nodeRect(g)) : null;
  }

  flat() { return this.model ? flattenMind(this.model.root) : []; }
  indexOf(node) { return this.flat().findIndex((x) => x.node === node); }
  /* 选中对象是节点对象本身(按身份比);自由元素是 { kind:'item', ref:id } */
  sameSel(a, b) {
    if (a && b && a.kind === 'item' && b.kind === 'item') return a.ref === b.ref;
    return !!a && a === b && a.kind === undefined;
  }

  render() {
    return super.render().then((applied) => {
      if (!applied) return; /* 被更新的渲染取代的那一次不算 */
      const node = this.pendingEdit;
      this.pendingEdit = null;
      if (node && this.svg && this.indexOf(node) >= 0) this.editNode(node);
    });
  }

  afterRender(svg, renderId) {
    const flat = this.flat();
    this.nodeEls = mapMindSvg(svg, renderId, flat);
    this.setupScene(svg, 'mind'); /* 认图 + 布局:树形自动排版(或已存的坐标)+ 曲线 + 配色 */
    this.afterLayout(); /* 这一步的结构变化(加 / 挂 / 换序 / 删)在新图上落位 */
    this.ov = this.newOverlay();
    this.dyn = svgEl('g', { class: 'lry-ov-dyn' }, this.ov);
    this.ctx.onState({ empty: false });
    this.refresh();
    if (this.sel) this.showTools(); /* 图变了位置:工具条跟着重定位 */
    else this.hideTools();
  }

  refresh() {
    if (!this.dyn || !this.svg) return;
    this.syncScale(); /* 缩放 / 改过窗口之后,比例可能变了 */
    this.clearDynamic();
    const flat = this.flat();
    if (this.sel && this.sel.kind !== 'item') {
      const r = this.nodeBox(this.sel);
      if (!r) { if (!this.pending) this.loseSelection(); } else {
        this.box(this.dyn, r, 'lry-ov-selbox', 3);
        if (!this.editing) this.gripHandle(r.cx, r.y - 12, { 'data-ref': this.indexOf(this.sel) }); /* 移动抓手 */
      }
    }
    /* 悬停(或选中的)节点:文字右侧出「加子节点」手柄(用别的工具时不画——那几下按住不是"加节点") */
    const hov = this.picking ? (this.hover || (this.sel && this.sel.kind !== 'item' ? this.sel : null)) : null;
    const hi = this.indexOf(hov);
    const hg = this.nodeEls[hi];
    if (hg && !this.editing && !this.drag && !this.draggingNode) {
      const r = this.nodeBox(hov) || nodeRect(hg);
      this.handle(this.dyn, r.x + r.w, r.cy, 'plus', { 'data-act': 'child', 'data-idx': hi, 'data-x': r.x + r.w, 'data-y': r.cy });
    }
    /* 「挂到其它节点下」的第二步:提示点目标 */
    if (this.reparentPick && !this.drag) {
      const r = this.nodeBox(this.reparentPick);
      if (r) svgEl('rect', { x: r.x - 4 / this.k, y: r.y - 4 / this.k, width: r.w + 8 / this.k, height: r.h + 8 / this.k, rx: 6 / this.k, class: 'lry-ov-target', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': (5 / this.k) + ' ' + (4 / this.k) }, this.dyn);
    }
    /* 拖动节点换父:橡皮筋 + 目标高亮 */
    const d = this.drag;
    if (d) {
      const end = d.targetEl ? nodeRect(d.targetEl) : null;
      svgEl('line', { x1: d.x, y1: d.y, x2: end ? end.cx : d.pt.x, y2: end ? end.cy : d.pt.y, class: 'lry-ov-rubber', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': (6 / this.k) + ' ' + (4 / this.k) }, this.dyn);
      if (end) this.box(this.dyn, end, 'lry-ov-target', 3);
    }
    if (this.sel) this.placeTools();
    this.drawExtra(); /* 多选框、自由元素的手柄、框选矩形、工具的草稿(见 canvas-tools.js) */
  }

  loseSelection() {
    this.sel = null;
    this.selExtra = [];
    this.hideTools();
  }

  /* ---------- 指针 ---------- */

  handleOver(e) {
    const h = e.target.closest && e.target.closest('.lry-ov-handle');
    if (h) { const x = this.flat()[+h.getAttribute('data-idx')]; if (x) this.setHover(x.node); return; }
    const g = e.target.closest && e.target.closest('g.mindmap-node');
    const i = g ? this.nodeEls.indexOf(g) : -1;
    const x = this.flat()[i];
    if (x) this.setHover(x.node);
  }

  handleOut(e) {
    const g = e.target.closest && e.target.closest('g.mindmap-node');
    if (!g) return;
    const to = e.relatedTarget;
    const h = to && to.closest && to.closest('.lry-ov-handle');
    if (to && g.contains(to)) return;
    const hovered = h && this.flat()[+h.getAttribute('data-idx')];
    if (hovered && hovered.node === this.hover) return; /* 移到本节点的手柄上不算离开 */
    this.setHover(null);
  }

  nodeAt(g) {
    const i = g ? this.nodeEls.indexOf(g) : -1;
    return i >= 0 ? this.flat()[i].node : null;
  }

  /* 能否把 node 的子树放到 target 之下:不能放到自己或自己的后代里 */
  canDrop(node, target) {
    return !!target && target !== node && !containsMind(node, target);
  }

  pointerDown(e) {
    if (this.commonDown(e)) return; /* 工具条上的工具、自由元素、空白处框选(见 canvas-tools.js) */
    const h = e.target.closest('.lry-ov-handle');
    if (h) {
      e.preventDefault();
      if (h.getAttribute('data-act') === 'move') {
        const nd = this.scene.nodes[+h.getAttribute('data-ref')];
        const node = nd && this.flat()[+h.getAttribute('data-ref')];
        if (nd && node) this.dragNode(e, nd, node);
        return;
      }
      const x = this.flat()[+h.getAttribute('data-idx')];
      if (x) this.addChild(x.node);
      return;
    }
    const ng = e.target.closest('g.mindmap-node');
    const node = this.nodeAt(ng);
    /* 「挂到其它节点下」的第二步:点一下目标节点 */
    if (this.reparentPick) {
      const pick = this.reparentPick;
      this.reparentPick = null;
      if (node && node !== pick) {
        if (this.canDrop(pick, node)) this.reparent(pick, node);
        else this.ctx.toast('不能挂到它自己的子节点下面');
      }
      this.select(pick);
      return;
    }
    if (!node) { this.select(null); return; }
    const r = nodeRect(ng);
    const nd = this.sceneNode(node);
    /*
     * 直接拖动 = 挪位置;按住 Alt 拖到目标节点上 = 挂到它下面(橡皮筋 + 目标高亮)。
     * 按下时或拖动途中按着 Alt 都算换父节点;触屏没有 Alt,走工具条里的「挂到其它节点下」。
     */
    let mode = e.altKey ? 'reparent' : null;
    let st = null;
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey; /* 按着修饰键点 = 加进 / 移出多选 */
    this.trackPointer(e, {
      move: (ev, moved) => {
        if (!moved) return;
        if (!mode) mode = ev.altKey ? 'reparent' : 'move';
        if (mode === 'move') {
          if (nd) { if (!st) st = this.dragStart(e, nd); this.dragTo(st, ev); }
          return;
        }
        const g = this.hitNode(ev.clientX, ev.clientY);
        const target = this.nodeAt(g);
        this.drag = { node, x: r.cx, y: r.cy, pt: toCanvasPoint(this.svg, ev.clientX, ev.clientY), targetEl: this.canDrop(node, target) ? g : null };
        this.refresh();
      },
      up: () => {
        const d = this.drag;
        this.drag = null;
        if (st) { this.dragEnd(st); return; }
        /* 已经在多选里的节点,直接点一下保持多选不变 */
        if (!mode) { if (toggle) this.select(node, { add: true }); else if (!this.nodeSelected(nd)) this.select(node); this.refresh(); return; }
        if (d && d.targetEl) this.reparent(node, this.nodeAt(d.targetEl));
        this.refresh();
      }
    });
  }

  /* 工具条 / 右键里的「挂到其它节点下」:先点它,再点目标节点 */
  startReparentPick(node) {
    if (node === this.model.root) { this.ctx.toast('根节点不能挂到别的节点下面'); return; }
    this.reparentPick = node;
    this.hideTools();
    this.ctx.toast('请点一下要挂到的节点(Esc 取消)');
    this.refresh();
  }

  handleKey(e) {
    if (this.reparentPick && e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      this.reparentPick = null;
      this.ctx.toast('已取消');
      this.refresh();
      return true;
    }
    return super.handleKey(e);
  }

  dblClick(e) {
    /* 按坐标命中而不是看事件目标:前面的按下-松开可能让事件目标变成容器 */
    const node = this.nodeAt(this.hitNode(e.clientX, e.clientY));
    if (node) this.editNode(node);
  }

  /* ---------- 结构操作 ---------- */

  parentOf(node) {
    const hit = this.flat().find((x) => x.node === node);
    return hit ? hit.parent : null;
  }

  newNode(text) {
    return { id: '', text, shape: 'default', suffix: '', children: [] };
  }

  addChild(node) {
    let created = null;
    const prevLast = node.children[node.children.length - 1] || null;
    this.mutate('添加子节点', (m) => {
      created = this.newNode('新分支');
      node.children.push(created);
      this.pendingEdit = created;
    });
    if (created) {
      /* 新节点放在最后一个兄长的子树下面(渲染出来后落位,见 afterLayout) */
      this.job = { type: 'place', node: created, parent: node, after: prevLast };
      this.select(created);
    }
    return created;
  }

  addSibling(node) {
    const parent = this.parentOf(node);
    if (!parent) { this.addChild(node); return; } /* 根节点没有同级:加一个子节点 */
    let created = null;
    this.mutate('添加同级节点', (m) => {
      created = this.newNode('新分支');
      parent.children.splice(parent.children.indexOf(node) + 1, 0, created);
      this.pendingEdit = created;
    });
    if (created) {
      /* 新节点紧跟在本节点(连同它的子树)下面,后面的同级及其子树整体往下让 */
      this.job = { type: 'place', node: created, parent, after: node };
      this.select(created);
    }
  }

  remove(node) {
    if (!node) return;
    if (node === this.model.root) { this.ctx.toast('思维导图的根节点不能删除'); return; }
    const parent = this.parentOf(node);
    const nd = this.sceneNode(node);
    let followers = [], height = 0;
    if (parent && nd) {
      /* 记下它占了多高、后面排着哪些同级:删掉之后它们上移补位(渲染出来后做,见 afterLayout) */
      followers = parent.children.slice(parent.children.indexOf(node) + 1);
      height = groupRect(mindSubtree(this.scene, nd)).h;
    }
    this.job = { type: 'close', followers, height };
    this.select(null);
    this.mutate('删除节点', (m) => { detachMind(node, m.root); });
    if (parent && this.indexOf(parent) >= 0) this.select(parent);
  }

  shift(node, dir) {
    const other = sibling(node, dir, this.model.root);
    if (!other) { this.ctx.toast(dir < 0 ? '已经是第一个' : '已经是最后一个'); return; }
    const parent = this.parentOf(node);
    if (!parent) return;
    const list = parent.children;
    const i = list.indexOf(node);
    const j = list.indexOf(other);
    this.job = { type: 'swap', a: node, b: other }; /* 两棵子树上下对调(渲染出来后做,见 afterLayout) */
    this.mutate('调整顺序', () => { list[i] = other; list[j] = node; });
  }

  reparent(node, target) {
    if (!this.canDrop(node, target)) return;
    const after = target.children[target.children.length - 1] || null; /* 挂过去之后它排在最后:放在原来最后一个的下面 */
    this.job = { type: 'place', node, parent: target, after };
    this.mutate('移动节点', (m) => {
      detachMind(node, m.root);
      target.children.push(node);
    });
    this.select(node);
  }

  setShape(node, shape) {
    this.mutate('切换形状', () => { node.shape = shape; });
  }

  /* 进入文字编辑(全选原文字,直接输入即整体替换) */
  editNode(node) {
    if (!node || !this.nodeEls) return; /* 图还没渲染出来(引擎加载中):无从定位编辑框 */
    const g = this.nodeEls[this.indexOf(node)];
    if (!g) return;
    const rect = this.toStageRect(labelRect(g) || nodeRect(g));
    this.editText(rect, node.text, { multiline: true }).then((res) => {
      if (!res || res.cancelled) { this.select(node); return; }
      this.mutate('改文字', () => { node.text = res.value; });
      this.select(node);
    });
  }

  /* ---------- 选中对象的默认动作(按键与工具条共用) ---------- */

  deleteSelection() {
    if (this.sel && this.sel.kind === 'item') return this.deleteRefs([this.sel]);
    if (this.sel) this.remove(this.sel);
  }

  /* Enter:加同级节点(改文字用双击或工具条) */
  enterSelection() {
    if (this.sel) this.addSibling(this.sel);
  }

  addChildFromSelection() {
    if (this.sel) this.addChild(this.sel);
  }

  items() {
    return this.selectableRefs();
  }

  toolsAnchor() {
    if (!this.sel || !this.nodeEls) return null;
    if (this.sel.kind === 'item') { const b = this.itemBoxOf(this.sel.ref); return b ? this.toStageRect(b) : null; }
    const r = this.nodeBox(this.sel);
    return r ? this.toStageRect(r) : null;
  }

  /*
   * 工具条落位:树形排布下节点排得密(子节点就在父节点右侧),贴在上方或下方都可能压住邻居——
   * 2026-11-24 实测:换父节点之后工具条被收进可视区时正好盖在根节点上,想点根节点点到的是工具条按钮。
   * 挑一个不压住别的节点的位置:先下方,再右侧、左侧、上方;都不行退回基类。
   */
  placeTools(anchorRect) {
    anchorRect = anchorRect || (this.sel && this.toolsAnchor ? this.toolsAnchor() : null);
    if (this.ui.tools.hidden || !anchorRect || !this.scene || !this.sel) { super.placeTools(anchorRect); return; }
    const i = this.indexOf(this.sel);
    const box = this.nodeBox(this.sel);
    if (!box) { super.placeTools(anchorRect); return; }
    const self = this.toStageRect(box);
    const others = this.scene.nodes.filter((n, k) => k !== i).map((n) => this.toStageRect(nodeRectOf(n)));
    if (!this.placeToolsAvoid(anchorRect, self, others, true)) super.placeTools(anchorRect);
  }

  toolsFor(sel) {
    if (sel.kind === 'item') return this.itemTools(sel);
    const node = sel;
    return [
      { label: '子级', title: '添加子节点 (Tab)', icon: MINI.branch, onPick: () => this.addChild(node) },
      { label: '同级', title: '添加同级节点 (Enter)', icon: MINI.sibling, onPick: () => this.addSibling(node) },
      { label: '改文字', title: '修改文字 (双击)', icon: MINI.edit, onPick: () => this.editNode(node) },
      {
        key: 'shape', label: '形状', title: '切换形状', icon: MINI.shape[node.shape] || MINI.shape.default,
        panel: SHAPES.map((k) => ({
          title: MIND_LABELS.shapes[k], icon: MINI.shape[k], active: node.shape === k,
          onPick: () => this.setShape(node, k)
        }))
      },
      { icon: MINI.up, title: '上移(同级内换序)', onPick: () => this.shift(node, -1) },
      { icon: MINI.down, title: '下移(同级内换序)', onPick: () => this.shift(node, 1) },
      /* 触屏没有 Alt 键:换父节点走这里(也可以按住 Alt 把节点拖到目标上) */
      { icon: MINI.swap, label: '挂到…', title: '挂到其它节点下(再点一下目标节点;或按住 Alt 拖动节点)', onPick: () => this.startReparentPick(node) },
      { icon: MINI.trash, title: '删除节点(连同子节点) (Delete)', danger: true, onPick: () => this.remove(node) }
    ];
  }

  /* ---------- 多选 / 剪贴板 / 工具条(钩子的约定见 diagram-canvas.js) ---------- */

  refNodeKey(ref) { return ref && ref.kind !== 'item' ? (this.mindKeys().get(ref) || null) : null; }
  refRect(ref) {
    if (!ref) return null;
    if (ref.kind === 'item') return this.itemBoxOf(ref.ref);
    const nd = this.sceneNode(ref);
    return nd ? nodeRectOf(nd) : null;
  }
  selectableRefs() {
    const out = this.flat().map((x) => x.node);
    (this.layout.items || []).forEach((it) => { if (it && it.id) out.push({ kind: 'item', ref: it.id }); });
    return out;
  }
  isEmpty() { return false; /* 思维导图总有根节点 */ }
  nodeRefAt(t) { const g = t.closest('g.mindmap-node'); return g ? this.nodeAt(g) : null; }

  /* 右键菜单比工具条多一项:选中整棵子树(之后可以整组拖动、删除、复制) */
  extraMenu(node) {
    if (!node || node.kind === 'item' || node === this.model.root) return [];
    return [{ label: '选中整棵子树', hint: '连同它的子节点', run: () => this.selectSubtree(node) }];
  }
  selectSubtree(node) {
    const all = [];
    (function walk(n) { all.push(n); n.children.forEach(walk); })(node);
    this.selExtra = all.slice(1);
    this.sel = all[0];
    this.refresh();
    this.showTools();
    this.focus();
  }

  /* 一次删掉一组节点(连同各自的子树)和自由元素。一个撤销步。根节点不能删;祖先也在选中里的,随祖先一起删 */
  deleteRefs(refs) {
    const nodes = refs.filter((r) => r.kind !== 'item');
    const iids = refs.filter((r) => r.kind === 'item').map((r) => r.ref);
    const root = this.model.root;
    /* 能删的先挑出来(根不能删),再看祖先是不是也在要删的里面:根不算——它留着,它下面的"甲"照删 */
    const cand = nodes.filter((n) => n !== root && root && containsMind(root, n));
    const gone = cand.filter((n) => {
      for (let p = this.parentOf(n); p; p = this.parentOf(p)) if (cand.indexOf(p) >= 0) return false;
      return true;
    });
    if (!gone.length && !iids.length) {
      if (nodes.length) this.ctx.toast('思维导图的根节点不能删除');
      return false;
    }
    this.select(null);
    if (iids.length) this.layout.items = (this.layout.items || []).filter((it) => iids.indexOf(it.id) < 0);
    this.mutate('删除节点', (m) => { gone.forEach((n) => detachMind(n, m.root)); });
    if (nodes.some((n) => n === root)) this.ctx.toast('思维导图的根节点不能删除');
    return true;
  }

  /* 复制:选中的节点连同子树(祖先也被选中的不重复带走)、每个节点各自的位置、选中的自由元素 */
  buildCopyPayload(refs) {
    const sel = refs.filter((r) => r.kind !== 'item');
    if (!sel.length && !refs.some((r) => r.kind === 'item')) return null;
    const keys = this.mindKeys();
    const posOf = (n) => { const k = keys.get(n); const nd = this.sceneNode(n); const p = (k && this.layout.n[k]) || (nd && [nd.x, nd.y]); return p ? [p[0], p[1]] : null; };
    /* 子树整个带走(孩子全要):"祖先也选中了的不重复带"只在下面挑顶层那一步做 */
    const clone = (n) => ({ text: n.text, shape: n.shape, suffix: n.suffix, __pos: posOf(n), children: n.children.map(clone) });
    const top = this.flat().filter((x) => sel.indexOf(x.node) >= 0 && !(() => { for (let p = x.parent; p; p = this.parentOf(p)) if (sel.indexOf(p) >= 0) return true; return false; })());
    return { kind: 'mind', nodes: top.map((x) => clone(x.node)), items: this.copyItems(refs), pos: {} };
  }

  /* 粘贴:挂在选中的节点下面(没选中 = 根下面);每个节点落在原来的相对位置上(整体平移) */
  applyPaste(payload, at) {
    if (payload.kind !== 'mind') {
      if (!(payload.items || []).length) { this.ctx.toast('只能粘贴到思维导图画板(剪贴板里是' + ({ flow: '流程图', class: '类图' }[payload.kind] || '别的') + ')'); return false; }
      const off0 = this.pasteOffset(payload, at);
      this.pasteItems(payload, off0, null, null);
      this.repaintItems();
      this.commitLayout('粘贴', { norender: true });
      this.ctx.toast('已粘贴 ' + this.countCopied(payload));
      return true;
    }
    const off = this.pasteOffset(payload, at);
    const parent = this.sel && this.sel.kind !== 'item' && this.model.root && containsMind(this.model.root, this.sel) ? this.sel : this.model.root;
    const place = [];
    const made = [];
    const build = (src) => {
      const n = this.newNode(src.text);
      n.shape = src.shape || 'default';
      n.suffix = src.suffix || '';
      if (src.__pos) place.push({ node: n, x: r2(src.__pos[0] + off.dx), y: r2(src.__pos[1] + off.dy) });
      (src.children || []).forEach((c) => n.children.push(build(c)));
      return n;
    };
    let items = [];
    this.mutate('粘贴', (m) => {
      (payload.nodes || []).forEach((src) => {
        const n = build(src);
        parent.children.push(n);
        (function walk(x) { made.push(x); x.children.forEach(walk); })(n);
      });
      items = this.pasteItems(payload, off, null, null);
    });
    this.job = { type: 'at', place }; /* 渲染出来后各就各位,见 afterLayout */
    this.selExtra = made.concat(items.map((it) => ({ kind: 'item', ref: it.id })));
    this.sel = this.selExtra.pop() || null;
    this.ctx.toast('已粘贴 ' + this.countCopied(payload));
    return true;
  }

  /* 自动排版按树结构添加子节点;自由摆放才把新节点放到工具点击的位置,随后进入文字编辑 */
  placeNodeAt(x, y) {
    const parent = this.sel && this.sel.kind !== 'item' && this.model.root && containsMind(this.model.root, this.sel) ? this.sel : this.model.root;
    if (!this.free) return this.addChild(parent);
    let created = null;
    this.mutate('添加子节点', (m) => {
      created = this.newNode('新分支');
      parent.children.push(created);
      this.pendingEdit = created;
    });
    if (created) {
      this.job = { type: 'at', place: [{ node: created, x, y }] };
      this.select(created);
    }
    return created;
  }
}
