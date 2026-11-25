/**
 * UML 类图可视化编辑(v1.3.1)。在 Mermaid 渲染结果上叠加交互层,改的是结构模型(类 / 成员 / 关系 / 便签);
 * 布局始终由 Mermaid 自动完成——编辑器里看到的就是发布后的样子。
 *
 *   悬停类框:右侧出 ⊕、左侧出 ○。点 ⊕ = 加一个类并从本类关联过去(随即进入类名编辑);
 *             从任一手柄按住拖到另一个类上 = 建立关联(输入侧手柄 = 把对方关联到本类)。
 *   双击标题改类名;不是合法类名的文字(含空格、括号…)原样留作显示标注,类名不动。
 *   双击成员行改文字;悬停成员行时行尾出 ×,点它直接删除。属性区 / 方法区为空时,该区右侧出「＋」。
 *   选中类出工具条:关联类 / 改名 / 标注 / 属性 / 方法 / 便签 / 构造型 / 配色 / 删除;
 *   选中成员行:改文字 / 上移 / 下移 / 删除。
 *   关系可点选:类型(关联 / 依赖 / 继承 / 实现 / 组合 / 聚合 / 实线 / 虚线)、反向、文字、两端基数、删除;
 *   拖动两端的小圆点可改接。双击连线改文字。
 *   便签(note for X):双击改文字;可删除。
 *   按键:Tab 加关联类(选中成员行时加一个同类成员)、Enter 改当前选中对象、Delete 删除、↑↓ 换选中、Ctrl+Z / Ctrl+Shift+Z、Esc 取消。
 *
 * 图上的成员行与模型按"同类成员的先后"一一对应;条数对不上时(理论上不会)成员行只读,只允许整类操作。
 *
 * v1.4.1 自由画布:多选 / 框选 / 左侧工具条 / 右键菜单 / 复制粘贴 / 平移缩放 / 导出是三种图共用的,在 canvas-tools.js。
 * 类图自己的部分:复制粘贴带走类(成员 / 构造型 / 标注 / 配色)、选中的类之间的关系、它们的便签和位置;工具条的「图形」是自由元素。
 */
import { DiagramCanvas, MINI } from './diagram-canvas.js';
import {
  parseClass, serializeClass, classAddClass, classAddRel, classRemove, classRemoveRel, classReconnect,
  classRemoveNote, classSetNote, classAddNote, classAddMember, classRemoveMember, classMoveMember, classSetMemberText,
  classRename, classIdProblem, classSetDirection, classSetFill, classSetAnnotation, classSetLabel, classLabel, classSetRelType,
  classSwapRel, classSetRelLabel, classSetCard, REL_TYPES, relTypeOf, decodeText, memberProblem, CLASS_LABELS
} from './class-syntax.js';
import { svgEl, nodeRect, rowRect, nodeOrigin, toCanvasPoint, mapClassSvg, rectIn } from './svg-map.js';
import { BLANK } from './kind.js';

/* 配色档(浅色底,默认主题的深色字可读);null = 主题默认 */
const FILLS = [null, '#E8F1FF', '#FFF1DE', '#E6F7EC', '#FDE8EC', '#EFE9FF', '#EFF1F4'];
const swatch = (fill) => '<span class="lry-diagram-swatch' + (fill ? '' : ' lry-diagram-swatch-none') + '"' + (fill ? ' style="background:' + fill + '"' : '') + '></span>';
/* 构造型快捷项(空串 = 去掉);末尾另有"自定义…" */
const ANNS = ['', 'interface', 'abstract', 'enumeration', 'Service', 'Component', 'Entity'];
const hoverKey = (x) => (x ? x.kind + ':' + x.ref + ':' + (x.mi === undefined ? '' : x.mi) : '');
const r2 = (v) => Math.round(v * 100) / 100;

export class ClassEditor extends DiagramCanvas {
  constructor(stage, ui, ctx) {
    super(stage, ui, ctx);
    this.emptyHint = '画板是空的——点击这里添加第一个类';
  }

  parse(src) { return parseClass(src); }

  /* 只有头行(外加注释这类原样行)的空类图 Mermaid 会解析失败:拿等价的空图去渲染,源码本身不动 */
  renderSource() {
    const m = this.model;
    return m && !m.classes.length && !m.notes.length && !m.rels.length ? BLANK.class : this.src;
  }
  serialize(m) { return serializeClass(m); }
  sameSel(a, b) { return hoverKey(a) === hoverKey(b) && !!a; }
  /* 悬停对象是 { kind, ref, mi? },按值比较 */
  setHover(hv) {
    if (hoverKey(hv) === hoverKey(this.hover)) return;
    this.hover = hv || null;
    this.refresh();
  }

  cls(id) { return this.model ? this.model.byId[id] : null; }

  render() {
    return super.render().then((applied) => {
      /* 新建的类 / 成员 / 便签:等它渲染出来再进入文字编辑。被更新的渲染取代的那一次不算 */
      if (!applied) return;
      const p = this.pendingEdit;
      this.pendingEdit = null;
      if (!p || !this.model || !this.svg) return;
      if (p.what === 'title') { const c = this.model.byId[p.id]; if (c) this.editTitle(c); } else if (p.what === 'member') {
        const c = this.model.byId[p.id];
        const m = c && c.members[p.mi];
        if (m) this.editMember(c, m);
      } else if (p.what === 'note' && this.model.notes[p.index]) this.editNote(p.index);
    });
  }

  /* ---------- 渲染后:映射 + 叠加层 ---------- */

  afterRender(svg, renderId) {
    const m = mapClassSvg(svg, renderId, this.model);
    this.nodeEls = m.nodeEls;
    this.noteEls = m.noteEls;
    this.edgePaths = m.edgePaths;
    this.setupScene(svg, 'class'); /* 认图 + 落布局(自由摆放的节点归位、关系线重画) */
    this.placeSpawned();
    this.ov = this.newOverlay();
    const base = svgEl('g', { class: 'lry-ov-static' }, this.ov);
    this.dyn = svgEl('g', { class: 'lry-ov-dyn' }, this.ov);
    /* 关系命中区:加宽的透明线叠在原连线上 */
    this.edgePaths.forEach((p, i) => {
      if (p) svgEl('path', { d: p.getAttribute('d'), class: 'lry-ov-edgehit', 'data-edge': i }, base);
    });
    /* 悬停对象在重渲染后可能已对不上(成员行号会随改动变化):对不上的清掉,等指针再动时重建 */
    const hv = this.hover;
    if (hv && (hv.kind === 'note' ? !this.noteEls[hv.ref] : (hv.kind === 'member' ? !this.memberRect(hv.ref, hv.mi) : !this.nodeEls[hv.ref]))) this.hover = null;
    this.ctx.onState({ empty: !this.model.classes.length });
    this.refresh();
    if (this.sel) this.showTools(); /* 图变了位置:工具条跟着重定位 */
    else this.hideTools();
  }

  idOf(g) {
    const prefix = this.renderId + '-classId-';
    const id = g.getAttribute('id') || '';
    return id.indexOf(prefix) === 0 ? id.slice(prefix.length).replace(/-\d+$/, '') : null;
  }

  noteIndex(g) {
    const prefix = this.renderId + '-note';
    const id = g.getAttribute('id') || '';
    return id.indexOf(prefix) === 0 ? parseInt(id.slice(prefix.length), 10) : -1;
  }

  /* 该类在图上的成员行与模型是否条数一致。不一致时成员行不可操作,只允许整类操作 */
  rowsAligned(c, g) {
    const n = (q) => g.querySelectorAll(q).length;
    return c.members.filter((x) => x.kind === 'attr').length === n('g.members-group > g.label')
      && c.members.filter((x) => x.kind === 'method').length === n('g.methods-group > g.label');
  }

  memberRow(c, member) {
    const g = c && this.nodeEls ? this.nodeEls[c.id] : null;
    if (!g || !member || !this.rowsAligned(c, g)) return null;
    const rows = g.querySelectorAll(member.kind === 'method' ? 'g.methods-group > g.label' : 'g.members-group > g.label');
    const idx = c.members.filter((x) => x.kind === member.kind).indexOf(member);
    return idx >= 0 ? rows[idx] || null : null;
  }

  /*
   * 成员行的整行矩形(取类框宽度;文字块本身是居中的窄条),**画布(viewBox)单位**——叠加层画在 SVG 里,只能用这个。
   * memberRect() 是它换算到画布容器的屏幕像素版,给工具条定位用。两者混用会让手柄整体偏到图外。
   */
  memberBox(id, mi) {
    const c = this.cls(id);
    const member = c && c.members[mi];
    const g = c && this.nodeEls ? this.nodeEls[c.id] : null;
    const row = g ? this.memberRow(c, member) : null;
    if (!row) return null;
    const rr = rowRect(g, row);
    const nr = nodeRect(g);
    const pad = 1 / this.k; /* 左右各收进 1px */
    return { x: nr.x + pad, y: rr.y, w: nr.w - pad * 2, h: rr.h, cx: rr.cx, cy: rr.cy };
  }

  memberRect(id, mi) {
    const box = this.svg ? this.memberBox(id, mi) : null;
    return box ? this.toStageRect(box) : null;
  }

  refresh() {
    if (!this.dyn || !this.svg) return;
    this.syncScale(); /* 缩放 / 改过窗口之后,比例可能变了 */
    this.clearDynamic();
    const sel = this.sel;
    if (sel) {
      if (sel.kind === 'class' || sel.kind === 'note') {
        const g = sel.kind === 'class' ? this.nodeEls[sel.ref] : this.noteEls[sel.ref];
        if (!g) { if (!this.pending) this.loseSelection(); } else {
          this.box(this.dyn, nodeRect(g), 'lry-ov-selbox', 3);
          /* 选中的类 / 便签:顶边正上方出移动抓手(出入手柄在标题行左右两端,不打架) */
          const nd = this.scene && this.scene.byKey[sel.kind === 'note' ? 'note:' + sel.ref : sel.ref];
          if (nd && !this.editing) this.gripHandle(nd.x + nd.w / 2, nd.y - 12, { 'data-ref': sel.ref, 'data-kind': sel.kind });
        }
      } else if (sel.kind === 'member') {
        const r = this.memberBox(sel.ref, sel.mi);
        if (!r) { if (!this.pending) this.loseSelection(); } else this.box(this.dyn, r, 'lry-ov-selbox', 1);
      } else if (sel.kind === 'rel') {
        const p = this.edgePaths[sel.ref];
        if (!p) { if (!this.pending) this.loseSelection(); } else {
          svgEl('path', { d: p.getAttribute('d'), class: 'lry-ov-edgesel', 'vector-effect': 'non-scaling-stroke' }, this.dyn);
          const nums = (String(p.getAttribute('d') || '').match(/-?[\d.]+/g) || [0, 0, 0, 0]).map(Number);
          [
            { x: nums[0], y: nums[1], end: 'a' },
            { x: nums[nums.length - 2], y: nums[nums.length - 1], end: 'b' }
          ].forEach((o) => this.handle(this.dyn, o.x, o.y, 'dot', { 'data-act': 'end', 'data-end': o.end, 'data-edge': sel.ref, 'data-x': o.x, 'data-y': o.y }));
        }
      }
    }
    /* 出手柄的类:悬停优先(选中着别的类时也要能从其它类起拖);选中成员行时不画(左侧是它的工具条,右侧是行尾的 ×)。
       用别的工具(抓手 / 文字 / 连线…)时不画——那几下按住不是"连线" */
    const hid = this.picking ? (this.hover ? this.hover.ref : (sel && sel.kind === 'class' ? sel.ref : null)) : null;
    const hg = hid && this.nodeEls ? this.nodeEls[hid] : null;
    if (hg && !this.editing) {
      const r = nodeRect(hg);
      const put = (act, x, y, glyph, extra) => this.handle(this.dyn, x, y, glyph, Object.assign({ 'data-act': act, 'data-ref': hid, 'data-x': x, 'data-y': y }, extra || {}));
      /* 两个手柄挂在标题行的高度(右上 ⊕、左上 ○):类框正中多是成员行,挂在那里会和成员行行尾的 × 重叠 */
      const title = hg.querySelector('g.label-group > g.label');
      const ty = title ? rowRect(hg, title).cy : r.cy;
      put('out', r.x + r.w, ty, 'plus');
      put('in', r.x, ty, 'ring');
      /* 属性区 / 方法区为空:在该区右侧出「＋」 */
      const divs = [...hg.querySelectorAll('g.divider')].map((d) => {
        const path = d.querySelector('path');
        const mm = path ? /^M\s*([-\d.]+)\s+([-\d.]+)/.exec(path.getAttribute('d') || '') : null;
        return mm ? +mm[2] : null;
      });
      if (divs.length >= 2 && divs[0] !== null && divs[1] !== null) {
        const oy = nodeOrigin(hg).y;
        const bands = [
          ['addattr', 'g.members-group > g.label', oy + divs[0], oy + divs[1]],
          ['addmethod', 'g.methods-group > g.label', oy + divs[1], r.y + r.h]
        ];
        bands.forEach(([act, q, y1, y2]) => {
          if (hg.querySelector(q) || (y2 - y1) * this.k < 14) return; /* 区高不足 14px 就不放了 */
          put(act, r.x + r.w - 15 / this.k, (y1 + y2) / 2, 'plus');
        });
      }
    }
    /* 悬停成员行:整行高亮 + 紧贴类框右外侧的 ×。放在框外:落在文字末端的话,想点文字会误删 */
    const hv = this.picking ? this.hover : null;
    if (hv && hv.kind === 'member' && !this.editing) {
      const r = this.memberBox(hv.ref, hv.mi);
      if (r) {
        svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'lry-ov-rowhov', 'vector-effect': 'non-scaling-stroke' }, this.dyn);
        this.handle(this.dyn, r.x + r.w + 10 / this.k, r.cy, 'x', { class: 'lry-ov-handle lry-ov-handle-x', 'data-act': 'delmember', 'data-ref': hv.ref, 'data-mi': hv.mi }, 16);
      }
    }
    /* 拖拽建关系的橡皮筋 */
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
   * 工具条落位:类图的框排得密(纵向图里父类就在正上方),固定贴在上方会盖住别的类。
   * 这里在上下左右几个候选位置里挑第一个不压住其它类框 / 便签的;都不行再交给基类(上方优先、收进可视区)。
   * 成员行的工具条从"类框左侧"起试;关系照旧走基类的贴一侧。
   */
  placeTools(anchorRect) {
    const tools = this.ui.tools;
    anchorRect = anchorRect || (this.sel && this.toolsAnchor ? this.toolsAnchor() : null);
    if (tools.hidden || !anchorRect || !this.svg || (anchorRect.side && !anchorRect.sideLeft)) { super.placeTools(anchorRect); return; }
    const sel = this.sel;
    const g = sel.kind === 'note' ? this.noteEls[sel.ref] : this.nodeEls[sel.ref];
    const self = g ? this.toStageRect(nodeRect(g)) : null; /* 选中对象所在的框 */
    if (!self) { super.placeTools(anchorRect); return; }
    const others = [];
    Object.keys(this.nodeEls).forEach((id) => { if (this.nodeEls[id] !== g) others.push(this.toStageRect(nodeRect(this.nodeEls[id]))); });
    this.noteEls.forEach((n) => { if (n && n !== g) others.push(this.toStageRect(nodeRect(n))); });
    if (!this.placeToolsAvoid(anchorRect, self, others, false)) super.placeTools(anchorRect);
  }

  /* 选中对象在重渲染后不在了 */
  loseSelection() {
    this.sel = null;
    this.selExtra = [];
    this.hideTools();
  }

  /* ---------- 命中 ---------- */

  /*
   * 事件目标 → 模型位置:{ kind:'class' | 'note', ref } 或 { kind:'member', ref, mi }。
   * 不是图上的节点、或节点对应的语句画布没建模时返回 null。
   */
  locate(target) {
    if (!target || !target.closest) return null;
    const g = target.closest('g.node');
    if (!g || !this.svg || !this.svg.contains(g)) return null;
    const id = this.idOf(g);
    if (id === null) {
      const n = this.noteIndex(g);
      return n >= 0 && this.model.notes[n] ? { kind: 'note', ref: n } : null;
    }
    const cls = this.model.byId[id];
    if (!cls) return null;
    const lab = target.closest('g.label');
    const grp = lab && lab.parentNode ? (lab.parentNode.getAttribute('class') || '').split(' ')[0] : '';
    if ((grp === 'members-group' || grp === 'methods-group') && this.rowsAligned(cls, g)) {
      const kind = grp === 'members-group' ? 'attr' : 'method';
      const idx = [...lab.parentNode.querySelectorAll('g.label')].indexOf(lab);
      const member = cls.members.filter((x) => x.kind === kind)[idx];
      if (member) return { kind: 'member', ref: id, mi: cls.members.indexOf(member) };
    }
    return { kind: 'class', ref: id };
  }

  /* ---------- 指针 ---------- */

  handleOver(e) {
    const h = e.target.closest && e.target.closest('.lry-ov-handle');
    if (h) {
      const ref = h.getAttribute('data-ref');
      if (h.getAttribute('data-mi') !== null) this.setHover({ kind: 'member', ref, mi: +h.getAttribute('data-mi') });
      else this.setHover({ kind: 'class', ref });
      return;
    }
    const at = this.locate(e.target);
    if (at) this.setHover(at);
  }

  handleOut(e) {
    const g = e.target.closest && e.target.closest('g.node');
    if (!g) return;
    const to = e.relatedTarget;
    /* 移到本节点内部、或本节点自己的手柄上(手柄画在节点外侧),都不算离开 */
    if (to && g.contains(to)) return;
    const h = to && to.closest ? to.closest('.lry-ov-handle') : null;
    if (h && h.getAttribute('data-ref') && h.getAttribute('data-ref') === this.idOf(g)) return;
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
      else if (act === 'move') {
        const nd = this.scene && this.scene.byKey[h.getAttribute('data-kind') === 'note' ? 'note:' + ref : ref];
        if (nd) this.dragNode(e, nd, h.getAttribute('data-kind') === 'note' ? { kind: 'note', ref: +ref } : { kind: 'class', ref });
      }
      else if (act === 'addattr' || act === 'addmethod') this.addMember(ref, act === 'addattr' ? 'attr' : 'method');
      else if (act === 'delmember') this.removeMember(ref, +h.getAttribute('data-mi'));
      return;
    }
    const hit = e.target.closest('.lry-ov-edgehit');
    if (hit) { this.select({ kind: 'rel', ref: +hit.getAttribute('data-edge') }); return; }
    const li = this.edgeIndexAt(e.target); /* 点在关系文字上:同样选中这条关系 */
    if (li >= 0) { this.select({ kind: 'rel', ref: li }); return; }
    const at = this.locate(e.target);
    if (!at) { this.select(null); return; } /* 走到这儿的空白不多见(框选已在 commonDown 里处理) */
    /* 按住类名行或便签拖 = 挪动整个类 / 便签(多选时整组);按住成员行维持原样(只选中,成员行有自己的操作) */
    if (at.kind === 'class' || at.kind === 'note') {
      const nd = this.scene && this.scene.byKey[at.kind === 'note' ? 'note:' + at.ref : at.ref];
      if (nd) { this.nodeDown(e, nd, at); return; }
    }
    this.trackPointer(e, { up: (ev, moved) => { if (!moved) this.select(at); } });
  }

  dblClick(e) {
    /* 按坐标命中而不是看事件目标:前面的按下-松开可能让事件目标变成容器 */
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const hit = el && el.closest ? el.closest('.lry-ov-edgehit') : null;
    if (hit) { this.editRelLabel(+hit.getAttribute('data-edge')); return; }
    const li = this.edgeIndexAt(el); /* 双击关系文字 */
    if (li >= 0) { this.editRelLabel(li); return; }
    const at = this.locate(el);
    if (!at) { if (!this.model.classes.length) this.addLoose(); return; }
    if (at.kind === 'note') { this.editNote(at.ref); return; }
    const cls = this.model.byId[at.ref];
    if (at.kind === 'member') { const m = cls.members[at.mi]; if (m) this.editMember(cls, m); return; }
    const lab = el.closest('g.label');
    const grp = lab && lab.parentNode ? (lab.parentNode.getAttribute('class') || '').split(' ')[0] : '';
    if (grp === 'annotation-group') this.editAnnotation(cls);
    else this.editTitle(cls);
  }

  /* 拖动期间的统一收尾:记录指针下的类,重画橡皮筋 */
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

  /* 从手柄按住拖动:拖到另一个类上松手 = 建立关联;原地松手(没拖动)= 点击 */
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

  /* 拖动关系端点改接:橡皮筋从不动的那一端画起 */
  startReconnect(e, index, end, handleEl) {
    const c = { index, end, x: 0, y: 0, pt: null, target: null, targetEl: null };
    const p = this.edgePaths[index];
    const nums = (String(p.getAttribute('d') || '').match(/-?[\d.]+/g) || [0, 0, 0, 0]).map(Number);
    const fixed = end === 'a' ? { x: nums[nums.length - 2], y: nums[nums.length - 1] } : { x: nums[0], y: nums[1] };
    c.x = fixed.x; c.y = fixed.y; c.pt = { x: c.x, y: c.y };
    this.connect = c;
    this.refresh();
    this.trackAim(e, c, (cc, moved) => {
      if (moved && cc.target) this.reconnect(index, end, cc.target);
    });
  }

  /* ---------- 结构操作(模型怎么变在 class-syntax.js,这里只管选中与提示) ---------- */

  /* 加一个类(带一个类块)并可选连一条关系;建成后选中它并进入类名编辑 */
  /* 坐标表里的键 = 类名 / "note:<序号>"。改了类名、删了便签之后键要跟着对象走:按对象身份在改动前后各取一次键 */
  mutate(label, fn) {
    const ids = new Map(), notes = new Map();
    if (this.model) {
      this.model.classes.forEach((c) => ids.set(c, c.id));
      (this.model.notes || []).forEach((n, i) => notes.set(n, 'note:' + i));
    }
    return super.mutate(label, (m) => {
      const r = fn(m);
      const n = this.layout.n;
      const move = (to, from) => { if (from !== undefined && from !== to && n[from] !== undefined) { n[to] = n[from]; delete n[from]; } };
      m.classes.forEach((c) => move(c.id, ids.get(c)));
      (m.notes || []).forEach((nt, i) => move('note:' + i, notes.get(nt)));
      return r;
    });
  }

  addClass(members, rel) {
    let cls = null;
    this.mutate('添加类', (m) => {
      cls = classAddClass(m, members, rel).cls;
      this.pendingEdit = { what: 'title', id: cls.id };
    });
    if (cls) {
      /* 图已经在自由摆放:渲染出来后把它放到与它关联的那个类旁边(见 placeSpawned)。竖图向下、横图向右 */
      this.spawn = { key: cls.id, anchor: rel ? (rel.from || rel.to || null) : null, vertical: this.model.direction !== 'LR' };
      this.select({ kind: 'class', ref: cls.id });
    }
    return cls;
  }

  /* 加一个与 id 关联的类:side=out 为"本类 → 新类",in 为"新类 → 本类" */
  addLinked(id, side) {
    const from = this.cls(id);
    if (!from) return null;
    return this.addClass(['+field'], side === 'out' ? { from: id } : { to: id });
  }

  addLoose() {
    return this.addClass(['+field'], null);
  }

  link(a, b) {
    if (a === b) { this.ctx.toast('不能关联到类自己'); return; }
    if (!this.model.byId[a] || !this.model.byId[b]) return;
    /* 同两个类之间可以有多个不同的关联;完全相同的一条多半是误操作 */
    const dup = this.model.rels.some((r) => r.a === a && r.b === b && r.start === '' && r.end === 'dependency' && !r.dashed && !r.label && !r.cardA && !r.cardB);
    if (dup) { this.ctx.toast('这两个类之间已经有一条这样的关联;要换类型请点选那条线'); return; }
    this.mutate('添加关系', (m) => { classAddRel(m, { a, b }); });
    this.select({ kind: 'rel', ref: this.model.rels.length - 1 });
  }

  reconnect(index, end, target) {
    const r = this.model.rels[index];
    if (!r) return;
    const a = end === 'a' ? target : r.a;
    const b = end === 'b' ? target : r.b;
    if (a === b) { this.ctx.toast('不能关联到类自己'); return; }
    if (!this.model.byId[a] || !this.model.byId[b]) return;
    this.mutate('改接关系', (m) => { classReconnect(m, index, a, b); });
  }

  removeClass(id) {
    if (!this.cls(id)) return;
    this.select(null);
    this.mutate('删除类', (m) => { classRemove(m, id); });
  }

  removeRel(index) {
    if (!this.model.rels[index]) return;
    this.select(null);
    this.mutate('删除关系', (m) => { classRemoveRel(m, index); });
  }

  removeNote(index) {
    if (!this.model.notes[index]) return;
    this.select(null);
    this.mutate('删除便签', (m) => { classRemoveNote(m, index); });
  }

  addNote(id) {
    if (!this.cls(id)) return;
    let index = -1;
    this.mutate('添加便签', (m) => { index = classAddNote(m, id); this.pendingEdit = { what: 'note', index }; });
    if (index >= 0) this.select({ kind: 'note', ref: index });
  }

  setDirection(d) {
    if (this.model.direction === d) return;
    this.mutate('切换方向', (m) => { classSetDirection(m, d); });
  }

  /* 顶栏的方向按钮:纵向(TB / BT)与横向(LR / RL)互切 */
  flipDirection() { this.setDirection(this.model.direction === 'LR' ? 'TB' : 'LR'); }

  /* 新成员的占位文字:+field / +field2…、+method() / +method2()… */
  nextMemberText(cls, kind) {
    const base = kind === 'method' ? '+method' : '+field';
    const taken = new Set(cls.members.map((x) => x.text));
    let k = 0;
    let text = base;
    while (taken.has(text)) text = base + (++k);
    return kind === 'method' ? text + '()' : text;
  }

  /* 加一个成员并进入文字编辑:有类块就写进类块,否则写成一条行内成员语句 */
  addMember(id, kind) {
    const c = this.cls(id);
    if (!c) return;
    let mi = -1;
    this.mutate(kind === 'method' ? '添加方法' : '添加属性', (m) => {
      const cls = m.byId[id];
      const member = classAddMember(m, cls, kind, this.nextMemberText(cls, kind));
      mi = cls.members.indexOf(member);
      this.pendingEdit = { what: 'member', id, mi };
    });
    if (mi >= 0) this.select({ kind: 'member', ref: id, mi });
  }

  removeMember(id, mi) {
    const c = this.cls(id);
    const member = c && c.members[mi];
    if (!member) return;
    this.mutate('删除成员', (m) => { classRemoveMember(m, m.byId[id], member); });
    this.select({ kind: 'class', ref: id });
  }

  /* 成员换位:与同容器里相邻的同类成员交换位置;选中跟着被移动的这一行走 */
  moveMember(c, member, dir) {
    const done = this.mutate('调整顺序', (m) => { classMoveMember(m, m.byId[c.id], member, dir); });
    if (!done) { this.ctx.toast(dir < 0 ? '已经在最上面' : '已经在最下面'); return; }
    this.select({ kind: 'member', ref: c.id, mi: c.members.indexOf(member) });
  }

  setAnnotation(c, text) {
    this.mutate('构造型', (m) => { classSetAnnotation(m, m.byId[c.id], text); });
    this.select({ kind: 'class', ref: c.id });
  }

  /* ---------- 就地文字编辑 ---------- */

  /*
   * 改标题。nameOnly = 只改类名(工具条「改名」);否则(双击标题 / Enter):
   *   带显示标注的类改的是标注;输入的是合法类名就改名;不是合法类名(含空格、括号…)的留作显示标注,类名不动。
   */
  editTitle(c, opts) {
    const g = c && this.nodeEls ? this.nodeEls[c.id] : null; /* 图还没渲染出来(引擎加载中):无从定位编辑框 */
    const row = g ? g.querySelector('g.label-group > g.label') : null;
    if (!row) return;
    const nameOnly = !!(opts && opts.nameOnly);
    const cur = classLabel(c);
    const value = nameOnly ? c.id : (cur !== null ? cur : c.id);
    this.editText(this.toStageRect(rowRect(g, row)), value, { placeholder: nameOnly ? '类名' : '类名(可随意写,含空格时作为显示名称)' }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'class', ref: c.id }); return; }
      const text = res.value.trim();
      if (!nameOnly && cur !== null) this.setLabel(c, text);
      else if (!text) { if (nameOnly) this.ctx.toast('类名不能为空'); else this.setLabel(c, ''); }
      else {
        const problem = classIdProblem(this.model, text, c);
        if (!problem) this.mutate('改类名', (m) => { classRename(m, m.byId[c.id], text); });
        else if (nameOnly) this.ctx.toast(problem);
        else this.setLabel(c, text);
      }
      this.select({ kind: 'class', ref: c.id });
    });
  }

  /* 显示标注(class A["…"]):空 = 去掉 */
  editLabel(c) {
    const g = c && this.nodeEls ? this.nodeEls[c.id] : null;
    const row = g ? g.querySelector('g.label-group > g.label') : null;
    if (!row) return;
    const cur = classLabel(c);
    this.editText(this.toStageRect(rowRect(g, row)), cur === null ? '' : cur, { placeholder: '显示名称(留空则显示类名)', selectAll: cur !== null }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'class', ref: c.id }); return; }
      this.setLabel(c, res.value.trim());
      this.select({ kind: 'class', ref: c.id });
    });
  }

  setLabel(c, text) {
    this.mutate('改标注', (m) => { classSetLabel(m, m.byId[c.id], text); });
    this.select({ kind: 'class', ref: c.id });
  }

  editAnnotation(c) {
    const g = c && this.nodeEls ? this.nodeEls[c.id] : null;
    if (!g) return;
    const cur = this.annotationOf(c);
    const row = g.querySelector('g.annotation-group > g.label') || g.querySelector('g.label-group > g.label');
    if (!row) return;
    this.editText(this.toStageRect(rowRect(g, row)), cur, { placeholder: '构造型,如 interface(留空去掉)' }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'class', ref: c.id }); return; }
      this.setAnnotation(c, res.value.trim());
    });
  }

  annotationOf(c) {
    for (const d of c.defs) if (d.block && d.block.anns.length) return d.block.anns[0];
    return '';
  }

  /* 进入成员文字编辑(全选原文字,直接输入即整体替换) */
  editMember(c, member) {
    const g = c && this.nodeEls ? this.nodeEls[c.id] : null; /* 图还没渲染出来:无从定位编辑框 */
    const row = g ? this.memberRow(c, member) : null;
    if (!row) return;
    const isMethod = member.kind === 'method';
    this.editText(this.toStageRect(rowRect(g, row)), decodeText(member.text), { placeholder: isMethod ? '方法,如:+save() void' : '属性,如:+String name' }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'class', ref: c.id }); return; }
      const text = res.value.trim();
      const mi0 = c.members.indexOf(member);
      const problem = memberProblem(text);
      /* 输入不合法:拦下并说明,成员行保持选中,方便直接重改 */
      if (problem) { this.ctx.toast(problem); this.select({ kind: 'member', ref: c.id, mi: mi0 }); return; }
      this.mutate('改成员', (m) => { classSetMemberText(m, m.byId[c.id], member, text); });
      const mi = c.members.indexOf(member);
      this.select(mi >= 0 ? { kind: 'member', ref: c.id, mi } : { kind: 'class', ref: c.id });
    });
  }

  editRelLabel(index) {
    const p = this.edgePaths && this.edgePaths[index];
    const rel = this.model.rels[index];
    if (!p || !rel) return;
    const r = rectIn(p, this.stage);
    this.editText({ x: r.x + r.w / 2 - 90, y: r.y + r.h / 2 - 15, w: 180, h: 30 }, decodeText(rel.label), { placeholder: '关系文字,如:拥有 / 1 对多' }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'rel', ref: index }); return; }
      this.mutate('改关系文字', (m) => { classSetRelLabel(m, index, res.value); });
      this.select({ kind: 'rel', ref: index });
    });
  }

  /* 基数:关系写成「前者 → 后者」,which = 'a' 是前者一侧 */
  editCard(index, which) {
    const p = this.edgePaths && this.edgePaths[index];
    const rel = this.model.rels[index];
    if (!p || !rel) return;
    const r = rectIn(p, this.stage);
    const tip = which === 'a' ? rel.a : rel.b;
    const cur = which === 'a' ? rel.cardA : rel.cardB;
    this.editText({ x: r.x + r.w / 2 - 90, y: r.y + r.h / 2 - 15, w: 180, h: 30 }, cur, { placeholder: '「' + tip + '」一侧的基数,如 1 / 0..*(留空清除)', selectAll: !!cur }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'rel', ref: index }); return; }
      this.mutate('改基数', (m) => { classSetCard(m, index, which, res.value); });
      this.select({ kind: 'rel', ref: index });
    });
  }

  editNote(index) {
    const p = this.noteEls && this.noteEls[index];
    const note = this.model.notes[index];
    if (!p || !note) return;
    this.editText(this.toStageRect(nodeRect(p)), decodeText(note.text), { multiline: true, placeholder: '便签说明' }).then((res) => {
      if (!res || res.cancelled) { this.select({ kind: 'note', ref: index }); return; }
      const text = res.value.trim();
      if (!text) this.removeNote(index);
      else {
        this.mutate('改便签', (m) => { classSetNote(m, index, text); });
        this.select({ kind: 'note', ref: index });
      }
    });
  }

  /* ---------- 选中对象的默认动作(按键与工具条共用) ---------- */

  deleteSelection() {
    const sel = this.sel;
    if (!sel) return;
    if (sel.kind === 'class') this.removeClass(sel.ref);
    else if (sel.kind === 'member') this.removeMember(sel.ref, sel.mi);
    else if (sel.kind === 'rel') this.removeRel(sel.ref);
    else if (sel.kind === 'note') this.removeNote(sel.ref);
    else if (sel.kind === 'item') this.deleteRefs([sel]);
  }

  enterSelection() {
    const sel = this.sel;
    if (!sel) return;
    if (sel.kind === 'class') this.editTitle(this.cls(sel.ref));
    else if (sel.kind === 'member') { const c = this.cls(sel.ref); const m = c && c.members[sel.mi]; if (m) this.editMember(c, m); } else if (sel.kind === 'rel') this.editRelLabel(sel.ref);
    else if (sel.kind === 'note') this.editNote(sel.ref);
  }

  addChildFromSelection() {
    const sel = this.sel;
    if (!sel) return;
    if (sel.kind === 'class') this.addLinked(sel.ref, 'out');
    else if (sel.kind === 'member') { const c = this.cls(sel.ref); const m = c && c.members[sel.mi]; if (m) this.addMember(sel.ref, m.kind); }
  }

  items() {
    return this.selectableRefs();
  }

  toolsAnchor() {
    const sel = this.sel;
    if (!sel || !this.nodeEls) return null;
    if (sel.kind === 'item') { const r = this.itemBoxOf(sel.ref); return r ? this.toStageRect(r) : null; }
    if (sel.kind === 'class') { const g = this.nodeEls[sel.ref]; return g ? this.toStageRect(nodeRect(g)) : null; }
    if (sel.kind === 'note') { const g = this.noteEls[sel.ref]; return g ? this.toStageRect(nodeRect(g)) : null; }
    if (sel.kind === 'member') {
      /* 贴在类框左侧、与该行齐平:放上方会盖住标题和上面的成员行;右侧留给连线手柄与行尾的 × */
      const r = this.memberRect(sel.ref, sel.mi);
      return r ? { x: r.x, y: r.y, w: 0, h: r.h, side: true, sideLeft: true } : null;
    }
    const p = this.edgePaths[sel.ref];
    /* 锚在整条连线的外接矩形上:工具条贴着连线上沿之上,与两端的改接手柄留出间距 */
    return p ? Object.assign(rectIn(p, this.stage), { side: true }) : null;
  }

  toolsFor(sel) {
    if (sel.kind === 'item') return this.itemTools(sel);
    if (sel.kind === 'class') {
      const node = this.cls(sel.ref);
      if (!node) return null;
      const hasLabel = classLabel(node) !== null;
      const ann = this.annotationOf(node);
      return [
        { label: '关联类', title: '添加一个类,并从本类关联过去 (Tab)', icon: MINI.plus, onPick: () => this.addLinked(node.id, 'out') },
        { label: '改名', title: hasLabel ? '修改类名(这个类带显示标注;改标注用「标注」)' : '修改类名(双击标题也行)', icon: MINI.edit, onPick: () => this.editTitle(node, { nameOnly: true }) },
        { label: '标注', title: '显示名称:图上显示的文字,类名不动', icon: MINI.text, active: hasLabel, onPick: () => this.editLabel(node) },
        { label: '属性', title: '添加属性', icon: MINI.plus, onPick: () => this.addMember(node.id, 'attr') },
        { label: '方法', title: '添加方法', icon: MINI.plus, onPick: () => this.addMember(node.id, 'method') },
        { label: '便签', title: '添加说明便签', icon: MINI.note, onPick: () => this.addNote(node.id) },
        {
          key: 'ann', label: '构造型', title: '构造型:<<interface>> 这类标记', icon: MINI.braces,
          panel: ANNS.map((a) => ({ label: a || '无', title: a ? '<<' + a + '>>' : '去掉构造型', active: a === ann, onPick: () => this.setAnnotation(node, a) }))
            .concat([{ label: '自定义…', title: '输入构造型文字', icon: MINI.edit, onPick: () => this.editAnnotation(node) }])
        },
        {
          key: 'fill', label: '配色', title: '类框底色', icon: swatch(node.fill),
          panel: FILLS.map((f) => ({
            title: f ? '底色 ' + f : '主题默认', icon: swatch(f), active: (node.fill || null) === f,
            onPick: () => this.mutate('类框配色', (m) => { classSetFill(m, m.byId[node.id], f); })
          }))
        },
        { icon: MINI.trash, title: '删除类(连同它的关系与便签) (Delete)', danger: true, onPick: () => this.removeClass(node.id) }
      ];
    }
    if (sel.kind === 'member') {
      const c = this.cls(sel.ref);
      const member = c && c.members[sel.mi];
      if (!member) return null;
      return [
        { label: '改文字', title: '修改成员(双击成员行也行)', icon: MINI.edit, onPick: () => this.editMember(c, member) },
        { icon: MINI.up, title: '上移(同类成员内换序)', onPick: () => this.moveMember(c, member, -1) },
        { icon: MINI.down, title: '下移(同类成员内换序)', onPick: () => this.moveMember(c, member, 1) },
        { icon: MINI.trash, title: '删除成员 (Delete)', danger: true, onPick: () => this.removeMember(c.id, sel.mi) }
      ];
    }
    if (sel.kind === 'note') {
      return [
        { label: '改文字', title: '修改便签(双击也行)', icon: MINI.edit, onPick: () => this.editNote(sel.ref) },
        { icon: MINI.trash, title: '删除便签 (Delete)', danger: true, onPick: () => this.removeNote(sel.ref) }
      ];
    }
    const rel = this.model.rels[sel.ref];
    if (!rel) return null;
    const type = relTypeOf(rel);
    return [
      {
        key: 'type', label: CLASS_LABELS.rels[type] || '自定义', title: '切换关系类型(图上记号随之改变)', icon: MINI.swap,
        panel: REL_TYPES.map(([key, name]) => ({ label: name, title: CLASS_LABELS.relTips[key], active: key === type, onPick: () => this.setRelType(sel.ref, key) }))
      },
      { label: '反向', title: '调换关系的两个端点(记号跟着端点走)', icon: MINI.swap, onPick: () => this.swapRel(sel.ref) },
      { label: '文字', title: '关系文字(双击连线也行)', icon: MINI.text, active: !!rel.label, onPick: () => this.editRelLabel(sel.ref) },
      { label: '基数·前', title: '「' + rel.a + '」一侧的基数,如 1 / 0..*', icon: MINI.card, active: !!rel.cardA, onPick: () => this.editCard(sel.ref, 'a') },
      { label: '基数·后', title: '「' + rel.b + '」一侧的基数,如 1 / 0..*', icon: MINI.card, active: !!rel.cardB, onPick: () => this.editCard(sel.ref, 'b') },
      { icon: MINI.trash, title: '删除关系 (Delete)', danger: true, onPick: () => this.removeRel(sel.ref) }
    ];
  }

  setRelType(index, key) {
    this.mutate('切换关系类型', (m) => { classSetRelType(m, index, key); });
  }

  swapRel(index) {
    this.mutate('调换端点', (m) => { classSwapRel(m, index); });
  }

  /* ---------- 多选 / 剪贴板 / 工具条(钩子的约定见 diagram-canvas.js) ---------- */

  refNodeKey(ref) {
    if (!ref) return null;
    return ref.kind === 'class' ? ref.ref : ref.kind === 'note' ? 'note:' + ref.ref : null;
  }
  refRect(ref) {
    if (!ref) return null;
    if (ref.kind === 'item') return this.itemBoxOf(ref.ref);
    if (ref.kind === 'class') { const g = this.nodeEls && this.nodeEls[ref.ref]; return g ? nodeRect(g) : null; }
    if (ref.kind === 'note') { const g = this.noteEls && this.noteEls[ref.ref]; return g ? nodeRect(g) : null; }
    if (ref.kind === 'member') return this.memberBox(ref.ref, ref.mi);
    return null; /* 关系线不参与框选 / 多选 */
  }
  selectableRefs() {
    const out = this.model.classes.map((c) => ({ kind: 'class', ref: c.id }))
      .concat(this.model.notes.map((n, i) => ({ kind: 'note', ref: i })));
    (this.layout.items || []).forEach((it) => { if (it && it.id) out.push({ kind: 'item', ref: it.id }); });
    return out;
  }
  isEmpty() { return !this.model.classes.length; }
  edgeRefAt(i) { return this.model.rels[i] ? { kind: 'rel', ref: i } : null; }
  nodeRefAt(t) { return this.locate(t); }

  /* 一次删掉一组:类(连同它的关系 / 便签)、单独选中的关系 / 便签 / 成员行、自由元素。一个撤销步 */
  deleteRefs(refs) {
    const ids = refs.filter((r) => r.kind === 'class').map((r) => r.ref).filter((id) => this.model.byId[id]);
    const rels = refs.filter((r) => r.kind === 'rel').map((r) => this.model.rels[r.ref]).filter(Boolean);
    const notes = refs.filter((r) => r.kind === 'note').map((r) => this.model.notes[r.ref]).filter(Boolean);
    const iids = refs.filter((r) => r.kind === 'item').map((r) => r.ref);
    if (!ids.length && !rels.length && !notes.length && !iids.length) return false;
    this.select(null);
    if (iids.length) this.layout.items = (this.layout.items || []).filter((it) => iids.indexOf(it.id) < 0);
    this.mutate('删除', (m) => {
      ids.forEach((id) => classRemove(m, id));
      /* 删类会带走它的关系和便签,序号跟着变:剩下的按对象找回,从后往前删 */
      rels.map((x) => m.rels.indexOf(x)).filter((i) => i >= 0).sort((a, b) => b - a).forEach((i) => classRemoveRel(m, i));
      notes.map((x) => m.notes.indexOf(x)).filter((i) => i >= 0).sort((a, b) => b - a).forEach((i) => classRemoveNote(m, i));
    });
    return true;
  }

  /* 复制:选中的类(成员 / 构造型 / 标注 / 配色)、它们之间的关系、它们的便签、各自的位置、选中的自由元素 */
  buildCopyPayload(refs) {
    const clsIds = refs.filter((r) => r.kind === 'class').map((r) => r.ref);
    const noteIdx = refs.filter((r) => r.kind === 'note').map((r) => r.ref);
    if (!clsIds.length && !noteIdx.length && !refs.some((r) => r.kind === 'item')) return null;
    const posOf = (key, nd) => { const p = this.layout.n[key] || (nd && [nd.x, nd.y]); return p ? [p[0], p[1]] : null; };
    const nodes = clsIds.map((id) => this.model.byId[id]).filter(Boolean).map((c) => {
      const def = c.defs[0] || {};
      return {
        id: c.id, members: c.members.map((m) => m.text), anns: ((def.block && def.block.anns) || []).slice(),
        label: classLabel(c), generic: def.generic || '', fill: c.fill || null
      };
    });
    const idSet = new Set(clsIds);
    const rels = this.model.rels.filter((r) => idSet.has(r.a) && idSet.has(r.b))
      .map((r) => ({ a: r.a, b: r.b, ga: r.ga, gb: r.gb, cardA: r.cardA, cardB: r.cardB, start: r.start, end: r.end, dashed: r.dashed, label: r.label }));
    const notes = this.model.notes.map((n, i) => ({ n, i })).filter((x) => noteIdx.indexOf(x.i) >= 0 || idSet.has(x.n.cls))
      .map((x) => ({ cls: x.n.cls, g: x.n.g, text: decodeText(x.n.text), __pos: posOf('note:' + x.i, this.scene && this.scene.byKey['note:' + x.i]) }));
    const pos = {};
    nodes.forEach((n) => { const p = posOf(n.id, this.scene && this.scene.byKey[n.id]); if (p) pos[n.id] = p; });
    return { kind: 'class', nodes, rels, notes, items: this.copyItems(refs), pos };
  }

  /* 粘贴:类换新名,关系 / 便签跟着换;位置整体平移(贴到右键点的地方,或原位偏 24) */
  applyPaste(payload, at) {
    if (payload.kind !== 'class') {
      if (!(payload.items || []).length) { this.ctx.toast('只能粘贴到类图画板(剪贴板里是' + ({ flow: '流程图', mind: '思维导图' }[payload.kind] || '别的') + ')'); return false; }
      const off0 = this.pasteOffset(payload, at);
      this.pasteItems(payload, off0, null, null);
      this.repaintItems();
      this.commitLayout('粘贴', { norender: true });
      this.ctx.toast('已粘贴 ' + this.countCopied(payload));
      return true;
    }
    const off = this.pasteOffset(payload, at);
    const map = {};
    const made = [];
    const firsts = [];
    this.mutate('粘贴', (m) => {
      (payload.nodes || []).forEach((src) => {
        const cls = classAddClass(m, src.members || []).cls;
        map[src.id] = cls.id;
        made.push({ kind: 'class', ref: cls.id });
        if (src.label) classSetLabel(m, cls, src.label);
        if (src.generic && cls.defs[0]) cls.defs[0].generic = src.generic;
        if ((src.anns || []).length === 1) classSetAnnotation(m, cls, src.anns[0]);
        else if ((src.anns || []).length > 1 && cls.defs[0]) { cls.defs[0].block.anns = src.anns.slice(); cls.defs[0].dirty = true; }
        if (src.fill) classSetFill(m, cls, src.fill);
        const p = (payload.pos || {})[src.id];
        if (p) this.layout.n[cls.id] = [r2(p[0] + off.dx), r2(p[1] + off.dy)];
      });
      (payload.rels || []).forEach((r) => {
        if (!map[r.a] || !map[r.b]) return;
        classAddRel(m, { a: map[r.a], b: map[r.b], ga: r.ga || '', gb: r.gb || '', cardA: r.cardA || '', cardB: r.cardB || '', start: r.start || '', end: r.end || 'dependency', dashed: !!r.dashed, label: r.label || '' });
      });
      (payload.notes || []).forEach((n) => {
        if (!map[n.cls]) return;
        const i = classAddNote(m, map[n.cls]);
        classSetNote(m, i, n.text);
        if (n.__pos) this.layout.n['note:' + i] = [r2(n.__pos[0] + off.dx), r2(n.__pos[1] + off.dy)];
      });
      const endPointOf = (key) => { const nd = this.scene && this.scene.byKey[key]; return nd ? [nd.x + nd.w, nd.y + nd.h / 2] : [0, 0]; };
      this.pasteItems(payload, off, (k) => map[k], endPointOf).forEach((it) => made.push({ kind: 'item', ref: it.id }));
    });
    /* 选中的是刚贴进来的 */
    this.selExtra = made.slice(0, -1);
    this.sel = made[made.length - 1] || null;
    this.ctx.toast('已粘贴 ' + this.countCopied(payload));
    return true;
  }

  /* 工具条「添加节点」/ 右键「在这里添加节点」:新类落在点的地方,随后进入类名编辑 */
  placeNodeAt(x, y) {
    let id = null;
    this.mutate('添加类', (m) => { const r = classAddClass(m, ['+field'], null); id = r.cls.id; this.pendingEdit = { what: 'title', id }; });
    if (id) {
      this.spawn = { key: id, at: [x, y] }; /* 渲染出来后落到点的地方,见 diagram-canvas.js 的 placeSpawned */
      this.select({ kind: 'class', ref: id });
    }
    return id;
  }
}
