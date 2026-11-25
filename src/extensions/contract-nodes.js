/**
 * 契约节点:代码块 / 公式 / 脚注 —— 与前台 lry-content-render.js 及
 * 服务端白名单的 DOM 契约逐字对齐。
 *
 * 代码块:pre class="brush:js;toolbar:false;theme:monokai;"(class 原样保留),
 * 内容为纯文本代码;NodeView 内用 highlight.js 做编辑态高亮(NodeView DOM
 * 不参与 getHTML 序列化,序列化走 renderHTML,契约不破)。
 * 公式:行内 <span class="lry-math">\(tex\)</span>、
 *       块级 <p class="lry-math lry-math-block">\[tex\]</p>。
 *       编辑态由 NodeView 按 KaTeX 渲染(ui/math-nodeview.js),双击/回车进入公式对话框。
 * 脚注:sup.lry-fn / sup.lry-fn-label / p.lry-fn-def(由 LryParagraph cls 承载)
 *       / div.lry-footnotes 容器。
 */
import { Node } from '@tiptap/core';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { codeBlockNodeView } from '../ui/codeblock-nodeview.js';
import { codeHighlightPlugin } from '../ui/code-highlight.js';
import { mathNodeView, MATH_TYPES } from '../ui/math-nodeview.js';
import { openFormulaDialog } from '../ui/formula.js';
import { parseBrushClass, buildBrushClass, brushFromDom } from './brush.js';

/* 缩进单位用制表符:前台 lry-content-render.css 与编辑器均为 tab-size:4,与站内
   PHP 源码风格一致;粘贴进来的空格缩进原样保留不被改写 */
export const CODE_INDENT = '\t';

/* 公式节点的解析优先级须压过段落规则(同为默认优先级时按扩展顺序,LryParagraph 的裸 <p> 规则
   排在前面先认领)。此前入库的块级公式 <p class="lry-math lry-math-block"> 载入即被解析成
   普通段落、class 丢失,编辑器里只剩 \[…\] 源码(前台靠裸定界符兜底才显示正常)——2026-11-24 */
const MATH_PARSE_PRIORITY = 200;

/* 行首一个缩进单位的宽度:制表符 1,空格最多 4 个 */
function unitCut(text, i) {
  if (text[i] === '\t') return 1;
  const m = /^ {1,4}/.exec(text.slice(i, i + 4));
  return m ? m[0].length : 0;
}

/**
 * 代码块缩进(2026-11-23 v1.2.0):在事务 tr 上追加步骤,成功返回 true。
 * - 空选区:Tab 在光标处插入缩进;Shift+Tab 去掉当前行行首一个缩进单位
 *   (光标在缩进区内则随之左移)
 * - 有选区:选区覆盖的每一行行首统一加减一个缩进单位(VS Code 同款),
 *   选区随之伸缩保持覆盖这些行
 * 非代码块内或无可去缩进返回 false(不拦截按键)。
 */
export function indentCode(tr, dir) {
  const { selection } = tr;
  const { $from, $to } = selection;
  if ($from.parent !== $to.parent || !$from.parent.type.spec.code) return false;
  const base = $from.start();
  const text = $from.parent.textContent;
  const a = $from.parentOffset;
  const b = $to.parentOffset;
  if (a === b) {
    if (dir > 0) {
      tr.insertText(CODE_INDENT, base + a);
      tr.setSelection(TextSelection.create(tr.doc, base + a + 1));
      return true;
    }
    /* 偏移 0 时行首就是 0:lastIndexOf 的负起点只检查下标 0,块以换行开头时会误判 */
    const lineStart = a === 0 ? 0 : text.lastIndexOf('\n', a - 1) + 1;
    const cut = unitCut(text, lineStart);
    if (!cut) return false;
    tr.delete(base + lineStart, base + lineStart + cut);
    tr.setSelection(TextSelection.create(tr.doc, base + (a <= lineStart + cut ? lineStart : a - cut)));
    return true;
  }
  const first = text.lastIndexOf('\n', a - 1) + 1;
  const lines = [];
  for (let L = first; L < b;) {
    lines.push(L);
    const nl = text.indexOf('\n', L);
    if (nl < 0) break;
    L = nl + 1;
  }
  const cuts = lines.map((L) => (dir < 0 ? unitCut(text, L) : 0));
  if (dir < 0 && !cuts.some(Boolean)) return false;
  /* 从最后一行往前应用:前面的行首位置不受影响 */
  let delta = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (dir > 0) { tr.insertText(CODE_INDENT, base + lines[i]); delta += 1; }
    else if (cuts[i]) { tr.delete(base + lines[i], base + lines[i] + cuts[i]); delta -= cuts[i]; }
  }
  /* 新选区:起点 —— 缩进时随行首插入右移;反缩进时,起点与行首之间被删掉的缩进
     使之左移,起点本就在缩进区内(含行首)则贴到行首,不得越过行首减成负偏移 */
  const newFrom = dir > 0 ? base + a + 1 : base + a - Math.min(cuts[0], a - first);
  tr.setSelection(TextSelection.create(tr.doc, newFrom, base + b + delta));
  return true;
}

/* brush class 解析/构造已移至 ./brush.js(2026-11-24:节点、NodeView、编辑态高亮三处共用);
   此处保持原导出名 */
export { parseBrushClass, buildBrushClass };

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
        /* brushFromDom:自带 brush: 的原样保留;网页/Markdown 产物把语言写在
           <code class="language-xxx"> 上的,换算成 brush 契约形态(此前一律丢失成"纯文本") */
        parseHTML: (el) => brushFromDom(el)
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
    /* 语雀式增强(行号/语言下拉/复制),序列化不受影响 */
    return codeBlockNodeView();
  },
  addProseMirrorPlugins() {
    /* 编辑态语法高亮 + 粘贴后语言自动识别(ui/code-highlight.js) */
    return [codeHighlightPlugin()];
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
    const type = this.type;
    /* 跳出到代码块之后的下一个文本块开头;其后没有(或不是可落光标的文本块)则在块后
       补一个空段落并落进去。适用于任意嵌套层级(表格单元格、折叠体内等) */
    const exitTo = (tr, state, after) => {
      const next = tr.doc.resolve(after).nodeAfter;
      if (next && next.isTextblock && next.type.spec.code !== true) {
        tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
        return true;
      }
      tr.insert(after, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      return true;
    };
    /* 输入法合成期间(在代码块里打中文注释等)不接管任何按键:合成中的回车是"上屏候选词",
       不是"换行/退出";Esc 是"取消候选" */
    const composing = () => !!this.editor.view.composing;
    /* 光标在代码块内(空选区)时返回其文本与父位置,否则 null */
    const caretIn = (state) => {
      const { $from, empty } = state.selection;
      return empty && $from.parent.type === type ? { $from, text: $from.parent.textContent, off: $from.parentOffset } : null;
    };
    return {
      'Mod-Alt-c': () => this.editor.commands.setCodeBlockLang('plain'),
      /* ---- v1.2.0 代码块编辑行为(官方 CodeBlock 快捷键的对齐补全) ---- */
      Tab: () => !composing() && this.editor.commands.command(({ tr }) => indentCode(tr, 1)),
      'Shift-Tab': () => !composing() && this.editor.commands.command(({ tr }) => indentCode(tr, -1)),
      /* ---- 2026-11-24:用户报"进了代码块出不来"——三个出口 ---- */
      /* ① 空行上回车 = 退出代码块(Typora/语雀同款):
            光标在末尾空行(行内只有空白)时回车,删掉这个空行并落到块后的文本块;
            块内此前也只有空白行(连按两次回车的新块)则整块变回段落。
            全新的空块与首行上的回车仍是在块内换行;当前行有内容时正常换行 */
      Enter: () => !composing() && this.editor.commands.command(({ state, tr }) => {
        const { $from } = state.selection;
        if ($from.parent.type !== type) return false;
        /* 有选区:选中内容替换为换行 */
        if (!state.selection.empty) {
          tr.replaceSelectionWith(state.schema.text('\n')).scrollIntoView();
          return true;
        }
        const text = $from.parent.textContent;
        const off = $from.parentOffset;
        if (text !== '' && text.slice(off).trim() === '') {
          /* 行首位置:偏移 0 时就是 0——lastIndexOf 的负起点只检查下标 0,块以换行开头会误判 */
          const lineStart = off === 0 ? 0 : text.lastIndexOf('\n', off - 1) + 1;
          if (lineStart > 0 && text.slice(lineStart, off).trim() === '') {
            if (text.slice(0, lineStart - 1).trim() === '') {
              /* 块内只有空白行:整块变回段落 */
              const before = $from.before($from.depth);
              tr.delete(before, before + $from.parent.nodeSize);
              exitTo(tr, state, before);
              return true;
            }
            /* 删掉末尾空行(连同其前的换行)并跳出 */
            tr.delete($from.start() + lineStart - 1, $from.start() + text.length);
            exitTo(tr, state, tr.mapping.map($from.after($from.depth)));
            return true;
          }
        }
        /* 其余情况:在光标处换行。不再交回 ProseMirror 默认处理——它对"块首回车"不做任何事,
           真实浏览器里会落成不稳定的浏览器默认行为 */
        tr.insertText('\n').scrollIntoView();
        return true;
      }),
      /* ② 末行按 ↓:其后是文本块时沿用浏览器默认的光标移动;否则(文末/表格/原子块)
            在块后补空段落并落进去。关闭 trailingNode 后 PM 自身无法把光标移出文末代码块 */
      ArrowDown: () => !composing() && this.editor.commands.command(({ state, tr }) => {
        const c = caretIn(state);
        if (!c || c.text.slice(c.off).includes('\n')) return false;
        const after = c.$from.after(c.$from.depth);
        const next = tr.doc.resolve(after).nodeAfter;
        if (next && next.isTextblock) return false;
        exitTo(tr, state, after);
        return true;
      }),
      /* ③ Esc:不论在哪一行都跳出 */
      Escape: () => !composing() && this.editor.commands.command(({ state, tr }) => {
        const c = caretIn(state);
        if (!c) return false;
        exitTo(tr, state, c.$from.after(c.$from.depth));
        return true;
      }),
      /* 空代码块内退格:转回普通段落(显式清掉 cls,否则 brush class 会残留到 <p> 上) */
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection;
        if (!empty || $anchor.parent.type !== this.type || $anchor.parent.textContent.length) return false;
        return this.editor.commands.setNode('paragraph', { cls: null });
      }
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
      },
      priority: MATH_PARSE_PRIORITY
    }];
  },
  renderHTML({ node }) {
    return ['span', { class: 'lry-math' }, '\\(' + node.attrs.tex + '\\)'];
  },
  /* 编辑态按 KaTeX 渲染(此前无 NodeView,只见源码);序列化仍走上面的 renderHTML */
  addNodeView() {
    return mathNodeView(false);
  },
  addKeyboardShortcuts() {
    return { Enter: () => editMathOnEnter(this.editor) };
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
    const attrs = (el) => {
      const text = el.textContent || '';
      const m = /^\\\[(.*)\\\]$/s.exec(text.trim());
      return { tex: m ? m[1] : text };
    };
    /* 契约形态是 <p>;前台也认 div.lry-math-block,这里一并吃下、输出统一成 <p> */
    return [
      { tag: 'p.lry-math-block', getAttrs: attrs, priority: MATH_PARSE_PRIORITY },
      { tag: 'div.lry-math-block', getAttrs: attrs, priority: MATH_PARSE_PRIORITY }
    ];
  },
  renderHTML({ node }) {
    return ['p', { class: 'lry-math lry-math-block' }, '\\[' + node.attrs.tex + '\\]'];
  },
  addNodeView() {
    return mathNodeView(true);
  },
  addKeyboardShortcuts() {
    return { Enter: () => editMathOnEnter(this.editor) };
  }
});

/* 选中公式按回车 = 进入编辑(与双击同;上下文条/双击之外的键盘出口) */
function editMathOnEnter(editor) {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || MATH_TYPES.indexOf(sel.node.type.name) < 0) return false;
  openFormulaDialog(editor);
  return true;
}

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
