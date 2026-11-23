/**
 * 代码块编辑态语法高亮。
 *
 * 把 highlight.js 的分词结果做成内联装饰,编辑时与发布后同色;调色板与令牌规则见
 * lry-editor.css(.hljs-* 仅按首个类名着色)。
 * - 懒加载:文档里出现非空代码块时才拉取脚本,打包体积零增长;页面已自带
 *   window.hljs 时直接复用。资源目录见 highlightBase();加载失败只是不高亮,不影响编辑
 * - 缓存:以代码块节点(不可变对象)为键,未改动的块不重复分词
 * - 主题:brush class 里的 theme:xxx 决定调色板(需 lry-code-themes.js);未指定时为
 *   样式表里的默认值 one-dark
 * - 粘贴自动识别语言:向"纯文本"代码块粘贴多行内容时按确定性特征识别,
 *   认不出就保持纯文本,不猜(明确选过其它语言的块不动)
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BRUSH_TO_HLJS } from '../config.js';
import { parseBrushClass, buildBrushClass } from '../extensions/brush.js';

const MAX_HIGHLIGHT_CHARS = 30000; /* 超长代码块不做编辑态分词(逐键重算会卡) */
const key = new PluginKey('lryCodeHighlight');

const MAX_DETECT_CHARS = 6000;

export function highlightReady() {
  return typeof window !== 'undefined' && !!window.hljs;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('加载失败:' + src));
    document.head.appendChild(s);
  });
}

/* 把全部主题的调色板注入成一份样式(作用域 .lry-codebox.theme-xxx),只注入一次 */
function injectThemeCss() {
  const themes = window.LryCodeThemes;
  if (!themes || document.querySelector('style[data-lry-code-themes="editor"]')) return;
  const css = [];
  themes.list().forEach(({ id }) => {
    const p = themes.palette(id);
    const scope = '.lry-codebox.theme-' + id;
    css.push(scope + ' .lry-codebody,' + scope + ' .lry-codebody pre{background:' + p.bg + ';color:' + p.fg + ';}');
    Object.keys(p.token).forEach((slot) => {
      css.push(scope + ' .hljs-' + slot + '{color:' + p.token[slot] + ';}');
    });
  });
  const style = document.createElement('style');
  style.setAttribute('data-lry-code-themes', 'editor');
  style.textContent = css.join('\n');
  document.head.appendChild(style);
}

let loading = null;

/**
 * 高亮资源目录(开源包约定,与 showdown/mermaid/katex 一致):
 * - window.LRY_EDITOR_HIGHLIGHT_BASE:显式指定目录(须含 highlight.min.js,可选 lry-code-themes.js)
 * - 否则 <包根>/third-party/highlight/,包根相对 <script src="…/dist/lry-editor.js"> 推断,
 *   window.LRY_EDITOR_BASE 可覆写包根
 * npm 引入(无 script 标签)时取 ./third-party/highlight/,建议自行先加载 highlight.js 或显式指定目录
 */
function highlightBase() {
  const fix = (u) => String(u).replace(/\/?$/, '/');
  if (typeof window === 'undefined') return null;
  if (window.LRY_EDITOR_HIGHLIGHT_BASE) return fix(window.LRY_EDITOR_HIGHLIGHT_BASE);
  const s = typeof document !== 'undefined' && document.querySelector('script[src*="lry-editor"]');
  const m = s ? /(.*)dist\//.exec(s.getAttribute('src')) : null;
  return fix(window.LRY_EDITOR_BASE || (m ? m[1] : './')) + 'third-party/highlight/';
}

/** 确保 highlight.js 与主题调色板就绪; resolves false 表示不可用(不高亮,不影响编辑) */
export function ensureCodeHighlight() {
  if (highlightReady()) return Promise.resolve(true);
  if (loading) return loading;
  const base = highlightBase();
  loading = (async () => {
    /* 主题缺失不致命:令牌色退回样式表默认值(one-dark) */
    try {
      if (!window.LryCodeThemes && base) await loadScript(base + 'lry-code-themes.js');
    } catch (e) {
      console.warn('[lry-editor] 代码主题调色板加载失败,使用默认配色', e);
    }
    if (!window.hljs) {
      if (!base) throw new Error('highlight.js 未加载');
      await loadScript(base + 'highlight.min.js');
    }
    if (!window.hljs) throw new Error('highlight.js 未就绪');
    injectThemeCss();
    return true;
  })();
  loading.catch(() => { loading = null; }); /* 失败后允许下次重试 */
  return loading;
}

/** 主题类名:只收安全字符,未知/非法值不加类(走默认配色) */
export function themeClass(theme) {
  const t = String(theme || '').toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(t) ? 'theme-' + t : '';
}

function resolveLanguage(brush) {
  const id = String(brush || 'plain').toLowerCase();
  if (!id || id === 'plain') return null;
  const cand = BRUSH_TO_HLJS[id] || id;
  try {
    return window.hljs.getLanguage(cand) ? cand : null;
  } catch (e) { return null; }
}

/* hljs 11 的语法树:字符串(纯文本)/ {scope, children}(节点;叶子节点的 children 是字符串数组)。
   作用域取第一段(与前台 .hljs-title 等选择器一致:前台只按首个类名着色) */
function measure(n) {
  if (typeof n === 'string') return n.length;
  if (!n || !n.children) return 0;
  let len = 0;
  n.children.forEach((c) => { len += measure(c); });
  return len;
}
function walk(n, offset, out) {
  if (typeof n === 'string') return n.length;
  if (!n || !n.children) return 0;
  const main = n.scope ? String(n.scope).split(/[.\s]/)[0] : '';
  const len = measure(n);
  /* 先父后子:同起点时装饰按加入顺序嵌套,父区间必须先加入才能包在子区间外 */
  if (main && len) out.push({ from: offset, to: offset + len, cls: 'hljs-' + main });
  let adv = 0;
  n.children.forEach((c) => { adv += walk(c, offset + adv, out); });
  return adv;
}

/**
 * 分词:返回相对代码块内容起点的令牌区间。未就绪/纯文本/超长/失败均返回空数组。
 * @param {string} code 代码块文本
 * @param {string} brush brush 标识(如 js / php / plain)
 */
export function tokenize(code, brush) {
  if (!highlightReady() || !code || code.length > MAX_HIGHLIGHT_CHARS) return [];
  const lang = resolveLanguage(brush);
  if (!lang) return [];
  let res;
  try {
    res = window.hljs.highlight(code, { language: lang, ignoreIllegals: true });
  } catch (e) { return []; }
  const out = [];
  walk(res._emitter && res._emitter.root ? res._emitter.root : res._emitter, 0, out);
  return out;
}

/**
 * 粘贴自动识别语言——只认没有歧义的确定性特征,按特异性从高到低匹配,认不出返回 null。
 *
 * 为什么不用 highlight.js 的 highlightAuto:它的 relevance 是很粗的关键字计数,并列是常态
 * (JS 与 Lua 同分、Python 与 SCSS 同分),C 家族几种语法在彼此代码上得分几乎一样,
 * 纯英文句子还会被判成 YAML——统计式识别的错标率不可接受,而错误的语言标签比
 * "纯文本"更糟。这里每条规则都对应某种语言独有的语法。
 * @param {string} text 代码块全文
 * @returns {string|null} brush 标识
 */
function isJson(t) {
  if (!/^[\s[{]/.test(t)) return false;
  try { JSON.parse(t); return true; } catch (e) { return false; }
}
/* 级联样式表:去掉注释后,"属性: 值;" 行至少 2 条,且占非选择器行的半数以上 */
function isCss(t) {
  const body = t.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/<\w/.test(body)) return false;
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  let decl = 0, other = 0;
  lines.forEach((l) => {
    if (/^[a-z-]+\s*:\s*[^;{}]+;?\s*$/i.test(l)) decl++;
    else if (!/[{}]$/.test(l) && !/^[{}]/.test(l)) other++;
  });
  return decl >= 2 && decl >= other;
}
/* JavaScript:命中的独有特征不少于 2 种(C 家族/Go/Rust/Python 已在前面判定) */
const JS_MARKS = [
  /\b(?:const|let|var)\s+\w+\s*=/, /=>/, /\bconsole\.\w+\(/, /\bfunction\s*\w*\s*\([^)]*\)\s*\{/,
  /\bdocument\.\w+/, /\brequire\s*\(/, /^\s*import\s+[\w{}*,\s]+\s+from\s+['"]/m, /^\s*export\s+(?:default|const|let|function|class)\b/m,
  /\$\(['"]/, /\btypeof\b/, /===|!==/, /\bnew\s+(?:Promise|Array|Object|Map|Set|Date)\b/, /\bundefined\b/
];
const RULES = [
  ['php', (t) => /^\s*<\?php\b/i.test(t) || /\bfunction\s+\w+\s*\(\s*(?:\$\w+|[^)]*\$\w+)/.test(t)],
  ['bash', (t) => /^#!\s*\/\S*\b(?:ba|z|da)?sh\b|^#!\s*\/bin\/sh\b/m.test(t) || /^\s*if\s+\[\s[^\n]*\]\s*;\s*then\s*$/m.test(t) || /^\s*(?:fi|done|esac)\s*$/m.test(t) && /^\s*(?:for|while|if|case)\s/m.test(t)],
  ['python', (t) => /^#!\s*\/\S*\bpython[23]?\b/m.test(t)],
  ['ruby', (t) => /^#!\s*\/\S*\bruby\b/m.test(t)],
  ['perl', (t) => /^#!\s*\/\S*\bperl\b/m.test(t)],
  ['js', (t) => /^#!\s*\/\S*\bnode\b/m.test(t)],
  ['html', (t) => /^\s*<!doctype\s+html|^\s*<html[\s>]|^\s*<(?:div|p|span|table|thead|tbody|tr|ul|ol|li|a|body|head|section|article|nav|header|footer|form|img|h[1-6]|script|style|link|meta)\b/i.test(t)],
  ['xml', (t) => /^\s*<\?xml\b/.test(t) || /^\s*<[a-z][\w:.-]*[\s>][\s\S]*<\/[a-z][\w:.-]*>\s*$/.test(t)],
  ['json', isJson],
  ['sql', (t) => /^\s*(?:select\s+[\s\S]+?\s+from\s|insert\s+into\s|update\s+[\w.`]+\s+set\s|delete\s+from\s|create\s+(?:table|database|index|view)\b|alter\s+table\s|drop\s+table\b)/i.test(t)],
  ['dockerfile', (t) => /^\s*FROM\s+\S+(?:\s+AS\s+\S+)?\s*$[\s\S]*?^\s*(?:RUN|CMD|ENTRYPOINT|COPY|ADD|WORKDIR|ENV|EXPOSE|ARG|VOLUME|USER|LABEL|HEALTHCHECK)\b/m.test(t)],
  ['go', (t) => /^\s*package\s+\w+\s*$/m.test(t) && /\bfunc\s+(?:\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/.test(t)],
  ['rust', (t) => /\bfn\s+main\s*\(\s*\)|\blet\s+mut\s+\w+|\bprintln!\(|\bimpl\s+\w+\s*\{|^\s*use\s+std::/m.test(t)],
  ['csharp', (t) => /^\s*using\s+(?:System|Microsoft)\b/m.test(t) || (/^\s*namespace\s+[\w.]+\s*(?:\{|;)?\s*$/m.test(t) && /\b(?:class|struct|interface)\s+\w+/.test(t))],
  ['java', (t) => /^\s*import\s+java\.[\w.]+\s*;/m.test(t) || /\bSystem\.(?:out|err|in)\./.test(t) || /\bmain\s*\(\s*String\b/.test(t)
    || (/\bpublic\s+(?:abstract\s+|final\s+)?class\s+\w+/.test(t) && !/\bnamespace\b|^\s*using\s|Console\.|\bstring\s+\w+\s*[;=)]/m.test(t))],
  ['cpp', (t) => /#include\s*<(?:iostream|vector|string|map|set|memory|algorithm|cstdio|cmath|cstdlib|queue|stack)>|\bstd::|\bcout\b|\bendl\b|\btemplate\s*<|\bnamespace\s+\w+\s*\{/.test(t)],
  ['c', (t) => /#include\s*<(?:stdio|stdlib|string|math)\.h>|\bprintf\s*\(|\bscanf\s*\(/.test(t)],
  ['python', (t) => !/;\s*$/m.test(t) && (/^\s*def\s+\w+\s*\(.*\)\s*:\s*(?:#.*)?$/m.test(t) || /^\s*class\s+\w+(?:\(.*\))?\s*:\s*$/m.test(t)
    || (/^\s*(?:from\s+[\w.]+\s+import|import\s+\w+)\b/m.test(t) && /^([ \t]{4,}|\t+)\S/m.test(t)))],
  ['css', isCss],
  ['typescript', (t) => !/\b(?:public|private|namespace|using|System)\b/.test(t) && /\binterface\s+\w+\s*\{/.test(t) && /\b(?:function|const|let|export)\b/.test(t)
    || !/\b(?:public|private|namespace|using|System|int|float|double|char)\b/.test(t) && /\)\s*:\s*(?:string|number|boolean|any|void|never)\s*\{/.test(t) && /\b(?:function|const|let|export)\b/.test(t)],
  ['js', (t) => JS_MARKS.filter((re) => re.test(t)).length >= 2]
];

export function detectLanguage(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t.length < 12 || t.length > MAX_DETECT_CHARS || t.split('\n').length < 2) return null;
  for (let i = 0; i < RULES.length; i++) {
    try {
      if (RULES[i][1](t)) return RULES[i][0];
    } catch (e) { /* ignore */ }
  }
  return null;
}

const isCode = (node) => node.type.spec.code === true;

/**
 * 高亮插件:装饰由文档直接推导(无插件状态);懒加载在 view 钩子里触发,
 * 就绪后发一笔仅带 meta 的事务让视图重算装饰。appendTransaction 负责粘贴后的语言识别。
 */
export function codeHighlightPlugin() {
  const cache = new WeakMap(); /* codeBlock 节点 → 令牌区间 */
  return new Plugin({
    key,
    view() {
      return {
        update(view) {
          if (highlightReady() || loading || !view.editable) return;
          let need = false;
          view.state.doc.descendants((node) => {
            if (need) return false;
            if (isCode(node)) { need = !!node.textContent; return false; }
            return true;
          });
          if (!need) return;
          ensureCodeHighlight().then((ok) => {
            if (ok && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true));
          }).catch((e) => { console.warn('[lry-editor] 代码高亮组件加载失败,编辑态暂不着色', e); });
        }
      };
    },
    props: {
      decorations(state) {
        if (!highlightReady()) return null;
        const decos = [];
        state.doc.descendants((node, pos) => {
          if (!isCode(node)) return true;
          const text = node.textContent;
          if (text) {
            let toks = cache.get(node);
            if (!toks) {
              toks = tokenize(text, parseBrushClass(node.attrs.cls).brush);
              cache.set(node, toks);
            }
            const base = pos + 1;
            for (let i = 0; i < toks.length; i++) {
              decos.push(Decoration.inline(base + toks[i].from, base + toks[i].to, { class: toks[i].cls }));
            }
          }
          return false;
        });
        return decos.length ? DecorationSet.create(state.doc, decos) : null;
      }
    },
    appendTransaction(transactions, oldState, newState) {
      if (!highlightReady()) return null;
      let pasted = false;
      const ranges = [];
      transactions.forEach((tr) => {
        if (!tr.docChanged || !tr.getMeta('paste')) return;
        pasted = true;
        tr.steps.forEach((step) => {
          if (!step.getMap) return;
          step.getMap().forEach((_os, _oe, newStart, newEnd) => ranges.push([newStart, newEnd]));
        });
      });
      if (!pasted) return null;
      const tr = newState.tr;
      let touched = false;
      newState.doc.descendants((node, pos) => {
        if (isCode(node)) {
          if (ranges.some(([a, b]) => pos < b && pos + node.nodeSize > a)) {
            const info = parseBrushClass(node.attrs.cls);
            if (info.brush === 'plain') {
              const lang = detectLanguage(node.textContent);
              if (lang) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, cls: buildBrushClass(lang, info.theme) });
                touched = true;
              }
            }
          }
          return false;
        }
        return true;
      });
      return touched ? tr : null;
    }
  });
}
