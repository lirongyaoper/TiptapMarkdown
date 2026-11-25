/**
 * 行柄「+」菜单(2026-11-15 五轮,语雀式块级行操作):
 * 每个顶层块左侧渲染 "+" 按钮(Widget decoration);Markdown 分栏模式常显,
 * 富文本模式块 hover 显示(CSS :has)。点击弹出分组菜单(26 项):
 *   转换:H1-H6/高亮块×4/引用/有序·无序·任务列表/代码块/折叠块
 *   操作:复制/剪切/删除行、增/减缩进
 *   插入:图片/附件/状态卡/画板/思维导图/流程图/UML/公式/分割线/表情
 * 实现:操作统一「选区置整块 → 复用既有命令链」,折叠/高亮块经
 * DOMSerializer 序列化块内容后重组节点。
 *
 * 预告下一行(2026-11-24):末块不是空段落时在文末另画一行待写行(行首「+」常显),
 * 点它在文末新起段落;末块已是空段落时该行的「+」常显。见 isWaitingLine / nextLineWidget。
 * 「插入」落位(2026-11-24):空段落原位替换、否则插在当前块之后;块级内容落在文末时其后补
 * 空段落并落光标。见 ui/insert-slot.js。
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { DOMSerializer } from '@tiptap/pm/model';
import { h, popover, closePopover, toast } from './dom.js';
import { openEmojiPicker } from './emoji.js';
import { openFormulaDialog } from './formula.js';
import { isBlankParagraph, slotRange, settleAfterBlock } from './insert-slot.js';
import { focusDiagramAt } from './mermaid-view.js';
import { STARTER } from '../diagram/kind.js';

const rowKey = new PluginKey('lryRowHandle');

/* 高亮块四色 */
const CARDS = [['info', '信息'], ['success', '成功'], ['warning', '警示'], ['danger', '危险']];

/* 文末是否已是"待写行"(空段落):是则它自己就是预告的下一行,不再另画预告行 */
export function isWaitingLine(doc) {
  const last = doc.lastChild;
  return !!last && last.type.name === 'paragraph' && last.content.size === 0;
}

/* 预告下一行(2026-11-24,用户报"进了代码块出不来、要预见性地给出下一行"):
   末块不是空段落(代码块/表格/画板等)时,在文末画一行不可编辑的待写行——
   点行内任意处在文末补一个空段落并落进去;点行首常显的「+」则补段落并打开其行菜单。
   纯编辑态装饰,文档不变,不影响序列化契约 */
function nextLineWidget(pos) {
  return Decoration.widget(pos, (view) => {
    const line = document.createElement('div');
    line.className = 'lry-next-line';
    line.contentEditable = 'false';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'lry-row-handle lry-next-add';
    add.title = '插入内容(图片、表格、画板、代码块…)';
    add.textContent = '+';
    const hint = document.createElement('span');
    hint.className = 'lry-next-hint';
    hint.textContent = '继续输入,或点「+」插入内容';
    line.appendChild(add);
    line.appendChild(hint);
    const startNew = (withMenu) => {
      const { state } = view;
      const tr = state.tr;
      let caret;
      /* 渲染后文档可能已变(末块已成空段落):此时只需把光标落进去 */
      if (isWaitingLine(state.doc)) {
        caret = state.doc.content.size - 1;
      } else {
        const at = state.doc.content.size;
        tr.insert(at, state.schema.nodes.paragraph.create());
        caret = at + 1;
      }
      tr.setSelection(TextSelection.create(tr.doc, caret));
      tr.scrollIntoView();
      view.dispatch(tr);
      view.focus();
      if (withMenu) {
        /* 新段落的行柄是最后一个普通行柄:走它的 mousedown,弹出与点中已有行相同的菜单 */
        const handles = view.dom.querySelectorAll('.lry-row-handle:not(.lry-next-add)');
        const target = handles[handles.length - 1];
        if (target) target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      }
    };
    add.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); startNew(true); });
    line.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); startNew(false); });
    return line;
  }, { side: 1, ignoreSelection: true, key: 'lry-next-line', stopEvent: () => true });
}

/* 行柄默认画在编辑器左外侧 26px 处(靠页面留白摆放)。宿主页面若把编辑器放进会裁剪的容器
   (overflow:hidden 且左侧不留边),行柄会被整个裁掉——看不见也点不到(2026-11-24 实测:会员中心
   投稿页的模板就是这样包的)。创建时与窗口尺寸变化时各量一次:外突位置露出来的不足一半,
   就给编辑器加 .lry-row-handle-in,行柄改画进 ProseMirror 自己的 30px 左内边距(与窄屏同款摆法)。
   量的必须是外突位置:先把"收进来"的状态撤掉再量,否则永远量到没被裁。 */
export function syncHandleMode(editor) {
  try {
    const dom = editor.view && editor.view.dom;
    const wrap = dom && dom.closest ? dom.closest('.lry-editor') : null;
    if (!wrap || !dom.isConnected) return false;
    wrap.classList.remove('lry-row-handle-in');
    const btn = dom.querySelector('.lry-row-handle');
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    if (!r.width) return false; /* 无布局环境(jsdom)/ 编辑器此刻不可见 */
    const win = dom.ownerDocument.defaultView || window;
    let left = Math.max(0, r.left), right = Math.min(win.innerWidth, r.right); /* 视口左右边 */
    for (let p = btn.parentElement; p && p.nodeType === 1 && p !== dom.ownerDocument.documentElement; p = p.parentElement) {
      const cs = win.getComputedStyle(p);
      if (!/(hidden|clip|auto|scroll)/.test(cs.overflowX)) continue;
      const l = p.getBoundingClientRect().left + p.clientLeft; /* 裁剪发生在内边距盒 */
      left = Math.max(left, l);
      right = Math.min(right, l + p.clientWidth);
    }
    const inside = (right - left) < r.width * 0.5;
    wrap.classList.toggle('lry-row-handle-in', inside);
    return inside;
  } catch (e) { return false; }
}

function watchHandleMode(editor) {
  const dom = editor.view.dom;
  const win = dom.ownerDocument.defaultView || window;
  let timer = null;
  const run = () => { if (!editor.isDestroyed && dom.isConnected) syncHandleMode(editor); };
  const onRz = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 150); };
  win.addEventListener('resize', onRz);
  /* 创建时布局可能还没最终落定(字体、外层脚本):隔一帧与 300ms 各量一次 */
  if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run);
  setTimeout(run, 300);
  return () => { win.removeEventListener('resize', onRz); if (timer) clearTimeout(timer); };
}

export const RowHandle = Extension.create({
  name: 'lryRowHandle',

  onCreate() { this._stopHandleWatch = watchHandleMode(this.editor); },
  onDestroy() { if (this._stopHandleWatch) { this._stopHandleWatch(); this._stopHandleWatch = null; } },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: rowKey,
        props: {
          decorations(state) {
            const decos = [];
            const waiting = isWaitingLine(state.doc);
            const editable = editor.isEditable !== false;
            const count = state.doc.childCount;
            state.doc.forEach((node, offset, index) => {
              /* 不给这些块挂行柄 */
              if (node.type.name === 'lryPageBreak') return;
              decos.push(Decoration.widget(offset, (view) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'lry-row-handle';
                /* 文末待写行的行柄常显(非悬停才出现),让"下一行"始终可见可点 */
                if (waiting && editable && index === count - 1) btn.classList.add('lry-row-handle-next');
                btn.title = '行操作';
                btn.textContent = '+';
                btn.addEventListener('mousedown', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  /* 实时反查:decoration key 会在 doc 变化时复用 DOM,
                     闭包捕获的 node/pos 可能过期(曾致删除后串块) */
                  let pos = null;
                  try { pos = view.posAtDOM(btn); } catch (err) { pos = null; }
                  if (pos === null || pos < 0 || pos > view.state.doc.content.size) return;
                  const cur = view.state.doc.nodeAt(Math.min(pos, view.state.doc.content.size - 1));
                  /* widget(side:-1)位于顶层块前:posAtDOM 回落该块 pos */
                  let blockPos = pos, block = cur;
                  if (!block) {
                    const $p = view.state.doc.resolve(Math.max(0, Math.min(pos, view.state.doc.content.size)));
                    block = $p.parent;
                    blockPos = $p.before($p.depth);
                  }
                  if (!block || block === view.state.doc) return;
                  openMenu(editor, btn, blockPos, block);
                });
                return btn;
              }, { side: -1, ignoreSelection: true }));
            });
            if (!waiting && editable && count) decos.push(nextLineWidget(state.doc.content.size));
            return DecorationSet.create(state.doc, decos);
          }
        }
      })
    ];
  }
});

function openMenu(editor, anchor, pos, node) {
  const ed = editor;
  const endPos = pos + node.nodeSize;

  /* 选区置整块(命令链作用于选区),返回 chain */
  const selectBlock = () => ed.chain().focus().setTextSelection({ from: pos + 1, to: endPos - 1 });

  /* 整块序列化(用于重组折叠/高亮块):序列化节点本身而非 children,
     保证产物是合法块级 HTML——空段落得 <p></p>(children 版返回空串,
     曾致 '<blockquote></blockquote>' 违反 content:'block+' 报
     Invalid content for node blockquote),图片段得 <p><img></p> */
  const nodeBlockHtml = () => {
    const ser = DOMSerializer.fromSchema(ed.schema);
    const div = document.createElement('div');
    div.appendChild(ser.serializeNode(node));
    return div.innerHTML || '<p></p>';
  };
  const nodeText = () => node.textContent;

  const run = (label, fn) => () => {
    closePopover();
    try { fn(); } catch (e) { console.error('[lry-editor] 行操作失败:' + label, e); toast('操作失败:' + e.message, 'error'); }
  };

  /* 「插入」落位(2026-11-24,规则见 ui/insert-slot.js):空段落原位替换、否则插在其后;
     块级内容落在文末时其后补空段落并把光标放进去(此前一律插在空行下方,上方留一个空行,
     且文末是原子块时光标被弹回上一行末尾) */
  const isBlank = isBlankParagraph(node);
  const mmd = (src) => ed.schema.nodes.lryMermaid.create({ src });
  let insertedAt = null;
  const putBlock = (blockNode, after) => ed.chain().focus().command(({ tr }) => {
    const slot = slotRange(node, pos);
    tr.replaceWith(slot.from, slot.to, blockNode);
    settleAfterBlock(tr, slot.from, blockNode.nodeSize);
    insertedAt = after ? slot.from : null;
    return true;
  }).run();
  /* 画板:插入后把焦点交给画布(插入即可编辑);正文光标仍在画板后的空段落里 */
  const putDiagram = (src) => { putBlock(mmd(src), true); if (insertedAt !== null) focusDiagramAt(ed, insertedAt); };

  const G = (t) => h('div', { class: 'lry-row-group' }, t);
  const I = (label, fn, hint) => h('button', { type: 'button', class: 'lry-menu-item', onclick: run(label, fn) },
    h('span', { class: 'lry-menu-text' }, label), hint ? h('span', { class: 'lry-menu-hint' }, hint) : null);

  /* 表情锚:菜单内嵌按钮 */
  let emojiBtn = null;
  emojiBtn = I('表情', () => openEmojiPicker(emojiBtn, { editor: ed }));

  const menu = h('div', { class: 'lry-menu lry-row-menu' },
    G('转换为'),
    [1, 2, 3, 4, 5, 6].map((lv) => I('标题 H' + lv, () => {
      if (node.type.name === 'heading' && node.attrs.level === lv) {
        selectBlock().setParagraph().run();
      } else {
        selectBlock().toggleHeading({ level: lv }).run();
      }
    })),
    CARDS.map(([tp, name]) => I('高亮块·' + name, () => {
      const cls = node.type.name === 'blockquote' ? (node.attrs.cls || '') : '';
      if (cls.includes('lry-card-' + tp)) {
        /* 同类型再点 = 解除高亮:光标入块内首个位置后 lift */
        ed.chain().focus().setTextSelection(pos + 1).lift('blockquote').run();
      } else {
        /* 整块替换(选区替换会造成原块外壳残留/内容重复) */
        ed.chain().focus().insertContentAt({ from: pos, to: endPos },
          '<blockquote class="lry-card lry-card-' + tp + '">' + nodeBlockHtml() + '</blockquote><p></p>'
        ).run();
      }
    })),
    I('引用', () => selectBlock().toggleBlockquote().run()),
    I('有序列表', () => selectBlock().toggleOrderedList().run()),
    I('无序列表', () => selectBlock().toggleBulletList().run()),
    I('任务列表', () => {
      /* 非任务列表 → 任务列表;已是 → 解除 */
      ed.chain().focus().setTextSelection({ from: pos, to: endPos }).toggleTaskList().run();
    }),
    I('代码块', () => selectBlock().toggleCodeBlock().run()),
    I('折叠块', () => {
      const headText = (nodeText() || '折叠标题').trim().slice(0, 60) || '折叠标题';
      const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      ed.chain().focus().insertContentAt({ from: pos, to: endPos },
        '<div class="lry-fold"><div class="lry-fold-head">' + esc(headText) + '</div>'
        + '<div class="lry-fold-body">' + nodeBlockHtml() + '</div></div><p></p>'
      ).run();
    }),
    /* 已是折叠块:菜单里也能切换开合(与点标题栏箭头等价;触屏 / 键盘用户的兜底)。
       光标先落进标题文字里再执行——整块选区的两个端点落在折叠块的子块边界上,不是行内位置 */
    node.type.name === 'lryFold' ? I(node.attrs.open === false ? '展开折叠块' : '收起折叠块', () => ed.chain().focus().setTextSelection(pos + 2).toggleFold().run()) : null,

    G('操作'),
    I('复制行', async () => {
      try {
        await navigator.clipboard.writeText(nodeText());
        toast('已复制该行', 'success');
      } catch (e) { toast('复制失败:' + e.message, 'error'); }
      ed.chain().focus().setTextSelection(pos + 1).run();
    }),
    I('剪切行', async () => {
      try { await navigator.clipboard.writeText(nodeText()); } catch (e) { /* 剪切仍执行 */ }
      const tr = ed.state.tr.delete(pos, endPos);
      ed.view.dispatch(tr);
      toast('已剪切', 'success');
    }),
    I('删除行', () => {
      ed.view.dispatch(ed.state.tr.delete(pos, endPos));
    }),
    I('增加缩进', () => indentRow(ed, pos, node, 1)),
    I('减少缩进', () => indentRow(ed, pos, node, -1)),

    G('插入'),
    I('图片', () => triggerToolbar(ed, 'insertimage')),
    I('附件卡', () => triggerToolbar(ed, 'attachment')),
    /* 状态卡是行内胶囊:段落 → 追加到本行文字末尾(光标落行内。此前落在块边界上,是个越界的
       非法光标位置);其余块沿用"其后最近文本处" */
    I('状态卡', () => ed.chain().focus()
      .setTextSelection(isBlank || node.type.name === 'paragraph' ? pos + node.nodeSize - 1 : endPos)
      .insertStatus('info', '进行中').run()),
    I('画板', () => putDiagram(STARTER.flow)),
    I('思维导图', () => putDiagram(STARTER.mind)),
    I('流程图', () => putDiagram(STARTER.flow)),
    I('UML 类图', () => putDiagram(STARTER.class)),
    /* 打开公式对话框(此前直接插入 E=mc^2 占位块,既不弹输入框也没法改) */
    I('公式', () => openFormulaDialog(ed, { mode: 'block', blockPos: pos })),
    I('分割线', () => putBlock(ed.schema.nodes.horizontalRule.create())),
    emojiBtn
  );

  popover(anchor, menu, { className: 'lry-row-pop' });
}

/* 行缩进:列表项 sink/lift;段落 indentLeft ±2em */
function indentRow(ed, pos, node, dir) {
  const $p = ed.state.doc.resolve(pos + 1);
  let inList = false;
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type.name === 'listItem' || $p.node(d).type.name === 'taskItem') { inList = true; break; }
  }
  if (inList) {
    /* 列表类型探测:taskList 内是 taskItem,普通列表是 listItem,
       sink/lift 必须用对类型(错类型静默失败) */
    let itemTypeName = 'listItem';
    for (let d = $p.depth; d > 0; d--) {
      const t = $p.node(d).type.name;
      if (t === 'taskItem') { itemTypeName = 'taskItem'; break; }
      if (t === 'listItem') { itemTypeName = 'listItem'; break; }
    }
    const c = dir > 0 ? ed.chain().focus().setTextSelection(pos + 1).sinkListItem(itemTypeName)
      : ed.chain().focus().setTextSelection(pos + 1).liftListItem(itemTypeName);
    c.run();
    return;
  }
  if (node.type.name === 'paragraph' || node.type.name === 'heading') {
    const cur = parseFloat(node.attrs.indentLeft) || 0;
    const next = dir > 0 ? Math.min(10, cur + 2) : Math.max(0, cur - 2);
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, null, {
      ...node.attrs, indentLeft: next > 0 ? next + 'em' : null
    }));
  } else {
    toast(dir > 0 ? '该类型块不支持缩进' : '该类型块不支持缩进', 'error');
  }
}

/* 触发工具栏既有对话框(图片/附件),找当前编辑器实例的工具栏按钮 */
function triggerToolbar(ed, cmd) {
  const wrapper = ed.view.dom.closest('.lry-editor');
  const btn = wrapper && wrapper.querySelector('[data-cmd=' + cmd + ']');
  if (btn) btn.click();
  else toast('未找到「' + cmd + '」入口', 'error');
}
