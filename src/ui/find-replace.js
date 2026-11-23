/**
 * 查找替换(2026-11-23 v1.2.0 重做)。
 *
 * - 形态:模态对话框 → 编辑器内浮动条(工具栏下方右侧),不阻断输入。定位匹配
 *   只移动文档选区、不抢焦点,回车逐个跳转;Esc 关闭并把焦点交还编辑器当前匹配处
 * - 全部匹配高亮(内联 Decoration),当前项加深
 * - 跨样式匹配:同一文本块内跨 mark 边界的词也能命中(旧实现只在单个文本节点内找)
 * - 区分大小写 / 全词 / 正则 三个开关;全部替换单事务提交(一次可撤销)
 * - 文档变化时按「当前匹配位置映射」保持高亮不跳
 *
 * collectMatches 为纯函数,单测直接断言;高亮插件经 editor.registerPlugin 挂载,
 * 关闭后随实例销毁卸载。
 */
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { h, toast, fixedTopInset } from './dom.js';

const MAX_MATCHES = 5000;
const WORD = /[\p{L}\p{N}_]/u;
const key = new PluginKey('lryFindReplace');

/**
 * 收集全部匹配。
 * @param {Node} doc
 * @param {string} query
 * @param {{caseSensitive?:boolean, wholeWord?:boolean, regex?:boolean}} opts
 * @returns {{matches:{from:number,to:number}[], error:string|null}}
 */
export function collectMatches(doc, query, opts) {
  opts = opts || {};
  const q = String(query == null ? '' : query);
  const res = { matches: [], error: null };
  if (!q) return res;
  let re = null;
  if (opts.regex) {
    try { re = new RegExp(q, 'g' + (opts.caseSensitive ? '' : 'i')); }
    catch (e) { res.error = '正则表达式有误:' + e.message; return res; }
  }
  const caseSensitive = !!opts.caseSensitive;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const starts = [];
    const base = pos + 1;
    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return;
      for (let i = 0; i < child.text.length; i++) starts.push(base + offset + i);
      text += child.text;
    });
    let hay = text;
    if (!caseSensitive && !re) {
      hay = text.toLowerCase();
      if (hay.length !== text.length) hay = text; /* 个别字符大小写换长度不等:退回区分大小写 */
    }
    const needle = caseSensitive ? q : q.toLowerCase();
    const add = (i, len) => {
      if (opts.wholeWord && ((i > 0 && WORD.test(text[i - 1])) || (i + len < text.length && WORD.test(text[i + len])))) return;
      res.matches.push({ from: starts[i], to: starts[i] + len });
    };
    if (re) {
      re.lastIndex = 0;
      let m, guard = 0;
      while ((m = re.exec(text)) && guard++ < 50000) {
        if (!m[0].length) { re.lastIndex++; continue; }
        add(m.index, m[0].length);
        if (res.matches.length >= MAX_MATCHES) break;
      }
    } else {
      let i = 0;
      for (;;) {
        const at = hay.indexOf(needle, i);
        if (at < 0) break;
        add(at, q.length);
        i = at + 1; /* 步进 1:支持重叠匹配(如 "aa" 在 "aaa" 中两处) */
        if (res.matches.length >= MAX_MATCHES) break;
      }
    }
    return false; /* 不下钻文本块子节点 */
  });
  return res;
}

/* 以 ref 位置为基准重算:当前项取 ref 及之后的第一个匹配(没有则取最后一个) */
function refresh(st, doc, ref) {
  const r = collectMatches(doc, st.query, st);
  st.doc = doc;
  st.matches = r.matches;
  st.error = r.error;
  st.decoKey = null;
  if (!st.matches.length) { st.active = -1; return; }
  let idx = st.matches.findIndex((m) => m.from >= ref);
  if (idx < 0) idx = st.matches.length - 1;
  st.active = idx;
}

function findPlugin(st) {
  return new Plugin({
    key,
    /* pos:当前匹配起点,随文档变化映射(保持高亮不跳) */
    state: {
      init: () => ({ pos: null }),
      apply(tr, value) {
        if (!tr.docChanged || value.pos == null) return value;
        return { pos: tr.mapping.map(value.pos, 1) };
      }
    },
    props: {
      decorations(state) {
        if (!st.open || !st.query) return null;
        if (st.doc !== state.doc) {
          const ps = key.getState(state);
          refresh(st, state.doc, ps && ps.pos != null ? ps.pos : state.selection.from);
        }
        const sig = st.active + ':' + st.matches.length + ':' + st.query;
        if (st.decoKey !== sig || st.decoDoc !== state.doc) {
          const decos = [];
          st.matches.forEach((m, i) => decos.push(Decoration.inline(m.from, m.to, {
            class: i === st.active ? 'lry-find-active' : 'lry-find-match'
          })));
          st.decos = decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
          st.decoKey = sig;
          st.decoDoc = state.doc;
        }
        return st.decos;
      }
    }
  });
}

export function mountFindReplace(inst) {
  const ed = inst.editor;
  const st = {
    open: false, query: '', caseSensitive: false, wholeWord: false, regex: false,
    matches: [], active: -1, error: null, doc: null, decoKey: null, decoDoc: null,
    decos: DecorationSet.empty
  };
  ed.registerPlugin(findPlugin(st));

  const qIn = h('input', { type: 'text', class: 'lry-input lry-find-q', placeholder: '查找内容', spellcheck: 'false' });
  const rIn = h('input', { type: 'text', class: 'lry-input lry-find-r', placeholder: '替换为', spellcheck: 'false' });
  const countEl = h('span', { class: 'lry-find-count' });
  const tg = (k, label, title) => {
    const b = h('button', {
      type: 'button', class: 'lry-find-tg', title,
      onclick: () => { st[k] = !st[k]; b.classList.toggle('lry-btn-active', st[k]); search(); }
    }, label);
    return b;
  };
  const nav = (label, title, fn) => h('button', { type: 'button', class: 'lry-find-tg lry-find-nav', title, onclick: fn }, label);
  const rowRep = h('div', { class: 'lry-find-rep' },
    rIn,
    h('button', { type: 'button', class: 'lry-btn', onclick: () => replaceOne() }, '替换'),
    h('button', { type: 'button', class: 'lry-btn lry-btn-primary', onclick: () => replaceAll() }, '全部替换'));
  rowRep.hidden = true;
  const bar = h('div', { class: 'lry-findbar', style: { display: 'none' } },
    h('div', { class: 'lry-find-row' },
      qIn, countEl,
      tg('caseSensitive', 'Aa', '区分大小写'),
      tg('wholeWord', '词', '全词匹配'),
      tg('regex', '.*', '正则表达式'),
      nav('↑', '上一个 (Shift+Enter)', () => go(-1)),
      nav('↓', '下一个 (Enter)', () => go(1)),
      h('button', {
        type: 'button', class: 'lry-find-tg', title: '展开/收起替换',
        onclick: () => { rowRep.hidden = !rowRep.hidden; if (!rowRep.hidden) rIn.focus(); }
      }, '替换'),
      h('button', { type: 'button', class: 'lry-find-tg', title: '关闭 (Esc)', onclick: () => close(true) }, '×')),
    rowRep);
  inst.wrapper.appendChild(bar);

  let lastQuery = '';
  let revealTimer = null;

  const contentEl = inst.wrapper.querySelector('.lry-editor-content');

  /* 定位:编辑区顶边露在(站点固定)页头之下 → 贴工具栏下方右侧(随页面滚动);
     顶边被页头遮住或滚出视口 → 固定到页头下方右侧。长文逐个跳匹配时视图会滚走,
     不固定的话查找条连同计数与替换按钮一起滚出视口(2026-11-24 浏览器实测发现)。
     本条 z-index 低于站点页头,页头下沿由 fixedTopInset() 探得 */
  const position = () => {
    if (!st.open || !contentEl) return;
    const r = contentEl.getBoundingClientRect();
    const inset = fixedTopInset();
    if (r.top >= inset) {
      bar.style.position = 'absolute';
      bar.style.top = (contentEl.offsetTop + 8) + 'px';
      bar.style.right = '12px';
    } else {
      bar.style.position = 'fixed';
      bar.style.top = (inset + 8) + 'px';
      /* 右缘对齐外框右缘内缩 12px,与绝对定位态(right:12px 相对外框)一致 */
      const wrapRight = inst.wrapper.getBoundingClientRect().right;
      bar.style.right = Math.max(12, window.innerWidth - wrapRight + 12) + 'px';
    }
  };

  /* 工具栏换行高度变化/视口缩放/页面滚动时复算 */
  const onRz = () => { if (st.open) position(); };
  window.addEventListener('resize', onRz);
  window.addEventListener('scroll', onRz, true);

  /* 高亮刷新:仅带 meta 的空事务(decorations 据此重算) */
  const bump = (pos) => {
    const tr = ed.state.tr.setMeta(key, { pos: pos == null ? null : pos });
    ed.view.dispatch(tr);
  };

  const syncCount = () => {
    countEl.textContent = st.error ? '正则有误' : (st.matches.length ? (st.active + 1) + ' / ' + st.matches.length : (st.query ? '无结果' : ''));
    countEl.classList.toggle('lry-find-err', !!st.error);
    bar.classList.toggle('lry-find-bad', !st.error && !!st.query && !st.matches.length);
  };

  const reveal = (from) => {
    try {
      const n = ed.view.domAtPos(from).node;
      const target = n.nodeType === 3 ? n.parentElement : n;
      if (target && target.scrollIntoView) {
        (window.requestAnimationFrame || setTimeout)(() => {
          try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
  };

  /* 把编辑器选区落到第 i 个匹配(不抢浮动条焦点) */
  const selectMatch = (i, takeFocus) => {
    st.active = i;
    const m = st.matches[i];
    if (!m) return;
    const tr = ed.state.tr;
    tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
    tr.setMeta(key, { pos: m.from });
    ed.view.dispatch(tr);
    if (takeFocus) ed.commands.focus();
    reveal(m.from);
    syncCount();
  };

  const ensure = () => {
    if (st.doc !== ed.state.doc) refresh(st, ed.state.doc, ed.state.selection.from);
  };

  const search = () => {
    st.query = qIn.value;
    st.doc = ed.state.doc;
    const r = collectMatches(st.doc, st.query, st);
    st.matches = r.matches;
    st.error = r.error;
    st.active = st.matches.length ? 0 : -1;
    st.decoKey = null;
    bump(st.active >= 0 ? st.matches[st.active].from : null);
    syncCount();
  };

  const go = (dir) => {
    ensure();
    const n = st.matches.length;
    if (!n) return;
    const i = st.active < 0 ? (dir > 0 ? 0 : n - 1) : (st.active + dir + n) % n;
    selectMatch(i, false);
  };

  /* 替换文本:普通文本块内不允许换行(换行符在非代码块里是非法内容),空格代替;
     代码块内保留换行 */
  const repAt = (from) => {
    const v = rIn.value;
    const $p = ed.state.doc.resolve(from);
    return $p.parent.type.spec.code ? v : v.replace(/[\r\n]+/g, ' ');
  };

  const replaceOne = () => {
    ensure();
    const m = st.matches[st.active];
    if (!m) { toast('没有可替换的匹配', 'error'); return; }
    const rep = repAt(m.from);
    const tr = ed.state.tr.insertText(rep, m.from, m.to);
    /* 下一个匹配从替换文本之后找:替换结果本身命中查询时不会原地打转 */
    tr.setMeta(key, { pos: m.from + rep.length });
    ed.view.dispatch(tr);
    if (st.matches.length) selectMatch(st.active, false);
    else syncCount();
  };

  const replaceAll = () => {
    ensure();
    if (!st.matches.length) { toast('无匹配', 'error'); return; }
    const tr = ed.state.tr;
    let n = 0;
    /* 从后往前:前面的位置不受替换长度影响 */
    for (let i = st.matches.length - 1; i >= 0; i--) {
      const m = st.matches[i];
      tr.insertText(repAt(m.from), m.from, m.to);
      n++;
    }
    tr.setMeta(key, { pos: null });
    ed.view.dispatch(tr);
    toast('已替换 ' + n + ' 处', 'success');
    syncCount();
  };

  const open = (opts) => {
    opts = opts || {};
    st.open = true;
    position(); /* 置于 st.open 之后:position 以 open 为前置条件 */
    bar.style.display = '';
    if (opts.replace) rowRep.hidden = false;
    const sel = ed.state.selection;
    if (!sel.empty) {
      const t = ed.state.doc.textBetween(sel.from, sel.to, '\n');
      if (t && t.length <= 200) qIn.value = t;
    } else if (lastQuery) {
      qIn.value = lastQuery;
    }
    search();
    if (!sel.empty && st.active >= 0) selectMatch(st.active, false);
    qIn.focus();
    qIn.select();
  };

  const close = (takeFocus) => {
    if (!st.open) return;
    st.open = false;
    lastQuery = st.query;
    if (revealTimer) clearTimeout(revealTimer);
    bar.style.display = 'none';
    bump(null);
    if (takeFocus) ed.commands.focus();
  };

  qIn.addEventListener('input', () => {
    search();
    /* 输入停顿后把首个匹配滚入视野(不抢焦点) */
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => { if (st.open && st.active >= 0) selectMatch(st.active, false); }, 250);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key === 'Enter' && e.target === qIn) { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter' && e.target === rIn) { e.preventDefault(); replaceOne(); }
  };
  bar.addEventListener('keydown', onKey);

  inst.findApi = {
    open, close,
    isOpen: () => st.open,
    state: st
  };
  inst._findCleanup = () => {
    close(false);
    window.removeEventListener('resize', onRz);
    window.removeEventListener('scroll', onRz, true);
    if (bar.parentNode) bar.parentNode.removeChild(bar);
    ed.unregisterPlugin(key);
  };
  return inst.findApi;
}
