/**
 * 画板导出图片(v1.4.1):把画布上的 svg 画成 PNG 下载下来。
 *
 * 做法:克隆画布上的 svg(去掉编辑用的叠加层)→ **把 foreignObject 里的文字换成纯 svg 的 <text>** → 补上白底和宽高 →
 * 当作图片加载 → 画到 canvas 上(默认 2 倍,清楚)→ PNG。
 *
 * 为什么要把文字换掉(2026-11-24 实测):Mermaid 的文字标签都是 foreignObject 里的 HTML。svg 里只要有一个 foreignObject,
 * 画到 canvas 上就被浏览器判成"被跨域数据污染",读不出像素(Chromium 报 SecurityError;Safari 更干脆,当图片加载时不画里面的文字)。
 * 换成 <text> 之后两种浏览器都能导出。位置按页面上量出来的真实行来:每个文本节点逐字符量矩形,顶边一变就是换了一行,
 * 每一行一个 <text>,字体 / 字号 / 粗细 / 颜色取计算样式——所以导出的图和画布上看到的一模一样,不用再请 Mermaid 重排一遍。
 * 图片元素(<image>)的地址换成内嵌的数据:svg 当图片加载时不加载外部资源,画出来是空的。
 *
 * 导出过程出了任何错(老浏览器等)退到 svg 文件。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SIDE = 8000; /* canvas 单边上限(再大有些设备画不出来) */

export function isSvgImageTextUnsafe() {
  /* 文字已经换成 <text>,不再依赖 foreignObject:各浏览器都能导出。这个判断只留给"退到 svg"的说明用 */
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /^((?!chrome|android|crios|fxios|edg|opt).)*safari/i.test(ua);
}

/* 一个文本节点逐字符量,按行切开:[{ text, left, right, top, height }](屏幕坐标)。量不到(没布局)返回 [] */
function measureLines(node) {
  const text = node.data;
  if (!text || !text.trim()) return [];
  const range = node.ownerDocument.createRange();
  const out = [];
  let start = 0, top = null, left = 0, right = 0, height = 0;
  const emit = (end) => { if (top !== null && end > start) out.push({ text: text.slice(start, end), left, right, top, height }); };
  for (let i = 0; i < text.length; i++) {
    /* 量两个字符:折叠的空白单个量出来是零宽,取得到的下一个矩形 */
    range.setStart(node, i); range.setEnd(node, Math.min(text.length, i + 2));
    const rects = range.getClientRects();
    let r = rects.length ? rects[0] : null;
    if (r && (!r.width || !r.height)) r = rects.length > 1 ? rects[1] : null;
    if (!r) continue; /* 量不到的字符(换行符、零宽字符):并进当前行 */
    if (top === null) { top = r.top; left = r.left; right = r.right; height = r.height; start = i; }
    else if (Math.abs(r.top - top) > Math.max(2, height * 0.5)) { /* 顶边变了 = 换行:收掉上一行,从这一个字符开始新的一行 */
      emit(i);
      top = r.top; left = r.left; right = r.right; height = r.height; start = i;
    } else { left = Math.min(left, r.left); right = Math.max(right, r.right); height = Math.max(height, r.height); }
  }
  emit(text.length);
  range.detach();
  return out;
}

/* 把克隆出来的 svg 里的 foreignObject 全部换成 <text>(按页面上那个原元素的排版量位置) */
function flattenLabels(clone, live) {
  const srcList = live.querySelectorAll('foreignObject');
  clone.querySelectorAll('foreignObject').forEach((fo, i) => {
    const src = srcList[i];
    const g = document.createElementNS(SVG_NS, 'g');
    fo.parentNode.replaceChild(g, fo);
    if (!src || typeof src.getScreenCTM !== 'function') return;
    let inv = null;
    try { inv = src.getScreenCTM().inverse(); } catch (e) { return; }
    const toLocal = (x, y) => { const p = live.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(inv); return { x: q.x, y: q.y }; };
    const walker = live.ownerDocument.createTreeWalker(src, 4 /* NodeFilter.SHOW_TEXT:有的环境里没有 NodeFilter,直接用数值 */);
    const doc = live.ownerDocument;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const lines = measureLines(node).map((l) => {
        const a = toLocal(l.left, l.top), b = toLocal(l.right, l.top + l.height);
        return { text: l.text, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
      });
      if (!lines.length) continue;
      const el = node.parentElement;
      const cs = el ? doc.defaultView.getComputedStyle(el) : null;
      if (!cs) continue;
      /* 对齐:看这个文本节点所在的块 */
      let block = el;
      while (block && block !== src && !/block|flex|table-cell|inline-block/.test(doc.defaultView.getComputedStyle(block).display)) block = block.parentElement;
      const align = block && block !== src ? doc.defaultView.getComputedStyle(block).textAlign : 'start';
      lines.forEach((l) => {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('xml:space', 'preserve');
        t.setAttribute('font-family', cs.fontFamily);
        t.setAttribute('font-size', cs.fontSize);
        if (cs.fontWeight && cs.fontWeight !== '400' && cs.fontWeight !== 'normal') t.setAttribute('font-weight', cs.fontWeight);
        if (cs.fontStyle && cs.fontStyle !== 'normal') t.setAttribute('font-style', cs.fontStyle);
        if (cs.letterSpacing && cs.letterSpacing !== 'normal') t.setAttribute('letter-spacing', cs.letterSpacing);
        t.setAttribute('fill', cs.color || '#000');
        t.setAttribute('dominant-baseline', 'central');
        if (/center/.test(align)) { t.setAttribute('text-anchor', 'middle'); t.setAttribute('x', String((l.x0 + l.x1) / 2)); }
        else if (/right|end/.test(align)) { t.setAttribute('text-anchor', 'end'); t.setAttribute('x', String(l.x1)); }
        else { t.setAttribute('text-anchor', 'start'); t.setAttribute('x', String(l.x0)); }
        t.setAttribute('y', String((l.y0 + l.y1) / 2));
        t.textContent = l.text;
        g.appendChild(t);
      });
    }
  });
}

/* svg 里的 <image>:地址换成内嵌的数据(取不到的去掉地址,别留一个加载不出来的外链) */
async function inlineImages(clone) {
  const imgs = [...clone.querySelectorAll('image[href], image[xlink\\:href]')];
  await Promise.all(imgs.map(async (im) => {
    const href = im.getAttribute('href') || im.getAttribute('xlink:href') || '';
    if (!href || /^(data:|blob:)/.test(href)) return;
    try {
      const res = await fetch(href, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      const data = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob); });
      im.setAttribute('href', data);
      im.removeAttribute('xlink:href');
    } catch (e) {
      im.removeAttribute('href');
      im.removeAttribute('xlink:href');
    }
  }));
}

/**
 * 画布上的 svg → 可以当图片用的独立 svg(不含 foreignObject)。
 * @returns {Promise<{ node:Element, text:string, w:number, h:number }>}
 */
export async function svgForExport(svg) {
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.lry-ov, .lry-ov-old').forEach((n) => n.remove());
  ['data-tool', 'tabindex'].forEach((a) => clone.removeAttribute(a));
  const vb = (svg.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(parseFloat);
  const w = vb[2] > 0 ? vb[2] : 1, h = vb[3] > 0 ? vb[3] : 1;
  clone.removeAttribute('style'); /* 画布里为定宽写的 style(宽度 / max-width)不属于图本身 */
  clone.setAttribute('width', String(Math.round(w * 100) / 100));
  clone.setAttribute('height', String(Math.round(h * 100) / 100));
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  await inlineImages(clone); /* 先于量文字:取图要等,期间的滚动不影响文字相对 foreignObject 的位置 */
  flattenLabels(clone, svg);
  /* 白底:svg 自己没有底色,不补的话 PNG 是透明的 */
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(vb[0] || 0)); bg.setAttribute('y', String(vb[1] || 0));
  bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h)); bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  return { node: clone, text: new XMLSerializer().serializeToString(clone), w, h };
}

/**
 * 把 svg 画成 PNG。@returns {Promise<{blob:Blob, width:number, height:number, canvas:HTMLCanvasElement}>}
 * 画不出来时 Promise 拒绝。
 */
export async function renderDiagramImage(svg, scale) {
  const { text, w, h } = await svgForExport(svg);
  const s = Math.max(0.5, Math.min(scale || 2, MAX_SIDE / Math.max(w, h, 1)));
  const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const fail = () => { URL.revokeObjectURL(url); reject(new Error('导出图片失败')); };
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve({ blob: b, width: c.width, height: c.height, canvas: c }) : reject(new Error('导出图片失败'))), 'image/png');
      } catch (e) { fail(); }
    };
    img.onerror = fail;
    img.src = url;
  });
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  (document.body || document.documentElement).appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
}

/* 文件名里的时间:20261125-0930 */
function stamp() {
  const d = new Date();
  const p = (n) => ('0' + n).slice(-2);
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

/** 导出 svg 文件(导不出 PNG 时的退路) */
export async function exportDiagramSvg(svg, baseName) {
  const { text } = await svgForExport(svg);
  downloadBlob(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + text], { type: 'image/svg+xml;charset=utf-8' }), baseName + '-' + stamp() + '.svg');
  return { kind: 'svg' };
}

/**
 * 导出 PNG;导出出错时退到 svg 文件。
 * @returns {Promise<{kind:'png'|'svg', width?:number, height?:number}>}
 */
export async function exportDiagramImage(svg, baseName) {
  const name = (baseName || 'lry-editor') + '-' + stamp();
  try {
    const r = await renderDiagramImage(svg, 2);
    downloadBlob(r.blob, name + '.png');
    return { kind: 'png', width: r.width, height: r.height };
  } catch (e) {
    try { exportDiagramSvg(svg, baseName); } catch (e2) { /* 连 svg 都导不出:把原因报给调用方 */ return { kind: 'svg', error: e }; }
    return { kind: 'svg', error: e };
  }
}
