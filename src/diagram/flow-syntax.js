/**
 * Mermaid 流程图 ⇄ 结构模型(v1.3.0 可视化画布的语法层)。纯函数,无 DOM 依赖。
 *
 * 生成原则:按原稿的语句顺序**原位重建**,不重新组织源码。
 *   Mermaid 对语句先后是敏感的(实测 12.3.0):linkStyle 写在任何连线之前会直接内部崩溃、
 *   class X 写在 X 的定义之前不生效、嵌套 subgraph 的包含关系取决于书写位置。
 *   所以模型保留一份"顶层语句序列"(items):子图块 / 连线语句 / 纯定义语句 / 原样行,
 *   每个节点的定义只写在它**首次出现**的那条语句里,其余位置只写 id。
 *   不编辑的图做一次往返,产物与原稿几乎逐行相同。
 *
 * 只建模画布能编辑的部分:
 *   节点 { id, label, shape, fill, styleRest, first, group }   按首次出现的顺序
 *   连线 { from, to, label, type, comment }                     按文本顺序(linkStyle 按序号索引连线)
 *   单节点 style 行里的 fill 归模型(配色),其余声明留在原行里
 * 其余语句(classDef / class / linkStyle / click / 注释 / 指令 / direction…)逐行原样保留、留在原位:
 * 认不出的写法不会丢,对应的节点/连线只是不能在图上操作,图照常渲染。
 * 头行不是 graph/flowchart 时返回 { ok:false },调用方落到源码模式。
 *
 * 连线形态受支持的范围:
 *   -->  ---  -.->  ==>  --o  --x   可带 |文字| 或居中文字( -- 文字 --> / -. 文字 .-> / == 文字 ==> )
 *   多级链 A --> B --> C,扇出 A & B --> C & D(生成时一条连线一行)
 * 文字里的引号:Mermaid 引号串内不接受 \" 转义,须写实体 #quot;(实测)。
 */

const HEAD_RE = /^(graph|flowchart)\s+(TD|TB|LR|RL|BT)\s*$/i;
const SUBGRAPH_RE = /^subgraph\b\s*(.*)$/i;
const STYLE_RE = /^style\s+([^\s,]+)\s+(.+)$/;
const DIRECTION_RE = /^direction\s+(TD|TB|LR|RL|BT)\s*$/i;
/* 这些语句画布不建模,但 Mermaid 认识:原样保留、不提示 */
const EXTRA_RE = /^(classDef|class|linkStyle|click|accTitle|accDescr|href|call|default)\b/i;
/* 声明以逗号或分号分隔;fill 归模型(配色),其余声明原样留在 style 行里 */
const FILL_RE = /(^|[;,])\s*fill\s*:\s*([^,;]+?)\s*(?=[,;]|$)/i;

/* 画布可切换的九种形状:open/close 为 Mermaid 定界 */
export const SHAPES = {
  rect: { open: '[', close: ']' },
  rounded: { open: '(', close: ')' },
  stadium: { open: '([', close: '])' },
  diamond: { open: '{', close: '}' },
  circle: { open: '((', close: '))' },
  para: { open: '[/', close: '/]' },
  sub: { open: '[[', close: ']]' },
  db: { open: '[(', close: ')]' },
  hex: { open: '{{', close: '}}' }
};
const SHAPE_LABELS = { rect: '矩形', rounded: '圆角', stadium: '胶囊', diamond: '菱形', circle: '圆形', para: '平行四边形', sub: '子程序', db: '数据库', hex: '六边形' };

export const EDGE_TYPES = ['arrow', 'line', 'dotted', 'thick', 'circle', 'cross'];
const EDGE_OP = { arrow: '-->', line: '---', dotted: '-.->', thick: '==>', circle: '--o', cross: '--x' };
const EDGE_LABELS = { arrow: '实线箭头', line: '实线无箭头', dotted: '虚线', thick: '粗线', circle: '圆端点', cross: '叉端点' };

/* ---------- 文字编解码 ---------- */

/** 标签文字(源码形态)→ 编辑用纯文本 */
export function decodeLabel(raw) {
  let s = String(raw || '').trim();
  const q = /^"([\s\S]*)"$/.exec(s);
  if (q) s = q[1];
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#quot;/gi, '"')
    .replace(/#amp;/gi, '&')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** 编辑用纯文本 → 源码形态。空文字 Mermaid 不接受,用一个空格占位 */
export function encodeLabel(text) {
  let s = String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n').replace(/^[ \t]+|[ \t]+$/g, '').replace(/\n{3,}/g, '\n\n');
  s = s.replace(/\n/g, '<br/>').replace(/"/g, '#quot;').replace(/`/g, "'");
  const safe = /^[^\s"(){}\[\]|;#<>&=\-]{1,40}$/.test(s);
  if (!s) return '" "';
  return safe ? s : '"' + s + '"';
}

/* 连线文字:Mermaid 不接受空管道(-->||);含括号/竖线/分号等须加引号(实测),引号写成 #quot; */
function encEdgeLabel(text) {
  const t = String(text || '').replace(/\r\n?|\n/g, ' ').replace(/^[ ]+|[ ]+$/g, '');
  if (!t) return '';
  return /[()\[\]{}|;"<>]/.test(t) ? '"' + t.replace(/"/g, '#quot;') + '"' : t;
}

function readUntil(s, i, close) {
  let out = '';
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      const e = s.indexOf('"', i + 1);
      if (e < 0) return null;
      out += s.slice(i, e + 1);
      i = e;
      continue;
    }
    if (c === close) return { text: out, end: i + 1 };
    out += c;
  }
  return null;
}

/* ---------- 读取节点引用 ---------- */
/* id:到空白、定界符、连线起点(-- -. ==)为止;可含单个连字符与中文 */
const ID_RE = /^(?:(?!--|-\.|==)[^\s\[\](){}<>&|="@])+/;
/* 方括号族的定界形态(由特殊到一般)。shape 为 raw 的(反向平行四边形等)原样保留定界,画布不给切换 */
const BRACKET_FORMS = [
  { open: '[(', close: ')', tail: ']', shape: 'db' },
  { open: '[[', close: ']', tail: ']', shape: 'sub' },
  { open: '[/', close: '/', tail: ']', shape: 'para' },
  { open: '[\\', close: '\\', tail: ']', shape: 'raw' },
  { open: '[/', close: '\\', tail: ']', shape: 'raw' },
  { open: '[\\', close: '/', tail: ']', shape: 'raw' },
  { open: '[', close: ']', tail: '', shape: 'rect' }
];

/**
 * 读一个节点引用:id + 可选的形状定界。认不出返回 null。
 * @returns {{id:string,label:string,shape:string,start:number,end:number,open?:string,close?:string}|null}
 */
export function readNode(s, i) {
  const m = ID_RE.exec(s.slice(i));
  if (!m) return null;
  const id = m[0];
  let j = i + id.length;
  const first = s[j];
  const ref = { id, label: id, shape: 'bare', start: i };
  const finish = (shape, open, close, inner, end) => {
    ref.shape = shape; ref.label = decodeLabel(inner);
    if (open !== undefined) { ref.open = open; ref.close = close; }
    ref.end = end;
    return ref;
  };
  if (first === '[') {
    for (const f of BRACKET_FORMS) {
      if (s.lastIndexOf(f.open, j) !== j) continue;
      const r = readUntil(s, j + f.open.length, f.close);
      if (!r || (f.tail && s[r.end] !== f.tail)) continue;
      return finish(f.shape, f.open, f.close + f.tail, r.text, r.end + f.tail.length);
    }
    return null;
  }
  if (first === '(') {
    if (s[j + 1] === '(') {
      const r = readUntil(s, j + 2, ')');
      if (r && s[r.end] === ')') return finish('circle', '((', '))', r.text, r.end + 1);
      return null;
    }
    if (s[j + 1] === '[') {
      const r = readUntil(s, j + 2, ']');
      if (r && s[r.end] === ')') return finish('stadium', '([', '])', r.text, r.end + 1);
      return null;
    }
    const r = readUntil(s, j + 1, ')');
    return r ? finish('rounded', '(', ')', r.text, r.end) : null;
  }
  if (first === '{') {
    if (s[j + 1] === '{') {
      const r = readUntil(s, j + 2, '}');
      if (r && s[r.end] === '}') return finish('hex', '{{', '}}', r.text, r.end + 1);
      return null;
    }
    const r = readUntil(s, j + 1, '}');
    return r ? finish('diamond', '{', '}', r.text, r.end) : null;
  }
  if (first === '>') {
    const r = readUntil(s, j + 1, ']');
    return r ? finish('raw', '>', ']', r.text, r.end) : null;
  }
  ref.end = j;
  return ref;
}

/* ---------- 读取连线 ---------- */
const EDGE_START_HEAD = /^(?:-{2,}|-\.+(?:-+\.+)*-?|=+)([>xo])/;
const EDGE_START = /^(?:-{2,}|-\.+(?:-+\.+)*-?|=+)/;
/* 居中文字:-- 文字 --> / == 文字 ==> / -. 文字 .-> 。引号串整体读取(里面可以有 --) */
const EDGE_MID_TEXT = /^\s+(?:"([^"]*)"|([^|\s"][^|]*?))\s*(?:(-{2,}|-\.+(?:-+\.+)*-?|=+)([>xo])?|(\.+->))/;

/**
 * 从 i 处读一条连线。认不出返回 null。
 * @returns {{type:string,label:string,end:number}|null}
 */
export function readEdge(s, i) {
  let m = EDGE_START_HEAD.exec(s.slice(i));
  let head = '';
  let n;
  if (m) { head = m[1]; n = m[0].length; }
  else {
    m = EDGE_START.exec(s.slice(i));
    if (!m) return null;
    n = m[0].length;
  }
  const op0 = m[0];
  let j = i + n;
  let label = '';
  let dotted = op0.indexOf('.') >= 0;
  if (s[j] === '|') {
    const e = s.indexOf('|', j + 1);
    if (e < 0) return null;
    label = decodeLabel(s.slice(j + 1, e));
    j = e + 1;
  } else if (!head) {
    const t = EDGE_MID_TEXT.exec(s.slice(j));
    if (t) {
      label = decodeLabel(t[1] !== undefined ? t[1] : t[2]);
      if (t[5]) { head = '>'; dotted = true; } /* -. 文字 .-> */
      else if (t[4]) head = t[4];
      j += t[0].length;
    } else if (op0 === '--' || op0 === '-.' || op0 === '==') {
      return null; /* 只有两个短横/点/等号且没有箭头、文字:Mermaid 不认这种写法(A -- B) */
    }
  }
  const thick = op0.indexOf('=') >= 0;
  const type = head === 'x' ? 'cross' : head === 'o' ? 'circle' : head === '>' ? (dotted ? 'dotted' : thick ? 'thick' : 'arrow') : (dotted ? 'dotted' : thick ? 'thick' : 'line');
  return { type, label, end: j };
}

/* ---------- 解析 ---------- */

const skipSp = (s, i) => { while (s[i] === ' ' || s[i] === '\t') i++; return i; };

export function parseFlow(src) {
  const text = String(src || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  let headIdx = -1;
  let head = null;
  const lead = []; /* 头行之前的指令/注释(%%{init}%% 习惯写在最前),生成时仍放在头行之前 */
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k].trim();
    if (!t) continue;
    const hm = HEAD_RE.exec(t);
    if (hm) {
      head = {
        keyword: hm[1].toLowerCase() === 'graph' ? 'graph' : 'flowchart',
        direction: hm[2].toUpperCase() === 'TB' ? 'TD' : hm[2].toUpperCase()
      };
      headIdx = k;
      break;
    }
    if (t.indexOf('%%') === 0) { lead.push(t); continue; }
    break;
  }
  if (!head) return { ok: false, reason: 'not-flow' };

  const model = {
    kind: 'flow', keyword: head.keyword, direction: head.direction,
    nodes: [], edges: [], items: [], lead, warnings: [], usedNums: new Set()
  };
  const byId = Object.create(null);
  const styles = []; /* { item, id, fill, rest }:接管的单节点 style 行,解析完再落到节点上 */
  let cur = null; /* 当前所在的 subgraph(null=顶层) */
  const container = () => (cur ? cur.items : model.items);

  /* 登记节点引用。首次出现 → 记下"定义写在哪条语句里";此前只是被连线带过的裸节点、现在才给出定义 → 以定义为准 */
  const register = (ref, item) => {
    let node = byId[ref.id];
    if (!node) {
      node = byId[ref.id] = { id: ref.id, label: ref.label, shape: ref.shape, fill: null, styleRest: null, first: item, group: cur };
      if (ref.shape === 'raw') { node.open = ref.open; node.close = ref.close; }
      model.nodes.push(node);
      const nm = /^n(\d+)$/.exec(ref.id);
      if (nm) model.usedNums.add(+nm[1]);
      return { node, absorbed: false };
    }
    let absorbed = false;
    if (node.shape === 'bare' && ref.shape !== 'bare') {
      node.label = ref.label; node.shape = ref.shape;
      if (ref.shape === 'raw') { node.open = ref.open; node.close = ref.close; }
      /* 这条后置定义已被并进首次出现处,生成时不再单写一行 */
      absorbed = true;
    }
    return { node, absorbed };
  };

  /* 整句先扫读、后落库:读到一半认不出时不能留下半截节点(整行原样保留) */
  const scan = (t, comment) => {
    const refs = [];
    const edges = [];
    let i = skipSp(t, 0);
    let left = null;
    let spec = null;
    for (;;) {
      const list = [];
      for (;;) {
        const ref = readNode(t, i);
        if (!ref) return null;
        list.push(refs.push(ref) - 1);
        i = skipSp(t, ref.end);
        if (t[i] === '&') { i = skipSp(t, i + 1); continue; }
        break;
      }
      if (spec) for (const a of left) for (const b of list) edges.push({ from: refs[a].id, to: refs[b].id, type: spec.type, label: spec.label, comment: comment || '' });
      left = list;
      if (i >= t.length) return { refs, edges, text: t };
      const e = readEdge(t, i);
      if (!e) return null;
      spec = e;
      i = skipSp(t, e.end);
    }
  };

  /* 行尾注释(A --> B %% 说明)与顶层分号分段;引号/定界内的不算 */
  const cutLine = (t) => {
    let depth = 0, quoted = false, cut = -1;
    const semi = [];
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (quoted) { if (c === '"') quoted = false; continue; }
      if (c === '"') { quoted = true; continue; }
      if ('[({'.includes(c)) depth++;
      else if ('])}'.includes(c)) depth = Math.max(0, depth - 1);
      else if (c === ';' && depth === 0) semi.push(i);
      else if (c === '%' && t[i + 1] === '%' && depth === 0) { cut = i; break; }
    }
    const comment = cut >= 0 ? t.slice(cut) : '';
    const body = (cut >= 0 ? t.slice(0, cut) : t).replace(/[;\s]+$/, '');
    const parts = [];
    let start = 0;
    for (const at of semi) { if (at < body.length) { parts.push(body.slice(start, at).trim()); start = at + 1; } }
    parts.push(body.slice(start).trim());
    return { comment, parts: parts.filter(Boolean) };
  };

  const put = (it) => { const arr = container(); it.in = arr; arr.push(it); return it; };

  for (let k = headIdx + 1; k < lines.length; k++) {
    const rawT = lines[k].trim();
    if (!rawT) continue;
    if (rawT.indexOf('%%') === 0) { put({ t: 'l', text: rawT }); continue; }
    if (/^end$/i.test(rawT)) { if (cur) cur = cur.up; else put({ t: 'l', text: rawT }); continue; }
    if (SUBGRAPH_RE.test(rawT)) {
      const g = { head: rawT, items: [], up: cur };
      put({ t: 'g', g });
      cur = g;
      continue;
    }
    /* 重复的头行、direction 语句:原样留在所在位置 */
    if (HEAD_RE.test(rawT) || DIRECTION_RE.test(rawT)) { put({ t: 'l', text: rawT }); continue; }
    /* style <id> <声明>:只接管"单节点 + 含 fill"的写法(配色归模型),行留在原位、生成时重写 */
    const stm = STYLE_RE.exec(rawT);
    if (stm) {
      const fill = FILL_RE.exec(stm[2]);
      if (fill && !stm[1].includes(',')) {
        styles.push({ item: put({ t: 'l', text: rawT, styleId: stm[1] }), id: stm[1], fill: fill[2].replace(/\s*!important\s*$/i, ''), rest: stm[2].replace(FILL_RE, '$1').replace(/^[,;\s]+|[,;\s]+$/g, '') });
        continue;
      }
      put({ t: 'l', text: rawT });
      continue;
    }
    if (EXTRA_RE.test(rawT)) { put({ t: 'l', text: rawT }); continue; }
    const cut = cutLine(rawT);
    if (!cut.parts.length) continue;
    const scanned = [];
    for (const part of cut.parts) {
      const r = scan(part, cut.comment);
      if (!r) { scanned.length = 0; break; }
      scanned.push(r);
    }
    if (!scanned.length) {
      put({ t: 'l', text: rawT });
      model.warnings.push('第 ' + (k + 1) + ' 行含暂不支持在图上编辑的语法,已原样保留');
      continue;
    }
    scanned.forEach((r) => {
      const item = r.edges.length ? { t: 'e', idx: [] } : { t: 'd', refs: [] };
      r.refs.forEach((ref) => {
        const reg = register(ref, item);
        if (item.refs) item.refs.push({ node: reg.node, raw: r.text.slice(ref.start, ref.end), absorbed: reg.absorbed });
      });
      if (item.idx) r.edges.forEach((e) => item.idx.push(model.edges.push(e) - 1));
      put(item);
    });
  }
  styles.forEach((s) => {
    const n = byId[s.id];
    if (!n) { delete s.item.styleId; return; } /* 指向未知节点:整行原样保留 */
    n.fill = s.fill;
    n.styleRest = s.rest;
  });
  model.byId = byId;
  return { ok: true, model };
};

/* ---------- 生成 ---------- */

function nodeDef(n) {
  const label = encodeLabel(n.label);
  if (n.shape === 'bare' && n.label === n.id) return n.id;
  if (n.shape === 'bare') return n.id + '[' + label + ']';
  if (n.shape === 'raw') return n.id + n.open + label + n.close;
  const sh = SHAPES[n.shape] || SHAPES.rect;
  return n.id + sh.open + label + sh.close;
}

/*
 * 节点在一条语句里的写法:在它"首次出现的语句"里写定义,其余语句只写 id;
 * 同一条语句里第二次出现(链式 A --> B --> C 的 B)也只写 id。
 */
function emitter(model, item) {
  const seen = new Set();
  return (id) => {
    const node = model.byId[id];
    if (!node) return id;
    if (node.first === item && !seen.has(id)) { seen.add(id); return nodeDef(node); }
    return id;
  };
}

function edgeLine(e, write) {
  const label = encEdgeLabel(e.label);
  return write(e.from) + ' ' + EDGE_OP[e.type] + (label ? '|' + label + '|' : '') + ' ' + write(e.to) + (e.comment ? ' ' + e.comment : '');
}

function styleLine(n) {
  return 'style ' + n.id + ' fill:' + n.fill + (n.styleRest ? ',' + n.styleRest : '');
}

function emitItems(items, pad, out, model) {
  items.forEach((it) => {
    if (it.t === 'g') {
      out.push(pad + it.g.head);
      emitItems(it.g.items, pad + '  ', out, model);
      out.push(pad + 'end');
    } else if (it.t === 'e') {
      /* 这条语句里首次出现的节点(model.nodes 的顺序 = 原句里的出现顺序)。一条连线一行之后,
         若按行内联定义得到的先后与原句不一致(扇出 A & B --> C & D 会变成 A、C、B、D),
         就先按原顺序逐个定义、连线行只写 id——节点先后会影响自动排版 */
      const firsts = model.nodes.filter((n) => n.first === it);
      const inlineOrder = [];
      it.idx.forEach((i) => {
        const e = model.edges[i];
        if (!e) return;
        [e.from, e.to].forEach((id) => { if (firsts.some((n) => n.id === id) && inlineOrder.indexOf(id) < 0) inlineOrder.push(id); });
      });
      const write = emitter(model, it);
      if (inlineOrder.join() !== firsts.map((n) => n.id).join()) {
        firsts.forEach((n) => { out.push(pad + nodeDef(n)); write(n.id); });
      }
      it.idx.forEach((i) => { const e = model.edges[i]; if (e) out.push(pad + edgeLine(e, write)); });
    } else if (it.t === 'd') {
      /* 一行只写一个节点定义(多个定义挤在一行不是 Mermaid 的可靠写法);后置定义原样保留 */
      it.refs.forEach((r) => {
        if (r.absorbed || !model.byId[r.node.id]) return;
        out.push(pad + (r.node.first === it ? nodeDef(r.node) : (r.raw || r.node.id)));
      });
    } else if (it.t === 'l') {
      if (it.styleId) {
        const n = model.byId[it.styleId];
        if (!n) return; /* 节点已删除 */
        if (n.fill) out.push(pad + styleLine(n));
        else if (n.styleRest) out.push(pad + 'style ' + n.id + ' ' + n.styleRest); /* 配色改回主题默认:只留其余声明 */
      } else out.push(pad + it.text);
    }
  });
}

export function serializeFlow(model) {
  const out = [];
  out.push(...model.lead);
  out.push(model.keyword + ' ' + model.direction);
  emitItems(model.items, '', out, model);
  /* 还没有 style 行、却设了配色的节点(画布里新建或新上色):补在最后 */
  model.nodes.forEach((n) => {
    if (!n.fill) return;
    const has = (items) => items.some((it) => it.t === 'g' ? has(it.g.items) : (it.t === 'l' && it.styleId === n.id));
    if (!has(model.items)) out.push(styleLine(n));
  });
  return out.join('\n');
}

/** 下一个可用的新节点 id:n1、n2…(避开已有节点与原样语句里出现过的) */
export function nextNodeId(model) {
  const used = new Set(model.usedNums || []);
  const scan = (items) => items.forEach((it) => {
    if (it.t === 'g') scan(it.g.items);
    else if (it.t === 'l') { for (const m of it.text.matchAll(/\bn(\d+)\b/g)) used.add(+m[1]); }
    else if (it.t === 'd') { it.refs.forEach((r) => { for (const m of (r.raw || '').matchAll(/\bn(\d+)\b/g)) used.add(+m[1]); }); }
  });
  scan(model.items || []);
  let k = 1;
  while (used.has(k)) k++;
  used.add(k);
  if (model.usedNums) model.usedNums = used;
  return 'n' + k;
}

/* ---------- 模型操作(画布用;这里只动模型,文档写回由调用方收尾) ---------- */

/**
 * 加一个节点,可选同时连一条线。group 给定则写进该 subgraph 块的末尾(新节点成为它的成员)。
 * 新节点连同连线写成一条语句:`A --> n1[新节点]`。
 */
export function flowAdd(model, node, edge, group) {
  model.nodes.push(node);
  model.byId[node.id] = node;
  node.group = group || null;
  let item;
  if (edge) {
    item = { t: 'e', idx: [model.edges.push(edge) - 1] };
  } else {
    item = { t: 'd', refs: [{ node, raw: '', absorbed: false }] };
  }
  node.first = item;
  const arr = group ? group.items : model.items;
  item.in = arr;
  arr.push(item);
  return item;
}

/* 两个节点同属一个 subgraph 时,新连线写进该块;否则写在顶层末尾 */
export function flowAddEdge(model, edge, a, b) {
  const ga = a.group || null;
  const gb = b.group || null;
  const item = { t: 'e', idx: [model.edges.push(edge) - 1] };
  const arr = ga && ga === gb ? ga.items : model.items;
  item.in = arr;
  arr.push(item);
  return item;
}

/* 按谓词删连线(可同时按谓词删节点);items 里的连线序号随之重排 */
function flowPrune(model, predEdge, goneNode) {
  const keep = [];
  const map = [];
  model.edges.forEach((e, i) => {
    if (predEdge(e, i)) map[i] = -1;
    else { map[i] = keep.length; keep.push(e); }
  });
  model.edges = keep;
  const walk = (items) => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.t === 'g') { walk(it.g.items); continue; }
      if (it.t === 'e') {
        it.idx = it.idx.map((x) => map[x]).filter((x) => x >= 0);
        if (it.idx.length) continue;
        /* 这条连线语句没了:但节点可能是在这里首次定义的——换成一条纯定义语句保住定义 */
        const defs = model.nodes.filter((n) => n.first === it);
        if (defs.length) {
          const d = { t: 'd', refs: defs.map((n) => ({ node: n, raw: '', absorbed: false })), in: items };
          defs.forEach((n) => { n.first = d; });
          items[i] = d;
        } else items.splice(i, 1);
      } else if (it.t === 'd') {
        it.refs = it.refs.filter((r) => model.byId[r.node.id]);
        if (!it.refs.length) items.splice(i, 1);
      } else if (it.t === 'l' && it.styleId && goneNode && goneNode(it.styleId)) {
        items.splice(i, 1);
      }
    }
  };
  walk(model.items);
}

export function flowRemoveNode(model, id) {
  const node = model.byId[id];
  if (!node) return false;
  flowPrune(model, (e) => e.from === id || e.to === id, (sid) => sid === id);
  model.nodes = model.nodes.filter((n) => n !== node);
  delete model.byId[id];
  return true;
}

/**
 * 改接连线的一端。原端点如果是在这条连线语句里首次定义的(A[x] --> B 改接成 C --> B),
 * 定义会随语句改写而丢失:把它提成一条纯定义语句,插在原位之前。
 */
export function flowReconnect(model, index, from, to) {
  const e = model.edges[index];
  if (!e) return false;
  e.from = from;
  e.to = to;
  const rescue = (items) => {
    items.forEach((it) => {
      if (it.t === 'g') { rescue(it.g.items); return; }
      if (it.t !== 'e' || it.idx.indexOf(index) < 0) return;
      const lost = model.nodes.filter((n) => n.first === it && !it.idx.some((i) => { const x = model.edges[i]; return x && (x.from === n.id || x.to === n.id); }));
      if (!lost.length) return;
      const d = { t: 'd', refs: lost.map((n) => ({ node: n, raw: '', absorbed: false })), in: items };
      lost.forEach((n) => { n.first = d; });
      items.splice(items.indexOf(it), 0, d);
    });
  };
  rescue(model.items);
  return true;
}

export function flowRemoveEdge(model, index) {
  if (!model.edges[index]) return false;
  flowPrune(model, (e, i) => i === index, null);
  return true;
}

/**
 * 同层换序(布局里同层节点的先后取决于首次出现的先后):与定义顺序上相邻、同属一个 subgraph、
 * 且彼此没有直接连线的节点互换先后。做法是把要提前的那个节点的定义"提"到对方首次出现的语句之前,
 * 连线顺序不动(linkStyle 的序号不受影响)。@returns 换位的另一个节点,没有可换的返回 null
 */
export function flowShift(model, node, dir) {
  if (!node) return null;
  const i = model.nodes.indexOf(node);
  for (let j = i + dir; j >= 0 && j < model.nodes.length; j += dir) {
    const other = model.nodes[j];
    if (!other || (other.group || null) !== (node.group || null)) continue;
    if (model.edges.some((e) => (e.from === node.id && e.to === other.id) || (e.from === other.id && e.to === node.id))) continue;
    const mover = dir < 0 ? node : other;
    const target = dir < 0 ? other : node;
    const arr = mover.group ? mover.group.items : model.items;
    const at = arr.indexOf(target.first);
    if (at < 0) return null;
    /* 从原来的纯定义语句里摘掉(原来写在连线语句里的,那条连线自然只写 id) */
    const old = mover.first;
    if (old && old.t === 'd') {
      old.refs = old.refs.filter((r) => r.node !== mover);
      if (!old.refs.length && old.in) { const k = old.in.indexOf(old); if (k >= 0) old.in.splice(k, 1); }
    }
    const def = { t: 'd', refs: [{ node: mover, raw: '', absorbed: false }], in: arr };
    /* 插在目标语句之前;若刚摘掉的是同一个数组里更靠前的项,下标已变,重新取 */
    const at2 = arr.indexOf(target.first);
    arr.splice(at2 < 0 ? at : at2, 0, def);
    mover.first = def;
    model.nodes.splice(model.nodes.indexOf(mover), 1);
    model.nodes.splice(model.nodes.indexOf(target), 0, mover);
    return other;
  }
  return null;
}

export const FLOW_LABELS = { shapes: SHAPE_LABELS, edges: EDGE_LABELS };
