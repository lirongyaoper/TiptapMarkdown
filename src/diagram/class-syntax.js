/**
 * Mermaid 类图 ⇄ 结构模型(v1.3.1 可视化画布的语法层)。纯函数,无 DOM 依赖。
 *
 * 生成原则同 flow-syntax.js:按原稿的语句顺序**原位重建**,不重新组织源码。
 *   模型保留顶层语句序列(items):类定义(可带类块)/ 行内成员 / 关系 / 便签 / direction / 原样行。
 *   同一个类可以有多处定义(多个类块 + 行内成员),成员按语句在源码里的先后归并——Mermaid 的显示顺序也是如此(实测)。
 *   不编辑的图做一次往返,产物与原稿逐语句相同。
 *
 * 只建模画布能编辑的部分:
 *   类     { id, defs: [定义语句], members: [成员], fill, styleRest }
 *   定义   { generic, label, css, block }   class A~T~["标注"]:::css { … };block = { anns: [构造型文字], after }
 *   成员   { kind: 'attr' | 'method', text, box }   text 是整行原文(可见性 / 类型 / 泛型由用户手写),box 是它所在的类块或行内语句
 *   关系   { a, ga, b, gb, cardA, cardB, start, end, dashed, label, op }   按文本顺序;start / end 是靠 a / 靠 b 一端的记号
 *   便签   { cls, g, text }   note for X "…"
 *   配色   没有单独的字段:有 style 行的类由那行维护(只对纯 ASCII 类名合法);否则走
 *          cssClass "类名" 样式名 + 末尾的 classDef 样式名 fill:…(对中文、带点的类名也有效)
 * 其余语句(classDef / click / 注释 / 指令)逐行原样保留、留在原位;认不出的语句原样保留并提示。
 * 头行不是 classDiagram、或含 namespace 块时返回 { ok:false },调用方落到源码模式。
 *
 * Mermaid 12.3.0 类图语法(浏览器实测;改本文件前必读):
 *   - 分号不能当语句分隔符;一条关系一行,不支持链式(A --> B --> C)与扇出
 *   - 关系文字不能含 ASCII 冒号 / 分号;标签、类标注、便签、成员里的 <…> 按 HTML 处理(标签被剥掉、实体被解码)
 *     → 统一用 #58; 这类实体码转义(这些位置都会被解码),用户输入的原样保留
 *   - 行尾 %% 注释:后面只要还有语句就解析失败 → 生成器绝不产出(注释只单独成行)
 *   - 类块在**第一个 } 处**结束(成员文字里不能有花括号);} 之后同一行不能再有语句
 *   - 成员含 (…) 即方法,否则是属性;右括号多于左括号会让 Mermaid 内部崩溃
 *   - style <类> fill:… 只接受纯 ASCII 类名(中文、带点的类名直接解析失败),且类必须已在前面出现
 *   - cssClass "类名" 样式名 对任何类名都行,但它**只在后面还有同名的 classDef 语句时才生效**(最后一个 classDef 为准);
 *     classDef 只认 fill / stroke / color 这类属性(font-size 写法直接解析失败)
 *   - 别名(class X as Y)在本版已坏(会生成叫 "XasY" 的类);独立便签(note "…" as N)已移除;命名空间块内不能写关系
 *   - Mermaid 对认不出的语句**静默忽略**,所以"能不能在图上编辑"只能由本文件判定,不能指望它报错
 *   - 类名:字母 / 数字 / 下划线 / 中文 / 点;不能含 - $ 空格,不能是保留字(class、note、direction…)
 */

const HEAD_RE = /^classDiagram(-v2)?\s*$/i;
/* 类名;点只在后面还跟名字字符时才算类名的一部分(A..>B 是依赖关系,a.b.c 是一个类名) */
const ID_SRC = '[\\w\\u0080-\\uFFFF]+(?:\\.[\\w\\u0080-\\uFFFF]+)*';
const ID_FULL_RE = new RegExp('^' + ID_SRC + '$');
const ID_AT_RE = new RegExp('^' + ID_SRC);
/* Mermaid 的关键字不能作类名(实测 class / note 直接解析失败;其余是同类关键字,保守处理) */
const RESERVED_RE = /^(class|note|direction|style|classdef|namespace|click|link|cssclass|href|call|callback|end)$/i;
const DIRECTION_RE = /^direction\s+(TB|LR|BT|RL)\s*$/i;
const STYLE_RE = /^style\s+(\S+)\s+(.+)$/;
const FILL_RE = /(^|[;,])\s*fill\s*:\s*([^,;]+?)\s*(?=[,;]|$)/i;
/* 这些语句画布不建模,但 Mermaid 认识:原样保留、不提示 */
const EXTRA_RE = /^(classDef|href|call)\b/i;
const CLASSDEF_RE = /^classDef\s+([\w-]+)\s+(.+)$/i;
const CSS_RE = /^cssClass\s+"([^"]+)"\s+([\w-]+)\s*$/i;
const CLICK_RE = /^click\s+(\S+)([\s\S]*)$/i;
const CLASS_KW_RE = /^class\s+/i;
const NOTE_RE = new RegExp('^note\\s+for\\s+(' + ID_SRC + ')(~[^~]*~)?\\s+"([^"]*)"\\s*$', 'i');
const INLINE_RE = new RegExp('^(' + ID_SRC + ')(~[^~]*~)?\\s*:\\s?(.*)$');
const ANNOTATION_RE = /^<<(.*)>>$/;

/* 关系运算符(按书写形态 a op b)→ 线两端的记号。列表里长的在前(--> 要先于 -- 被 matching 到) */
const REL_OPS = {
  '<|--': { start: 'extension' },
  '--|>': { end: 'extension' },
  '<|..': { start: 'extension', dashed: true },
  '..|>': { end: 'extension', dashed: true },
  '*--': { start: 'composition' },
  '--*': { end: 'composition' },
  'o--': { start: 'aggregation' },
  '--o': { end: 'aggregation' },
  '-->': { end: 'dependency' },
  '<--': { start: 'dependency' },
  '..>': { end: 'dependency', dashed: true },
  '<..': { start: 'dependency', dashed: true },
  '--': {},
  '..': { dashed: true }
};
const REL_OP_LIST = Object.keys(REL_OPS);

/* 画布可切换的关系类型(按"前者 → 后者"的书写方向给出标准写法) */
export const REL_TYPES = [
  ['assoc', '关联', { end: 'dependency' }],
  ['depend', '依赖', { end: 'dependency', dashed: true }],
  ['inherit', '继承', { start: 'extension' }],
  ['realize', '实现', { end: 'extension', dashed: true }],
  ['compose', '组合', { start: 'composition' }],
  ['aggregate', '聚合', { start: 'aggregation' }],
  ['link', '实线', {}],
  ['dashed', '虚线', { dashed: true }]
];
const REL_TYPE_TIPS = {
  assoc: '关联:实线箭头,前者指向后者',
  depend: '依赖:虚线箭头,前者依赖后者',
  inherit: '继承:后者继承前者(空心三角指向前者)',
  realize: '实现:前者实现后者(虚线,空心三角指向后者)',
  compose: '组合:实心菱形在前者一端',
  aggregate: '聚合:空心菱形在前者一端',
  link: '实线:无箭头',
  dashed: '虚线:无箭头'
};

/* ---------- 文字编解码 ---------- */

const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0' };
const codePoint = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

/** 源码形态 → 编辑用纯文本:Mermaid 的实体码(#quot; #9829; 与 &name;)解码、<br/> 换行、其余 HTML 标签剥掉 */
export function decodeText(raw) {
  let s = String(raw || '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  /* 先剥标签、后解实体码:与 Mermaid 的呈现一致(原文里的 <…> 是标签;要显示尖括号得写 #lt;) */
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  s = s.replace(/&?#(\d+);/g, (m, n) => codePoint(+n));
  s = s.replace(/&?#([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
    const c = NAMED[name.toLowerCase()];
    return c === undefined ? m : c;
  });
  s = s.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
    const c = NAMED[name.toLowerCase()];
    return c === undefined ? m : c;
  });
  return s.trim();
}

/* Mermaid 会解码的实体码:尖括号、冒号等语法字符在标签 / 成员 / 便签里全靠它们原样保留 */
const ESC = { '#': '#35;', '&': '#amp;', '<': '#lt;', '>': '#gt;', ':': '#58;', ';': '#59;', '"': '#quot;', '[': '#91;', ']': '#93;', '{': '｛', '}': '｝' };
/* 一次遍历完成转义:实体码自己带 # 与分号,分多次 replace 会把刚生成的结果再转义一遍 */
function escapeAll(s, chars) {
  return s.replace(new RegExp('[' + chars + ']', 'g'), (c) => ESC[c]);
}
const oneLine = (text) => String(text === undefined || text === null ? '' : text).replace(/\r\n?|\n/g, ' ').replace(/\s+/g, ' ').replace(/^[ ]+|[ ]+$/g, '');

/** 关系文字:单行;冒号、分号是 Mermaid 的语法字符,转成实体码 */
export function encodeRelationLabel(text) {
  return escapeAll(oneLine(text), '#&<>:;"');
}

/** 类标注(class A["…"]):单行;方括号是定界符 */
export function encodeClassLabel(text) {
  return escapeAll(oneLine(text), '#&<>"\\[\\]');
}

/** 便签文字(双引号串内):换行写成 <br/> */
export function encodeNote(text) {
  const s = String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n').replace(/^[ \t]+|[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  return escapeAll(s, '#&<>"').replace(/\n/g, '<br/>');
}

/** 成员文字(单行):花括号会结束类块,换成全角;括号配不配对由 memberProblem 另行校验 */
export function encodeMember(text) {
  return escapeAll(oneLine(text), '#&<>"{}');
}

/** 含 (…) 的是方法,否则是属性——与 Mermaid 的判定一致(实测) */
export function memberKind(text) {
  return /\(.*\)/.test(String(text || '')) ? 'method' : 'attr';
}

/** 成员文字能否交给 Mermaid:右括号多于左括号会让它内部崩溃(实测) */
export function memberProblem(text) {
  const s = String(text || '');
  if (!s.trim()) return '成员不能为空';
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth < 0) return '成员里的右括号没有配对的左括号,无法解析'; }
  }
  return '';
}

/* ---------- 读取 ---------- */

const skipSp = (s, i) => { while (s[i] === ' ' || s[i] === '\t') i++; return i; };

function readIdAt(s, i) {
  const m = ID_AT_RE.exec(s.slice(i));
  if (!m || RESERVED_RE.test(m[0])) return null;
  return { id: m[0], end: i + m[0].length };
}

/* 基数:双引号或单引号串 */
function readCardAt(s, i) {
  const c = s[i];
  if (c !== '"' && c !== "'") return null;
  const close = s.indexOf(c, i + 1);
  if (close < 0) return null;
  return { text: s.slice(i + 1, close), end: close + 1 };
}

/**
 * 类定义语句:class A ~泛型~ ["标注"] :::css [{ 同一行的内容 }]
 * @returns {{generic:string,label:string|null,css:string,block:object|null,open?:boolean}|null}
 */
function parseClassDef(t) {
  const kw = CLASS_KW_RE.exec(t);
  if (!kw) return null;
  let i = skipSp(t, kw[0].length);
  const ref = readIdAt(t, i);
  if (!ref) return null;
  i = skipSp(t, ref.end);
  const def = { t: 'c', cls: null, id: ref.id, generic: '', label: null, css: '', block: null };
  if (t[i] === '~') {
    const close = t.indexOf('~', i + 1);
    if (close < 0) return null;
    def.generic = t.slice(i + 1, close).trim();
    i = skipSp(t, close + 1);
  }
  if (t[i] === '[') {
    const close = t.indexOf(']', i + 1);
    if (close < 0) return null;
    def.label = t.slice(i + 1, close);
    const quoted = /^"(.*)"$/.exec(def.label);
    if (quoted) def.label = quoted[1]; /* 引号是标注的定界符,不归文字 */
    i = skipSp(t, close + 1);
  }
  if (t.indexOf(':::', i) === i) {
    const cm = /^:::\s*([\w-]+)/.exec(t.slice(i));
    if (!cm) return null;
    def.css = cm[1];
    i = skipSp(t, i + cm[0].length);
  }
  def.rawHead = t.slice(0, i).trim(); /* 头部原文:没改动过就逐字写回 */
  if (i >= t.length) return def;
  if (t[i] !== '{') return null;
  def.block = { anns: [], after: '' };
  /* { 之后还有内容:是类块的第一行(可能就带着 }) */
  const rest = t.slice(i + 1).trim();
  if (rest) def.firstLine = rest;
  else def.open = true; /* 类块内容从下一行开始 */
  return def;
}

/**
 * 一条关系:A ["基数"] op ["基数"] B : 文字。认不出返回 null。
 * 两端的关系运算符(-->、<--、o-- 等)之外的写法(链式、|文字|、三连字符…)都走这里。
 */
function parseRelation(t) {
  let i = skipSp(t, 0);
  const a = readIdAt(t, i);
  if (!a) return null;
  i = skipSp(t, a.end);
  let ga = '';
  if (t[i] === '~') {
    const close = t.indexOf('~', i + 1);
    if (close < 0) return null;
    ga = t.slice(i + 1, close).trim();
    i = skipSp(t, close + 1);
  }
  let cardA = '';
  const ca = readCardAt(t, i);
  if (ca) { cardA = ca.text; i = skipSp(t, ca.end); }
  /* 直接贴着类名的 o 会被类名吃掉(Ao--B = 类 Ao 链接 B),与 Mermaid 的词法一致 */
  const op = REL_OP_LIST.find((o) => t.startsWith(o, i));
  if (!op) return null;
  i = skipSp(t, i + op.length);
  let cardB = '';
  const cb = readCardAt(t, i);
  if (cb) { cardB = cb.text; i = skipSp(t, cb.end); }
  const b = readIdAt(t, i);
  if (!b) return null;
  i = skipSp(t, b.end);
  let gb = '';
  if (t[i] === '~') {
    const close = t.indexOf('~', i + 1);
    if (close < 0) return null;
    gb = t.slice(i + 1, close).trim();
    i = skipSp(t, close + 1);
  }
  let label = '';
  if (t[i] === ':') {
    const raw = t.slice(i + 1).trim();
    if (!raw) return null; /* 冒号后没有文字:Mermaid 解析失败 */
    label = raw;
  } else if (i < t.length) return null;
  const spec = REL_OPS[op];
  return {
    a: a.id, ga, b: b.id, gb, cardA, cardB, label,
    start: spec.start || '', end: spec.end || '', dashed: !!spec.dashed, op
  };
}

/* ---------- 解析 ---------- */

export function parseClass(src) {
  const text = String(src || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  let headIdx = -1;
  const lead = []; /* 头行之前的指令/注释(%%{init}%% 习惯写在最前),生成时仍放在头行之前 */
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k].trim();
    if (!t) continue;
    if (HEAD_RE.test(t)) { headIdx = k; break; }
    if (t.indexOf('%%') === 0) { lead.push(t); continue; }
    break;
  }
  if (headIdx < 0) return { ok: false, reason: 'not-class' };

  const model = {
    kind: 'class', head: lines[headIdx].trim(), direction: 'TB',
    items: [], lead, classes: [], rels: [], notes: [], warnings: [], usedNums: new Set()
  };
  const byId = Object.create(null);
  const styles = []; /* { item, id, fill, rest }:接管的 style 行,解析完再落到类上 */
  const classDefs = {}; /* 样式名 → fill(classDef 语句里的) */
  const cssItems = []; /* { item, id, name }:cssClass 语句,解析完再按 classDef 落到类上 */
  const put = (it) => { model.items.push(it); return it; };
  /* 登记类:只在关系 / 类定义 / 行内成员里出现才算(便签、style 指向的类不会单独成图,实测) */
  const register = (id) => {
    let cls = byId[id];
    if (!cls) {
      cls = byId[id] = { id, defs: [], members: [], fill: null, styleRest: null, styleItem: null, cssItem: null };
      model.classes.push(cls);
      const nm = /^Class(\d+)$/.exec(id);
      if (nm) model.usedNums.add(+nm[1]);
    }
    return cls;
  };

  /* 往类块里喂一行:到第一个 } 为止(与 Mermaid 一致——成员文字里不能有花括号)。@returns 类块是否结束 */
  const feedBlock = (def, line) => {
    const at = line.indexOf('}');
    const body = (at >= 0 ? line.slice(0, at) : line).trim();
    if (body) {
      const ann = ANNOTATION_RE.exec(body);
      if (ann) def.block.anns.push(ann[1]);
      else insertMember(def.cls, { kind: memberKind(body), text: body, box: def.block });
    }
    if (at < 0) return false;
    def.block.after = line.slice(at + 1).trim();
    return true;
  };

  let open = null; /* 正在读取的类块 */
  for (let k = headIdx + 1; k < lines.length; k++) {
    const t = lines[k].trim();
    if (!t) continue;
    if (open) {
      /* 类块里的 %% 行 Mermaid 会忽略;保留它们会让成员行号对不上,这里一并略去 */
      if (t.indexOf('%%') === 0) continue;
      if (feedBlock(open, t)) open = null;
      continue;
    }
    if (t.indexOf('%%') === 0) { put({ t: 'l', text: t }); continue; }
    if (/^namespace\b/i.test(t)) return { ok: false, reason: 'namespace' };
    if (HEAD_RE.test(t)) { put({ t: 'l', text: t }); continue; } /* 重复的头行:原样留在原位 */
    const dir = DIRECTION_RE.exec(t);
    if (dir) {
      /* 每条 direction 语句留在原位(以最后一条为准) */
      model.direction = dir[1].toUpperCase();
      put({ t: 'dir', value: model.direction });
      continue;
    }
    const cdef = CLASSDEF_RE.exec(t);
    if (cdef) {
      const f = FILL_RE.exec(cdef[2]);
      if (f) classDefs[cdef[1]] = f[2].replace(/\s*!important\s*$/i, '');
      put({ t: 'l', text: t });
      continue;
    }
    if (EXTRA_RE.test(t)) { put({ t: 'l', text: t }); continue; }
    const css = CSS_RE.exec(t);
    if (css) { cssItems.push({ item: put({ t: 'css', cls: null, raw: t }), id: css[1], name: css[2] }); continue; }
    const click = CLICK_RE.exec(t);
    if (click) { put({ t: 'l', text: t, clickId: click[1] }); continue; }
    /* style <类> <声明>:fill 归模型(配色),行留在原位、生成时重写 */
    const stm = STYLE_RE.exec(t);
    if (stm) {
      const fill = FILL_RE.exec(stm[2]);
      if (fill) {
        styles.push({ item: put({ t: 'l', text: t, styleId: stm[1] }), id: stm[1], fill: fill[2].replace(/\s*!important\s*$/i, ''), rest: stm[2].replace(FILL_RE, '$1').replace(/^[,;\s]+|[,;\s]+$/g, '') || null }); /* 只写了 fill 的,其余声明为 null */
        continue;
      }
      put({ t: 'l', text: t });
      continue;
    }

    const def = parseClassDef(t);
    if (def) {
      const cls = register(def.id);
      def.cls = cls;
      cls.defs.push(def);
      put(def);
      if (def.block) {
        if (def.open) open = def;
        else if (feedBlock(def, def.firstLine) === false) open = def;
      }
      continue;
    }
    const note = NOTE_RE.exec(t);
    if (note) {
      const n = { cls: note[1], g: note[2] ? note[2].slice(1, -1).trim() : '', text: note[3] };
      model.notes.push(n);
      put({ t: 'n', note: n, raw: t });
      continue;
    }
    const inline = INLINE_RE.exec(t);
    if (inline && !RESERVED_RE.test(inline[1]) && inline[3].trim()) {
      const cls = register(inline[1]);
      const item = put({ t: 'm', cls, ga: inline[2] ? inline[2].slice(1, -1).trim() : '', member: null, raw: t });
      item.member = { kind: memberKind(inline[3]), text: inline[3].trim(), box: item };
      insertMember(cls, item.member);
      continue;
    }
    const rel = parseRelation(t);
    if (rel) {
      register(rel.a);
      register(rel.b);
      model.rels.push(rel);
      put({ t: 'r', rel, raw: t });
      continue;
    }
    put({ t: 'l', text: t });
    model.warnings.push('第 ' + (k + 1) + ' 行含暂不支持在图上编辑的语法,已原样保留');
  }
  styles.forEach((s) => {
    const c = byId[s.id];
    if (!c) { delete s.item.styleId; return; } /* 指向不存在的类:整行原样保留 */
    c.fill = s.fill;
    c.styleRest = s.rest;
    c.styleItem = s.item;
  });
  /* cssClass "X" 样式名:样式名有带 fill 的 classDef、且类存在、且没有 style 行(style 的 fill 优先)时,归模型的配色 */
  cssItems.forEach((x) => {
    const c = byId[x.id];
    const fill = classDefs[x.name];
    if (!c || !fill || c.styleItem) { Object.assign(x.item, { t: 'l', text: x.item.raw, cls: null, dirty: undefined }); return; } /* 原样保留 */
    c.fill = fill;
    c.cssItem = x.item;
    x.item.cls = c;
  });
  model.byId = byId;
  model.classes.forEach((c) => orderMembers(model, c));
  return { ok: true, model };
}

/* 成员先登记进类里;先后顺序由 orderMembers 统一按语句在源码里的位置排 */
function insertMember(cls, member) {
  cls.members.push(member);
  return member;
}

/*
 * 成员的先后 = 它们所在语句在源码里的先后(图上的成员行就是这个顺序):
 * 同一个类块里的按块内顺序,行内成员按语句位置,类块与行内语句交错时各归其位。
 * 不靠"插入时机"来维持顺序——那样类块在前、行内成员在后的类,行内成员会被排到最前面。
 * 每次成员或语句的结构变化之后调用。
 */
function orderMembers(model, cls) {
  const key = (m) => {
    const box = m.box;
    if (!box) return Infinity;
    if (box.t === 'm') return model.items.indexOf(box);
    const def = cls.defs.find((d) => d.block === box);
    return def ? model.items.indexOf(def) : Infinity;
  };
  cls.members = cls.members.map((m, i) => ({ m, i, k: key(m) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.m);
}

/* ---------- 生成 ---------- */

function classLine(def, cls) {
  return 'class ' + cls.id
    + (def.generic ? '~' + def.generic + '~' : '')
    + (def.label !== null && def.label !== undefined ? '["' + encodeClassLabel(decodeText(def.label)) + '"]' : '') /* 带引号:括号等字符不破坏解析 */
    + (def.css ? ':::' + def.css : '');
}

function relLine(r) {
  const op = REL_OPS[r.op] ? r.op : (relOpFor(r.start, r.end, r.dashed) || '-->');
  let s = r.a + (r.ga ? '~' + r.ga + '~' : '');
  if (r.cardA) s += ' "' + r.cardA + '"';
  s += ' ' + op + ' ';
  if (r.cardB) s += '"' + r.cardB + '" ';
  s += r.b + (r.gb ? '~' + r.gb + '~' : '');
  if (r.label) s += ' : ' + encodeRelationLabel(decodeText(r.label));
  return s;
}

function styleLine(c) {
  return 'style ' + c.id + ' fill:' + c.fill + (c.styleRest ? ',' + c.styleRest : '');
}

/** 记号组合 → 关系运算符;组合不在支持范围内返回 null */
export function relOpFor(start, end, dashed) {
  const hit = REL_OP_LIST.find((o) => {
    const s = REL_OPS[o];
    return (s.start || '') === (start || '') && (s.end || '') === (end || '') && !!s.dashed === !!dashed;
  });
  return hit || null;
}

/**
 * 关系当前对应的画布类型键(assoc / inherit / …)。只看两端有哪两种记号、是不是虚线,不看记号在哪一端:
 * 反向写法(A --|> B)也是「继承」,方向由「反向」按钮管。表里没有的组合(双向等)返回 'custom'。
 */
export function relTypeOf(rel) {
  const key = (start, end, dashed) => [start || '', end || ''].sort().join(',') + '/' + !!dashed;
  const want = key(rel.start, rel.end, rel.dashed);
  const hit = REL_TYPES.find(([, , spec]) => key(spec.start, spec.end, spec.dashed) === want);
  return hit ? hit[0] : 'custom';
}

export function serializeClass(model) {
  const out = [];
  out.push(...model.lead);
  out.push(model.head);
  model.items.forEach((it) => {
    if (it.t === 'c') {
      /* 没改动过的语句(raw / rawHead 还在、没被标脏)逐字写回;改动过的按模型重建 */
      const line = it.rawHead && !it.dirty ? it.rawHead : classLine(it, it.cls);
      if (!it.block) { out.push(line); return; }
      out.push(line + ' {');
      it.block.anns.forEach((a) => out.push('  <<' + a + '>>'));
      it.cls.members.forEach((m) => { if (m.box === it.block) out.push('  ' + m.text); });
      out.push('}' + (it.block.after ? ' ' + it.block.after : ''));
    } else if (it.t === 'm') {
      out.push(it.raw && !it.dirty ? it.raw : it.cls.id + (it.ga ? '~' + it.ga + '~' : '') + ' : ' + it.member.text);
    } else if (it.t === 'r') {
      out.push(it.raw && !it.rel.dirty ? it.raw : relLine(it.rel));
    } else if (it.t === 'n') {
      out.push(it.raw && !it.note.dirty ? it.raw : 'note for ' + it.note.cls + (it.note.g ? '~' + it.note.g + '~' : '') + ' "' + encodeNote(decodeText(it.note.text)) + '"');
    } else if (it.t === 'css') {
      out.push(it.raw && !it.dirty ? it.raw : 'cssClass "' + it.cls.id + '" ' + cssName(it.cls.fill));
    } else if (it.t === 'dir') {
      out.push('direction ' + it.value);
    } else if (it.styleId) {
      const c = model.byId[it.styleId];
      if (!c) return; /* 类已删除 */
      if (c.fill) out.push(styleLine(c));
      else if (c.styleRest) out.push('style ' + c.id + ' ' + c.styleRest); /* 配色改回主题默认:只留其余声明 */
    } else out.push(it.text);
  });
  /*
   * 走 cssClass 的配色:末尾要有同名的 classDef(Mermaid 只认写在 cssClass 之后的 classDef)。
   * 源码里已有内容一致的就不再写;自家(lryXXXXXX)的 classDef 行不再被任何类引用时不再输出。
   */
  const used = new Set();
  model.classes.forEach((c) => { if (c.cssItem && c.fill) used.add(cssName(c.fill)); });
  const emitted = new Set();
  model.classes.forEach((c) => {
    if (!c.cssItem || !c.fill) return;
    const name = cssName(c.fill);
    const have = model.items.some((it) => it.t === 'l' && new RegExp('^classDef\\s+' + name + '\\s+[^\\n]*fill\\s*:\\s*#?' + c.fill.slice(1), 'i').test(it.text));
    if (!have && !emitted.has(name)) { out.push('classDef ' + name + ' fill:' + c.fill); emitted.add(name); }
  });
  const body = out.length - emitted.size; /* 以上 classDef 行之外的部分 */
  return out.slice(0, body).filter((line) => !( /^classDef\s+lry[0-9A-F]{6}\b/i.test(line) && !used.has(/^classDef\s+(\S+)/i.exec(line)[1]) ))
    .concat(out.slice(body)).join('\n');
}

/* 配色对应的样式名:按颜色定,同一个颜色只有一条 classDef */
const cssName = (fill) => 'lry' + String(fill).replace('#', '').toUpperCase();

/* ---------- 模型操作(画布用;这里只动模型,文档写回由调用方收尾) ---------- */

/** 下一个可用的新类名:Class1、Class2…(避开已有类名与原样语句里出现过的) */
export function nextClassId(model) {
  const used = new Set(model.usedNums || []);
  model.items.forEach((it) => {
    if (it.t !== 'l') return;
    for (const m of it.text.matchAll(/\bClass(\d+)\b/g)) used.add(+m[1]);
  });
  let k = 1;
  while (used.has(k)) k++;
  used.add(k);
  model.usedNums = used;
  return 'Class' + k;
}

/** 类名能否使用:可用返回空串,否则返回给用户看的原因 */
export function classIdProblem(model, id, self) {
  const s = String(id || '').trim();
  if (!s) return '类名不能为空';
  if (!ID_FULL_RE.test(s) || RESERVED_RE.test(s)) return '类名只能由字母、数字、下划线、中文和点组成,且不能用保留字';
  const other = model.byId[s];
  if (other && other !== self) return '已经有叫「' + s + '」的类了';
  return '';
}

/**
 * 加一个类(带一个类块,members 是成员原文数组),可选同时连一条关系:
 * rel = { from: 另一端的类 } 为"另一端 → 新类",{ to: 另一端的类 } 为"新类 → 另一端";默认关联(实线箭头)。
 */
export function classAddClass(model, members, rel) {
  const id = nextClassId(model);
  const cls = { id, defs: [], members: [], fill: null, styleRest: null, styleItem: null, cssItem: null };
  model.byId[id] = cls;
  model.classes.push(cls);
  const block = { anns: [], after: '' };
  const def = { t: 'c', cls, generic: '', label: null, css: '', block };
  cls.defs.push(def);
  model.items.push(def);
  (members || []).forEach((text) => insertMember(cls, { kind: memberKind(text), text, box: block }));
  let made = null;
  if (rel) {
    made = Object.assign({ a: id, ga: '', b: id, gb: '', cardA: '', cardB: '', start: '', end: 'dependency', dashed: false, label: '' }, rel.from ? { a: rel.from } : { b: rel.to });
    made.op = relOpFor(made.start, made.end, made.dashed);
    model.rels.push(made);
    model.items.push({ t: 'r', rel: made });
  }
  return { cls, rel: made };
}

export function classAddRel(model, spec) {
  const r = Object.assign({ a: '', ga: '', b: '', gb: '', cardA: '', cardB: '', start: '', end: 'dependency', dashed: false, label: '' }, spec);
  r.op = relOpFor(r.start, r.end, r.dashed) || '-->';
  model.rels.push(r);
  model.items.push({ t: 'r', rel: r });
  return r;
}

/* 语句数组里去掉一项 */
const dropItem = (model, pred) => {
  const at = model.items.findIndex(pred);
  if (at >= 0) model.items.splice(at, 1);
};

/**
 * 设置类框配色(null = 主题默认)。类已有 style 行的,原位改写那一行(保留 stroke 等其余声明);
 * 否则走 cssClass + classDef:对中文、带点的类名也有效(style 行只接受纯 ASCII 类名)。
 */
export function classSetFill(model, cls, fill) {
  if (cls.styleItem) {
    cls.fill = fill || null;
    return true;
  }
  if (!fill) {
    if (cls.cssItem) { dropItem(model, (it) => it === cls.cssItem); cls.cssItem = null; }
    cls.fill = null;
    return true;
  }
  if (cls.cssItem) { cls.fill = fill; cls.cssItem.dirty = true; return true; }
  const item = { t: 'css', cls, dirty: true };
  cls.cssItem = item;
  cls.fill = fill;
  model.items.push(item);
  return true;
}

/** 删除类:连同它的定义、行内成员、关系、便签、配色,以及指向它的 style / click 行 */
export function classRemove(model, id) {
  const cls = model.byId[id];
  if (!cls) return false;
  model.items = model.items.filter((it) => {
    if (it.t === 'c' || it.t === 'm' || it.t === 'css') return it.cls !== cls;
    if (it.t === 'r') return it.rel.a !== id && it.rel.b !== id;
    if (it.t === 'n') return it.note.cls !== id;
    if (it.t === 'l') return it.styleId !== id && it.clickId !== id;
    return true;
  });
  model.rels = model.rels.filter((r) => r.a !== id && r.b !== id);
  model.notes = model.notes.filter((n) => n.cls !== id);
  model.classes.splice(model.classes.indexOf(cls), 1);
  delete model.byId[id];
  return true;
}

export function classRemoveRel(model, index) {
  const r = model.rels[index];
  if (!r) return false;
  model.rels.splice(index, 1);
  dropItem(model, (it) => it.t === 'r' && it.rel === r);
  return true;
}

/** 改接关系的一端(新端的泛型不保留) */
export function classReconnect(model, index, a, b) {
  const r = model.rels[index];
  if (!r) return false;
  r.a = a;
  r.b = b;
  r.ga = '';
  r.gb = '';
  r.dirty = true;
  return true;
}

export function classRemoveNote(model, index) {
  const n = model.notes[index];
  if (!n) return false;
  model.notes.splice(index, 1);
  dropItem(model, (it) => it.t === 'n' && it.note === n);
  return true;
}

export function classSetNote(model, index, text) {
  const n = model.notes[index];
  if (!n) return false;
  if (!String(text || '').trim()) return classRemoveNote(model, index);
  n.text = encodeNote(text);
  n.dirty = true;
  return true;
}

export function classAddNote(model, clsId) {
  const n = { cls: clsId, g: '', text: '说明' };
  model.notes.push(n);
  model.items.push({ t: 'n', note: n });
  return model.notes.length - 1;
}

/** 加一个成员:有类块就写进最后一个类块,否则写成一条行内成员语句(紧跟该类的最后一条语句) */
export function classAddMember(model, cls, kind, text) {
  const member = { kind, text: encodeMember(text), box: null };
  const block = targetBlock(cls);
  if (block) {
    member.box = block;
    insertMember(cls, member);
    orderMembers(model, cls); /* 块里原有成员之后、排在块后面的行内成员之前 */
    return member;
  }
  const item = { t: 'm', cls, ga: '', member: null };
  member.box = item;
  item.member = member;
  let anchor = -1;
  model.items.forEach((it, i) => { if ((it.t === 'c' || it.t === 'm') && it.cls === cls) anchor = i; });
  model.items.splice(anchor + 1, 0, item);
  insertMember(cls, member);
  orderMembers(model, cls);
  return member;
}

export function classRemoveMember(model, cls, member) {
  const i = cls.members.indexOf(member);
  if (i < 0) return false;
  cls.members.splice(i, 1);
  if (member.box && member.box.t === 'm') dropItem(model, (it) => it === member.box);
  return true;
}

/** 改成员文字(text 为编辑框里的纯文本;调用方先用 memberProblem 校验) */
export function classSetMemberText(model, cls, member, text) {
  if (cls.members.indexOf(member) < 0) return false;
  member.text = encodeMember(text);
  member.kind = memberKind(text);
  if (member.box && member.box.t === 'm') member.box.dirty = true;
  return true;
}

/*
 * 成员换位:与相邻的同类成员交换位置(同一个类块里的,或都是行内成员的)——交换的是成员对象本身,
 * 这样"被移动的那一行"还是原来选中的那个成员(交换文字的话,选中会留在原位置)。
 * 行内成员的先后由语句顺序决定,还要把它们在 items 里对调。
 * @returns 与之交换的成员;没有可换的(已是类块内 / 行内成员里同类的第一个或最后一个)返回 null
 */
export function classMoveMember(model, cls, member, dir) {
  if (!member || cls.members.indexOf(member) < 0) return null;
  /* 可换的范围:同一个类块里的同类成员,或都是行内成员(各占一条语句)的同类成员 */
  const inline = (x) => x.box && x.box.t === 'm';
  const pool = cls.members.filter((x) => x.kind === member.kind && (x.box === member.box || (inline(x) && inline(member))));
  const other = pool[pool.indexOf(member) + dir];
  if (!other) return null;
  const a = cls.members.indexOf(member);
  const b = cls.members.indexOf(other);
  cls.members[a] = other;
  cls.members[b] = member;
  /* 行内成员的先后由语句顺序决定:两条语句在 items 里对调 */
  if (inline(member)) {
    const x = model.items.indexOf(member.box);
    const y = model.items.indexOf(other.box);
    model.items[x] = other.box;
    model.items[y] = member.box;
  }
  return other;
}

const targetBlock = (cls) => {
  for (let i = cls.defs.length - 1; i >= 0; i--) if (cls.defs[i].block) return cls.defs[i].block;
  return null;
};

/* 主要定义语句:改类名 / 标注 / 构造型落在它上面 */
function primaryDef(model, cls) {
  let def = cls.defs.filter((d) => d.block).pop() || cls.defs[cls.defs.length - 1];
  if (!def) { /* 只在关系里被引用过的类:补一条定义语句 */
    def = { t: 'c', cls, generic: '', label: null, css: '', block: null };
    cls.defs.push(def);
    model.items.push(def);
  }
  return def;
}

/* 类当前显示的标注(没有返回 null) */
export function classLabel(cls) {
  const hit = cls.defs.filter((d) => d.label !== null && d.label !== undefined).pop();
  return hit ? decodeText(hit.label) : null;
}

/** 设置显示标注;空串 = 去掉标注 */
export function classSetLabel(model, cls, text) {
  const def = primaryDef(model, cls);
  const t = String(text || '').replace(/\r\n?|\n/g, ' ').replace(/\s+/g, ' ').trim();
  cls.defs.forEach((d) => { if (d !== def) { d.label = null; d.dirty = true; } });
  def.label = t ? encodeClassLabel(t) : null;
  def.dirty = true;
  return true;
}

/** 设置构造型(<<interface>> 等);空串 = 去掉。类没有类块时把主定义改成带类块的 */
export function classSetAnnotation(model, cls, text) {
  const t = String(text || '').replace(/[<>{}\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t && !targetBlock(cls)) primaryDef(model, cls).block = { anns: [], after: '' };
  const blocks = cls.defs.map((d) => d.block).filter(Boolean);
  blocks.forEach((b, i) => { b.anns = i === 0 && t ? [t] : []; });
  return true;
}

/** 改类名:同步关系、便签、style / click 行 */
export function classRename(model, cls, next) {
  const prev = cls.id;
  const id = String(next).trim();
  delete model.byId[prev];
  cls.id = id;
  model.byId[id] = cls;
  /* 语句原文里带着旧类名:涉及这个类的语句全部标脏,生成时按模型重建 */
  model.rels.forEach((r) => { const touched = r.a === prev || r.b === prev; if (r.a === prev) r.a = id; if (r.b === prev) r.b = id; if (touched) r.dirty = true; });
  model.notes.forEach((n) => { if (n.cls === prev) { n.cls = id; n.dirty = true; } });
  cls.defs.forEach((d) => { d.dirty = true; });
  if (cls.cssItem) cls.cssItem.dirty = true;
  /* style 行只接受纯 ASCII 类名:改名后不再合法时,配色改走 cssClass */
  if (cls.styleItem && !/^[A-Za-z0-9_]+$/.test(id) && cls.fill) {
    dropItem(model, (it) => it === cls.styleItem);
    cls.styleItem = null;
    cls.styleRest = null;
    cls.cssItem = { t: 'css', cls, dirty: true };
    model.items.push(cls.cssItem);
  }
  model.items.forEach((it) => {
    if (it.t === 'm' && it.cls === cls) it.dirty = true;
    if (it.t !== 'l') return;
    if (it.styleId === prev) it.styleId = id;
    if (it.clickId === prev) {
      it.clickId = id;
      it.text = it.text.replace(/^(\s*click\s+)\S+/i, (m, head) => head + id);
    }
  });
  const nm = /^Class(\d+)$/.exec(id);
  if (nm) model.usedNums.add(+nm[1]);
  return true;
}

/* 关系类型 / 方向 / 两端 */
export function classSetRelType(model, index, key) {
  const r = model.rels[index];
  const hit = REL_TYPES.find((x) => x[0] === key);
  if (!r || !hit) return false;
  r.start = hit[2].start || '';
  r.end = hit[2].end || '';
  r.dashed = !!hit[2].dashed;
  r.op = relOpFor(r.start, r.end, r.dashed);
  r.dirty = true;
  return true;
}

/* 调换两端:记号与基数跟着端点走,书写方向上的"前 / 后"互换 */
export function classSwapRel(model, index) {
  const r = model.rels[index];
  if (!r) return false;
  const old = { a: r.a, ga: r.ga, cardA: r.cardA, start: r.start };
  r.a = r.b; r.ga = r.gb; r.cardA = r.cardB; r.start = r.end;
  r.b = old.a; r.gb = old.ga; r.cardB = old.cardA; r.end = old.start;
  r.op = relOpFor(r.start, r.end, r.dashed) || r.op;
  r.dirty = true;
  return true;
}

export function classSetRelLabel(model, index, text) {
  const r = model.rels[index];
  if (!r) return false;
  r.label = encodeRelationLabel(text);
  r.dirty = true;
  return true;
}

/* 基数:去引号、单行;空串 = 清除 */
export function classSetCard(model, index, which, text) {
  const r = model.rels[index];
  if (!r) return false;
  const t = String(text || '').replace(/["'\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (which === 'a') r.cardA = t; else r.cardB = t;
  r.dirty = true;
  return true;
}

export function classSetDirection(model, d) {
  model.direction = d;
  const item = model.items.find((x) => x.t === 'dir');
  if (item) item.value = d;
  else model.items.push({ t: 'dir', value: d });
  return true;
}

export const CLASS_LABELS = {
  rels: REL_TYPES.reduce((o, [key, name]) => { o[key] = name; return o; }, {}),
  relTips: REL_TYPE_TIPS,
  relNames: REL_TYPES.reduce((o, [key, , spec]) => { o[key] = relOpFor(spec.start, spec.end, spec.dashed); return o; }, {})
};
