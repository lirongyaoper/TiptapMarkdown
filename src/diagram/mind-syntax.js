/**
 * Mermaid 思维导图 ⇄ 树(v1.3.0 可视化画布的语法层)。纯函数,无 DOM 依赖。
 *
 * mindmap 语法 = 一行一个节点,缩进表示层级;渲染结果里的节点按行序编号(node_0、node_1…)、
 * 连线为 edge_<父序号>_<子序号>(实测 12.3.0),所以树的先序序号直接对应到图上的节点。
 *
 * 只有根节点算"整图读不出"以外的硬约束:多个根、缩进乱到找不到父节点、markdown 反引号块等 → { ok:false }。
 * 注释行、指令行原样保留;节点的形状定界与图标后缀(::fa(...) / ::icon(...))原样保留。
 *
 * 文字规则(用 Mermaid 自身解析器实测):
 *   无框默认节点:文字可含括号、方括号、井号、尖括号,但不能以 ( [ ) { 开头;
 *   带定界的节点([x] (x) ((x)) {{x}} …):文字含括号/方括号/花括号时必须加引号,引号内的引号写 #quot;。
 */

const HEAD_RE = /^mindmap\s*$/i;
const FORMS = [
  { open: '((', close: '))', shape: 'circle' },
  { open: '))', close: '((', shape: 'bang' },
  { open: ')', close: '(', shape: 'cloud' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[', close: ']', shape: 'square' },
  { open: '(', close: ')', shape: 'rounded' }
];
const SHAPE_LABELS = { default: '无框', square: '方块', rounded: '圆角', circle: '圆形', bang: '爆炸形', cloud: '云形', hexagon: '六边形' };

const decode = (s) => String(s || '').trim().replace(/<br\s*\/?>/gi, '\n').replace(/#quot;/gi, '"').replace(/#amp;/gi, '&').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/<[^>]+>/g, '').trim();
const SHAPE_CHARS = /[()\[\]{}"]/;

/**
 * 一行节点 → { id, text, shape, suffix };读不出返回 null。
 * 行 = [id] + 形状(描述) [+ ::后缀],或 纯 id 文字(无框节点,显示的就是这串文字)。
 * ASCII 括号/方括号/花括号一律是定界符:要点(一) 在 Mermaid 里显示的是"一"。
 * @returns {{id:string,text:string,shape:string,suffix:string}|null}
 */
export function readMindNode(content) {
  if (!content || content[0] === '`' || content[0] === '"') return null; /* markdown 串/整行引号:不建模 */
  /* ::后缀(图标/类)优先于形状:图标写法里自带括号(::fa(fa fa-book)),不能当成定界 */
  const suf = content.indexOf('::');
  if (suf >= 0) {
    const head = readMindNode(content.slice(0, suf));
    return head ? Object.assign(head, { suffix: content.slice(suf) }) : null;
  }
  for (let i = 0; i < content.length; i++) {
    const two = content.slice(i, i + 2);
    const f = two === '((' ? FORMS[0] : two === '))' ? FORMS[1] : two === '{{' ? FORMS[3]
      : content[i] === ')' ? FORMS[2] : content[i] === '[' ? FORMS[4] : content[i] === '(' ? FORMS[5] : null;
    if (!f) continue;
    const inner = content.slice(i + f.open.length);
    let text, rest;
    if (inner[0] === '"') {
      /* 引号描述:里面可以有括号;闭合引号后必须紧跟形状的闭合定界 */
      const q = inner.indexOf('"', 1);
      if (q < 0 || !inner.startsWith(f.close, q + 1)) return null;
      text = inner.slice(1, q);
      rest = inner.slice(q + 1 + f.close.length);
    } else {
      const at = inner.indexOf(f.close);
      if (at < 0) return null;
      text = inner.slice(0, at);
      rest = inner.slice(at + f.close.length);
    }
    if (rest && !rest.startsWith('::')) return null; /* 定界后只允许图标/类后缀 */
    return { id: content.slice(0, i).trim(), text: decode(text), shape: f.shape, suffix: rest || '' };
  }
  /* 无框节点:整行就是显示的文字。写不回无框形态的文字(含 ASCII 括号等)在读取时就算作方块,
     与 writeMindNode 的生成规则一致,保证往返稳定 */
  const text = decode(content);
  return { id: '', text, shape: needsBox(text) ? 'square' : 'default', suffix: '' };
}

/* 无框形态容不下的文字 */
function needsBox(t) {
  return !t || SHAPE_CHARS.test(t) || t[0] === '<' || /%%/.test(t);
}

const cleanText = (t) => String(t === undefined || t === null ? '' : t).replace(/\r\n?/g, '\n').replace(/^[ \t]+|[ \t]+$/g, '').replace(/\n{3,}/g, '\n\n').replace(/\n/g, '<br/>').replace(/`/g, "'");
const quotedText = (t) => '"' + t.replace(/"/g, '#quot;') + '"';

/**
 * 节点 → 一行。
 * 无框节点:文字里不能有 ASCII 括号类字符(它们是定界符)、不能以引号/尖括号/反引号起头、不能为空;
 * 不满足时改写成方块 + 引号描述(形如 ["要点(一)"]),文字保真、只是多个框。
 */
export function writeMindNode(n) {
  const t = cleanText(n.text);
  const suffix = n.suffix || '';
  if (n.shape === 'default' && !needsBox(t)) return t + suffix;
  if (n.shape === 'default') return '["' + (t || ' ').replace(/"/g, '#quot;') + '"]' + suffix;
  const f = FORMS.find((x) => x.shape === n.shape) || FORMS[4];
  return (n.id || '') + f.open + (!t || SHAPE_CHARS.test(t) ? quotedText(t || ' ') : t) + f.close + suffix;
}

export function parseMind(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let headIdx = -1;
  const lead = [];
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k].trim();
    if (!t) continue;
    if (HEAD_RE.test(t)) { headIdx = k; break; }
    if (t.indexOf('%%') === 0) { lead.push(t); continue; }
    return { ok: false, reason: 'not-mind' };
  }
  if (headIdx < 0) return { ok: false, reason: 'not-mind' };

  const model = { kind: 'mind', lead, pre: [], post: [], root: null, unit: '  ', base: '', warnings: [] };
  let root = null;
  let stack = []; /* [缩进宽度, 节点] */
  let minDiff = Infinity;
  let tabs = true;
  let sawNode = false;
  for (let k = headIdx + 1; k < lines.length; k++) {
    const line = lines[k].replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (line.trim().indexOf('%%') === 0) { (sawNode ? model.post : model.pre).push(line.trim()); continue; }
    const ws = /^[ \t]*/.exec(line)[0];
    if (ws && !/^\t+$/.test(ws)) tabs = false;
    const width = ws.length;
    const parsed = readMindNode(line.trim());
    if (!parsed) return { ok: false, reason: 'unsupported', line: k + 1 };
    const node = { id: parsed.id, text: parsed.text, shape: parsed.shape, suffix: parsed.suffix, children: [] };
    sawNode = true;
    while (stack.length && stack[stack.length - 1][0] >= width) stack.pop();
    if (!stack.length) {
      if (root) return { ok: false, reason: 'multi-root', line: k + 1 };
      root = node;
      model.base = ws; /* 根节点原有的缩进原样保留,重写源码时不做无谓改写 */
    } else {
      const [pw, parent] = stack[stack.length - 1];
      minDiff = Math.min(minDiff, width - pw);
      parent.children.push(node);
    }
    stack.push([width, node]);
  }
  if (!root) return { ok: false, reason: 'no-root' };
  model.root = root;
  model.unit = tabs ? '\t' : ' '.repeat(Math.max(2, minDiff === Infinity ? 2 : minDiff));
  return { ok: true, model };
}

/** 先序列表(= 渲染结果里的 node_序号 顺序) */
export function flattenMind(root) {
  const out = [];
  (function walk(n, depth, parent) {
    out.push({ node: n, depth, parent });
    n.children.forEach((c) => walk(c, depth + 1, n));
  })(root, 0, null);
  return out;
}

export function serializeMind(model) {
  const out = [...model.lead, 'mindmap', ...model.pre];
  flattenMind(model.root).forEach(({ node, depth }) => out.push(model.base + model.unit.repeat(depth) + writeMindNode(node)));
  out.push(...model.post);
  return out.join('\n');
}

/** 节点在父级中的上一个/下一个兄弟(没有返回 null) */
export function sibling(node, dir, root) {
  let found = null;
  (function walk(n, parent) {
    if (found) return;
    if (n === node) { found = { parent, list: parent ? parent.children : null }; return; }
    n.children.forEach((c) => walk(c, n));
  })(root, null);
  if (!found || !found.list) return null;
  const i = found.list.indexOf(node);
  return found.list[i + dir] || null;
}

/** 从树里摘除一个节点(连同子树);根节点不可摘 */
export function detachMind(node, root) {
  let done = false;
  (function walk(n) {
    if (done) return;
    const i = n.children.indexOf(node);
    if (i >= 0) { n.children.splice(i, 1); done = true; return; }
    n.children.forEach(walk);
  })(root);
  return done;
}

export function containsMind(ancestor, node) {
  if (ancestor === node) return true;
  return ancestor.children.some((c) => containsMind(c, node));
}

export const MIND_LABELS = { shapes: SHAPE_LABELS };
