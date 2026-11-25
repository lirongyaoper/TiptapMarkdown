/**
 * Mermaid 懒加载与渲染(画板 NodeView 用;2026-11-24 自 ui/mermaid-view.js 抽出)。
 * 默认加载随包的 third-party/mermaid.min.js;宿主页可用 window.LRY_EDITOR_BASE 覆写包根。
 * 与 showdown/katex/highlight 同策略:文档里出现画板才加载。
 * 初始化配置只有一份(diagram/layout-core.js 的 MERMAID_INIT):前台渲染器加载同一个文件的独立构建,
 * 两边用同一套主题——配置各写一份的话,迟早会不一样,"编辑器里看到的 = 发布后的"就不成立了。
 */
import { MERMAID_INIT } from '../diagram/layout-core.js';

let loading = null;
let queue = Promise.resolve();
let seq = 0;

export function ensureMermaidLib() {
  if (window.mermaid) {
    window.mermaid.initialize(MERMAID_INIT);
    return Promise.resolve();
  }
  if (loading) return loading;
  const script = document.querySelector('script[src*="lry-editor"]');
  const match = script ? /(.*)dist\//.exec(script.getAttribute('src')) : null;
  const base = window.LRY_EDITOR_BASE || (match ? match[1] : './');
  const url = base.replace(/\/?$/, '/') + 'third-party/mermaid.min.js';
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => {
      if (window.mermaid) {
        window.mermaid.initialize(MERMAID_INIT);
        resolve();
      } else reject(new Error('mermaid 加载异常'));
    };
    s.onerror = () => { loading = null; reject(new Error('mermaid 加载失败:' + url)); };
    document.head.appendChild(s);
  });
  return loading;
}

/** 是"绘图引擎没加载上来"(网络问题)而不是源码有误:这种情况不是改源码能解决的,提示要分开说 */
export function isEngineError(e) {
  return /mermaid 加载失败|mermaid 加载异常/.test(String((e && e.message) || e));
}

/* SVG 字符串 → 元素 */
export function svgFromString(svg) {
  const tpl = document.createElement('template');
  tpl.innerHTML = svg;
  return tpl.content.firstElementChild;
}

/**
 * 渲染一段 Mermaid 源码,返回 { svg 元素, renderId }。
 * 多个画板块同屏时排队串行:mermaid.render 会在 body 里建临时节点,排队互不干扰;
 * 每次用全局唯一的渲染 id(节点组 id、连线 id 都以它为前缀,svg-map.js 据此做映射)。
 * 源码有误时 Promise 拒绝,错误信息交给调用方展示。
 */
/* 渲染失败时 Mermaid 会把"错误图"(炸弹 + Parse error)留在 body 里的 div#d<渲染id>,不清理就挂在页面底部 */
function clean(id) {
  const stray = document.getElementById('d' + id);
  if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
}

export function renderMermaidSvg(src) {
  return ensureMermaidLib().then(() => {
    const id = 'lrydg' + (++seq);
    const run = () => window.mermaid.render(id, src).then((r) => {
      if (!r || !r.svg) throw new Error('mermaid 渲染结果为空');
      return { svg: svgFromString(r.svg), renderId: id };
    }, (e) => {
      throw e;
    }).then((r) => { clean(id); return r; }, (e) => { clean(id); throw e; });
    queue = queue.then(run, run);
    return queue;
  });
}
