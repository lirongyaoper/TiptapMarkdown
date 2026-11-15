/**
 * 自定义 Mark 集:UEditor 行内格式对齐。
 * - FontBorder  文字边框(UEditor fontborder,输出 span style border)
 * - LryMark     语雀式高亮(输出 <mark style="background-color:…">,与前台
 *               lry-content-render 及服务端白名单契约一致,不用 data-color)
 * - Kbd         键盘键(md-core 产出 <kbd>)
 * - LegacyStyle 兜底 mark:span 行内样式中未被建模的属性原样保留,
 *               保证存量 roundtrip 语义零丢失(验收门核心)。
 * 前景色/背景色/字号/字体/行高(块级)由官方 @tiptap/extension-text-style 提供。
 */
import { Mark, mergeAttributes } from '@tiptap/core';

/* 已被官方/自定义 mark 建模的行内样式属性——LegacyStyle 不碰它们 */
const MODELED_INLINE_PROPS = [
  'color', 'background-color', 'font-size', 'font-family', 'border',
  'background'
];

export const FontBorder = Mark.create({
  name: 'fontBorder',
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { style: 'border:1px solid currentColor' }), 0];
  },
  parseHTML() {
    return [{
      tag: 'span',
      getAttrs(el) {
        const style = styleToObj(el.getAttribute('style'));
        return style.border && /(^|;)\s*border\s*:/.test(el.getAttribute('style') || '') ? {} : false;
      }
    }];
  },
  addCommands() {
    return {
      toggleFontBorder: () => ({ commands }) => commands.toggleMark(this.name)
    };
  }
});

export const LryMark = Mark.create({
  name: 'lryMark',
  addAttributes() {
    return {
      color: {
        default: '#ffff00',
        parseHTML: (el) => {
          const style = styleToObj(el.getAttribute('style'));
          return normalizeColor(style['background-color'] || style.background || '#ffff00');
        }
      }
    };
  },
  renderHTML({ mark }) {
    return ['mark', { style: 'background-color:' + mark.attrs.color }, 0];
  },
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  addCommands() {
    return {
      setLryMark: (color) => ({ commands }) => commands.setMark(this.name, { color }),
      toggleLryMark: () => ({ commands }) => commands.toggleMark(this.name)
    };
  }
});

export const Kbd = Mark.create({
  name: 'kbd',
  renderHTML() { return ['kbd', 0]; },
  parseHTML() { return [{ tag: 'kbd' }]; },
  addCommands() {
    return { toggleKbd: () => ({ commands }) => commands.toggleMark(this.name) };
  }
});

export const LegacyStyle = Mark.create({
  name: 'legacyStyle',
  addAttributes() {
    return {
      style: {
        default: null,
        /* 只收官方/自定义 mark 未建模的属性残渣 */
        parseHTML: (el) => {
          const raw = el.getAttribute('style');
          if (!raw) return null;
          const style = styleToObj(raw);
          const rest = {};
          Object.keys(style).forEach(function (k) {
            if (MODELED_INLINE_PROPS.indexOf(k) < 0) rest[k] = style[k];
          });
          return objToStyle(rest) || null;
        }
      }
    };
  },
  renderHTML({ mark }) {
    return ['span', mark.attrs.style ? { style: mark.attrs.style } : {}, 0];
  },
  parseHTML() {
    return [{
      tag: 'span',
      getAttrs(el) {
        return el.getAttribute('style') ? {} : false;
      },
      /* 低优先级:官方 mark 先认领自己那部分,这里只收残渣 */
      priority: 10
    }];
  }
});

function normalizeColor(c) {
  /* rgb(...) / #RGB / #RRGGBB 原样保留 */
  return String(c).trim();
}

function styleToObj(style) {
  const obj = {};
  String(style || '').split(';').forEach(function (pair) {
    const i = pair.indexOf(':');
    if (i <= 0) return;
    const k = pair.slice(0, i).trim().toLowerCase();
    const v = pair.slice(i + 1).trim();
    if (k && v) obj[k] = v;
  });
  return obj;
}

function objToStyle(obj) {
  const parts = [];
  Object.keys(obj).forEach(function (k) { parts.push(k + ':' + obj[k]); });
  return parts.length ? parts.join(';') : null;
}

export { styleToObj, objToStyle };
