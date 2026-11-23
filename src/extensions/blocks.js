/**
 * 块级扩展:UEditor 段落样式对齐 + 契约节点。
 *
 * LryParagraph 是 roundtrip 保真的关键:单一节点统一建模
 * text-align / line-height / letter-spacing / margin-top / margin-bottom /
 * margin-left(缩进) / text-indent / direction / background-color,
 * 未建模属性整串进 miscStyle 原样往返;class 透传(lry-toc / lry-fn-def /
 * lry-math-block 由专门节点优先认领)。渲染时由本节点全权重建 style,
 * 不依赖官方 TextAlign/LineHeight(避免多 attribute 串 style 的合并歧义)。
 */
import { Node, Extension } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import Blockquote from '@tiptap/extension-blockquote';
import { Plugin } from '@tiptap/pm/state';

export const styleToObj = (style) => {
  const obj = {};
  String(style || '').split(';').forEach((pair) => {
    const i = pair.indexOf(':');
    if (i <= 0) return;
    const k = pair.slice(0, i).trim().toLowerCase();
    const v = pair.slice(i + 1).trim();
    if (k && v) obj[k] = v;
  });
  return obj;
};
export const objToStyle = (obj) => {
  const parts = [];
  Object.keys(obj).forEach((k) => parts.push(k + ':' + obj[k]));
  return parts.length ? parts.join(';') : '';
};

function renderBlockStyle(attrs) {
  const style = {};
  if (attrs.align) style['text-align'] = attrs.align;
  if (attrs.lineHeight) style['line-height'] = attrs.lineHeight;
  if (attrs.letterSpacing) style['letter-spacing'] = attrs.letterSpacing;
  if (attrs.marginTop) style['margin-top'] = attrs.marginTop;
  if (attrs.marginBottom) style['margin-bottom'] = attrs.marginBottom;
  if (attrs.indentLeft) style['margin-left'] = attrs.indentLeft;
  if (attrs.indentLeftPad) style['padding-left'] = attrs.indentLeftPad;
  if (attrs.textIndent) style['text-indent'] = attrs.textIndent;
  if (attrs.bgColor) style['background-color'] = attrs.bgColor;
  const s = objToStyle(style);
  return attrs.miscStyle ? (s ? s + ';' + attrs.miscStyle : attrs.miscStyle) : s;
}

function blockAttrsFor() {
  return {
    align: { default: null },
    lineHeight: { default: null },
    letterSpacing: { default: null },
    marginTop: { default: null },
    marginBottom: { default: null },
    indentLeft: { default: null },
    indentLeftPad: { default: null },
    textIndent: { default: null },
    dir: { default: null },
    bgColor: { default: null },
    miscStyle: { default: null },
    cls: { default: null }
  };
}

/* 供 addAttributes 生成 parse/render 映射:
   样式型属性 parse 从 style 读取;render 一律不输出(由节点 renderHTML 统一拼 style) */
function blockAttrSpecs() {
  const attrKeyToStyle = {
    align: 'text-align', lineHeight: 'line-height', letterSpacing: 'letter-spacing',
    marginTop: 'margin-top', marginBottom: 'margin-bottom', indentLeft: 'margin-left',
    indentLeftPad: 'padding-left', textIndent: 'text-indent', bgColor: 'background-color'
  };
  const spec = {};
  Object.keys(attrKeyToStyle).forEach((key) => {
    const cssProp = attrKeyToStyle[key];
    spec[key] = {
      default: null,
      parseHTML: (el) => styleToObj(el.getAttribute('style'))[cssProp] || null,
      renderHTML: () => ({})
    };
  });
  spec.dir = {
    default: null,
    parseHTML: (el) => el.getAttribute('dir') || (styleToObj(el.getAttribute('style')).direction || null),
    renderHTML: (attrs) => (attrs.dir ? { dir: attrs.dir } : {})
  };
  spec.miscStyle = {
    default: null,
    parseHTML: (el) => {
      const style = styleToObj(el.getAttribute('style'));
      Object.keys(attrKeyToStyle).forEach((key) => delete style[attrKeyToStyle[key]]);
      delete style.direction;
      const s = objToStyle(style);
      return s || null;
    },
    renderHTML: () => ({})
  };
  spec.cls = {
    default: null,
    /* class 白名单透传:lry-*(TOC/脚注定义行)/ theme-*;其余自定义 class 不吞 */
    parseHTML: (el) => {
      const cls = el.getAttribute('class');
      return cls && /^(lry-(?!math)|theme-)/.test(cls) ? cls : null;
    },
    renderHTML: () => ({})
  };
  return spec;
}

export const LryParagraph = Paragraph.extend({
  name: 'paragraph',
  addAttributes() {
    return blockAttrSpecs();
  },
  renderHTML({ node, HTMLAttributes }) {
    const style = renderBlockStyle(node.attrs);
    const attrs = { ...HTMLAttributes };
    if (style) attrs.style = style;
    if (node.attrs.cls) attrs.class = node.attrs.cls;
    else delete attrs.class;
    return ['p', attrs, 0];
  }
});

export const LryHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      miscStyle: {
        default: null,
        parseHTML: (el) => {
          const style = styleToObj(el.getAttribute('style'));
          delete style['text-align'];
          const s = objToStyle(style);
          return s || null;
        }
      },
      align: {
        default: null,
        parseHTML: (el) => styleToObj(el.getAttribute('style'))['text-align'] || null,
        renderHTML: (attrs) => (attrs.align ? { style: 'text-align:' + attrs.align } : {})
      }
    };
  }
});

export const LryBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      cls: {
        default: null,
        parseHTML: (el) => {
          const cls = el.getAttribute('class');
          return cls && /^lry-/.test(cls) ? cls : null;
        },
        renderHTML: () => ({}) /* 序列化以 class 表达,不输出 cls 属性 */
      }
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = { ...HTMLAttributes };
    if (node.attrs.cls) attrs.class = node.attrs.cls;
    else delete attrs.class;
    return ['blockquote', attrs, 0];
  }
});

/* 分页标记:编辑器内显示为分隔条;序列化为 <p data-lry-pagebreak>_lry_content_page_</p>,
   服务端 content_model explode('_lry_content_page_') 分页语义不变 */
export const PageBreak = Node.create({
  name: 'lryPageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [
      { tag: 'p[data-lry-pagebreak]' },
      {
        tag: 'p',
        getAttrs: (el) => ((el.textContent || '').trim() === '_lry_content_page_' ? {} : false)
      },
      { tag: 'hr[class*=pagebreak]' }
    ];
  },
  renderHTML() {
    return ['p', { 'data-lry-pagebreak': '1', class: 'lry-pagebreak' }, '_lry_content_page_'];
  },
  addCommands() {
    return {
      insertPageBreak: () => ({ commands }) =>
        commands.insertContent({ type: this.name })
    };
  }
});

/* 通用命令:setBlockStyle,供工具栏(对齐/行距/间距/缩进/方向/段背景)调用 */
export const BlockStyleCommands = Extension.create({
  name: 'lryBlockStyleCommands',
  addCommands() {
    return {
      /* key ∈ align/lineHeight/letterSpacing/marginTop/marginBottom/indentLeft/textIndent/dir/bgColor */
      setBlockStyle: (key, value) => ({ state, tr }) => {
        const { from, to } = state.selection;
        let touched = false;
        tr.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            tr.setNodeMarkup(pos, null, { ...node.attrs, [key]: value || null });
            touched = true;
          }
        });
        return touched;
      }
    };
  }
});

/* 首行自动缩进(2026-11-18):模式开关,非一次性排版。
   开启 = 全部顶层段落 text-indent:2em,此后新输入/粘贴/回车分段的顶层段落自动续用
   (appendTransaction 兜底);再次点击全部去除。仅作用顶层段落 —— 引用/列表/折叠体
   等容器内的段落不缩进,符合中文正文排版习惯;textIndent 属性由 LryParagraph
   序列化(style="text-indent:2em"),roundtrip 幂等无需额外处理。 */
export const FirstLineIndent = Extension.create({
  name: 'lryFirstLineIndent',
  addOptions() {
    return { indent: '2em' };
  },
  addStorage() {
    return { enabled: false };
  },
  addCommands() {
    return {
      toggleFirstLineIndent: () => ({ state, tr }) => {
        const value = this.storage.enabled ? null : this.options.indent;
        this.storage.enabled = !this.storage.enabled;
        state.doc.forEach((node, pos) => {
          if (node.type.name === 'paragraph' && node.attrs.textIndent !== value) {
            tr.setNodeMarkup(pos, null, { ...node.attrs, textIndent: value });
          }
        });
        /* 空文档无段落时也返回 true,保证命令入链(mode 状态已翻转) */
        return true;
      }
    };
  },
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        appendTransaction: (transactions, oldState, newState) => {
          if (!ext.storage.enabled) return null;
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = newState.tr;
          let touched = false;
          newState.doc.forEach((node, pos) => {
            if (node.type.name === 'paragraph' && !node.attrs.textIndent) {
              tr.setNodeMarkup(pos, null, { ...node.attrs, textIndent: ext.options.indent });
              touched = true;
            }
          });
          /* 补齐后二次进入必然无缺失段落,天然终止;不产生额外历史步骤 */
          return touched ? tr : null;
        }
      })
    ];
  }
});
