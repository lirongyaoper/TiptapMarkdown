/**
 * 画板块 NodeView(v1.3.0 重写:可视化编辑;v1.3.1 加入类图)。
 *
 * 画板 = 文档里的一个原子块,内容是 Mermaid 源码(契约不变:<pre class="lry-mermaid">,序列化走 renderHTML)。
 * 顶栏:类型徽标 · 可视化|源码 · 撤销/重做 · 缩放 · 方向(流程图 / 类图)· 全屏 · 删除。
 *   可视化(流程图 / 思维导图 / UML 类图):Mermaid 实时渲染 + 交互层,直接在图上增删改(diagram/ 目录)。
 *   预览(其余图型):只读渲染;源码模式下源码与预览并排、边写边出图。
 *   源码:认不出的写法自动落到这里,简化后可切回可视化。
 * 画布里的按键与指针事件全部由本视图接管,不透传给 ProseMirror;每次画布操作是一个文档事务。
 *
 * v1.4.0 自由画布:节点可以拖到任意位置,坐标存在图源码末尾的 %% lry-layout 注释块里(diagram/layout-core.js)。
 *   源码模式里不显示这个块(它是画布自己维护的),切回可视化时自动接回去;
 *   只读预览、源码模式的实时预览都走同一个 applyLayout——和前台渲染器是同一份代码。
 */
import { TextSelection } from '@tiptap/pm/state';
import { h, toast } from './dom.js';
import { ICONS } from './icons.js';
import { renderMermaidSvg, isEngineError } from './mermaid-loader.js';
import { detectKind, VISUAL_KINDS, BLANK } from '../diagram/kind.js';
import { parseLayout, stripLayout, attachLayout, layoutHasContent, buildScene, applyLayout } from '../diagram/layout-core.js';
import { FlowEditor } from '../diagram/flow-editor.js';
import { MindEditor } from '../diagram/mind-editor.js';
import { ClassEditor } from '../diagram/class-editor.js';
import { MINI } from '../diagram/diagram-canvas.js';

/**
 * 把焦点交给指定位置的画板块(插入即可编辑)。NodeView 的 DOM 要到下一次视图更新才有,延后一拍再找。
 * @param {Editor} ed
 * @param {number} pos  lryMermaid 节点的位置
 */
export function focusDiagramAt(ed, pos) {
  const doc = ed.view.dom.ownerDocument;
  const focus = () => {
    if (ed.isDestroyed) return;
    const dom = ed.view.nodeDOM(pos);
    const stage = dom && dom.querySelector ? dom.querySelector('.lry-diagram-stage') : null;
    if (stage) stage.focus({ preventScroll: true });
  };
  setTimeout(focus, 0);
  /* 插入命令自带的"延迟聚焦"排在 requestAnimationFrame 里,可能在上面之后才把焦点交给正文
     (焦点原本不在本编辑器里时就会这样)。隔两帧再看一眼:焦点确实落回了正文才交还给画布;
     用户已经点到别处的不动 */
  const again = () => { if (!ed.isDestroyed && doc.activeElement === ed.view.dom) focus(); };
  if (typeof ed.view.dom.ownerDocument.defaultView.requestAnimationFrame === 'function') {
    const raf = () => ed.view.dom.ownerDocument.defaultView.requestAnimationFrame(again);
    ed.view.dom.ownerDocument.defaultView.requestAnimationFrame(raf);
  } else setTimeout(again, 60);
}

/** 插入一个画板块并聚焦它(斜杠面板、行柄等入口共用) */
export function insertDiagram(ed, src) {
  const seen = new Set();
  ed.state.doc.descendants((n, p) => { if (n.type.name === 'lryMermaid') seen.add(p); });
  ed.chain().focus().insertMermaid(src).run();
  let found = -1;
  ed.state.doc.descendants((n, p) => { if (found < 0 && n.type.name === 'lryMermaid' && !seen.has(p)) found = p; });
  if (found >= 0) focusDiagramAt(ed, found);
  return found;
}

export function mermaidNodeView() {
  /* Tiptap v3 NodeView 工厂签名:对象参数 */
  return ({ node, view, getPos, editor }) => {
    const readonly = editor.isEditable === false;
    /* 只读时不给画布(画布能改内容):流程图 / 思维导图 / 类图在只读实例里按只读预览处理 */
    const canVisual = (k) => VISUAL_KINDS.indexOf(k) >= 0 && !readonly;
    const doc = view.dom.ownerDocument;

    const badge = h('span', { class: 'lry-mermaid-badge' });
    const tabVisual = h('button', { type: 'button', class: 'lry-diagram-tab', onclick: () => setMode('visual') });
    const tabSource = h('button', { type: 'button', class: 'lry-diagram-tab', onclick: () => setMode('source') }, '源码');
    const dirBtn = h('button', { type: 'button', class: 'lry-diagram-btn lry-diagram-dir', title: '切换方向:纵向 / 横向', onclick: () => { if (canvas) canvas.flipDirection(); } }, '纵向');
    /* 点完顶栏按钮把焦点交还画布:按钮被点一下会拿走焦点,之后的 Ctrl+Z / 方向键 / Delete 就没人接了
       (2026-11-24 实测:点「重新排版」之后紧接着 Ctrl+Z 没反应) */
    const btn = (title, icon, fn) => h('button', { type: 'button', class: 'lry-diagram-btn', title, html: icon, onclick: (ev) => { fn(ev); if (canvas && st.mode === 'visual') canvas.focus(); } });
    const undoBtn = btn('撤销 (Ctrl+Z)', ICONS.undo, () => canvas && canvas.undo());
    const redoBtn = btn('重做 (Ctrl+Shift+Z)', ICONS.redo, () => canvas && canvas.redo());
    const zoomOut = btn('缩小', '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 12h14"/></svg>', () => canvas && canvas.setZoom(canvas.zoom - 0.1));
    const zoomLabel = h('button', { type: 'button', class: 'lry-diagram-zoom', title: '恢复 100%', onclick: () => canvas && canvas.setZoom(1) }, '100%');
    const zoomIn = btn('放大', '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>', () => canvas && canvas.setZoom(canvas.zoom + 0.1));
    const fitBtn = btn('适应画布(整张图刚好放进可视区)', '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>', () => canvas && canvas.fitToView());
    const exportBtn = btn('导出图片(把画板存成 PNG)', '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>', () => canvas && canvas.exportImage());
    const resetBtn = btn('重新排版(丢掉手动摆放的位置,回到自动排版)', '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="16" height="6" rx="1.2"/></svg>', () => canvas && canvas.resetLayout());
    const fsBtn = btn('全屏编辑', ICONS.fullscreen, () => toggleFs());
    const delBtn = btn('删除画板', MINI.trash, () => {
      const p = pos();
      if (p === undefined) return;
      view.dispatch(view.state.tr.delete(p, p + node.nodeSize));
    });
    const bar = h('div', { class: 'lry-mermaid-bar' },
      badge,
      h('div', { class: 'lry-diagram-tabs' }, tabVisual, tabSource),
      dirBtn,
      h('span', { class: 'lry-diagram-spacer' }),
      undoBtn, redoBtn, h('span', { class: 'lry-diagram-vsep' }), zoomOut, zoomLabel, zoomIn, fitBtn, h('span', { class: 'lry-diagram-vsep' }), resetBtn, exportBtn, fsBtn, delBtn);

    const scaler = h('div', { class: 'lry-diagram-scale' });
    const ta = h('textarea', { class: 'lry-diagram-ta', hidden: true, rows: 1, spellcheck: 'false' });
    const tools = h('div', { class: 'lry-diagram-tools', hidden: true });
    const hint = h('div', { class: 'lry-diagram-hint' });
    const chooser = h('div', { class: 'lry-diagram-chooser' },
      h('div', { class: 'lry-diagram-chooser-title' }, '新建画板'),
      h('button', { type: 'button', class: 'lry-diagram-choose', onclick: () => createBlank('flow') }, h('span', { class: 'lry-diagram-choose-icon', html: MINI.dirV }), h('span', null, '流程图')),
      h('button', { type: 'button', class: 'lry-diagram-choose', onclick: () => createBlank('mind') }, h('span', { class: 'lry-diagram-choose-icon', html: MINI.branch }), h('span', null, '思维导图')),
      h('button', { type: 'button', class: 'lry-diagram-choose', onclick: () => createBlank('class') }, h('span', { class: 'lry-diagram-choose-icon', html: MINI.braces }), h('span', null, 'UML 类图')));
    const loading = h('div', { class: 'lry-mermaid-empty lry-diagram-loading' }, '正在加载绘图引擎…');
    const stage = h('div', { class: 'lry-mermaid-stage lry-diagram-stage' }, scaler, loading, hint, chooser, ta, tools);
    const note = h('div', { class: 'lry-diagram-note', hidden: true });
    const srcTa = h('textarea', { class: 'lry-mermaid-ta lry-diagram-src-ta', spellcheck: 'false', placeholder: 'Mermaid 源码,如:graph TD\n  A[开始] --> B[结束]' });
    const preview = h('div', { class: 'lry-diagram-preview' });
    /* 源码模式里不显示布局块:这里说明一句,免得用户以为位置没保存 */
    const srcHint = h('div', { class: 'lry-diagram-srchint', hidden: true }, '节点的摆放位置由画布自动保存,不显示在源码里;切回可视化时原样保留。');
    const srcWrap = h('div', { class: 'lry-diagram-srcwrap' }, h('div', { class: 'lry-diagram-srccol' }, srcTa, srcHint), h('div', { class: 'lry-diagram-preview-wrap' }, h('div', { class: 'lry-diagram-preview-title' }, '实时预览'), preview));

    const wrap = h('div', { class: 'lry-mermaid-box lry-diagram lry-diagram-mode-visual' + (readonly ? ' lry-diagram-ro' : '') },
      bar, stage, note, srcWrap);

    const st = { mode: 'visual', kind: null, label: '', canUndo: false, canRedo: false, zoom: 1, busy: false, error: '', unsupported: false, empty: false };
    let canvas = null;
    let canvasKind = null;
    let committed = node.attrs.src || '';
    let plainSeq = 0;
    let srcTimer = null;
    let prevBodyOverflow = null;
    const src = () => node.attrs.src || '';
    /* 源码模式期间藏在幕后的布局块(进源码模式那一刻的样子;离开时接回去) */
    let hiddenLayout = parseLayout(src());
    /* 源码栏里的文字 → 要写回文档的源码:用户自己没贴布局块的话,把藏起来的那份接回去 */
    const withHidden = (text) => /%% lry-layout v\d/.test(text) ? text : attachLayout(text, hiddenLayout);
    const pos = () => {
      try { const p = typeof getPos === 'function' ? getPos() : getPos; return typeof p === 'number' ? p : undefined; } catch (e) { return undefined; }
    };

    /* 写回文档:一个操作一个事务。序列化契约由节点的 renderHTML 负责,这里只改 src */
    const commit = (next) => {
      const p = pos();
      if (p === undefined || p < 0) return;
      const cur = view.state.doc.nodeAt(p);
      if (!cur || cur.type.name !== 'lryMermaid') return;
      committed = next;
      view.dispatch(view.state.tr.setNodeMarkup(p, undefined, { src: next }));
      node = view.state.doc.nodeAt(p) || node;
    };

    const leaveCanvas = () => {
      const p = pos();
      if (p === undefined) return;
      if (wrap.classList.contains('lry-diagram-fs')) toggleFs(false);
      /* 离开画布回到正文:光标落到画板后的文本块开头,其后没有可落光标的文本块就补一个空段落 */
      const tr = view.state.tr;
      const after = p + node.nodeSize;
      const next = tr.doc.resolve(after).nodeAfter;
      if (next && next.isTextblock && next.type.spec.code !== true) tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
      else {
        tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
      }
      view.dispatch(tr);
      view.focus();
    };

    const ctx = {
      getSource: src,
      commit,
      renderSvg: renderMermaidSvg,
      toast: (m) => toast(m),
      leaveCanvas,
      /* 上传图片、开图片对话框要用的编辑器实例。取值要晚于实例创建(create 里 view 建好之后才挂 lryInst),所以做成取值时再算 */
      get inst() { return (editor && editor.lryInst) || null; },
      /* 画布自己没有可撤销/重做的步骤时,转成正文级撤销重做 */
      docUndo: (redo) => { if (redo) editor.commands.redo(); else editor.commands.undo(); }, /* 不抢焦点:焦点留在画布 */
      onState: (info) => {
        Object.assign(st, info);
        if (info.unsupported) {
          /* 这段源码没法在图上编辑:落到源码模式并说明原因,源码不丢(布局块照旧藏在幕后) */
          st.unsupported = true;
          st.mode = 'source';
          hiddenLayout = parseLayout(src());
          srcTa.value = stripLayout(src());
          renderPreview(src());
          srcHint.hidden = !layoutHasContent(hiddenLayout);
        }
        /* 出图失败且这块画布还没出过图(切回可视化时源码有错):留在源码模式让人先改对,不给一个空画布 */
        if (st.error && st.mode === 'visual' && info.hasImage === false) {
          st.mode = 'source';
          srcTa.value = src();
          renderPreview(src());
        }
        syncBar();
      }
    };

    /* ---------- 画布实例(随图型变化重建) ---------- */
    const destroyCanvas = () => { if (canvas) { canvas.destroy(); canvas = null; canvasKind = null; wrap.__lryCanvas = null; } };
    const ensureCanvas = () => {
      const kind = detectKind(src());
      const want = kind && canVisual(kind.kind) ? kind.kind : null;
      if (canvas && canvasKind === want) return canvas;
      destroyCanvas();
      if (!want) return null;
      canvasKind = want;
      canvas = new (want === 'flow' ? FlowEditor : want === 'class' ? ClassEditor : MindEditor)(stage, { scaler, ta, tools, host: wrap }, ctx); /* host:左侧工具条挂在画板框上(不随画布滚动) */
      wrap.__lryCanvas = canvas; /* 供回归测试白盒访问(非公开 API) */
      return canvas;
    };

    /* ---------- 渲染 ---------- */
    const renderInto = (el, text, keepOnFail) => {
      const seq = ++plainSeq;
      el.classList.remove('lry-mermaid-err');
      loading.hidden = false;
      return renderMermaidSvg(text).then(({ svg }) => {
        if (seq !== plainSeq) return;
        loading.hidden = true;
        el.textContent = '';
        el.appendChild(svg);
        /* 预览也要落布局:思维导图的树形排布、手动摆放过的节点位置——和可视化画布、前台是同一份代码 */
        const kind = detectKind(text);
        if (kind && VISUAL_KINDS.indexOf(kind.kind) >= 0) applyLayout(svg, buildScene(svg, kind.kind), parseLayout(text));
      }).catch((e) => {
        if (seq !== plainSeq) return;
        loading.hidden = true;
        if (!keepOnFail || !el.querySelector('svg')) {
          if (!keepOnFail) el.textContent = '';
          el.classList.add('lry-mermaid-err');
          if (!keepOnFail) el.appendChild(h('div', { class: 'lry-mermaid-errtip' }, isEngineError(e) ? '绘图引擎加载失败,请刷新页面重试' : '图源有误或渲染失败:' + String((e && e.message) || e).slice(0, 160)));
        }
      });
    };
    const renderPreview = (text) => {
      preview.textContent = '';
      return renderInto(preview, text, false);
    };

    /* 按当前源码与模式装配整个块 */
    const load = (opts) => {
      const text = src();
      const kind = detectKind(text);
      st.kind = kind ? kind.kind : null;
      st.label = kind ? kind.label : '画板';
      if (!kind) { /* 空画板:先选图型 */
        destroyCanvas();
        st.mode = 'visual';
        scaler.textContent = '';
        syncBar();
        return;
      }
      st.unsupported = false;
      st.error = '';
      if (!canVisual(kind.kind)) {
        destroyCanvas();
        if (st.mode === 'visual') renderInto(scaler, text, false);
        else renderPreview(text);
      } else if (st.mode === 'visual') {
        const c = ensureCanvas();
        if (!c.setSource(text, opts)) destroyCanvas(); /* 已由 onState 落到源码模式 */
      } else {
        destroyCanvas();
        renderPreview(text);
      }
      syncBar();
    };

    const createBlank = (kind) => {
      commit(BLANK[kind]);
      st.mode = 'visual';
      load();
      const c = ensureCanvas();
      if (c) {
        if (c.addLoose) c.addLoose(); /* 空流程图 / 空类图:直接建第一个节点(类)并进入文字编辑 */
        else { c.select(c.model.root); }
      }
    };

    /* ---------- 顶栏 ---------- */
    const setMode = (mode) => {
      if (readonly) return;
      if (mode === 'source') {
        if (canvas) canvas.endEdit(true);
        hiddenLayout = parseLayout(src());
        srcTa.value = stripLayout(src());
        srcHint.hidden = !layoutHasContent(hiddenLayout);
        st.mode = 'source';
        load();
        syncBar();
        setTimeout(() => { srcTa.focus(); srcTa.setSelectionRange(srcTa.value.length, srcTa.value.length); }, 0);
      } else {
        if (srcTimer) { clearTimeout(srcTimer); srcTimer = null; commit(withHidden(srcTa.value)); }
        st.mode = 'visual';
        load({ keepHistory: false });
        syncBar();
        if (canvas) canvas.focus();
      }
    };

    srcTa.addEventListener('input', () => {
      if (srcTimer) clearTimeout(srcTimer);
      srcTimer = setTimeout(() => {
        srcTimer = null;
        const text = withHidden(srcTa.value);
        commit(text);
        const kind = detectKind(text);
        st.kind = kind ? kind.kind : null;
        st.label = kind ? kind.label : '画板';
        renderPreview(text); /* 预览的是"保存后的样子":带着藏在幕后的布局 */
        syncBar();
      }, 350);
    });
    srcTa.addEventListener('blur', () => { if (srcTimer) { clearTimeout(srcTimer); srcTimer = null; commit(withHidden(srcTa.value)); } });

    const toggleFs = (force) => {
      const on = force === undefined ? !wrap.classList.contains('lry-diagram-fs') : !!force;
      if (on === wrap.classList.contains('lry-diagram-fs')) return;
      wrap.classList.toggle('lry-diagram-fs', on);
      fsBtn.title = on ? '退出全屏 (Esc)' : '全屏编辑';
      if (on) {
        prevBodyOverflow = doc.body.style.overflow;
        doc.body.style.overflow = 'hidden';
        doc.body.classList.add('lry-diagram-fs-on'); /* 画板里的右键菜单 / 表情面板要压在全屏画板之上(见样式) */
        if (canvas) canvas.focus();
      } else {
        doc.body.style.overflow = prevBodyOverflow || '';
        doc.body.classList.remove('lry-diagram-fs-on');
        if (canvas) canvas.focus();
      }
    };

    const syncBar = () => {
      badge.textContent = st.label;
      wrap.dataset.kind = st.kind || 'none';
      const visual = canVisual(st.kind);
      tabVisual.textContent = visual ? '可视化' : '预览';
      tabVisual.classList.toggle('lry-diagram-tab-on', st.mode === 'visual');
      tabSource.classList.toggle('lry-diagram-tab-on', st.mode === 'source');
      /* 标签本身不禁用:点它就是"再试一次可视化",仍不支持会回到源码并给出说明 */
      tabVisual.title = st.unsupported ? '这段源码含暂不支持在图上编辑的写法。点击重试;简化写法后即可在图上编辑'
        : (visual ? '在图上直接编辑' : '预览(这类图只读,修改请切到源码)');
      tabVisual.classList.toggle('lry-diagram-tab-warn', !!st.unsupported);
      dirBtn.hidden = !(visual && (st.kind === 'flow' || st.kind === 'class') && st.mode === 'visual');
      const hasCanvas = !!canvas && st.mode === 'visual';
      /* 没有画布的块(只读实例、只读预览的图型):svg 按普通文档流定宽,见样式里的 .lry-diagram-static */
      wrap.classList.toggle('lry-diagram-static', !canvas);
      undoBtn.disabled = !hasCanvas || !st.canUndo;
      redoBtn.disabled = !hasCanvas || !st.canRedo;
      zoomOut.disabled = zoomIn.disabled = !hasCanvas;
      fitBtn.disabled = exportBtn.disabled = !hasCanvas;
      resetBtn.disabled = !hasCanvas || !(canvas && canvas.free); /* 没手动摆过就没有可"重排"的 */
      resetBtn.title = canvas && canvas.free ? '重新排版(丢掉手动摆放的位置,回到自动排版)' : '重新排版(还没手动摆放过节点)';
      srcHint.hidden = !(st.mode === 'source' && layoutHasContent(hiddenLayout));
      zoomLabel.textContent = Math.round(st.zoom * 100) + '%';
      const dir = hasCanvas && canvas.model ? canvas.model.direction : 'TD';
      dirBtn.textContent = dir === 'LR' ? '横向' : '纵向';
      dirBtn.title = '当前' + (dir === 'LR' ? '横向' : '纵向') + ' · 点击切换方向';
      dirBtn.setAttribute('data-dir', dir);
      [undoBtn, redoBtn, zoomOut, zoomIn, fitBtn, resetBtn, exportBtn, fsBtn, delBtn, dirBtn].forEach((b) => { b.disabled = b.disabled || readonly; });
      wrap.classList.toggle('lry-diagram-mode-visual', st.mode === 'visual');
      wrap.classList.toggle('lry-diagram-mode-source', st.mode === 'source');
      chooser.hidden = !!st.kind || readonly;
      hint.hidden = !(st.mode === 'visual' && visual && st.empty && !st.busy);
      hint.textContent = (canvas && canvas.emptyHint) || '画板是空的——点击这里添加第一个节点';
      loading.hidden = !(st.mode === 'visual' && st.busy);
      let msg = '';
      if (st.mode === 'source' && st.unsupported) msg = '这段源码含暂不支持在图上编辑的写法,已切到源码模式;Mermaid 照常渲染,简化写法后可切回可视化。';
      if (/^绘图引擎加载失败/.test(st.error)) msg = st.error + (st.mode === 'source' ? ';可先在源码模式编辑,网络恢复后刷新页面即可出图' : '');
      else if (st.error) msg = (st.mode === 'visual' ? '图源有误,已保留上一次的图:' : '图源有误,无法出图——请在源码里修正后再切回可视化:') + st.error;
      note.textContent = msg;
      note.hidden = !msg;
    };

    /* ---------- 装配 ---------- */
    /* 源自画布/工具条/编辑框的拖拽一律不启动(拖的是图里的节点,不是这一块);顶栏仍可拖动整块 */
    wrap.addEventListener('dragstart', (e) => {
      if (e.target !== wrap && !bar.contains(e.target)) e.preventDefault();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrap.classList.contains('lry-diagram-fs') && !(canvas && canvas.sel)) toggleFs(false);
    });
    load({ keepHistory: false });

    return {
      dom: wrap,
      update(n) {
        if (n.type.name !== 'lryMermaid') return false;
        node = n;
        if ((n.attrs.src || '') !== committed) {
          /* 外部改动(正文级撤销 / 重做等):源码模式里显示的仍是不带布局块的那份 */
          if (st.mode === 'source') { hiddenLayout = parseLayout(n.attrs.src || ''); srcTa.value = stripLayout(n.attrs.src || ''); }
          load({ keepHistory: false });
        }
        return true;
      },
      stopEvent(e) {
        const t = e.target;
        if (!t || !wrap.contains(t)) return false;
        /* 顶栏:按钮自己处理;点顶栏空白处仍交给 ProseMirror(选中整块,便于拖动/删除) */
        if (bar.contains(t)) return !!t.closest('button, input, textarea, select');
        /* 画布、工具条、编辑框、源码区一律自己处理 */
        return true;
      },
      ignoreMutation() { return true; },
      destroy() {
        destroyCanvas();
        if (srcTimer) clearTimeout(srcTimer);
        if (wrap.classList.contains('lry-diagram-fs')) { doc.body.style.overflow = prevBodyOverflow || ''; doc.body.classList.remove('lry-diagram-fs-on'); }
      }
    };
  };
}
