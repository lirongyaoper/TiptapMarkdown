/**
 * 语雀式多文稿块(2026-11-15,按 多文稿类型一体.md):
 * 序列化全部走 div/span + lry-* class(服务端 remove_xss(rich) 白名单验证通过:
 * 标签白名单无 details/summary、style 白名单无 flex → 布局全靠前台 CSS)。
 *
 * - LryMermaid   <pre class="lry-mermaid">转义图源</pre>(画板:流程/架构/脑图/时序/甘特)
 * - LryFold      <div class="lry-fold[ lry-fold-open]"><div class="lry-fold-head">题
 *                  </div><div class="lry-fold-body">…</div></div>(折叠块)
 * - LryCols/Col  <div class="lry-cols lry-cols-2"><div class="lry-col">…(分栏)
 * - LryStatus    <span class="lry-status lry-status-ok">进行中</span>(状态卡)
 * - LryFileCard  <div class="lry-filecard">📎<a href>名</a></div>(本地文件嵌入卡)
 */
import { Node } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { mermaidNodeView } from '../ui/mermaid-view.js';
import { STARTER } from '../diagram/kind.js';

/* ---------- 画板:Mermaid 块 ---------- */
export const LryMermaid = Node.create({
  name: 'lryMermaid',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (el) => el.textContent || '',
        renderHTML: () => ({}) /* 序列化为元素文本,不走属性 */
      }
    };
  },
  parseHTML() {
    return [{ tag: 'pre.lry-mermaid' }];
  },
  renderHTML({ node }) {
    /* 图源为元素文本(atom 节点以静态文本子节点序列化,PM 负责转义) */
    return ['pre', { class: 'lry-mermaid' }, node.attrs.src || ''];
  },
  addNodeView() {
    return mermaidNodeView();
  },
  addCommands() {
    return {
      insertMermaid: (source) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: { src: source || STARTER.flow }
      })
    };
  }
});

/* ---------- 折叠块 ---------- */
/* 切换开合(2026-11-24 用户报"折叠块不能折叠"):open 属性原先只在序列化时用,编辑器里没有任何地方切换它——
   标题栏是手型光标,点下去却只是把光标放进标题,存下来的全是展开态。
   规则按落点区分:点在标题文字上 = 进去改标题;点在标题栏其它地方(左侧箭头区、标题短时右侧的空白)= 切换折叠。
   判断用标题文字的实际矩形(Range.getClientRects);空标题时整条标题栏都是切换区。 */
function onTitleText(event) {
  const head = event.target && event.target.closest ? event.target.closest('.lry-fold-head') : null;
  if (!head) return true;
  const range = head.ownerDocument.createRange();
  range.selectNodeContents(head);
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (event.clientX >= r.left - 2 && event.clientX <= r.right + 2 && event.clientY >= r.top - 2 && event.clientY <= r.bottom + 2) return true;
  }
  return false;
}
/* 在 tr 里把 foldPos 处的折叠块切换开合;收起时把光标挪到标题开头(正文不可见了,光标不能留在里面) */
function toggleFoldTr(tr, foldPos) {
  const fold = tr.doc.nodeAt(foldPos);
  if (!fold || fold.type.name !== 'lryFold') return false;
  const closing = fold.attrs.open !== false;
  tr.setNodeMarkup(foldPos, undefined, Object.assign({}, fold.attrs, { open: !closing }));
  if (closing) tr.setSelection(TextSelection.near(tr.doc.resolve(foldPos + 2)));
  return true;
}

export const LryFold = Node.create({
  name: 'lryFold',
  group: 'block',
  content: 'lryFoldHead lryFoldBody',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => !el.classList.contains('lry-fold-close'),
        renderHTML: () => ({}) /* 序列化以 class 表达,不输出属性 */
      }
    };
  },
  parseHTML() {
    return [{ tag: 'div.lry-fold' }];
  },
  renderHTML({ node }) {
    /* 展开=无标记(默认展开);收起态序列化 lry-fold-close(前台据此收起) */
    const cls = 'lry-fold' + (node.attrs.open ? '' : ' lry-fold-close');
    return ['div', { class: cls }, 0];
  },
  addCommands() {
    return {
      insertFold: () => ({ commands }) => commands.insertContent({
        type: this.name,
        content: [
          { type: 'lryFoldHead', content: [{ type: 'text', text: '折叠标题' }] },
          { type: 'lryFoldBody', content: [{ type: 'paragraph', content: [{ type: 'text', text: '折叠内容…' }] }] }
        ]
      }),
      /* 光标所在(或选区所涉)的折叠块切换开合;行柄菜单用它 */
      toggleFold: () => ({ state, tr, dispatch }) => {
        const $from = state.selection.$from;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name !== 'lryFold') continue;
          if (!dispatch) return true;
          return toggleFoldTr(tr, $from.before(d));
        }
        return false;
      }
    };
  },
  addProseMirrorPlugins() {
    /* 标题栏上的单击:落在标题文字之外就切换折叠 */
    const toggleOnHead = (view, _pos, node, nodePos, event) => {
      if (node.type.name !== 'lryFoldHead' || (event.button !== undefined && event.button !== 0)) return false;
      if (onTitleText(event)) return false;
      const tr = view.state.tr;
      if (!toggleFoldTr(tr, nodePos - 1)) return false;
      view.dispatch(tr);
      return true;
    };
    return [new Plugin({
      key: new PluginKey('lryFoldToggle'),
      props: {
        handleClickOn: toggleOnHead,
        /* 连点:ProseMirror 把 500ms 内的第二次 / 第三次点击改派给双击 / 三击处理(默认是选词 / 选段),
           切换区里照样"每点一次切换一次",免得连点箭头变成选中标题文字 */
        handleDoubleClickOn: toggleOnHead,
        handleTripleClickOn: toggleOnHead,
      },
      /* 选区落进了收起态的正文里(正文 display:none,光标会消失、打字打进看不见的地方),分两种来源:
         ① 纯移动光标 / 选区(查找定位、大纲跳转等)——把折叠块展开;
         ② 改了文档之后光标落进去(载入内容时的默认光标位置、Markdown 分栏回灌)——收起态是用户存的,
            不能动,只把光标挪到标题开头。不区分来源的话,载入带收起折叠块的内容会把收起态悄悄展开。 */
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null;
        const { $from, from } = newState.selection;
        let hit = null;
        for (let d = $from.depth; d > 0 && !hit; d--) {
          const n = $from.node(d);
          if (n.type.name !== 'lryFold' || n.attrs.open !== false) continue;
          const foldPos = $from.before(d);
          if (from >= foldPos + 1 + n.firstChild.nodeSize) hit = { foldPos, node: n }; /* 在标题里:保持收起 */
        }
        if (!hit) return null;
        const tr = newState.tr;
        if (transactions.every((t) => !t.docChanged)) tr.setNodeMarkup(hit.foldPos, undefined, Object.assign({}, hit.node.attrs, { open: true }));
        else tr.setSelection(TextSelection.near(tr.doc.resolve(hit.foldPos + 2)));
        return tr;
      }
    })];
  }
});

export const LryFoldHead = Node.create({
  name: 'lryFoldHead',
  group: '', /* 仅作为 lryFold 子节点,不入顶层 group */
  content: 'inline*',
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'div.lry-fold-head' }];
  },
  renderHTML() {
    return ['div', { class: 'lry-fold-head' }, 0];
  }
});

export const LryFoldBody = Node.create({
  name: 'lryFoldBody',
  group: '',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div.lry-fold-body' }];
  },
  renderHTML() {
    return ['div', { class: 'lry-fold-body' }, 0];
  }
});

/* ---------- 分栏布局 ---------- */
export const LryCols = Node.create({
  name: 'lryCols',
  group: 'block',
  content: 'lryCol+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      cols: {
        default: 2,
        parseHTML: (el) => {
          const m = /lry-cols-(\d)/.exec(el.getAttribute('class') || '');
          return m ? parseInt(m[1], 10) : 2;
        },
        renderHTML: () => ({}) /* 以 class 表达 */
      }
    };
  },
  parseHTML() {
    return [{ tag: 'div.lry-cols' }];
  },
  renderHTML({ node }) {
    return ['div', { class: 'lry-cols lry-cols-' + (node.attrs.cols || 2) }, 0];
  },
  addCommands() {
    return {
      insertCols: (n) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: { cols: n === 3 ? 3 : 2 },
        content: Array.from({ length: n === 3 ? 3 : 2 }, () => ({
          type: 'lryCol', content: [{ type: 'paragraph' }]
        }))
      })
    };
  }
});

export const LryCol = Node.create({
  name: 'lryCol',
  group: '',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div.lry-col' }];
  },
  renderHTML() {
    return ['div', { class: 'lry-col' }, 0];
  }
});

/* ---------- 状态卡片(行内胶囊) ---------- */
const STATUS_TYPES = ['ok', 'info', 'warn', 'err', 'done'];
export const LryStatus = Node.create({
  name: 'lryStatus',
  group: 'inline',
  inline: true,
  content: 'inline*',
  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: (el) => {
          const m = /lry-status-([a-z]+)/.exec(el.getAttribute('class') || '');
          return m && STATUS_TYPES.indexOf(m[1]) >= 0 ? m[1] : 'info';
        }
      }
    };
  },
  parseHTML() {
    return [{ tag: 'span.lry-status' }];
  },
  renderHTML({ node }) {
    return ['span', { class: 'lry-status lry-status-' + (node.attrs.type || 'info') }, 0];
  },
  addCommands() {
    return {
      insertStatus: (type, text) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: { type: STATUS_TYPES.indexOf(type) >= 0 ? type : 'info' },
        content: [{ type: 'text', text: text || '进行中' }]
      })
    };
  }
});

/* ---------- 本地文件嵌入卡 ---------- */
export const LryFileCard = Node.create({
  name: 'lryFileCard',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: null },
      title: { default: null }
    };
  },
  parseHTML() {
    return [{
      tag: 'div.lry-filecard',
      getAttrs: (el) => {
        const a = el.querySelector('a');
        return { href: a ? a.getAttribute('href') : (el.getAttribute('data-href') || null), title: a ? a.textContent : el.textContent };
      }
    }];
  },
  renderHTML({ node }) {
    return ['div', { class: 'lry-filecard' },
      ['span', { class: 'lry-filecard-icon' }, '📎'],
      ['a', { class: 'lry-filecard-link', href: node.attrs.href, target: '_blank', rel: 'noopener' }, node.attrs.title || '附件'],
      ['span', { class: 'lry-filecard-act' }, '预览/下载']];
  },
  addCommands() {
    return {
      insertFileCard: (options) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: { href: options.href, title: options.title || '附件' }
      })
    };
  }
});
