/**
 * Typora 式 Markdown 输入规则(语雀式边写边转的富文本侧补齐):
 * - $x^2$ + 空格/回车 → 行内公式节点
 * - $$E=mc^2$$ + 回车 → 块级公式节点
 * - ==text== + 空格/回车 → lryMark 高亮(官方 Highlight 渲染 data-color,
 *   与站点契约不符,故用自定义规则驱动 LryMark)
 * 其余(# ** * ` ~ - 1. > ---)由 StarterKit/官方扩展自带。
 */
import { Extension } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

export const TyporaRules = Extension.create({
  name: 'lryTyporaRules',

  addInputRules() {
    const { editor } = this;
    return [
      /* $$...$$ 回车 → 块公式 */
      {
        find: /^\$\$([^$]+)\$\$$/,
        handler({ state, range, match }) {
          const tex = match[1].trim();
          if (!tex) return false;
          const { tr } = state;
          const from = range.from;
          const to = range.to;
          const node = state.schema.nodes.lryMathBlock.create({ tex });
          tr.replaceWith(from, to, node);
          tr.setSelection(NodeSelection.create(tr.doc, from));
          return true;
        }
      },
      /* $...$ + 空格/回车 → 行内公式 */
      {
        find: /(?:^|\s)\$([^$\n]+)\$$/,
        handler({ state, range, match }) {
          const tex = match[1].trim();
          if (!tex || tex.length < 1) return false;
          const { tr } = state;
          const spaces = match[0].startsWith(' ') ? 1 : 0;
          const from = range.from + spaces;
          const to = range.to;
          const node = state.schema.nodes.lryMathInline.create({ tex });
          tr.replaceWith(from, to, node);
          return true;
        }
      },
      /* ==text== + 空格/回车 → lryMark 高亮 */
      {
        find: /(?:^|\s)==([^=\n]+)==$/,
        handler({ state, range, match }) {
          const text = match[1];
          if (!text) return false;
          const spaces = match[0].startsWith(' ') ? 1 : 0;
          const from = range.from + spaces;
          const to = range.to;
          const { tr } = state;
          tr.insertText(text, from, to); /* 定界符随整段替换消失 */
          tr.addMark(from, from + text.length, state.schema.marks.lryMark.create({ color: '#ffff00' }));
          return true;
        }
      },
      /* [text](url) + 空格 → 链接 */
      {
        find: /^\[([^\]\n]+)\]\(([^)\s]+)\)$/,
        handler({ state, range, match }) {
          const text = match[1];
          const href = match[2];
          if (!text || !href) return false;
          const { tr } = state;
          tr.insertText(text, range.from, range.to);
          tr.addMark(range.from, range.from + text.length,
            state.schema.marks.link.create({ href, target: '_blank', rel: 'noopener' }));
          return true;
        }
      },
      /* ![alt](url) + 空格 → 图片 */
      {
        find: /^!\[([^\]\n]*)\]\(([^)\s]+)\)$/,
        handler({ state, range, match }) {
          const alt = match[1] || '';
          const src = match[2];
          if (!src) return false;
          const img = state.schema.nodes.image.create({ src, alt, title: alt || null });
          const { tr } = state;
          tr.replaceWith(range.from, range.to, img);
          return true;
        }
      },
      /* 列表项内输入 [ ] / [x] + 空格 → 整行升级为任务项
         ("-" 先被官方规则转成 bulletList,此处在 li 内接管;
          find 带尾空格 = inputRule 的 text 为 before+input) */
      {
        find: /^\[([ xX]?)\]\s$/,
        handler({ state, range, match }) {
          /* $from 在 doc>ul>li>p 的文本内:depth=p 层;li=depth-1,ul=depth-2 */
          const $from = state.doc.resolve(range.to);
          if ($from.parent.type.name !== 'paragraph') return false;
          if ($from.depth < 3) return false;
          const li = $from.node($from.depth - 1);
          const ul = $from.node($from.depth - 2);
          if (li.type.name !== 'listItem' || ul.type.name !== 'bulletList') return false;
          const done = /x/i.test(match[1] || '');
          const ulPos = $from.before($from.depth - 2);
          const { tr } = state;
          /* 整个顶层 bulletList 替换为 taskList(保持全部兄弟项) */
          const items = [];
          ul.forEach((item) => {
            const curDone = item === li ? done : false;
            items.push(state.schema.nodes.taskItem.createAndFill({ checked: curDone }, item.content));
          });
          const taskList = state.schema.nodes.taskList.createAndFill(null, items.filter(Boolean));
          if (!taskList) return false;
          tr.replaceWith(ulPos, ulPos + ul.nodeSize, taskList);
          /* 删除已输入的 "[ ]" 文本(range.from=匹配起点) */
          const delFrom = tr.mapping.map(range.from);
          const delTo = tr.mapping.map(range.to);
          tr.delete(Math.min(delFrom, delTo), Math.max(delFrom, delTo));
          return true;
        }
      },
      /* 全角#(U+FF03)1-6个 + 空格 → 标题(中文输入法友好) */
      {
        find: /^([\uFF03]{1,6})\s$/,
        handler({ state, range, match }) {
          /* tiptap 语义:range.from=匹配起点(不含刚输入的尾字符) */
          const $from = state.doc.resolve(range.to);
          if ($from.depth < 1) return false;
          if ($from.parent.type.name !== 'paragraph' && $from.parent.type.name !== 'heading') return false;
          const $start = state.doc.resolve(range.from);
          /* 行首:与光标同段落且在段首 */
          if ($start.parent !== $from.parent || $start.parentOffset !== 0) return false;
          const level = match[1].length;
          const { tr } = state;
          tr.setNodeMarkup($from.before(1), state.schema.nodes.heading, { level });
          tr.delete(range.from, range.to);
          return true;
        }
      },
      /* ```mermaid + 回车 → 画板块(带模板) */
      {
        find: /^```mermaid$/,
        handler({ state, range }) {
          const node = state.schema.nodes.lryMermaid.createAndFill();
          if (!node) return false;
          const { tr } = state;
          tr.replaceWith(range.from, range.to, node);
          return true;
        }
      },
      /* |a|b| 行 + 空格 → 两列表格(Markdown 混用,无需切模式) */
      {
        find: /^\|([^|\n]+)\|([^|\n]*)\|$/,
        handler({ range, match, chain }) {
          const a = match[1].trim();
          const b = match[2].trim();
          if (!a) return false;
          const esc = (s) => s.replace(/</g, '&lt;');
          const html = '<table><thead><tr><th>' + esc(a) + '</th><th>' + esc(b || '列2') + '</th></tr></thead>'
            + '<tbody><tr><td> </td><td> </td></tr></tbody></table><p></p>';
          /* 命令自建事务替换区间;返回 true 后 inputRule 对未修改的 tr 再 dispatch 是无害空事务 */
          chain().focus().insertContentAt({ from: range.from, to: range.to }, html).run();
          return true;
        }
      }
    ];
  }
});
