/**
 * 公式对话框:KaTeX 实时预览,插入 lry-math 契约节点。
 * KaTeX 资源懒加载(优先复用页面已加载的 katex 全局;否则取
 * third-party/katex 本地资产,LRY_EDITOR_KATEX 可覆写路径)。
 */
import { h, dialog, toast, field, selectEl } from './dom.js';

let katexLoading = null;
function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexLoading) return katexLoading;
  const s = document.querySelector('script[src*="lry-editor"]');
  const m = s ? /(.*)dist\//.exec(s.getAttribute('src')) : null;
  const base = window.LRY_EDITOR_KATEX || ((m ? m[1] : './') + 'third-party/katex');
  katexLoading = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-lry-katex]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = base + '/katex.min.css'; link.dataset.lryKatex = '1';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = base + '/katex.min.js';
    s.onload = () => resolve(window.katex);
    s.onerror = () => reject(new Error('KaTeX 加载失败'));
    document.head.appendChild(s);
  });
  return katexLoading;
}

export function openFormulaDialog(inst) {
  /* 选中的公式节点可直接编辑 */
  let editing = null;
  const sel = inst.editor.state.selection;
  const nodeAt = sel.$from.nodeAfter || sel.$from.parent.childAfter(sel.$from.parentOffset);
  if (nodeAt && nodeAt.node && (nodeAt.node.type.name === 'lryMathInline' || nodeAt.node.type.name === 'lryMathBlock')) editing = nodeAt.node;

  const ta = h('textarea', { class: 'lry-input', rows: 4, placeholder: 'LaTeX,如 E=mc^2 或 \\frac{a}{b}' });
  ta.value = editing ? editing.attrs.tex : '';
  const modeSel = selectEl([{ value: 'inline', label: '行内公式 \\(x\\)' }, { value: 'block', label: '块级公式 \\[x\\]' }],
    editing && editing.type.name === 'lryMathBlock' ? 'block' : 'inline');
  const preview = h('div', { class: 'lry-formula-preview' }, '公式预览');
  const render = () => {
    loadKatex().then((k) => {
      try {
        preview.innerHTML = '';
        const span = document.createElement('span');
        k.render(ta.value || '\\text{预览}', span, { throwOnError: false, displayMode: modeSel.value === 'block' });
        preview.appendChild(span);
      } catch (e) { preview.textContent = '公式有误:' + e.message; }
    }).catch((e) => { preview.textContent = e.message; });
  };
  ta.addEventListener('input', render);
  modeSel.addEventListener('change', render);
  setTimeout(render, 60);

  dialog({ title: '插入公式', width: '520px',
    body: h('div', null, field('LaTeX 源码', ta), field('形式', modeSel), field('预览', preview)),
    okText: editing ? '更新' : '插入',
    onOk(api) {
      const tex = ta.value.trim();
      if (!tex) { toast('请输入公式', 'error'); return false; }
      const block = modeSel.value === 'block';
      if (editing) {
        /* 原位更新:替换为同形态节点 */
        const type = (editing.type.name === 'lryMathBlock') === block ? editing.type.name : (block ? 'lryMathBlock' : 'lryMathInline');
        inst.editor.chain().focus().deleteSelection().insertContent({ type, attrs: { tex } }).run();
      } else {
        inst.editor.chain().focus().insertContent({
          type: block ? 'lryMathBlock' : 'lryMathInline', attrs: { tex }
        }).run();
      }
    } });
}
