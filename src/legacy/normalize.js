/**
 * 存量内容归一化:UEditor 产物在进入 Tiptap schema 前,先在离屏 DOM 里
 * 洗成标准形态。这一层保证官方扩展(Color/FontSize/FontFamily/Strike 等)
 * 无需魔改 parse 规则即可吃下旧格式;roundtrip 语义零丢失的关键一环。
 *
 * 处理清单(与 docs/lry-editor/test/corpus 特征统计一一对应):
 * - <font color|face|size>          → span 行内样式(size 1-7 → px 映射)
 * - <img anchorname>                → <a name>(锚点序列化形态)
 * - <img _src=…>(src 为占位)      → src ← _src,弃 _src(旧输出规则同款行为)
 * - <img class="edui-*">(非视频)  → 弃装饰类
 * - <u>/<strike>/<s>/<del>          → 官方扩展原生支持,不动
 * - 空 class 清理
 * 注意:<video class="edui-faked-video"> 的类是**输出契约**,由 LryVideo 节点
 * 自行解析/渲染,归一化不得触碰。
 */

const FONT_SIZE_MAP = { 1: '12px', 2: '13px', 3: '16px', 4: '18px', 5: '24px', 6: '32px', 7: '48px' };

function styleToObj(style) {
  const obj = {};
  String(style || '').split(';').forEach(function (pair) {
    const i = pair.indexOf(':');
    if (i <= 0) return;
    const k = pair.slice(0, i).trim().toLowerCase();
    const v = pair.slice(i + 1).trim();
    if (k && v) obj[k] = v;
  });
  return obj;
}

function objToStyle(obj) {
  const parts = [];
  Object.keys(obj).forEach(function (k) { parts.push(k + ':' + obj[k]); });
  return parts.length ? parts.join(';') : null;
}

/**
 * 归一化一段 HTML 字符串。
 * @param {string} html
 * @param {Document} doc  浏览器传 document;测试传 jsdom 的 window.document
 * @returns {string} 归一化后的 HTML
 */
import { normalizeYuqueHtml } from '../md/ensure.js';

export function normalizeLegacyHtml(html, doc) {
  if (!html || !html.includes('<')) return html || '';
  /* 画板图源保护:mermaid 图源里的 <xxx> 是图形语法不是 HTML 标签,
     先整段转义防止 DOMParser 吃掉(如 A[含<b>标签]) */
  html = html.replace(/(<pre class="lry-mermaid"[^>]*>)([\s\S]*?)(<\/pre>)/gi, (m, open, body, close) =>
    open + body.replace(/</g, '&lt;').replace(/>/g, '&gt;') + close);
  const dom = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  const root = dom.body;

  /* <font> → span */
  root.querySelectorAll('font').forEach(function (font) {
    const span = dom.createElement('span');
    const style = {};
    if (font.getAttribute('color')) style.color = font.getAttribute('color');
    if (font.getAttribute('face')) style['font-family'] = font.getAttribute('face');
    const sz = font.getAttribute('size');
    if (sz && FONT_SIZE_MAP[sz.trim()]) style['font-size'] = FONT_SIZE_MAP[sz.trim()];
    const st = objToStyle(style);
    if (st) span.setAttribute('style', st);
    while (font.firstChild) span.appendChild(font.firstChild);
    font.parentNode.replaceChild(span, font);
  });

  /* 锚点 img → a[name] */
  root.querySelectorAll('img[anchorname]').forEach(function (img) {
    const a = dom.createElement('a');
    a.setAttribute('name', img.getAttribute('anchorname'));
    img.parentNode.replaceChild(a, img);
  });

  /* img:_src 兜底 + edui 装饰类剥离(video 除外) */
  root.querySelectorAll('img').forEach(function (img) {
    const src = (img.getAttribute('src') || '').trim();
    const backup = (img.getAttribute('_src') || '').trim();
    if (backup && (!src || src.startsWith('data:image/png;base64'))) {
      img.setAttribute('src', backup);
    }
    img.removeAttribute('_src');
    const cls = (img.getAttribute('class') || '').trim();
    if (cls && !cls.includes('edui-faked-video')) {
      const kept = cls.split(/\s+/).filter(function (c) {
        return c && !c.startsWith('edui-') && !c.startsWith('anchorclass');
      });
      if (kept.length) img.setAttribute('class', kept.join(' '));
      else img.removeAttribute('class');
    }
  });

  /* 带样式的语义行内元素(strong/b/em/i/u/del/s):把已建模样式属性
     (color/font-size/font-family/background-color)提取到内层 span,
     原元素仅保留未建模属性 —— 存量 Word/网页粘贴内容里 strong 带
     font-size 的形态很常见(article-richstyle 语料)。 */
  root.querySelectorAll('strong,b,em,i,u,del,s,strike').forEach(function (el) {
    const raw = el.getAttribute('style');
    if (!raw) return;
    const style = styleToObj(raw);
    const modeled = ['color', 'background-color', 'font-size', 'font-family'];
    const take = {};
    const keep = {};
    Object.keys(style).forEach(function (k) {
      if (modeled.indexOf(k) >= 0) take[k] = style[k];
      else keep[k] = style[k];
    });
    const takeStr = objToStyle(take);
    const keepStr = objToStyle(keep);
    if (!takeStr) return;
    const span = dom.createElement('span');
    span.setAttribute('style', takeStr);
    while (el.firstChild) span.appendChild(el.firstChild);
    el.textContent = '';
    el.appendChild(span);
    if (keepStr) el.setAttribute('style', keepStr);
    else el.removeAttribute('style');
  });

  /* 剥离其余元素上的 edui-* 装饰类(edui-faked-video 的 video 节点除外) */
  root.querySelectorAll('*').forEach(function (el) {
    if (el.tagName === 'VIDEO' || el.tagName === 'IMG') return;
    const cls = (el.getAttribute('class') || '').trim();
    if (!cls) return;
    const kept = cls.split(/\s+/).filter(function (c) { return c && !c.startsWith('edui-'); });
    if (kept.length !== cls.split(/\s+/).filter(Boolean).length) {
      if (kept.length) el.setAttribute('class', kept.join(' '));
      else el.removeAttribute('class');
    }
  });

  /* 语雀块归一化(showdown 任务列表/mermaid 围栏产物统一契约形态) */
  return normalizeYuqueHtml(root.innerHTML);
}
