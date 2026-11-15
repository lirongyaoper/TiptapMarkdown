/**
 * 契约节点:代码块 / 公式 / 脚注 —— 与前台 lry-content-render.js 及
 * 服务端白名单的 DOM 契约逐字对齐。
 *
 * 代码块:pre class="brush:js;toolbar:false;theme:monokai;"(class 原样保留),
 * 内容为纯文本代码;NodeView 内用 highlight.js 做编辑态高亮(NodeView DOM
 * 不参与 getHTML 序列化,序列化走 renderHTML,契约不破)。
 * 公式:行内 <span class="lry-math">\(tex\)</span>、
 *       块级 <p class="lry-math lry-math-block">\[tex\]</p>。
 * 脚注:sup.lry-fn / sup.lry-fn-label / p.lry-fn-def(由 LryParagraph cls 承载)
 *       / div.lry-footnotes 容器。
 */
import { Node } from '@tiptap/core';
import { codeBlockNodeView } from '../ui/codeblock-nodeview.js';

/* brush class 解析:{brush, theme}(与旧 UE.mdBrushInfo 一致) */
export function parseBrushClass(cls) {
  const m = /brush:([^;]+)/.exec(cls || '');
  return {
    brush: m ? m[1].trim() : 'plain',
    theme: (/theme:([^;]+)/.exec(cls || '') || [])[1] || ''
  };
}
export function buildBrushClass(brush, theme) {
  let cls = 'brush:' + brush + ';toolbar:false;';
  if (theme) cls += 'theme:' + theme + ';';
  return cls;
}

export const LryCodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  addAttributes() {
    return {
      cls: {
        default: null,
        parseHTML: (el) => el.getAttribute('class') || null
      }
    };
  },
  parseHTML() {
    return [{ tag: 'pre' }];
  },
  renderHTML({ node }) {
    /* 旧 UEditor 序列化不含 <code> 子元素,保持一致避免结构计数漂移 */
    const cls = node.attrs.cls;
    return ['pre', cls ? { class: cls } : {}, 0];
  },
  addNodeView() {
    /* 语雀式增强(行号/语言标签/复制),序列化不受影响 */
    return codeBlockNodeView();
  },
  addCommands() {
    return {
      /* 对齐旧 execCommand('insertcode', langId):无代码块则插入,有则改语言 */
      setCodeBlockLang: (langId) => ({ state, chain, commands }) => {
        const pos = state.selection.$from;
        for (let d = pos.depth; d > 0; d--) {
          const node = pos.node(d);
          if (node.type.name === 'codeBlock') {
            const { theme } = parseBrushClass(node.attrs.cls);
            const cls = buildBrushClass(langId, theme);
            return chain().updateAttributes('codeBlock', { cls }).run();
          }
        }
        return commands.insertContent({
          type: 'codeBlock',
          attrs: { cls: buildBrushClass(langId, '') },
          content: [{ type: 'text', text: ' ' }]
        });
      },
      toggleCodeBlock: () => ({ commands }) => commands.setNode(this.name)
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-c': () => this.editor.commands.setCodeBlockLang('plain')
    };
  }
});

export const LryMathInline = Node.create({
  name: 'lryMathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { tex: { default: '' } };
  },
  parseHTML() {
    return [{
      tag: 'span.lry-math',
      getAttrs: (el) => {
        const text = el.textContent || '';
        const m = /^\\\((.*)\\\)$/s.exec(text.trim());
        return { tex: m ? m[1] : text };
      }
    }];
  },
  renderHTML({ node }) {
    return ['span', { class: 'lry-math' }, '\\(' + node.attrs.tex + '\\)'];
  },
  addCommands() {
    return {
      insertMath: (tex, display) => ({ commands }) => commands.insertContent({
        type: display ? 'lryMathBlock' : 'lryMathInline',
        attrs: { tex }
      })
    };
  }
});

export const LryMathBlock = Node.create({
  name: 'lryMathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { tex: { default: '' } };
  },
  parseHTML() {
    return [{
      tag: 'p.lry-math-block',
      getAttrs: (el) => {
        const text = el.textContent || '';
        const m = /^\\\[(.*)\\\]$/s.exec(text.trim());
        return { tex: m ? m[1] : text };
      }
    }];
  },
  renderHTML({ node }) {
    return ['p', { class: 'lry-math lry-math-block' }, '\\[' + node.attrs.tex + '\\]'];
  }
});

/* 脚注引用上标:<sup class="lry-fn">n</sup>(定义行 p.lry-fn-def 走 LryParagraph.cls) */
export const LryFnSup = Node.create({
  name: 'lryFnSup',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { n: { default: 1 } };
  },
  parseHTML() {
    return [{
      tag: 'sup.lry-fn',
      getAttrs: (el) => ({ n: parseInt(el.textContent, 10) || 1 }),
      /* 压过官方 Superscript 的 sup 规则 */
      priority: 1000
    }];
  },
  renderHTML({ node }) {
    return ['sup', { class: 'lry-fn' }, String(node.attrs.n)];
  }
});

export const LryFnLabel = Node.create({
  name: 'lryFnLabel',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { n: { default: 1 } };
  },
  parseHTML() {
    return [{
      tag: 'sup.lry-fn-label',
      getAttrs: (el) => ({ n: parseInt(el.textContent, 10) || 1 }),
      priority: 1000
    }];
  },
  renderHTML({ node }) {
    return ['sup', { class: 'lry-fn-label' }, String(node.attrs.n)];
  }
});

/* 脚注容器:<div class="lry-footnotes">(块级包裹) */
export const LryFootnotes = Node.create({
  name: 'lryFootnotes',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div.lry-footnotes' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, class: 'lry-footnotes' }, 0];
  }
});
