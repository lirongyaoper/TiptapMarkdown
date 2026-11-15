/**
 * 自动大纲面板 + 标题级折叠(2026-11-15,语雀式):
 * - 状态栏「大纲」开关:右侧浮动面板,实时提取 h1-h6 层级,点击定位
 * - 标题折叠:heading 节点装饰折叠柄(NodeDecoration),点击收起该标题到
 *   下一个同级/更高级标题之间的全部块(视觉折叠,不动文档数据)
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';

const foldKey = new PluginKey('lryHeadingFold');

export const OutlinePanel = Extension.create({
  name: 'lryOutlinePanel',

  addProseMirrorPlugins() {
    const editor = this.editor;
    /* 折叠集合:posSet(标题 pos → true) */
    let folded = new Set();
    return [
      new Plugin({
        key: foldKey,
        state: {
          init() { return { folded: new Set() }; },
          apply(tr, value) {
            const meta = tr.getMeta(foldKey);
            if (meta && meta.toggle !== undefined) {
              const s = new Set(value.folded);
              if (s.has(meta.toggle)) s.delete(meta.toggle);
              else s.add(meta.toggle);
              folded = s;
              return { folded: s };
            }
            if (meta && meta.clear) { folded = new Set(); return { folded: new Set() }; }
            /* 文档变化:按 node id 语义这里用 pos,文档变更后 pos 失效——用 tr.mapping 映射 */
            if (tr.docChanged && value.folded.size) {
              const s = new Set();
              value.folded.forEach((p) => {
                const m = tr.mapping.map(p, -1);
                const $m = tr.doc.resolve(Math.max(0, m));
                if ($m.parent.type.name.startsWith('heading')) s.add(m);
              });
              folded = s;
              return { folded: s };
            }
            folded = value.folded;
            return value;
          }
        },
        props: {
          decorations(state) {
            const { folded: f } = foldKey.getState(state) || { folded: new Set() };
            if (!f.size) return DecorationSet.empty;
            const decos = [];
            state.doc.forEach((node, pos) => {
              if (node.type.name !== 'heading') return;
              if (!f.has(pos)) return;
              decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'lry-heading lry-heading-folded' }));
              /* 视觉折叠:隐藏该标题到下一个同级/更高级标题之间的全部块 */
              const lv = node.attrs.level || 1;
              let p = pos + node.nodeSize;
              let stop = false;
              state.doc.forEach((sib, sp) => {
                if (stop || sp < p) return;
                if (sib.type.name === 'heading' && (sib.attrs.level || 1) <= lv) { stop = true; return; }
                decos.push(Decoration.node(sp, sp + sib.nodeSize, { class: 'lry-node-hidden' }));
              });
            });
            return DecorationSet.create(state.doc, decos);
          }
        },
        view() {
          return {
            update() { syncPanel(); }
          };
        }
      })
    ];

    function syncPanel() {
      if (!editor.storage.__outlinePanelEl) return;
      const list = editor.storage.__outlinePanelEl.querySelector('.lry-outline-list');
      if (!list) return;
      list.innerHTML = '';
      const f = (foldKey.getState(editor.state) || { folded: new Set() }).folded;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return;
        const lv = node.attrs.level || 1;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'lry-outline-item lry-outline-l' + lv;
        item.textContent = node.textContent || ('H' + lv);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
        });
        /* 折叠小箭头 */
        const arrow = document.createElement('span');
        arrow.className = 'lry-outline-arrow' + (f.has(pos) ? ' lry-outline-arrow-folded' : '');
        arrow.textContent = f.has(pos) ? '▶' : '▼';
        arrow.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const mapped = f.has(pos) ? pos : pos;
          editor.view.dispatch(editor.state.tr.setMeta(foldKey, { toggle: mapped }));
        });
        item.prepend(arrow);
        list.appendChild(item);
      });
      if (!list.children.length) {
        list.innerHTML = '<div class="lry-outline-empty">文档暂无标题(输入 # 空格 创建)</div>';
      }
    }
  }
});

/** 面板装配:create 后由 index.js 调;返回清理函数 */
export function mountOutlinePanel(inst) {
  const wrap = inst.wrapper;
  const st = wrap.querySelector('.lry-statusbar');
  if (!st) return () => {};

  const panel = document.createElement('div');
  panel.className = 'lry-outline-panel';
  panel.innerHTML = '<div class="lry-outline-head">大纲<span class="lry-outline-tip">点击跳转/箭头折叠</span></div><div class="lry-outline-list"></div>';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lry-status-btn';
  btn.textContent = '大纲';
  const KEY = 'lry-editor-outline-on';
  let on = localStorage.getItem(KEY) === '1';
  const apply = () => {
    panel.classList.toggle('lry-outline-on', on);
    btn.classList.toggle('lry-status-btn-active', on);
    inst.editor.storage.__outlinePanelEl = on ? panel : null;
    if (on) inst.editor.view.dispatch(inst.editor.state.tr.setMeta('noop', 1)); /* 触发同步 */
  };
  btn.addEventListener('click', () => {
    on = !on;
    localStorage.setItem(KEY, on ? '1' : '0');
    apply();
  });
  st.prepend(btn);
  wrap.appendChild(panel);
  apply();

  const cleanup = () => {
    btn.remove();
    panel.remove();
    inst.editor.storage.__outlinePanelEl = null;
  };
  inst._outlineCleanup = cleanup; /* destroy() 统一调用 */
  return cleanup;
}
