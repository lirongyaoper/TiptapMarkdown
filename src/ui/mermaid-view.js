/**
 * Mermaid 画板块 NodeView(2026-11-15,语雀式画板):
 * 默认渲染图(懒加载 plugin/mermaid/mermaid.min.js)+「编辑源码」切换为
 * textarea 编辑;改码防抖 600ms 重渲染;渲染失败红条提示并保留源码可改。
 * 序列化始终是 pre.lry-mermaid 文本(NodeView DOM 不参与 getHTML)。
 */

let mermaidLoading = null;
function ensureMermaidLib() {
  if (window.mermaid) {
    window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
    return Promise.resolve();
  }
  if (mermaidLoading) return mermaidLoading;
  const s = document.querySelector('script[src*="lry-editor"]');
  const m = s ? /(.*)dist\//.exec(s.getAttribute('src')) : null;
  const base = window.LRY_EDITOR_BASE || (m ? m[1] : './');
  const url = base.replace(/\/?$/, '/') + 'third-party/mermaid.min.js';
  mermaidLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => {
      if (window.mermaid) {
        window.mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
        resolve();
      } else reject(new Error('mermaid 加载异常'));
    };
    s.onerror = () => { mermaidLoading = null; reject(new Error('mermaid 加载失败:' + url)); };
    document.head.appendChild(s);
  });
  return mermaidLoading;
}

export function mermaidNodeView() {
  /* Tiptap v3 NodeView 工厂签名:对象参数 */
  return ({ node, view, getPos }) => {
    const wrap = document.createElement('div');
    wrap.className = 'lry-mermaid-box';
    const bar = document.createElement('div');
    bar.className = 'lry-mermaid-bar';
    bar.innerHTML = '<span class="lry-mermaid-badge">🎨 画板</span>'
      + '<button type="button" class="lry-btn lry-mermaid-edit">编辑源码</button>';
    const stage = document.createElement('div');
    stage.className = 'lry-mermaid-stage';
    const ta = document.createElement('textarea');
    ta.className = 'lry-mermaid-ta';
    ta.spellcheck = false;
    ta.style.display = 'none';
    ta.value = node.attrs.src || '';

    let renderTimer = null;
    let editing = false;
    let renderSeq = 0;

    const render = () => {
      const src = ta.value.trim();
      if (!src) { stage.innerHTML = '<div class="lry-mermaid-empty">空画板——点「编辑源码」开始绘图</div>'; return; }
      const seq = ++renderSeq;
      ensureMermaidLib().then(() => {
        if (seq !== renderSeq || editing) return;
        stage.innerHTML = '';
        /* mermaid v10+ render 为异步,返回 Promise<{svg}> */
        return Promise.resolve(window.mermaid.render('lry-mmd-' + seq, src)).then((r) => {
          if (seq !== renderSeq) return;
          stage.innerHTML = r && r.svg ? r.svg : '(空渲染结果)';
          stage.classList.remove('lry-mermaid-err');
        });
      }).catch((e) => {
        if (seq !== renderSeq) return;
        stage.innerHTML = '<div class="lry-mermaid-errtip">图源有误或渲染失败:' + String((e && e.message) || e).slice(0, 140) + '</div>';
        stage.classList.add('lry-mermaid-err');
      });
    };

    const syncToDoc = () => {
      const pos = getPos();
      if (pos === undefined || pos < 0) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { src: ta.value }));
    };

    bar.querySelector('.lry-mermaid-edit').addEventListener('click', () => {
      editing = !editing;
      ta.style.display = editing ? '' : 'none';
      bar.querySelector('.lry-mermaid-edit').textContent = editing ? '完成编辑' : '编辑源码';
      if (editing) {
        stage.style.display = 'none';
        ta.focus();
      } else {
        stage.style.display = '';
        syncToDoc();
        render();
      }
    });
    ta.addEventListener('input', () => {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(() => { if (!editing) return; }, 400); /* 编辑中不重渲,完成时统一 */
    });

    wrap.appendChild(bar);
    wrap.appendChild(stage);
    wrap.appendChild(ta);
    render();

    return {
      dom: wrap,
      update(n) {
        if (n.type.name !== 'lryMermaid') return false;
        const newText = n.attrs.src || '';
        if (newText !== ta.value && !editing) {
          ta.value = newText;
          render();
        }
        return true;
      },
      stopEvent(e) {
        /* textarea 与按钮内的事件不交给 PM */
        return editing && (e.target === ta || ta.contains(e.target) || bar.contains(e.target));
      },
      ignoreMutation() { return true; }
    };
  };
}
