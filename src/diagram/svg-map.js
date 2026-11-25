/**
 * 渲染结果 ↔ 源码模型的映射(v1.3.0 可视化画布)。
 * 画布直接用 Mermaid 的实时渲染结果,在其上叠交互层;这里负责把模型里的节点/连线对应到
 * SVG 里的那一个元素,并给出包围盒。依赖的是 Mermaid 12.3.0 写进 DOM 的稳定标识(浏览器实测):
 *   流程图  节点组 g.node,id = "<渲染id>-flowchart-<节点id>-<序号>"
 *           连线   path.flowchart-link,data-id = "L_<起点>_<终点>_<序号>"(DOM 顺序 = 文本顺序)
 *   思维导图 节点组 g.mindmap-node,id = "<渲染id>-node_<行序>"(先序;注释行、空行不占号)
 *           连线   path,id = "<渲染id>-edge_<父行序>_<子行序>"
 *   类图     见 mapClassSvg
 * Mermaid 升级后若这些标识变了,browser-v14.js 的首段探针会先红。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) Object.keys(attrs).forEach((k) => { if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]); });
  if (parent) parent.appendChild(el);
  return el;
}

/* 节点组自身的平移量(节点内部坐标 → 画布坐标) */
export function nodeOrigin(g) {
  const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/.exec(g.getAttribute('transform') || '');
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
}

/* 节点组在画布坐标系(viewBox)里的矩形:x/y/width/height */
export function nodeRect(g) {
  const b = g.getBBox();
  const o = nodeOrigin(g);
  return { x: o.x + b.x, y: o.y + b.y, w: b.width, h: b.height, cx: o.x + b.x + b.width / 2, cy: o.y + b.y + b.height / 2 };
}

/*
 * 节点里某一行(标题 / 构造型 / 成员行)在画布坐标系里的矩形。
 * row.getBBox() 不含 row 自己的 transform(每个成员行带 translate(0, 12) 这类位移),也不含中间各层分组
 * (标题组 / 属性组 / 方法组各有位移):直接加节点的平移量,所有行会算到同一个位置上。
 * 这里用两个元素的屏幕变换矩阵之差,把行自身的坐标系换到节点组的坐标系。
 */
export function rowRect(g, row) {
  const b = row.getBBox();
  const o = nodeOrigin(g);
  let m = null;
  try {
    const a = g.getScreenCTM();
    const r = row.getScreenCTM();
    if (a && r) m = a.inverse().multiply(r);
  } catch (e) { m = null; /* 没有布局信息(不可见)时退回只加节点平移量 */ }
  const map = (x, y) => (m ? { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f } : { x, y });
  const p0 = map(b.x, b.y);
  const p1 = map(b.x + b.width, b.y + b.height);
  const x = o.x + Math.min(p0.x, p1.x);
  const y = o.y + Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/*
 * 节点里文字块(foreignObject)在画布坐标系里的矩形;没有文字块返回 null。
 * 流程图的 foreignObject 外面还套着一层带位移的 g.label(translate(-宽/2, -高/2)):foreignObject 自己的
 * getBBox() 不含这层位移,只加节点的平移量算出来的是**节点中心**——就地输入框因此从节点正中开始画,
 * 节点越宽偏得越多。和 rowRect 一样用坐标变换矩阵算。
 */
export function labelRect(g) {
  const fo = g.querySelector('foreignObject');
  return fo ? rowRect(g, fo) : null;
}

/* 屏幕坐标 → 画布(viewBox)坐标 */
export function toCanvasPoint(svg, clientX, clientY) {
  const p = svg.createSVGPoint();
  p.x = clientX; p.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const q = p.matrixTransform(ctm.inverse());
  return { x: q.x, y: q.y };
}

/* 一个画布单位在屏幕上的像素数:手柄、选中框按它换算,保证观感大小不随图缩放 */
export function canvasScale(svg) {
  const vb = (svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(parseFloat);
  const r = svg.getBoundingClientRect();
  return vb[2] > 0 && r.width > 0 ? r.width / vb[2] : 1;
}

/* 元素矩形相对某个容器的位置(屏幕坐标) */
export function rectIn(el, container) {
  const a = el.getBoundingClientRect();
  const b = container.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
}

/* 流程图:节点 id → g;模型连线序号 → path */
export function mapFlowSvg(svg, renderId, model) {
  const nodeEls = Object.create(null);
  const prefix = renderId + '-flowchart-';
  svg.querySelectorAll('g.node').forEach((g) => {
    const id = g.getAttribute('id') || '';
    if (id.indexOf(prefix) !== 0) return;
    nodeEls[id.slice(prefix.length).replace(/-\d+$/, '')] = g;
  });
  const paths = [...svg.querySelectorAll('path.flowchart-link')];
  const edgePaths = [];
  const used = new Set();
  model.edges.forEach((e, i) => {
    /* 按 DOM 顺序在未用过的连线里找 data-id 前缀相同的那条:原样保留的语句里若有读不出的连线,
       DOM 里会多出路径,不能简单按序号对齐 */
    const want = 'L_' + e.from + '_' + e.to + '_';
    const at = paths.findIndex((p, j) => !used.has(j) && (p.getAttribute('data-id') || '').indexOf(want) === 0);
    if (at >= 0) { used.add(at); edgePaths[i] = paths[at]; }
  });
  return { nodeEls, edgePaths };
}

/* 思维导图:先序序号 → g(下标即序号) */
export function mapMindSvg(svg, renderId, flat) {
  const prefix = renderId + '-node_';
  const nodeEls = [];
  svg.querySelectorAll('g.mindmap-node').forEach((g) => {
    const id = g.getAttribute('id') || '';
    if (id.indexOf(prefix) !== 0) return;
    nodeEls[parseInt(id.slice(prefix.length), 10)] = g;
  });
  return nodeEls.slice(0, flat.length);
}

/*
 * 类图:类名 → g;便签序号 → g;关系序号 → path。
 * 实测(Mermaid 12.3.0):
 *   类     g.node,id = "<渲染id>-classId-<类名>-<序号>"——**序号是跨渲染的全局计数**,同一个图两次渲染不一样,
 *          只能按"类名"对;带超链接(click X href)的类被包在 <a> 里,所以不从 g.nodes 的直接子级里找
 *   便签   g.node,id = "<渲染id>-note<序号>"(按 note for 语句的文本顺序编号)
 *   关系   path.relation,data-id = "id_<甲>_<乙>_<序号>"(序号同样是全局计数);便签连线 data-id = "edgeNote<序号>"
 *   连线的 DOM 顺序 = 文本顺序(同类之间多条关系也按先后)
 */
export function mapClassSvg(svg, renderId, model) {
  const nodeEls = Object.create(null);
  const noteEls = [];
  const prefix = renderId + '-classId-';
  const notePrefix = renderId + '-note';
  svg.querySelectorAll('g.node').forEach((g) => {
    const id = g.getAttribute('id') || '';
    if (id.indexOf(prefix) === 0) nodeEls[id.slice(prefix.length).replace(/-\d+$/, '')] = g;
    else if (id.indexOf(notePrefix) === 0) noteEls[parseInt(id.slice(notePrefix.length), 10)] = g;
  });
  const paths = [...svg.querySelectorAll('path.relation')];
  const used = new Set();
  /* 按 DOM 顺序在未用过的连线里找 data-id 前缀相同的那条 */
  const take = (pred) => {
    const at = paths.findIndex((p, j) => !used.has(j) && pred(p.getAttribute('data-id') || ''));
    if (at < 0) return null;
    used.add(at);
    return paths[at];
  };
  const edgePaths = model.rels.map((r) => take((d) => d.indexOf('id_' + r.a + '_' + r.b + '_') === 0));
  const notePaths = model.notes.map((n, i) => take((d) => d === 'edgeNote' + i));
  return { nodeEls, noteEls, edgePaths, notePaths };
}
