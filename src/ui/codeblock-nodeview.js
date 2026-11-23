/**
 * 代码块 NodeView:顶栏(语言下拉 + 复制按钮)+ 行号列 + pre(编辑区)。
 * 序列化不变(仍 pre.brush:),getHTML 走 renderHTML,本视图仅编辑态增强。
 * 令牌着色由 ui/code-highlight.js 的内联装饰完成(渲染进 contentDOM,即 pre);
 * 本视图只负责按 brush class 给外壳挂主题类(theme-xxx)以匹配前台配色。
 */
import { CODE_LANGS } from '../config.js';
import { h, popover, closePopover } from './dom.js';
import { parseBrushClass, buildBrushClass } from '../extensions/brush.js';
import { themeClass } from './code-highlight.js';

const langName = (brush) => CODE_LANGS[brush] || (brush && brush !== 'plain' ? brush : '纯文本');

export function codeBlockNodeView() {
  /* Tiptap v3 NodeView 工厂签名:对象参数 */
  return ({ node, view, getPos }) => {
    const nodePos = (doc) => {
      let pos = null;
      try { pos = typeof getPos === 'function' ? getPos() : getPos; } catch (e) { pos = null; }
      return typeof pos === 'number' && doc.nodeAt(pos) && doc.nodeAt(pos).type.spec.code === true ? pos : null;
    };

    const box = document.createElement('div');
    const bar = document.createElement('div');
    bar.className = 'lry-codebar';
    const langBtn = h('button', { type: 'button', class: 'lry-codebar-lang', title: '点击切换语言' });
    const copy = h('button', { type: 'button', class: 'lry-codebar-copy' });
    copy.textContent = '复制';
    copy.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const text = node.textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => {
        copy.textContent = '已复制';
        setTimeout(() => { copy.textContent = '复制'; }, 1200);
      });
    });

    /* 语言下拉:搜索框 + 语言表(与工具栏「代码」下拉同一份表)。直接按节点位置改写
       语言并保留主题,不依赖编辑器当前选区 */
    let langOpen = false;
    const openLangMenu = () => {
      const pos = nodePos(view.state.doc);
      if (pos === null) return;
      const cur = parseBrushClass(view.state.doc.nodeAt(pos).attrs.cls).brush;
      const input = h('input', {
        type: 'text', class: 'lry-input lry-codelang-search', placeholder: '搜索语言(名称或标识)', spellcheck: 'false'
      });
      const list = h('div', { class: 'lry-menu lry-menu-scroll lry-codelang-list' });
      const pick = (id) => {
        closePopover();
        const p = nodePos(view.state.doc);
        if (p === null) return;
        const n = view.state.doc.nodeAt(p);
        view.dispatch(view.state.tr.setNodeMarkup(p, undefined, {
          ...n.attrs, cls: buildBrushClass(id, parseBrushClass(n.attrs.cls).theme)
        }));
      };
      const draw = (q) => {
        list.textContent = '';
        const f = String(q || '').trim().toLowerCase();
        Object.keys(CODE_LANGS).forEach((id) => {
          if (f && !(CODE_LANGS[id].toLowerCase().includes(f) || id.includes(f))) return;
          list.appendChild(h('button', {
            type: 'button', class: 'lry-menu-item' + (id === cur ? ' lry-menu-active' : ''),
            onmousedown: (e) => e.preventDefault(), /* 保持搜索框焦点,点击仍生效 */
            onclick: () => pick(id)
          }, h('span', { class: 'lry-menu-text' }, CODE_LANGS[id]), h('span', { class: 'lry-menu-hint' }, id)));
        });
        if (!list.children.length) list.appendChild(h('div', { class: 'lry-menu-item lry-menu-disabled' }, '无匹配语言'));
      };
      input.addEventListener('input', () => draw(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closePopover(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault(); /* 回车选中过滤后的首项(无过滤时即当前语言) */
        const first = list.querySelector('.lry-menu-item:not(.lry-menu-disabled)');
        if (first) first.click();
      });
      draw('');
      langOpen = true;
      popover(langBtn, h('div', { class: 'lry-codelang' }, input, list), {
        className: 'lry-codelang-pop', onClose: () => { langOpen = false; }
      });
      setTimeout(() => input.focus(), 30);
    };
    langBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    langBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (langOpen) closePopover(); /* 再点一次收起 */
      else openLangMenu();
    });
    bar.appendChild(langBtn);
    bar.appendChild(copy);

    const gutter = document.createElement('div');
    gutter.className = 'lry-codegutter';
    /* contentDOM 与 schema 结构严格一致:pre 直接承载内容(契约无 code 子层) */
    const pre = document.createElement('pre');

    const sync = (n) => {
      const { brush, theme } = parseBrushClass(n.attrs.cls);
      langBtn.textContent = langName(brush);
      const tc = themeClass(theme);
      const cls = 'lry-codebox' + (tc ? ' ' + tc : '');
      if (box.className !== cls) box.className = cls;
      if (pre.className !== (n.attrs.cls || '')) pre.className = n.attrs.cls || '';
      const lines = Math.max(1, n.textContent.split('\n').length);
      let g = '';
      for (let i = 1; i <= lines; i++) g += i + '\n';
      if (gutter.textContent !== g) gutter.textContent = g;
    };
    sync(node);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'lry-codebody';
    bodyWrap.appendChild(gutter);
    bodyWrap.appendChild(pre);
    box.appendChild(bar);
    box.appendChild(bodyWrap);

    return {
      dom: box,
      contentDOM: pre,
      update(n) {
        if (n.type.name !== 'codeBlock') return false;
        node = n;
        sync(node);
        return true;
      },
      ignoreMutation(m) {
        return !box.contains(m.target) || m.target === gutter || m.target === bar || bar.contains(m.target);
      },
      /* 节点被删除/重建时收掉自己打开的语言下拉 */
      destroy() {
        if (langOpen) closePopover();
      }
    };
  };
}
