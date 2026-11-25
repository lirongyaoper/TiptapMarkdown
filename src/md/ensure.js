/**
 * showdown 可用性保障(共用):loadScriptOnce 平移实现里 onload/onerror 共用
 * 同一 handler,404 也会当成功回调 —— 这里必须在回调后校验 window.showdown
 * 真实存在,否则 reject(真实页面相对路径 404 曾导致:源码栏空白 + 退出清空内容)。
 * 基址默认为包内绝对路径,页面可用 window.LRY_EDITOR_BASE 覆写。
 */
import { loadScriptOnce, markdownToHtml, htmlToMarkdown } from '../md-core/index.js';

export function showdownUrl() {
  /* 开源包默认:dist 同级的 ../third-party/showdown.js(相对 <script src> 推断);
     window.LRY_EDITOR_BASE 可覆写为任意绝对/相对路径 */
  const base = (typeof window !== 'undefined' && window.LRY_EDITOR_BASE)
    || (function () {
      const s = typeof document !== 'undefined' && document.querySelector('script[src*="lry-editor"]');
      if (s) { const m = /(.*)dist\//.exec(s.getAttribute('src')); if (m) return m[1]; }
      return './';
    })();
  return base.replace(/\/?$/, '/') + 'third-party/showdown.js';
}

let cached = null;
export function ensureShowdown() {
  if (typeof window !== 'undefined' && window.showdown) return Promise.resolve();
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const url = showdownUrl();
    loadScriptOnce(url, () => {
      if (window.showdown) resolve();
      else reject(new Error('showdown 加载失败:' + url));
    });
    setTimeout(() => {
      if (!window.showdown) reject(new Error('showdown 加载超时'));
    }, 10000);
  });
  /* 失败后允许下次重试 */
  cached.catch(() => { cached = null; });
  return cached;
}

/**
 * 安全转换:showdown 缺失或转换异常时返回 null,调用方不得动编辑器内容。
 */
export function safeMdToHtml(md) {
  if (typeof window === 'undefined' || !window.showdown) return null;
  try {
    const out = markdownToHtml(md, {});
    return typeof out === 'string' ? out : null;
  } catch (e) { return null; }
}

export function safeHtmlToMd(html) {
  if (typeof window === 'undefined' || !window.showdown) return null;
  try {
    const out = htmlToMarkdown(html, { richFormat: true });
    return typeof out === 'string' ? out : null;
  } catch (e) { return null; }
}

/**
 * 语雀块 HTML 归一化(2026-11-15 五轮):
 * 1) mermaid 围栏产物 → pre.lry-mermaid
 * 2) showdown 任务列表(li.task-list-item + ☑/☐字符) → 契约形态
 *    ul.lry-task > li.lry-task-item[.lry-task-done] > span.lry-task-check
 * 被 md 分栏(renderToPreview/flush)与 normalizeLegacyHtml(setContent)双点共用。
 */
export function normalizeYuqueHtml(html) {
  let out = String(html)
    /* 围栏代码块的末尾自带一个换行:它不是图源的一部分,去掉,粘贴进来的源码才逐字进入画板 */
    .replace(/<pre>\s*<code class="[^"]*mermaid[^"]*">([\s\S]*?)<\/code>\s*<\/pre>/gi, (m, c) => '<pre class="lry-mermaid">' + c.replace(/\s+$/, '') + '</pre>')
    .replace(/<pre class="[^"]*(?:brush:mermaid|language-mermaid|\bmermaid)[^"]*">([\s\S]*?)<\/pre>/gi, (m, c) => '<pre class="lry-mermaid">' + c.replace(/\s+$/, '') + '</pre>');
  out = out.replace(/<li\b[^>]*class="[^"]*task-list-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, (m, inner) => {
    const dm = /^\s*([\u2611\u2610☑☐])\s*/.exec(inner);
    const done = !!(dm && (dm[1] === '\u2611' || dm[1] === '☑'));
    const rest = dm ? inner.slice(dm[0].length) : inner;
    return '<li class="lry-task-item' + (done ? ' lry-task-done' : '') + '">'
      + '<span class="lry-task-check">' + (done ? '☑' : '☐') + '</span>'
      + '<div class="lry-task-body">' + rest + '</div></li>';
  });
  out = out.replace(/<ul>(?=(?:(?!<ul)[\s\S])*?<li class="lry-task-item)/g, '<ul class="lry-task">');
  return out;
}
