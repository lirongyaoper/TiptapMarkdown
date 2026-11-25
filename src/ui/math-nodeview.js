/**
 * 公式节点的编辑态渲染(2026-11-24,用户报"插入公式只显示源码、不能修改和编辑"):
 * 此前公式节点没有 NodeView,编辑器里只见 \(…\) / \[…\] 源码。现按前台同款 KaTeX 渲染,
 * 点击选中(出现上下文条:编辑/切换行内块级/删除),双击进入公式对话框。
 *
 * 序列化不受影响:仍走节点的 renderHTML(定界符文本契约),NodeView DOM 不参与 getHTML。
 * KaTeX 未就绪/加载失败/源码有误时回落为淡紫底源码(lry-math-raw / lry-math-error),
 * 保证任何情况下都看得见内容、可选中、可编辑。
 */
import { katexReady, loadKatex } from './katex.js';

export const MATH_TYPES = ['lryMathInline', 'lryMathBlock'];

export function mathNodeView(block) {
  const rawOf = (node) => (block ? '\\[' + (node.attrs.tex || '') + '\\]' : '\\(' + (node.attrs.tex || '') + '\\)');
  /* Tiptap v3 NodeView 工厂签名:对象参数 */
  return ({ node }) => {
    const dom = document.createElement(block ? 'p' : 'span');
    dom.className = block ? 'lry-math lry-math-block' : 'lry-math';
    dom.title = '双击编辑公式';
    let shownTex = null;

    const paint = () => {
      const tex = node.attrs.tex || '';
      if (!katexReady()) {
        /* 未就绪:先显示源码,库到位后重绘 */
        dom.textContent = rawOf(node);
        dom.classList.add('lry-math-raw');
        loadKatex().then(() => { if (dom.isConnected) paint(); }).catch(() => { /* 保持源码形态 */ });
        return;
      }
      dom.classList.remove('lry-math-raw', 'lry-math-error');
      if (!tex.trim()) {
        dom.textContent = block ? '(空公式)' : '∅';
        dom.classList.add('lry-math-error');
        return;
      }
      try {
        /* output:'html'——不带 MathML:浏览器会把 <math> 当可编辑节点,光标可能钻进公式内部 */
        dom.innerHTML = window.katex.renderToString(tex, { throwOnError: false, displayMode: block, output: 'html' });
      } catch (e) {
        dom.textContent = rawOf(node);
        dom.classList.add('lry-math-error');
        dom.title = '公式有误:' + e.message;
      }
    };
    shownTex = node.attrs.tex;
    paint();

    return {
      dom,
      update(n) {
        if (n.type.name !== node.type.name) return false;
        node = n;
        if (n.attrs.tex !== shownTex) { shownTex = n.attrs.tex; paint(); }
        return true;
      },
      /* 内部 DOM 由本视图自己改写(KaTeX 异步渲染),不交给 PM 同步 */
      ignoreMutation() { return true; }
    };
  };
}
