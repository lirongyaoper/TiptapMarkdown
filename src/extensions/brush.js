/**
 * brush class 契约形态的解析与构造:pre class="brush:js;toolbar:false;theme:monokai;"
 * (与旧 UE.mdBrushInfo 一致)。代码块节点、NodeView、编辑态高亮三处共用,
 * 独立成模块以免节点定义与视图层互相引用(2026-11-24)。
 */
const BRUSH_RE = /brush:([^;]+)/;
const THEME_RE = /theme:([^;]+)/;
const LANG_ID_RE = /^[a-z0-9+#._-]{1,16}$/i;
/* 外部语言标识 → 站内 brush 标识:顶栏语言名、工具栏下拉与前台渲染都以 brush 标识为准 */
const LANG_ALIAS = { javascript: 'js', node: 'js', nodejs: 'js', typescript: 'ts', shell: 'bash', sh: 'bash', zsh: 'bash',
  python3: 'python', golang: 'go', 'c++': 'cpp', 'c#': 'csharp', yml: 'yaml', text: 'plain', plaintext: 'plain' };

export function parseBrushClass(cls) {
  const s = cls || '';
  const m = BRUSH_RE.exec(s);
  return {
    brush: m ? m[1].trim() : 'plain',
    theme: (THEME_RE.exec(s) || [])[1] || ''
  };
}

export function buildBrushClass(brush, theme) {
  let cls = 'brush:' + brush + ';toolbar:false;';
  if (theme) cls += 'theme:' + theme + ';';
  return cls;
}

/**
 * 从 <pre> 元素推断 class 属性(解析入口)。
 * - 自带 brush: 的(站内契约形态)原样保留
 * - 否则看其 <code> 子元素或自身的 language-xxx / lang-xxx 类名(网页、GitHub、
 *   Markdown 转换产物、highlight.js 标记的代码都是这种形态),换算成 brush 契约形态,
 *   让粘贴进来的代码块带上语言——此前这类代码块一律变成"纯文本",语言信息丢失
 * - 语言标识只收安全字符,其余保持原 class 透传
 */
export function brushFromDom(el) {
  const own = el.getAttribute('class') || '';
  if (BRUSH_RE.test(own)) return own;
  const code = el.querySelector ? el.querySelector('code') : null;
  const codeCls = code ? (code.getAttribute('class') || '') : '';
  const pick = (s) => {
    const m = /(?:^|\s)(?:language|lang)-([^\s]+)(?=\s|$)/i.exec(s);
    return m && LANG_ID_RE.test(m[1]) ? m[1].toLowerCase() : '';
  };
  const raw = pick(codeCls) || pick(own);
  const id = raw ? (LANG_ALIAS[raw] || raw) : '';
  return id ? buildBrushClass(id, '') : (own || null);
}
