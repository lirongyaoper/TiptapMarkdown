/**
 * KaTeX 懒加载(公式对话框的实时预览与公式节点的编辑态渲染共用,2026-11-24)。
 * 优先复用页面已加载的 katex 全局;否则加载随包的 third-party/katex。
 * 宿主页可用 window.LRY_EDITOR_KATEX 覆写目录,或用 window.LRY_EDITOR_BASE 覆写包根。
 * 加载失败后允许再次尝试。
 */
let loading = null;

export function katexReady() {
  return !!(window.katex && window.katex.renderToString);
}

export function loadKatex() {
  if (katexReady()) return Promise.resolve(window.katex);
  if (loading) return loading;
  const script = document.querySelector('script[src*="lry-editor"]');
  const match = script ? /(.*)dist\//.exec(script.getAttribute('src')) : null;
  const base = window.LRY_EDITOR_KATEX
    || (window.LRY_EDITOR_BASE || (match ? match[1] : './')).replace(/\/?$/, '/') + 'third-party/katex';
  const dir = base.replace(/\/?$/, '/');
  loading = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-lry-katex]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = dir + 'katex.min.css'; link.dataset.lryKatex = '1';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = dir + 'katex.min.js';
    s.onload = () => {
      if (katexReady()) resolve(window.katex);
      else reject(new Error('KaTeX 加载异常'));
    };
    s.onerror = () => reject(new Error('KaTeX 加载失败'));
    document.head.appendChild(s);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}
