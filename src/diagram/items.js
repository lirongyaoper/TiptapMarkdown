/**
 * 自由元素(文字 / 图形 / 连线 / 贴纸 / 图片)的模型小工具(v1.4.1)。纯函数,不碰 DOM。
 *
 * 元素存在图源码末尾的布局块里(layout.items),由 layout-core.js 的 renderItems 画进 g.lry-items;
 * 这里管的是:新元素的默认样子、id、克隆、缩放时矩形怎么变。鼠标交互在 diagram-canvas.js。
 *
 * 每个元素带 id(i1、i2…):选中 / 拖动 / 缩放都按 id 找,重渲染之后选中状态还在。
 * 连线的端点可以是写死的坐标 [x, y],也可以绑在某个节点的某一边上 { n: 节点键, s: 'l' | 'r' | 't' | 'b' }(节点挪了它跟着走)。
 */
import { rectOf, itemRect } from './layout-core.js';

export const ITEM_LABELS = { text: '文字', shape: '图形', line: '连线', sticker: '贴纸', image: '图片' };
export const FORM_LABELS = { rect: '矩形', rounded: '圆角矩形', ellipse: '椭圆', diamond: '菱形', para: '平行四边形', hex: '六边形' };
export const FORMS = Object.keys(FORM_LABELS);
/* 图形底色(null = 白)/ 描边色 / 连线色:与节点配色、思维导图分支色同一套 */
export const ITEM_FILLS = ['#ffffff', '#E8F1FF', '#FFF1DE', '#E6F7EC', '#FDE8EC', '#EFE9FF', '#F2F3F5', '#1f2329'];
export const ITEM_STROKES = ['#8f959e', '#1a66d6', '#f2a84b', '#5fbf73', '#e8709a', '#a07de8', '#1f2329'];
export const LINE_WIDTHS = [1.5, 2.5, 4];
export const FONT_SIZES = [14, 18, 24, 32];
export const RESIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 12;

/** 下一个可用的元素 id:i1、i2… */
export function nextItemId(items) {
  const used = new Set();
  (items || []).forEach((it) => { if (it && it.id) used.add(it.id); });
  let k = 1;
  while (used.has('i' + k)) k++;
  return 'i' + k;
}

export function getItem(items, id) {
  return (items || []).find((it) => it && it.id === id) || null;
}

/** 新元素的默认样子。x / y 是左上角(连线是起点) */
export function makeItem(kind, x, y, extra) {
  const it = { id: (extra && extra.id) || null, k: kind };
  if (kind === 'text') Object.assign(it, { x, y, w: 120, h: 24, t: '文字' });
  else if (kind === 'shape') Object.assign(it, { x, y, w: 120, h: 56, f: 'rounded', fc: '#ffffff', sc: '#1a66d6', t: '' });
  else if (kind === 'line') Object.assign(it, { a: [x, y], b: [x, y], c: '#8f959e', sw: 1.5, arrow: true, t: '' }); /* 两个端点各是一个数组:共用一个的话,平移时会被加两遍 */
  else if (kind === 'sticker') Object.assign(it, { x, y, s: 48, e: '😀' });
  else if (kind === 'image') Object.assign(it, { x, y, w: 160, h: 120, src: '' });
  return Object.assign(it, extra || {}, { id: it.id });
}

/**
 * 克隆一个元素(粘贴用)。新 id 由 newId 给;连线上绑在节点上的端点按 mapKey(旧节点键 → 新节点键)改写,
 * 映射不到的(原来绑着的节点没一起复制)退成写死的坐标。
 */
export function cloneItem(it, newId, mapKey, endPointOf) {
  const c = JSON.parse(JSON.stringify(it));
  c.id = newId;
  if (c.k === 'line') {
    ['a', 'b'].forEach((end) => {
      const p = c[end];
      if (p && !Array.isArray(p) && p.n) {
        const to = mapKey ? mapKey(p.n) : null;
        if (to) c[end] = { n: to, s: p.s || 'r' };
        else c[end] = endPointOf ? endPointOf(p).slice() : [0, 0];
      }
    });
  }
  return c;
}

/* 元素整体平移 */
export function offsetItem(it, dx, dy) {
  if (it.k === 'line') {
    [it.a, it.b].forEach((p) => { if (Array.isArray(p)) { p[0] = Math.round((p[0] + dx) * 100) / 100; p[1] = Math.round((p[1] + dy) * 100) / 100; } });
    return it;
  }
  it.x = Math.round(((+it.x || 0) + dx) * 100) / 100;
  it.y = Math.round(((+it.y || 0) + dy) * 100) / 100;
  return it;
}

/**
 * 拖动缩放手柄之后的矩形:dir 是被拖的角 / 边(nw n ne e se s sw w),对面的角 / 边不动。
 * 拖过了对面的边就停在最小尺寸(方向不翻转)。
 */
export function resizeRect(start, dir, dx, dy, min) {
  const m = min || MIN_SIZE;
  const s = rectOf(start.x, start.y, start.w, start.h);
  let l = s.x, r = s.r, t = s.y, b = s.b;
  if (dir.indexOf('w') >= 0) l = Math.min(s.r - m, s.x + dx);
  if (dir.indexOf('e') >= 0) r = Math.max(s.x + m, s.r + dx);
  if (dir.indexOf('n') >= 0) t = Math.min(s.b - m, s.y + dy);
  if (dir.indexOf('s') >= 0) b = Math.max(s.y + m, s.b + dy);
  return { x: l, y: t, w: r - l, h: b - t };
}

/* 贴纸按比例缩放:取横向、纵向里变化大的那个;对面的角不动(拖边时按那一侧的变化) */
export function resizeSticker(start, dir, dx, dy, min) {
  const m = min || 16;
  const s = +start.s || 40;
  let grow = 0;
  if (dir.indexOf('w') >= 0) grow = -dx;
  else if (dir.indexOf('e') >= 0) grow = dx;
  if (dir.indexOf('n') >= 0) grow = dir.indexOf('w') >= 0 || dir.indexOf('e') >= 0 ? Math.max(grow, -dy) : -dy;
  else if (dir.indexOf('s') >= 0) grow = dir.indexOf('w') >= 0 || dir.indexOf('e') >= 0 ? Math.max(grow, dy) : dy;
  const size = Math.max(m, s + grow);
  return {
    s: size,
    x: dir.indexOf('w') >= 0 ? start.x + s - size : start.x,
    y: dir.indexOf('n') >= 0 ? start.y + s - size : start.y
  };
}

/* 点到矩形四条边的中点,哪条最近 */
export function nearestSide(r, p) {
  const d = [
    ['l', Math.hypot(p.x - r.x, p.y - r.cy)],
    ['r', Math.hypot(p.x - r.r, p.y - r.cy)],
    ['t', Math.hypot(p.x - r.cx, p.y - r.y)],
    ['b', Math.hypot(p.x - r.cx, p.y - r.b)]
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][0];
}

/*
 * 连线的两个端点(画布坐标)。写死的坐标原样返回;绑在节点上的取那一边的中点(节点挪了端点跟着动)。
 * nodeRect:节点键 → 矩形;绑着的节点已经不在了,按 (0, 0) 算
 */
export function linePoints(it, nodeRect) {
  const pt = (p) => {
    if (Array.isArray(p)) return { x: +p[0] || 0, y: +p[1] || 0 };
    const r = p && p.n && nodeRect ? nodeRect(p.n) : null;
    const c = r ? { cx: r.x + r.w / 2, cy: r.y + r.h / 2 } : { cx: 0, cy: 0 };
    if (!r) return { x: 0, y: 0 };
    const s = p.s || 'r'; /* 没写边 = 右边(与 layout-core 的画法一致) */
    return s === 'l' ? { x: r.x, y: c.cy } : s === 'r' ? { x: r.x + r.w, y: c.cy } : s === 't' ? { x: c.cx, y: r.y } : { x: c.cx, y: r.y + r.h };
  };
  return { a: pt(it.a), b: pt(it.b) };
}

/* 元素占的矩形(连线取两端点的包围盒) */
export function itemBox(it, nodeRect) {
  if (!it || it.k !== 'line') return itemRect(it);
  const e = linePoints(it, nodeRect);
  return rectOf(Math.min(e.a.x, e.b.x), Math.min(e.a.y, e.b.y), Math.abs(e.a.x - e.b.x), Math.abs(e.a.y - e.b.y));
}

/* 元素上有文字的(双击进去改):文字、图形(可带标注)、连线(可带文字) */
export function itemHasText(it) {
  return !!it && (it.k === 'text' || it.k === 'shape' || it.k === 'line');
}
