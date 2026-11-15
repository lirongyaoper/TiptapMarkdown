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
import { mermaidNodeView } from '../ui/mermaid-view.js';

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
        attrs: { src: source || 'graph TD\nA[开始] --> B{判断}\nB -->|是| C[结束]\nB -->|否| A' }
      })
    };
  }
});

/* ---------- 折叠块 ---------- */
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
      })
    };
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
