/**
 * 公式对话框 + 公式写入(2026-11-24 重写,用户报"选公式后没弹输入框、给出 E=mc^2 不能改、只见源码")。
 *
 * 入口与落点:
 *   工具栏「公式」/ 斜杠「公式·行内 / 公式·块级」/ 选中公式后的上下文条与双击 → 光标处
 *   行柄「+」→ 公式 → 该块之后(空段落则原位替换),块级公式落在文末时其后补空段落
 * 已选中的公式节点(节点选区)进入即编辑:原位更新并保持选中,上下文条不消失。
 *
 * 对话框 = 输入框 + 符号面板(点选即写入 LaTeX)+ 实时预览;Ctrl/⌘+Enter 确认。
 */
import { h, dialog, toast, field } from './dom.js';
import { katexReady, loadKatex } from './katex.js';
import { MATH_TYPES } from './math-nodeview.js';
import { isBlankParagraph, slotRange, settleAfterBlock } from './insert-slot.js';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

/* 符号面板:label=按钮显示,tex=写入源码(首个 {} 为待填位:有选区时填入选区,否则选中待替换),
   title=悬停说明 */
const SYM = (label, tex, title) => ({ label, tex, title: title || tex });
/* [按钮显示, LaTeX 命令名] */
const GREEK = [
  ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ϵ', 'epsilon'], ['ε', 'varepsilon'], ['ζ', 'zeta'], ['η', 'eta'],
  ['θ', 'theta'], ['ϑ', 'vartheta'], ['κ', 'kappa'], ['λ', 'lambda'], ['μ', 'mu'], ['ν', 'nu'], ['ξ', 'xi'], ['π', 'pi'],
  ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['υ', 'upsilon'], ['ϕ', 'phi'], ['φ', 'varphi'], ['χ', 'chi'], ['ψ', 'psi'], ['ω', 'omega'],
  ['Γ', 'Gamma'], ['Δ', 'Delta'], ['Θ', 'Theta'], ['Λ', 'Lambda'], ['Ξ', 'Xi'], ['Π', 'Pi'], ['Σ', 'Sigma'], ['Φ', 'Phi'],
  ['Ψ', 'Psi'], ['Ω', 'Omega'], ['Υ', 'Upsilon']
];

export const PALETTE = [
  ['常用', [
    SYM('x²', '^{}', '上标'), SYM('x₂', '_{}', '下标'), SYM('分式', '\\frac{}{}', '分式 \\frac{分子}{分母}'), SYM('根式', '\\sqrt{}', '根式 \\sqrt{}'),
    SYM('∑', '\\sum_{}^{}', '求和'), SYM('∏', '\\prod_{}^{}', '连乘'), SYM('∫', '\\int_{}^{}', '积分'), SYM('lim', '\\lim_{}', '极限'),
    SYM('∞', '\\infty'), SYM('∂', '\\partial'), SYM('∇', '\\nabla'),
    SYM('±', '\\pm'), SYM('∓', '\\mp'), SYM('×', '\\times'), SYM('÷', '\\div'), SYM('·', '\\cdot'),
    SYM('≤', '\\le'), SYM('≥', '\\ge'), SYM('≠', '\\ne'), SYM('≈', '\\approx'), SYM('≡', '\\equiv'),
    SYM('→', '\\to'), SYM('∈', '\\in'), SYM('∉', '\\notin'), SYM('∅', '\\varnothing'), SYM('∀', '\\forall'), SYM('∃', '\\exists'),
    SYM('…', '\\dots'), SYM('⋯', '\\cdots'), SYM('°', '^\\circ'), SYM('′', "'")
  ]],
  ['希腊字母', GREEK.map(([label, name]) => SYM(label, '\\' + name, '\\' + name))],
  ['运算关系', [
    SYM('∗', '\\ast'), SYM('⋆', '\\star'), SYM('∘', '\\circ'), SYM('∙', '\\bullet'), SYM('⊕', '\\oplus'), SYM('⊗', '\\otimes'),
    SYM('∩', '\\cap'), SYM('∪', '\\cup'), SYM('⊂', '\\subset'), SYM('⊃', '\\supset'), SYM('⊆', '\\subseteq'), SYM('⊇', '\\supseteq'),
    SYM('∝', '\\propto'), SYM('⊥', '\\perp'), SYM('∥', '\\parallel'), SYM('∠', '\\angle'), SYM('∵', '\\because'), SYM('∴', '\\therefore'),
    SYM('¬', '\\neg'), SYM('∧', '\\wedge'), SYM('∨', '\\vee'), SYM('∼', '\\sim'), SYM('≃', '\\simeq'),
    SYM('≪', '\\ll'), SYM('≫', '\\gg'), SYM('∤', '\\nmid'), SYM('ℏ', '\\hbar'), SYM('ℓ', '\\ell')
  ]],
  ['箭头', [
    SYM('→', '\\to'), SYM('←', '\\leftarrow'), SYM('↔', '\\leftrightarrow'), SYM('⇒', '\\Rightarrow'), SYM('⇐', '\\Leftarrow'),
    SYM('⇔', '\\Leftrightarrow'), SYM('↦', '\\mapsto'), SYM('↑', '\\uparrow'), SYM('↓', '\\downarrow'), SYM('⇀', '\\rightharpoonup'),
    SYM('⟶', '\\longrightarrow'), SYM('⟹', '\\Longrightarrow'), SYM('↩', '\\hookleftarrow'), SYM('⤳', '\\rightsquigarrow'), SYM('↝', '\\leadsto')
  ]],
  ['修饰结构', [
    SYM('上划线', '\\overline{}'), SYM('下划线', '\\underline{}'), SYM('向量', '\\vec{}'), SYM('粗体', '\\boldsymbol{}'),
    SYM('尖帽', '\\hat{}'), SYM('上波浪', '\\tilde{}'), SYM('上点', '\\dot{}'), SYM('上横点', '\\bar{}'),
    SYM('大括号', '\\left\\{\\right\\}'), SYM('自适应()', '\\left(\\right)'), SYM('绝对值', '\\left|\\right|'),
    SYM('下括注', '\\underbrace{}_{}'), SYM('上括注', '\\overbrace{}^{}'),
    SYM('方程组', '\\begin{cases}\n  \\\\\n\\end{cases}', '方程组 cases'),
    SYM('多行对齐', '\\begin{aligned}\n  &\n\\end{aligned}', '多行对齐 aligned'),
    SYM('矩阵', '\\begin{pmatrix}\n  & \\\\\n  & \n\\end{pmatrix}', '矩阵 pmatrix')
  ]]
];

/* 取位置处的节点;位置越界(文档在对话框打开期间变短等)返回 null,不抛异常 */
function safeNodeAt(doc, pos) {
  return pos >= 0 && pos <= doc.content.size ? doc.nodeAt(pos) : null;
}

/* 文档里找到刚写入的节点位置(节点对象不可变,原样写入即同一引用) */
function findNode(doc, node) {
  let found = null;
  doc.descendants((n, p) => { if (found === null && n === node) found = p; });
  return found;
}

/**
 * 把公式写入文档(一个事务)。
 * @param {Editor} ed
 * @param {string} tex
 * @param {boolean} block  块级(true)/行内(false)
 * @param {{pos:number,node:Node}|null} editing  原位更新;保持节点选中
 * @param {{blockPos:number}} [placement]  行柄入口:相对该块落位;缺省为光标处
 * @returns {number|null} 公式节点位置
 */
export function applyMath(ed, tex, block, editing, placement) {
  const wantBlock = !!block;
  let result = null;
  ed.chain().focus().command(({ tr }) => {
    const nodes = tr.doc.type.schema.nodes;
    const fresh = nodes[wantBlock ? 'lryMathBlock' : 'lryMathInline'].create({ tex });
    /* 编辑位置越界/目标已不在 一律按新插入处理 */
    const cur = editing ? safeNodeAt(tr.doc, editing.pos) : null;
    if (cur && MATH_TYPES.includes(cur.type.name)) {
      const pos = editing.pos;
      if ((cur.type.name === 'lryMathBlock') === wantBlock) {
        /* 同形态:只改属性。被选中的节点被替换后 PM 会把节点选区降级成光标,须显式恢复 */
        tr.setNodeMarkup(pos, undefined, { tex });
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        result = pos;
      } else if (wantBlock) {
        /* 行内 → 块级。公式是所在段落的唯一内容且外层容得下块级节点 → 整段换成公式
           (直接在段内替换会断出一个空段落留在上方;列表项必须以段落开头,不能这样换);
           否则段落从公式处断开,公式独立成块 */
        const $pos = tr.doc.resolve(pos);
        const para = $pos.parent;
        const at = $pos.before($pos.depth);
        const alone = para.type.name === 'paragraph' && para.childCount === 1
          && $pos.node(-1).canReplaceWith($pos.index(-1), $pos.index(-1) + 1, fresh.type);
        if (alone) {
          tr.replaceWith(at, at + para.nodeSize, fresh);
          result = at;
        } else {
          tr.replaceWith(pos, pos + cur.nodeSize, fresh);
          result = findNode(tr.doc, fresh);
          if (result === null) result = pos + ($pos.parentOffset > 0 ? 1 : 0);
        }
        tr.setSelection(NodeSelection.create(tr.doc, result));
      } else {
        /* 块级 → 行内:原位换成空段落,公式放进去(块边界上的行内内容交给 PM 自行包裹不可靠) */
        tr.replaceWith(pos, pos + cur.nodeSize, nodes.paragraph.create());
        tr.insert(pos + 1, fresh);
        result = pos + 1;
        tr.setSelection(NodeSelection.create(tr.doc, result));
      }
      return true;
    }
    const anchor = placement && typeof placement.blockPos === 'number' ? safeNodeAt(tr.doc, placement.blockPos) : null;
    if (anchor && wantBlock) {
      const slot = slotRange(anchor, placement.blockPos);
      tr.replaceWith(slot.from, slot.to, fresh);
      result = slot.from;
      settleAfterBlock(tr, slot.from, fresh.nodeSize);
    } else if (anchor) {
      const end = placement.blockPos + anchor.nodeSize;
      if (anchor.isTextblock && !anchor.type.spec.code) {
        /* 行柄入口的行内公式:追加到该块文本末尾 */
        tr.insert(end - 1, fresh);
        result = end - 1;
      } else {
        /* 非文本块(表格/画板/代码块等):其后新起一段 */
        tr.insert(end, nodes.paragraph.create(null, fresh));
        result = end + 1;
      }
      tr.setSelection(TextSelection.create(tr.doc, result + fresh.nodeSize));
    } else {
      /* 光标处(有选区则替换选区) */
      let { from, to } = tr.selection;
      const $from = tr.doc.resolve(from);
      if ($from.parent.type.spec.code) {
        /* 代码块内:行内公式放不进去;块级公式落到代码块之后,不拆散代码 */
        if (!wantBlock) { toast('代码块内不能插入行内公式', 'error'); return false; }
        from = to = $from.after($from.depth);
      } else if (wantBlock && tr.selection.empty && isBlankParagraph($from.parent)) {
        /* 空段落里插块级公式:占据这一段(直接插入会把空段落从中间断开,上方留一个空行) */
        from = $from.before($from.depth);
        to = $from.after($from.depth);
      }
      tr.replaceWith(from, to, fresh);
      result = findNode(tr.doc, fresh);
      if (result === null) result = from;
      if (wantBlock) settleAfterBlock(tr, result, fresh.nodeSize);
      else tr.setSelection(TextSelection.create(tr.doc, result + fresh.nodeSize));
    }
    return true;
  }).run();
  return result;
}

/** 选中的公式切换行内/块级(上下文条按钮) */
export function setMathForm(ed, block) {
  const sel = ed.state.selection;
  if (!(sel instanceof NodeSelection) || MATH_TYPES.indexOf(sel.node.type.name) < 0) return false;
  if ((sel.node.type.name === 'lryMathBlock') === !!block) return false;
  return applyMath(ed, sel.node.attrs.tex, block, { pos: sel.from, node: sel.node }) !== null;
}

/** 当前选区是否正是公式节点 */
export function selectedMath(ed) {
  const sel = ed.state.selection;
  return sel instanceof NodeSelection && MATH_TYPES.indexOf(sel.node.type.name) >= 0
    ? { pos: sel.from, node: sel.node } : null;
}

/**
 * 打开公式对话框。
 * @param {object} target  LRYEditor 实例或 Tiptap Editor
 * @param {{mode?:'inline'|'block', blockPos?:number}} [opts]  初始形式;blockPos=行柄入口的锚块位置
 */
export function openFormulaDialog(target, opts) {
  const ed = target && target.editor ? target.editor : target;
  opts = opts || {};
  /* 带锚块位置的行柄入口永远是"新插入":上一个公式编辑后仍处于选中态,不能因此把它当成编辑对象 */
  const editing = opts.blockPos === undefined ? selectedMath(ed) : null;

  const ta = h('textarea', { class: 'lry-input lry-formula-src', rows: 4, spellcheck: 'false',
    placeholder: '输入 LaTeX,如 E=mc^2、\\frac{a}{b}、\\sum_{i=1}^n i' });
  ta.value = editing ? editing.node.attrs.tex : '';
  let block = editing ? editing.node.type.name === 'lryMathBlock' : opts.mode !== 'inline';

  const preview = h('div', { class: 'lry-formula-preview' });
  let renderSeq = 0;
  const render = () => {
    const seq = ++renderSeq;
    const tex = ta.value.trim();
    if (!tex) { preview.classList.remove('lry-formula-error'); preview.innerHTML = '<span class="lry-formula-empty">实时预览——输入 LaTeX 或点下方符号</span>'; return; }
    if (!katexReady()) {
      preview.classList.remove('lry-formula-error');
      preview.textContent = '正在加载公式引擎…';
      loadKatex().then(() => { if (seq === renderSeq) render(); })
        .catch(() => { if (seq === renderSeq) { preview.textContent = '公式引擎加载失败,无法预览(不影响插入)'; preview.classList.add('lry-formula-error'); } });
      return;
    }
    try {
      preview.innerHTML = '';
      const span = document.createElement('span');
      window.katex.render(tex, span, { throwOnError: true, displayMode: block, output: 'html' });
      preview.appendChild(span);
      preview.classList.remove('lry-formula-error');
    } catch (e) {
      preview.textContent = '公式有误:' + e.message;
      preview.classList.add('lry-formula-error');
    }
  };

  /* 形式:行内 / 块级 分段开关 */
  const segInline = h('button', { type: 'button', class: 'lry-seg-btn', onclick: () => setForm(false) }, '行内公式');
  const segBlock = h('button', { type: 'button', class: 'lry-seg-btn', onclick: () => setForm(true) }, '块级公式');
  const setForm = (b) => { block = b; segInline.classList.toggle('lry-seg-on', !b); segBlock.classList.toggle('lry-seg-on', b); render(); };
  setForm(block);

  /* 符号面板:点选写入源码;按下不抢焦点,保住输入框的光标/选区。
     模板里的首个 {} 是待填位:有选区时填入选区内容;否则光标落进花括号里面,接着输入即填入分子/上标 */
  const pick = (tex) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const picked = s !== e ? ta.value.slice(s, e) : '';
    let out = tex;
    if (picked && out.indexOf('{}') >= 0) out = out.replace('{}', '{' + picked + '}'); /* 选区内容填进花括号里 */
    const hole = out.indexOf('{}');
    ta.setRangeText(out, s, e, 'end');
    const caret = !picked && hole >= 0 ? s + hole + 1 : s + out.length;
    ta.setSelectionRange(caret, caret);
    ta.focus();
    render();
  };
  const tabs = h('div', { class: 'lry-tabs lry-formula-tabs' });
  const grid = h('div', { class: 'lry-formula-grid' });
  let tabIdx = 0;
  const drawPalette = () => {
    [...tabs.children].forEach((c, i) => c.classList.toggle('lry-tab-active', i === tabIdx));
    grid.textContent = '';
    PALETTE[tabIdx][1].forEach((sym) => {
      grid.appendChild(h('button', {
        type: 'button', class: 'lry-formula-sym', title: sym.title,
        onmousedown: (ev) => ev.preventDefault(),
        onclick: () => pick(sym.tex)
      }, sym.label));
    });
  };
  PALETTE.forEach(([name], i) => {
    tabs.appendChild(h('button', { type: 'button', class: 'lry-tab', onclick: () => { tabIdx = i; drawPalette(); } }, name));
  });
  drawPalette();
  ta.addEventListener('input', render);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirm(); }
  });

  const confirm = () => {
    const tex = ta.value.trim();
    if (!tex) { toast('请输入公式', 'error'); return false; }
    applyMath(ed, tex, block, editing, opts.blockPos === undefined ? null : { blockPos: opts.blockPos });
    /* 对话框框架不自动关闭:不关的话再点一次「插入」会重复插入(旧实现即如此) */
    api.close();
    return true;
  };
  const api = dialog({
    title: editing ? '编辑公式' : '插入公式', width: '560px',
    body: h('div', { class: 'lry-formula' },
      field('LaTeX 源码', ta),
      h('div', { class: 'lry-formula-palette' }, tabs, grid),
      h('div', { class: 'lry-field' },
        h('span', { class: 'lry-field-label' }, '形式'),
        h('div', { class: 'lry-seg' }, segInline, segBlock)),
      field('预览', preview),
      h('div', { class: 'lry-tip' }, 'Ctrl / ⌘ + Enter 确认;发布后与预览一致。常用:上下标 ^ _ 、分式 \\frac{}{}、根式 \\sqrt{}')),
    okText: editing ? '更新' : '插入',
    onOk() { return confirm(); }
  });
  render();
  return api;
}
