/**
 * 画布布局层(v1.4.0 自由画布):Mermaid 负责"把节点画出来",这里负责"节点放在哪、连线怎么走"。
 *
 * 两件事:
 *  1. 布局数据的编解码——节点坐标、自由元素存进图源码末尾的 %% 注释块。存储格式不变(仍是 <pre class="lry-mermaid"> + 纯文本),
 *     Mermaid 把它当注释;在别的 Markdown 工具里打开,仍是一张自动排版的正常 Mermaid 图。
 *  2. 把布局落到 Mermaid 的渲染结果上:平移节点、重画连线、连线文字跟到中点、子图框按成员重算、重算画布大小;
 *     思维导图的自动排版(左→右树形,确定性)和语雀风格的样式也在这里做。
 *
 * **无依赖**:编辑器直接 import;前台渲染器加载同一份源码的独立构建(dist/lry-diagram-layout.js,挂 window.LryDiagramLayout)。
 * "编辑器里看到的 = 发布后的",靠的就是两边跑同一份代码。
 *
 * 只认 Mermaid 12.3.0 写进 DOM 的标识(浏览器实测,见 browser-v16.js 首段探针):
 *   流程图  节点 g.node,transform = 中心点,图形以 0 为中心;连线 path.flowchart-link[data-id="L_<起>_<止>_<序号>"],箭头是 marker 属性;
 *           连线文字 g.edgeLabels > g.edgeLabel(中心点) > g.label[data-id];子图 g.cluster > rect + g.cluster-label
 *   思维导图 节点 g.mindmap-node(中心点);无框节点画的是 path.node-bkg 圆角框 + 一条底线 + 文字;
 *           连线 path.edge[data-id="edge_<父>_<子>"](<父> <子> 是先序行号)
 *   类图     节点 g.node(中心点);关系 path.relation[data-id="id_<甲>_<乙>_<序号>"] 带 marker;便签连线 data-id="edgeNote<序号>";
 *           关系文字同流程图;基数 g.edgeTerminals **没有 id**,按离哪个端点最近来归属
 * 节点组 id 里的序号是跨渲染的全局计数,同一个图两次渲染不一样——一律按 data-id / 名字 / 行号对,不按整串 id。
 *
 * 几条踩过的坑:
 *  - 流程图 / 类图的连线上有内联样式 stroke-dasharray,实线是 "0 0 <长度> <箭头留白>",里面写死了**当时的连线长度**。
 *    连线重画变长之后不更新它,实线上会每隔一段出现一个缺口。
 *  - Mermaid 注入的样式带 "#<渲染id>" 前缀,优先级压过任何外部样式表:思维导图的配色只能用内联样式,不能靠 CSS。
 *  - viewBox 的原点不是 0(Mermaid 留了内边距),节点坐标和它在同一个坐标系;量比例要拿 viewBox 的宽。
 *  - 布局块里的 4 字节字符(贴纸表情等)必须写成 \u 转义(见 jsonText):站点的表是 utf8(每字符最多 3 字节),原样存落库直接报错。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const LAYOUT_VERSION = 1;
const MARK_LINE = '%% lry-layout v' + LAYOUT_VERSION;
/* 行尾兼容 CRLF:表单提交上来的内容是 CRLF(浏览器对 textarea 的规定),从接口 / 导入拿到的源码也可能带 \r */
const BLOCK_RE = /\r?\n?%% lry-layout v1\r?\n%% ([^\n\r]*)(?=\r?\n|$)/;

/* ---------- 布局块 ---------- */

export function emptyLayout() {
  return { v: LAYOUT_VERSION, n: {}, items: [] };
}

export function layoutHasContent(layout) {
  return !!(layout && ((layout.n && Object.keys(layout.n).length) || (layout.items && layout.items.length)));
}

function cleanPos(p) {
  if (!Array.isArray(p) || p.length < 2) return null;
  const x = +p[0], y = +p[1];
  if (!isFinite(x) || !isFinite(y)) return null;
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

/** 源码里的布局块 → 布局对象。没有块、块损坏都返回空布局(= 自动排版),不抛异常 */
export function parseLayout(src) {
  const layout = emptyLayout();
  const m = BLOCK_RE.exec(String(src || ''));
  if (!m) return layout;
  try {
    const o = JSON.parse(m[1]);
    if (!o || typeof o !== 'object') return layout;
    if (o.n && typeof o.n === 'object') {
      Object.keys(o.n).forEach((k) => { const p = cleanPos(o.n[k]); if (p) layout.n[k] = p; });
    }
    if (Array.isArray(o.items)) {
      layout.items = o.items.filter((it) => validItem(it));
    }
  } catch (e) { /* 块损坏:当作没有 */ }
  return layout;
}

/** 去掉布局块的源码(源码模式里显示用;也是 attachLayout 的起点) */
export function stripLayout(src) {
  return String(src || '').replace(BLOCK_RE, '');
}

/* 布局压成一行 JSON(只留有内容的部分) */
function jsonLine(layout) {
  const o = { v: LAYOUT_VERSION };
  if (layout && layout.n) {
    const keys = Object.keys(layout.n).filter((k) => cleanPos(layout.n[k])).sort();
    if (keys.length) {
      o.n = {};
      keys.forEach((k) => { o.n[k] = cleanPos(layout.n[k]); });
    }
  }
  const items = (layout && layout.items || []).filter(validItem);
  if (items.length) o.items = items;
  return jsonText(o);
}

/**
 * 对象 → 写进图源码(布局块、剪贴板)的那一行 JSON。
 *  - 尖括号、& 写成 \u 转义:图源存进 HTML 时这几个字符会被实体编码再来回解码,不碰它们最稳。
 *  - 4 字节字符(表情、部分数学符号等)写成代理对转义(\ud83d\ude00):站点的表目前是 utf8,每个字符最多 3 字节,原样写进去落库直接报错
 *    (2026-11-25 真实发帖页实测:带贴纸的帖子 1366 存不进去,还留下一条没有正文的帖子)。JSON.parse 读出来还是原字符,
 *    以后表升到 utf8mb4 也不用改。
 */
export function jsonText(obj) {
  const u = (c) => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
  return JSON.stringify(obj)
    .replace(/[\u003c\u003e\u0026\u2028\u2029]/g, u)
    .replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (c) => (c.length > 1 ? u(c.charAt(0)) + u(c.charAt(1)) : u(c)));
}

/** 把布局接到源码末尾:已有块先换掉;布局为空就不写块(源码回到一字不差的原样) */
export function attachLayout(src, layout) {
  const base = stripLayout(src);
  if (!layoutHasContent(layout)) return base;
  const nl = /\r\n/.test(base) ? '\r\n' : '\n'; /* 跟随源码自己的换行风格 */
  return base + (base && !/\n$/.test(base) ? nl : '') + MARK_LINE + nl + '%% ' + jsonLine(layout);
}

/* ---------- Mermaid 初始化配置(编辑器与前台共用,只此一份) ---------- */
export const MERMAID_INIT = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    fontFamily: 'PingFang SC,Hiragino Sans GB,Microsoft YaHei,Helvetica Neue,Arial,sans-serif',
    fontSize: '14px',
    background: '#ffffff',
    /* 节点:白底、浅灰描边、深灰字 */
    primaryColor: '#ffffff', primaryTextColor: '#1f2329', primaryBorderColor: '#dee0e3',
    secondaryColor: '#f2f3f5', secondaryTextColor: '#1f2329', secondaryBorderColor: '#dee0e3',
    tertiaryColor: '#f7f8fa', tertiaryTextColor: '#1f2329', tertiaryBorderColor: '#e5e6eb',
    lineColor: '#8f959e', textColor: '#1f2329',
    mainBkg: '#ffffff', nodeBorder: '#dee0e3',
    /* 子图:浅灰底、浅灰边 */
    clusterBkg: '#f7f8fa', clusterBorder: '#e5e6eb', edgeLabelBackground: '#ffffff',
    titleColor: '#1f2329'
  },
  /* Mermaid 自己的样式都带 "#<渲染id>" 前缀,这里的覆盖必须加 !important 才压得过。
     线宽的两条规则只管流程图的连线:思维导图的连线也带 edge-thickness-normal 这个类,而它的线宽是按分支用内联样式写的
     (3px)——带 !important 的规则会压过内联样式,不限定住的话思维导图的线全是 1.5px(2026-11-24 实测) */
  themeCSS: '.flowchart-link.edge-thickness-normal{stroke-width:1.5px !important}.flowchart-link.edge-thickness-thick{stroke-width:3px !important}'
    + '.flowchart-link,.relation{fill:none !important;stroke-linecap:round !important}',
  /* 节点:内边距 15、最小宽度 56、文字到 220 才换行。Mermaid 12.3 的默认值是最小宽度 120、到 120 就换行——
     「判断?」三个字也会把菱形撑到 173px,稍长的文字被挤成两行(2026-11-24 实测) */
  flowchart: { curve: 'basis', padding: 15, minNodeWidth: 56, wrappingWidth: 220, nodeSpacing: 48, rankSpacing: 56, useMaxWidth: true },
  class: { useMaxWidth: true },
  mindmap: { useMaxWidth: true }
};

/* 思维导图配色:按一级分支取色,子节点沿用所在分支的颜色 */
export const MIND_PALETTE = ['#a07de8', '#5b8def', '#36c5bd', '#f2a84b', '#5fbf73', '#e8709a', '#6fb3e0', '#c9cf56'];
export const MIND_TEXT = '#1f2329';
export const MIND_ROOT_BG = '#f2f3f5';
/* 相邻层级的横向间距(第一层留宽一些给曲线拐弯)、相邻节点的纵向间距 */
const MIND_GAP_X = [0, 64, 48, 40];
const MIND_GAP_Y = 18;

/* 图型识别(给前台渲染器用;编辑器自己用 diagram/kind.js 那套更完整的)。先去掉注释行:布局块、%%{init}%% 指令都长得不像图 */
export function layoutKind(src) {
  const body = String(src || '').replace(/%%[^\n]*/g, '');
  if (/^\s*mindmap\b/m.test(body)) return 'mind';
  if (/^\s*classDiagram\b/m.test(body)) return 'class';
  if (/^\s*(?:graph|flowchart)\b/m.test(body)) return 'flow';
  return null;
}

/* ---------- 几何 ---------- */

const f = (n) => Math.round(n * 100) / 100;
/* 判断"节点动没动"的容差:坐标表里的数保留两位小数,记下自动排版的当前位置再读回来会差不到 0.005 */
const POS_EPS = 0.01;

export function rectOf(x, y, w, h) {
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
}

export function unionRect(list) {
  let u = null;
  list.forEach((a) => {
    if (!a) return;
    u = u ? rectOf(Math.min(u.x, a.x), Math.min(u.y, a.y), Math.max(u.r, a.r) - Math.min(u.x, a.x), Math.max(u.b, a.b) - Math.min(u.y, a.y))
      : rectOf(a.x, a.y, a.w, a.h);
  });
  return u;
}

export function overlaps(a, b) {
  return a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
}

/** rect 和 others 里任何一个重叠,就往下挪到它的下面;一路挪到不重叠为止(新节点落位用) */
export function avoidOverlap(rect, others) {
  let r = rectOf(rect.x, rect.y, rect.w, rect.h);
  const list = (others || []).filter((o) => o && (o.w || o.h));
  for (let i = 0; i < 400; i++) {
    const hit = list.find((o) => overlaps(r, o));
    if (!hit) break;
    r = rectOf(r.x, hit.b + 16, r.w, r.h);
  }
  return [r.x, r.y];
}

export function anchorOf(r, side) {
  return side === 'l' ? { x: r.x, y: r.cy } : side === 'r' ? { x: r.r, y: r.cy } : side === 't' ? { x: r.cx, y: r.y } : { x: r.cx, y: r.b };
}

/* 两个节点各从哪一边出 / 进:横向为主就走左右边,纵向为主就走上下边 */
export function pickSides(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'r', to: 'l' } : { from: 'l', to: 'r' };
  return dy >= 0 ? { from: 'b', to: 't' } : { from: 't', to: 'b' };
}

/**
 * 两个框之间的连线(三次贝塞尔)。offset 把线整体挪开一点:同两个节点之间的多条线各自错开,不叠在一起。
 * @returns {{d:string, from:{x:number,y:number}, to:{x:number,y:number}}}
 */
export function routePath(a, b, opts) {
  const off = (opts && opts.offset) || 0;
  const s = pickSides(a, b);
  const p1 = anchorOf(a, s.from);
  const p2 = anchorOf(b, s.to);
  if (s.from === 'r' || s.from === 'l') {
    p1.y += off; p2.y += off;
    const k = Math.max(36, Math.abs(p2.x - p1.x) * 0.5);
    const c1 = p1.x + (s.from === 'r' ? k : -k), c2 = p2.x + (s.to === 'l' ? -k : k);
    return { d: 'M' + f(p1.x) + ' ' + f(p1.y) + 'C' + f(c1) + ' ' + f(p1.y) + ', ' + f(c2) + ' ' + f(p2.y) + ', ' + f(p2.x) + ' ' + f(p2.y), from: p1, to: p2 };
  }
  p1.x += off; p2.x += off;
  const k = Math.max(32, Math.abs(p2.y - p1.y) * 0.5);
  const c1 = p1.y + (s.from === 'b' ? k : -k), c2 = p2.y + (s.to === 't' ? -k : k);
  return { d: 'M' + f(p1.x) + ' ' + f(p1.y) + 'C' + f(p1.x) + ' ' + f(c1) + ', ' + f(p2.x) + ' ' + f(c2) + ', ' + f(p2.x) + ' ' + f(p2.y), from: p1, to: p2 };
}

/**
 * 思维导图的树形自动排版(左→右):父节点竖向居中对齐它的孩子们,横向逐级向右。
 * 结果只跟树的样子有关——增删节点时别的节点不会跳。
 * @param {Array<{w:number,h:number,children:number[]}>} list 下标 0 是根;children 是本表下标
 * @returns {Array<[number,number]>} 每个节点的左上角
 */
export function tidyLayout(list) {
  const n = list.length;
  if (!n) return [];
  const sub = new Array(n), out = new Array(n);
  const gapX = (d) => MIND_GAP_X[Math.min(d, MIND_GAP_X.length - 1)];
  const measure = (i) => {
    const c = list[i].children;
    if (!c.length) { sub[i] = list[i].h; return; }
    let s = 0;
    c.forEach((j, k) => { measure(j); s += sub[j] + (k ? MIND_GAP_Y : 0); });
    sub[i] = s;
  };
  const place = (i, top, left, depth) => {
    const me = list[i];
    const c = me.children;
    if (!c.length) { out[i] = [left, top]; return; }
    let t = top;
    c.forEach((j) => { place(j, t, left + me.w + gapX(depth + 1), depth + 1); t += sub[j] + MIND_GAP_Y; });
    out[i] = [left, top + (sub[i] - me.h) / 2];
  };
  measure(0);
  place(0, 0, 0, 0);
  return out;
}

/* ---------- 小工具 ---------- */

function nodeBBox(el) {
  try {
    const b = el.getBBox();
    if (b && (b.width || b.height)) return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch (e) { /* 无布局环境 */ }
  return { x: -40, y: -15, w: 80, h: 30 };
}

/* 元素 transform 里的 translate */
function transformXY(el) {
  const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/.exec((el && el.getAttribute('transform')) || '');
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
}

function setTranslate(el, x, y) {
  el.setAttribute('transform', 'translate(' + f(x) + ', ' + f(y) + ')');
}

/* path 的起点与终点(取 d 的前两个、后两个数) */
function pathEnds(path) {
  const nums = (String(path.getAttribute('d') || '').match(/-?[\d.]+/g) || []).map(Number);
  return { from: { x: nums[0] || 0, y: nums[1] || 0 }, to: { x: nums[nums.length - 2] || 0, y: nums[nums.length - 1] || 0 } };
}

function pathLength(path) {
  try { return typeof path.getTotalLength === 'function' ? path.getTotalLength() : 0; } catch (e) { return 0; }
}

/* 连线重画后,内联 stroke-dasharray 里写死的长度要跟着换(见文件头的坑) */
function refreshDash(path) {
  const st = path.getAttribute('style') || '';
  if (!/stroke-dasharray/.test(st)) return;
  const len = pathLength(path);
  if (!len) return;
  const solid = /stroke-dasharray:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*;/.exec(st);
  if (solid && !/stroke-dasharray:\s*0\s+0\s+2\s+2/.test(st)) {
    path.setAttribute('style', st.replace(solid[0], 'stroke-dasharray: ' + solid[1] + ' ' + solid[2] + ' ' + f(len) + ' ' + solid[4] + ';'));
    return;
  }
  path.setAttribute('style', st.replace(/stroke-dasharray:[^;]*;/, 'stroke-dasharray: 0 0 ' + '2 2 '.repeat(Math.ceil(len / 4) + 1) + '0;'));
}

/* 在 "<甲>_<乙>_<序号>" 去掉序号的串里认出两个节点:节点名里可以有下划线,所以拿已知的节点名去对 */
function resolvePair(core, has) {
  const parts = core.split('_');
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join('_'), b = parts.slice(i).join('_');
    if (has(a) && has(b)) return [a, b];
  }
  return null;
}

/* 去掉 id 末尾的 "-<全局序号>" */
const stripNum = (id) => String(id || '').replace(/-\d+$/, '');

/* ---------- 自由元素 ---------- */

export const ITEM_KINDS = ['text', 'shape', 'line', 'sticker', 'image'];
export const SHAPE_FORMS = ['rect', 'rounded', 'ellipse', 'diamond', 'para', 'hex'];

function validItem(it) {
  return !!it && typeof it === 'object' && typeof it.k === 'string' && ITEM_KINDS.indexOf(it.k) >= 0;
}

/* 布局块与剪贴板都是不可信输入:颜色只接受调色板输出的十六进制值,图片只接受安全协议 */
function safeColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || color === 'transparent' ? color : fallback;
}

function safeImageSrc(value) {
  const src = String(value || '').trim();
  if (!src || /[\u0000-\u0020<>"']/.test(src)) return '';
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(src)) return src;
  if (/^(?:https?:\/\/|\/(?!\/)|\.{1,2}\/)/i.test(src)) return src;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('//')) return src;
  return '';
}

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) Object.keys(attrs).forEach((k) => { if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]); });
  if (parent) parent.appendChild(el);
  return el;
}

const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function shapePath(form, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2;
  switch (form) {
    case 'diamond': return 'M' + f(cx) + ' ' + f(y) + 'L' + f(x + w) + ' ' + f(cy) + 'L' + f(cx) + ' ' + f(y + h) + 'L' + f(x) + ' ' + f(cy) + 'Z';
    case 'para': return 'M' + f(x + w * 0.2) + ' ' + f(y) + 'L' + f(x + w) + ' ' + f(y) + 'L' + f(x + w * 0.8) + ' ' + f(y + h) + 'L' + f(x) + ' ' + f(y + h) + 'Z';
    case 'hex': return 'M' + f(x + w * 0.22) + ' ' + f(y) + 'L' + f(x + w * 0.78) + ' ' + f(y) + 'L' + f(x + w) + ' ' + f(cy) + 'L' + f(x + w * 0.78) + ' ' + f(y + h) + 'L' + f(x + w * 0.22) + ' ' + f(y + h) + 'L' + f(x) + ' ' + f(cy) + 'Z';
    default: return '';
  }
}

/* 自由元素占的矩形(算画布范围用) */
export function itemRect(it) {
  const x = +it.x || 0, y = +it.y || 0;
  if (it.k === 'text') return rectOf(x, y, +it.w || 80, +it.h || 24);
  if (it.k === 'shape') return rectOf(x, y, +it.w || 120, +it.h || 56);
  if (it.k === 'sticker') { const s = +it.s || 40; return rectOf(x, y, s, s); }
  if (it.k === 'image') return rectOf(x, y, +it.w || 120, +it.h || 90);
  if (it.k === 'line') {
    /* 只算写死坐标的端点:绑在节点上的那一端位置随节点走(由 renderItems 现算),这里当它不存在。两端都没有坐标 = 画不出来,不占地方 */
    const pts = [it.a, it.b].filter(Array.isArray).map((p) => ({ x: +p[0] || 0, y: +p[1] || 0 }));
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return rectOf(Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs) - Math.min.apply(null, xs), Math.max.apply(null, ys) - Math.min.apply(null, ys));
  }
  return null;
}

/* 连线类自由元素的端点:坐标,或"某个节点的某一边"(节点挪了它跟着走) */
function itemPoint(p, scene) {
  if (Array.isArray(p)) return { x: +p[0] || 0, y: +p[1] || 0 };
  if (p && p.n && scene && scene.byKey[p.n]) return anchorOf(nodeRectOf(scene.byKey[p.n]), p.s || 'r');
  return null;
}

function htmlLabel(g, x, y, w, h, text, style) {
  const fo = svgEl('foreignObject', { x: f(x), y: f(y), width: f(w), height: f(h) }, g);
  const div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  div.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;text-align:center;white-space:pre-wrap;word-break:break-word;'
    + 'font-size:14px;line-height:1.5;color:' + MIND_TEXT + ';' + (style || '');
  div.innerHTML = escHtml(text || '').replace(/\n/g, '<br/>');
  fo.appendChild(div);
  return div;
}

/** 把自由元素画进 g.lry-items(每次重画都整组重建;编辑器在它上面叠交互层) */
export function renderItems(svg, scene, items) {
  const root = svg.querySelector('g') || svg;
  const old = svg.querySelector('g.lry-items');
  if (old) old.parentNode.removeChild(old);
  const list = (items || []).filter(validItem);
  if (!list.length) return null;
  const g = svgEl('g', { class: 'lry-items' }, root);
  list.forEach((it, i) => {
    const x = +it.x || 0, y = +it.y || 0;
    /* data-iid:元素的 id(选中、拖动、缩放都按它找);data-item:在表里的序号 */
    const grp = svgEl('g', { class: 'lry-item', 'data-item': i, 'data-kind': it.k, 'data-iid': it.id || '' }, g);
    if (it.k === 'text') {
      const div = htmlLabel(grp, x, y, +it.w || 80, +it.h || 24, it.t, 'justify-content:flex-start;text-align:left;font-size:' + (+it.s || 14) + 'px;color:' + safeColor(it.c, MIND_TEXT) + ';');
      div.setAttribute('data-lry-text', '1'); /* 编辑器按它量文字的实际高度 */
    } else if (it.k === 'shape') {
      const w = +it.w || 120, h = +it.h || 56, form = it.f || 'rect';
      const attrs = { fill: safeColor(it.fc, '#ffffff'), stroke: safeColor(it.sc, '#8f959e'), 'stroke-width': +it.sw || 1.5 };
      if (form === 'ellipse') svgEl('ellipse', Object.assign({ cx: f(x + w / 2), cy: f(y + h / 2), rx: f(w / 2), ry: f(h / 2) }, attrs), grp);
      else if (form === 'rect' || form === 'rounded') svgEl('rect', Object.assign({ x: f(x), y: f(y), width: f(w), height: f(h), rx: form === 'rounded' ? Math.min(10, h / 2) : 2 }, attrs), grp);
      else svgEl('path', Object.assign({ d: shapePath(form, x, y, w, h) }, attrs), grp);
      if (it.t) htmlLabel(grp, x + 8, y, w - 16, h, it.t, 'pointer-events:none;');
    } else if (it.k === 'sticker') {
      const s = +it.s || 40;
      const fo = svgEl('foreignObject', { x: f(x), y: f(y), width: f(s), height: f(s) }, grp);
      const div = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
      div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      div.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:' + f(s * 0.8) + 'px;line-height:1;';
      div.textContent = it.e || '😀';
      fo.appendChild(div);
    } else if (it.k === 'image') {
      const src = safeImageSrc(it.src);
      if (src) {
        const im = svgEl('image', { x: f(x), y: f(y), width: f(+it.w || 120), height: f(+it.h || 90), preserveAspectRatio: 'xMidYMid meet' }, grp);
        im.setAttribute('href', src);
      }
    } else if (it.k === 'line') {
      const a = itemPoint(it.a, scene), b = itemPoint(it.b, scene);
      if (!a || !b) return;
      const color = safeColor(it.c, '#8f959e');
      const d = routePath(rectOf(a.x - 1, a.y - 1, 2, 2), rectOf(b.x - 1, b.y - 1, 2, 2)).d;
      /* 加宽的透明线:细线本身点不中 */
      svgEl('path', { d, class: 'lry-item-hit', fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'stroke-linecap': 'round' }, grp);
      const p = svgEl('path', { d, class: 'lry-item-line', fill: 'none', stroke: color, 'stroke-width': +it.sw || 1.5, 'stroke-linecap': 'round' }, grp);
      if (it.dash) p.setAttribute('stroke-dasharray', '6 4');
      if (it.arrow) p.setAttribute('marker-end', 'url(#' + itemArrowId(svg, color) + ')');
      if (it.t) svgEl('text', { x: f((a.x + b.x) / 2), y: f((a.y + b.y) / 2 - 6), 'text-anchor': 'middle', fill: MIND_TEXT, 'font-size': 12 }, grp).textContent = it.t;
    }
  });
  return g;
}

/* 自由连线的箭头(同色共用一个):画在 svg 最前面的 defs 里,不挡 Mermaid 自己的 marker */
function itemArrowId(svg, color) {
  const id = (svg.getAttribute('id') || 'lry') + '_lry-item-arrow-' + String(color).replace(/[^a-z0-9]/gi, '');
  /* 在 svg 里面找,不用 document.getElementById:svg 还没挂进文档时(离屏渲染)后者找不到,会重复建 */
  if (!svg.querySelector('[id="' + id + '"]')) {
    const defs = svgEl('defs', null, null);
    svg.insertBefore(defs, svg.firstChild);
    const m = svgEl('marker', { id, viewBox: '0 0 12 12', refX: 11, refY: 6, markerWidth: 9, markerHeight: 9, orient: 'auto-start-reverse' }, defs);
    svgEl('path', { d: 'M1 1 L11 6 L1 11 z', fill: color }, m);
  }
  return id;
}

/* ---------- 认图:把 Mermaid 的渲染结果各归各位 ---------- */

function addNode(scene, key, el, w, h, extra) {
  const o = transformXY(el) || { x: 0, y: 0 };
  const n = Object.assign({ key, el, w, h, cx0: o.x, cy0: o.y, x: 0, y: 0, x0: 0, y0: 0 }, extra || {});
  scene.nodes.push(n);
  scene.byKey[key] = n;
  return n;
}

function attachLabels(svg, scene) {
  const seen = new Set();
  svg.querySelectorAll('g.edgeLabels g.edgeLabel').forEach((holder) => {
    const inner = holder.querySelector('g.label[data-id]');
    if (!inner) return;
    const e = scene.edges.find((x) => x.key === inner.getAttribute('data-id'));
    if (e) { e.labels.push(holder); seen.add(holder); }
  });
  return seen;
}

function buildFlow(svg, scene, renderId) {
  const prefix = renderId + '-flowchart-';
  svg.querySelectorAll('g.node').forEach((g) => {
    const id = g.getAttribute('id') || '';
    if (id.indexOf(prefix) !== 0) return;
    const b = nodeBBox(g);
    addNode(scene, stripNum(id.slice(prefix.length)), g, b.w, b.h);
  });
  const has = (k) => !!scene.byKey[k];
  svg.querySelectorAll('path.flowchart-link').forEach((p) => {
    const id = p.getAttribute('data-id') || '';
    if (id.indexOf('L_') !== 0) return;
    const m = /_(\d+)$/.exec(id.slice(2));
    if (!m) return;
    const pair = resolvePair(id.slice(2, 2 + m.index), has);
    scene.edges.push({ key: id, el: p, from: pair ? scene.byKey[pair[0]] : null, to: pair ? scene.byKey[pair[1]] : null, labels: [], terminals: [] });
  });
  attachLabels(svg, scene);
  svg.querySelectorAll('g.cluster').forEach((g) => {
    const rect = g.querySelector('rect');
    if (!rect) return;
    const cid = g.getAttribute('id') || '';
    const c = { el: g, rect, label: g.querySelector('g.cluster-label'), members: [], sub: cid.indexOf(renderId + '-') === 0 ? cid.slice(renderId.length + 1) : '' };
    const box = rectOf(+rect.getAttribute('x') || 0, +rect.getAttribute('y') || 0, +rect.getAttribute('width') || 0, +rect.getAttribute('height') || 0);
    /* 子图的成员:Mermaid 初始排版时落在框里的节点(所以必须在挪动节点之前认) */
    scene.nodes.forEach((n) => {
      const r = rectOf(n.cx0 - n.w / 2, n.cy0 - n.h / 2, n.w, n.h);
      if (r.x >= box.x && r.r <= box.r && r.y >= box.y && r.b <= box.b) c.members.push(n);
    });
    scene.clusters.push(c);
  });
  /* 连到子图上的线(甲 --> 子图名):子图不是节点,上面两头都认不出来。这里把子图那一头认成子图框,另一头认回节点 */
  scene.edges.forEach((e) => {
    if (e.from || e.to) return;
    const m = /_(\d+)$/.exec(e.key);
    /* m.index 是在整串 key 上的位置(含 "L_" 前缀),所以结束下标直接用它 */
    const core = e.key.slice(2, m ? m.index : e.key.length);
    const parts = core.split('_');
    for (let i = 1; i < parts.length; i++) {
      const head = parts.slice(0, i).join('_'), tail = parts.slice(i).join('_');
      const hc = scene.clusters.find((c) => c.sub === head), tc = scene.clusters.find((c) => c.sub === tail);
      if (!hc && !tc) continue;
      if (hc) e.fromBox = hc; else e.from = scene.byKey[head] || null;
      if (tc) e.toBox = tc; else e.to = scene.byKey[tail] || null;
      break;
    }
  });
}

function clusterRect(c) {
  return rectOf(+c.rect.getAttribute('x') || 0, +c.rect.getAttribute('y') || 0, +c.rect.getAttribute('width') || 0, +c.rect.getAttribute('height') || 0);
}

function buildMind(svg, scene, renderId) {
  const prefix = renderId + '-node_';
  const groups = Array.from(svg.querySelectorAll('g.mindmap-node'))
    .filter((g) => (g.getAttribute('id') || '').indexOf(prefix) === 0)
    .sort((a, b) => (+a.getAttribute('id').slice(prefix.length)) - (+b.getAttribute('id').slice(prefix.length)));
  const defs = groups.map((g) => {
    const fo = g.querySelector('foreignObject');
    const plain = !g.querySelector('.label-container'); /* 无框节点:Mermaid 画的是带底色的圆角框,布局上按文字块算 */
    const b = nodeBBox(g);
    const w = plain && fo && +fo.getAttribute('width') ? +fo.getAttribute('width') : b.w;
    const h = plain && fo && +fo.getAttribute('height') ? +fo.getAttribute('height') : b.h;
    return { w, h, plain, parent: -1, kids: [], root: /\bsection-root\b/.test(g.getAttribute('class') || '') };
  });
  const parentOf = defs.map(() => -1);
  svg.querySelectorAll('path.edge[data-id^="edge_"]').forEach((p) => {
    const m = /^edge_(\d+)_(\d+)$/.exec(p.getAttribute('data-id'));
    if (!m) return;
    const a = +m[1], c = +m[2];
    if (defs[a] && defs[c] && a !== c && parentOf[c] < 0) { parentOf[c] = a; defs[a].kids.push(c); }
  });
  defs.forEach((d) => d.kids.sort((x, y) => x - y));
  /* 先按树算出每个节点的键(根是 "0",第 j 个孩子是 "<父键>/<j>")、深度、所在的一级分支,再登记节点 */
  const keys = defs.map(() => ''), depths = defs.map(() => 0), branches = defs.map(() => 0);
  const walk = (i, key, depth, branch) => {
    keys[i] = key;
    depths[i] = depth;
    branches[i] = branch;
    defs[i].kids.forEach((c, j) => walk(c, key + '/' + j, depth + 1, depth === 0 ? j : branch));
  };
  const rootIdx = parentOf.findIndex((p) => p < 0);
  if (rootIdx >= 0) walk(rootIdx, '0', 0, 0);
  const nodes = groups.map((g, i) => addNode(scene, keys[i] || 'node_' + i, g, defs[i].w, defs[i].h,
    { plain: defs[i].plain, root: defs[i].root, parent: null, children: [], depth: depths[i], branch: branches[i] }));
  defs.forEach((d, i) => d.kids.forEach((c) => {
    nodes[c].parent = nodes[i];
    nodes[i].children.push(nodes[c]);
  }));
  svg.querySelectorAll('path.edge[data-id^="edge_"]').forEach((p) => {
    const m = /^edge_(\d+)_(\d+)$/.exec(p.getAttribute('data-id'));
    if (!m || !nodes[+m[1]] || !nodes[+m[2]]) return;
    scene.edges.push({ key: p.getAttribute('data-id'), el: p, from: nodes[+m[1]], to: nodes[+m[2]], labels: [], terminals: [], mind: true });
  });
  attachLabels(svg, scene);
}

function buildClass(svg, scene, renderId) {
  const classPrefix = renderId + '-classId-', notePrefix = renderId + '-note';
  svg.querySelectorAll('g.node').forEach((g) => {
    const id = g.getAttribute('id') || '';
    const b = nodeBBox(g);
    if (id.indexOf(classPrefix) === 0) addNode(scene, stripNum(id.slice(classPrefix.length)), g, b.w, b.h);
    else if (id.indexOf(notePrefix) === 0) addNode(scene, 'note:' + stripNum(id.slice(notePrefix.length)), g, b.w, b.h);
  });
  const has = (k) => !!scene.byKey[k];
  const classes = () => scene.nodes.filter((nd) => nd.key.indexOf('note:') !== 0);
  svg.querySelectorAll('path.relation').forEach((p) => {
    const id = p.getAttribute('data-id') || '';
    if (id.indexOf('edgeNote') === 0) {
      /* 便签连线:起点是便签,终点是离连线终点最近的那个类 */
      const note = scene.byKey['note:' + id.slice(8)];
      const end = pathEnds(p).to;
      let best = null, bestD = Infinity;
      classes().forEach((nd) => { const d = Math.pow(nd.cx0 - end.x, 2) + Math.pow(nd.cy0 - end.y, 2); if (d < bestD) { bestD = d; best = nd; } });
      scene.edges.push({ key: id, el: p, from: note || null, to: best, labels: [], terminals: [] });
      return;
    }
    if (id.indexOf('id_') !== 0) return;
    const m = /_(\d+)$/.exec(id.slice(3));
    if (!m) return;
    const pair = resolvePair(id.slice(3, 3 + m.index), has);
    scene.edges.push({ key: id, el: p, from: pair ? scene.byKey[pair[0]] : null, to: pair ? scene.byKey[pair[1]] : null, labels: [], terminals: [] });
  });
  attachLabels(svg, scene);
  /* 基数标注没有 id:按离哪条线的哪个端点最近来归属 */
  svg.querySelectorAll('g.edgeTerminals').forEach((t) => {
    const at = transformXY(t);
    if (!at) return;
    let best = null, bestD = Infinity;
    /* 只在类之间的关系线里找:便签连线和关系线常常挤在同一个角上,按距离分不清 */
    scene.edges.forEach((e) => {
      if (e.key.indexOf('id_') !== 0) return;
      const ends = pathEnds(e.el);
      ['from', 'to'].forEach((end) => {
        const d = Math.pow(ends[end].x - at.x, 2) + Math.pow(ends[end].y - at.y, 2);
        if (d < bestD) { bestD = d; best = { e, end }; }
      });
    });
    if (best && bestD < 3600) best.e.terminals.push({ el: t, end: best.end });
  });
}

/**
 * 认图。**必须在挪动任何节点之前调用**(它要记下 Mermaid 给的初始位置)。
 * @param {SVGSVGElement} svg Mermaid 渲染出来的 svg
 * @param {'flow'|'mind'|'class'} kind
 * @returns {{kind:string, nodes:Array, edges:Array, clusters:Array, byKey:object}}
 */
export function buildScene(svg, kind) {
  const scene = { kind, nodes: [], edges: [], clusters: [], byKey: {} };
  const renderId = svg.getAttribute('id') || '';
  if (kind === 'mind') buildMind(svg, scene, renderId);
  else if (kind === 'flow') buildFlow(svg, scene, renderId);
  else if (kind === 'class') buildClass(svg, scene, renderId);
  scene.nodes.forEach((n) => {
    n.x0 = n.cx0 - n.w / 2;
    n.y0 = n.cy0 - n.h / 2;
    n.x = n.x0;
    n.y = n.y0;
  });
  /* 同两个节点之间的多条连线:各自错开 */
  const groups = {};
  scene.edges.forEach((e) => {
    if (!e.from || !e.to || e.from === e.to) return;
    const k = e.from.key + '>' + e.to.key;
    (groups[k] = groups[k] || []).push(e);
  });
  Object.keys(groups).forEach((k) => groups[k].forEach((e, i) => { e.par = { i, n: groups[k].length }; }));
  scene.edges.forEach((e) => {
    const ends = pathEnds(e.el);
    e.init = {
      ends,
      labels: e.labels.map((l) => ({ el: l, at: transformXY(l) || { x: 0, y: 0 } })),
      terminals: e.terminals.map((t) => ({ el: t.el, end: t.end, at: transformXY(t.el) || { x: 0, y: 0 } }))
    };
  });
  scene.clusters.forEach((c) => {
    c.init = {
      x: +c.rect.getAttribute('x') || 0, y: +c.rect.getAttribute('y') || 0,
      w: +c.rect.getAttribute('width') || 0, h: +c.rect.getAttribute('height') || 0,
      label: transformXY(c.label) || { x: 0, y: 0 }
    };
  });
  return scene;
}

/* ---------- 落位 ---------- */

export function nodeRectOf(n) {
  return rectOf(n.x, n.y, n.w, n.h);
}

/** 把节点挪到 (x, y)(它的框的左上角,画布单位)。只动 DOM,不写布局 */
export function setNodePos(n, x, y) {
  n.x = x;
  n.y = y;
  setTranslate(n.el, x + n.w / 2, y + n.h / 2);
}

/* 思维导图的曲线:无框节点从文字的下方出发、落在子节点文字的下方(语雀的样子);带框的节点从框边走 */
function routeMind(p, c, off) {
  const pr = nodeRectOf(p), cr = nodeRectOf(c);
  const right = cr.cx >= pr.cx;
  const ps = p.plain ? { x: right ? pr.x + Math.min(16, pr.w * 0.3) : pr.r - Math.min(16, pr.w * 0.3), y: pr.b + 1 } : anchorOf(pr, right ? 'r' : 'l');
  const cs = c.plain ? { x: right ? cr.x + 8 : cr.r - 8, y: cr.b + 1 } : anchorOf(cr, right ? 'l' : 'r');
  ps.y += off; cs.y += off;
  const k = Math.max(20, Math.abs(cs.x - ps.x) * 0.5);
  const c1x = ps.x + (right ? k : -k), c2x = cs.x + (right ? -k : k);
  return { d: 'M' + f(ps.x) + ' ' + f(ps.y) + 'C' + f(c1x) + ' ' + f(ps.y) + ', ' + f(c2x) + ' ' + f(cs.y) + ', ' + f(cs.x) + ' ' + f(cs.y), from: ps, to: cs };
}

function routeOne(scene, e) {
  const a = e.from, b = e.to;
  const movedBy = (n) => (n && (Math.abs(n.x - n.x0) > POS_EPS || Math.abs(n.y - n.y0) > POS_EPS)) ? { x: n.x - n.x0, y: n.y - n.y0 } : null;
  const boxMovedBy = (c) => {
    if (!c) return null;
    const d = { x: (+c.rect.getAttribute('x') || 0) - c.init.x, y: (+c.rect.getAttribute('y') || 0) - c.init.y };
    return d.x || d.y ? d : null;
  };
  const da = movedBy(a) || boxMovedBy(e.fromBox);
  const db = movedBy(b) || boxMovedBy(e.toBox);
  if (!da && !db) return;
  const ends = e.init.ends;
  let from = ends.from, to = ends.to;
  const ra = a ? nodeRectOf(a) : (e.fromBox ? clusterRect(e.fromBox) : null);
  const rb = b ? nodeRectOf(b) : (e.toBox ? clusterRect(e.toBox) : null);
  const off = e.par && e.par.n > 1 ? (e.par.i - (e.par.n - 1) / 2) * 18 : 0;
  if (ra && rb && a !== b) {
    const r = scene.kind === 'mind' ? routeMind(a, b, off) : routePath(ra, rb, { offset: off });
    e.el.setAttribute('d', r.d);
    refreshDash(e.el);
    from = r.from;
    to = r.to;
  } else {
    /* 自环、或有一端根本认不出来:没有可重算的两端,整条线跟着动过的那一端平移 */
    const d = da || db;
    e.el.setAttribute('transform', 'translate(' + f(d.x) + ', ' + f(d.y) + ')');
    from = { x: ends.from.x + d.x, y: ends.from.y + d.y };
    to = { x: ends.to.x + d.x, y: ends.to.y + d.y };
  }
  /* 连线文字:落在新的中点 */
  e.init.labels.forEach((l) => setTranslate(l.el, (from.x + to.x) / 2, (from.y + to.y) / 2));
  /* 基数这类端点标注:跟着各自的端点走 */
  e.init.terminals.forEach((t) => {
    const pt = t.end === 'from' ? from : to, o = t.end === 'from' ? ends.from : ends.to;
    setTranslate(t.el, t.at.x + pt.x - o.x, t.at.y + pt.y - o.y);
  });
}

/** 重画连线:两端都在 nodes 里的那些;不传 keys 就全部重画 */
export function rerouteEdges(scene, keys) {
  const set = keys && new Set(keys);
  scene.edges.forEach((e) => {
    if (set && !(e.from && set.has(e.from.key)) && !(e.to && set.has(e.to.key))) return;
    routeOne(scene, e);
  });
}

/* 子图框:包住它的所有成员;标题跟着框的左上角走。拖动节点时编辑器会逐帧调用它 */
export function fitCluster(c) {
  if (!c.members.length) return;
  /* 成员一个都没挪过(没拖过节点的图、或存下来的位置就是自动排版的位置):子图框保持 Mermaid 自己画的,不去收紧它 */
  if (!c.fitted && !c.members.some((m) => Math.abs(m.x - m.x0) > POS_EPS || Math.abs(m.y - m.y0) > POS_EPS)) return;
  c.fitted = true;
  const u = unionRect(c.members.map(nodeRectOf));
  if (!u) return;
  const padX = 16, padTop = 28, padBottom = 14;
  const x = u.x - padX, y = u.y - padTop, w = u.w + padX * 2, h = u.h + padTop + padBottom;
  c.rect.setAttribute('x', f(x)); c.rect.setAttribute('y', f(y));
  c.rect.setAttribute('width', f(w)); c.rect.setAttribute('height', f(h));
  if (c.label) setTranslate(c.label, c.init.label.x + (x + w / 2) - (c.init.x + c.init.w / 2), c.init.label.y + y - c.init.y);
}

/* 思维导图的语雀风格:无框节点去底色、文字深灰;根节点灰色圆角底;连线按一级分支配色、加粗、圆头。
   Mermaid 的样式带 "#<渲染id>" 前缀,外部样式表压不过,所以用内联样式 */
function styleMind(scene) {
  const paint = (el, props) => { if (el) Object.keys(props).forEach((k) => { el.style[k] = props[k]; }); };
  scene.nodes.forEach((n) => {
    const g = n.el;
    const color = MIND_PALETTE[n.branch % MIND_PALETTE.length];
    paint(g.querySelector('.node-bkg'), { fill: 'transparent', stroke: 'none' });
    g.querySelectorAll('line').forEach((l) => paint(l, { stroke: 'none' }));
    const shape = g.querySelector('.label-container');
    if (shape) paint(shape, n.root ? { fill: MIND_ROOT_BG, stroke: 'none' } : { fill: '#ffffff', stroke: color, strokeWidth: '1.5px' });
    g.querySelectorAll('span, p').forEach((t) => paint(t, { color: MIND_TEXT, fontWeight: n.root ? '600' : '400' }));
  });
  scene.edges.forEach((e) => {
    const n = e.to || e.from;
    paint(e.el, { stroke: MIND_PALETTE[(n ? n.branch : 0) % MIND_PALETTE.length], strokeWidth: '3px', fill: 'none', strokeLinecap: 'round' });
  });
}

/** 重算画布大小:把所有东西都框进来,四周留边。svg 的宽是 100% + max-width,所以改 viewBox 和 max-width 就够 */
export function fitViewBox(svg, scene, items) {
  const rects = scene.nodes.map(nodeRectOf);
  scene.clusters.forEach((c) => rects.push(rectOf(+c.rect.getAttribute('x') || 0, +c.rect.getAttribute('y') || 0, +c.rect.getAttribute('width') || 0, +c.rect.getAttribute('height') || 0)));
  scene.edges.forEach((e) => e.init.labels.forEach((l) => {
    const at = transformXY(l.el);
    if (!at) return;
    let b = null;
    try { b = l.el.getBBox(); } catch (err) { /* 无布局环境 */ }
    if (b && (b.width || b.height)) rects.push(rectOf(at.x + b.x, at.y + b.y, b.width, b.height));
  }));
  (items || []).forEach((it) => rects.push(itemRect(it)));
  const u = unionRect(rects);
  if (!u) return null;
  const pad = 24;
  const box = rectOf(u.x - pad, u.y - pad, u.w + pad * 2, u.h + pad * 2);
  svg.setAttribute('viewBox', f(box.x) + ' ' + f(box.y) + ' ' + f(box.w) + ' ' + f(box.h));
  svg.style.maxWidth = f(box.w) + 'px';
  return box;
}

/**
 * 把布局整份落到渲染结果上。思维导图没有存位置的节点按树形自动排版;其它两种图没有存位置的节点保持 Mermaid 的位置不动。
 * @returns {boolean} 是否有节点被挪过(= 画布归我们管)
 */
export function applyLayout(svg, scene, layout) {
  const L = layout || emptyLayout();
  let any = false;
  if (scene.kind === 'mind') {
    const tidy = tidyLayout(scene.nodes.map((n) => ({ w: n.w, h: n.h, children: n.children.map((c) => scene.nodes.indexOf(c)) })));
    scene.nodes.forEach((n, i) => {
      const p = cleanPos(L.n[n.key]) || tidy[i];
      setNodePos(n, p[0], p[1]);
      any = true;
    });
    styleMind(scene);
  } else {
    scene.nodes.forEach((n) => {
      const p = cleanPos(L.n[n.key]);
      /* 存下来的位置和 Mermaid 给的相差不到 0.01(坐标表里的数保留两位,第一次拖动时记下的就是自动排版的当前位置):
         这个节点没被人动过——保持原样,连着它的线也就不必重画(重画会让回边和正向边叠到一起,2026-11-24 实测) */
      if (p && (Math.abs(p[0] - n.x0) > POS_EPS || Math.abs(p[1] - n.y0) > POS_EPS)) { setNodePos(n, p[0], p[1]); any = true; }
    });
  }
  /* 先收紧子图框再画线:连到子图上的线以子图框为端点 */
  scene.clusters.forEach(fitCluster);
  rerouteEdges(scene);
  renderItems(svg, scene, L.items);
  if (any || (L.items && L.items.length)) fitViewBox(svg, scene, L.items);
  return any;
}

/* ---------- 思维导图:自由摆放之后的结构变化怎么落位 ---------- */
/*
 * 图在编辑器里改动过一次之后,所有节点的位置都存在坐标表里(别的节点因此不会跳)。之后结构再变,
 * 变化的那一部分要自己找地方:下面三个函数对应"新节点 / 整棵子树挂到别的节点下""两个同级换序""删除后补位"。
 * 共同原则:只挪动必须挪的节点;被挪动的节点整体平移、彼此相对位置不变。
 */

function subtreeNodes(root) {
  const out = [root];
  root.children.forEach((c) => out.push.apply(out, subtreeNodes(c)));
  return out;
}

/* 一组节点的包围盒 */
export function groupRect(list) {
  return unionRect(list.map(nodeRectOf));
}

/* 整体平移一组节点,并把坐标写进坐标表 */
function shiftNodes(list, dx, dy, layout) {
  list.forEach((n) => {
    setNodePos(n, n.x + dx, n.y + dy);
    if (layout && layout.n) layout.n[n.key] = [n.x, n.y];
  });
}

/* 把 rect 下方(横向和它有重叠、顶边不高于它的顶边)的节点整体往下推,给它腾地方;exclude 里的节点和 parent 的祖先不推 */
function pushDown(scene, rect, exclude, parent, layout) {
  const isAncestor = (nd) => { for (let p = parent; p; p = p.parent) if (p === nd) return true; return false; };
  /* 节点身上只有 x / y / w / h(左上角与大小),右边界要现算 */
  const below = scene.nodes.filter((o) => {
    if (exclude.indexOf(o) >= 0 || isAncestor(o)) return false;
    const r = nodeRectOf(o);
    return r.x < rect.r + 12 && rect.x - 12 < r.r && r.y >= rect.y - 4;
  });
  if (!below.length) return 0;
  const push = rect.b + MIND_GAP_Y - Math.min.apply(null, below.map((o) => o.y));
  if (push <= 0) return 0;
  shiftNodes(below, 0, push, layout);
  return push;
}

/*
 * 把一棵子树(新节点是只有一个节点的子树)放到 parent 这一侧:横向上放在它右边这一层,竖向上与它齐平;
 * parent 已有子节点时放在最后一个兄长整棵子树的下面。然后给这棵子树腾地方。
 * 子树内部按树形排布的相对位置摆(所以调用前子树节点带着树形排布给的位置)。
 * @param {Array} subtree 子树的全部节点,[0] 是子树的根
 * @param {object} parent  父节点
 * @param {object|null} after 最后一个兄长(没有就传 null)
 */
export function mindPlaceSubtree(scene, subtree, parent, after, layout) {
  const root = subtree[0];
  const x = parent.x + parent.w + MIND_GAP_X[Math.min(root.depth, MIND_GAP_X.length - 1)];
  let y = parent.y + parent.h / 2 - root.h / 2;
  if (after) {
    let bottom = after.y + after.h;
    const walk = (nd) => nd.children.forEach((c) => { bottom = Math.max(bottom, c.y + c.h); walk(c); });
    walk(after);
    y = bottom + MIND_GAP_Y;
  }
  shiftNodes(subtree, x - root.x, y - root.y, null);
  pushDown(scene, groupRect(subtree), subtree, parent, layout);
  subtree.forEach((n) => { if (layout && layout.n) layout.n[n.key] = [n.x, n.y]; });
  return [x, y];
}

/* 新节点落位(只有一个节点的子树) */
export function mindSpawnPos(scene, n, parent, after, layout) {
  return mindPlaceSubtree(scene, [n], parent, after, layout);
}

/* 某个节点的整棵子树(scene 里的节点,[0] 是它自己) */
export function mindSubtree(scene, node) {
  return subtreeNodes(node);
}

/* 两个同级节点换序:两棵子树上下对调(横向位置不变) */
export function mindSwapSlots(scene, a, b, layout) {
  if (!a.length || !b.length) return false;
  const dy = groupRect(b).y - groupRect(a).y;
  if (!dy) return false;
  shiftNodes(a, 0, dy, layout);
  shiftNodes(b, 0, -dy, layout);
  return true;
}

/* 删除节点之后:排在它后面的同级节点(连同子树)整体上移,补上空出来的位置。传了 layout 就把新位置也写进坐标表
   (不写的话,随后按坐标表整表重画会把这些节点又放回原处——2026-11-24 实测) */
export function mindCloseGap(scene, followers, height, layout) {
  const dy = height + MIND_GAP_Y;
  followers.forEach((n) => { if (n) shiftNodes(subtreeNodes(n), 0, -dy, layout || null); });
  return dy;
}

/**
 * 新节点落位:挨着 anchor(向下或向右),和谁都不重叠;没有 anchor 时放在整张图的右边。
 * @returns {[number,number]} 左上角
 */
export function placeNear(scene, n, anchor, vertical) {
  const others = scene.nodes.filter((o) => o !== n).map(nodeRectOf);
  const a = anchor && anchor !== n ? nodeRectOf(anchor) : null;
  let x, y;
  if (!a) {
    const u = unionRect(others);
    x = u ? u.r + 48 : 0;
    y = u ? u.y : 0;
  } else if (vertical) {
    x = a.x;
    y = a.b + 44;
  } else {
    x = a.r + 64;
    y = a.y;
  }
  return avoidOverlap(rectOf(x, y, n.w, n.h), others);
}
