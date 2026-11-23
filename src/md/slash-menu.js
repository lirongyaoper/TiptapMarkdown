/**
 * 斜杠面板 2.5(2026-11-23 v1.2.0 重写触发与交互;语雀式插入面板):
 * - 触发收敛:仅段落/标题内、行首或空白之后输入 "/" 唤起(行首 "+" 同理)——
 *   URL、"路径/文件"、"和/或" 里的斜杠不再误弹(旧实现任何位置的 "/" 都弹)
 * - 过滤由文档驱动:每次事务后取「触发符到光标」之间的真实文本作过滤词,
 *   输入法合成、联想选词、退格、撤销全部天然正确(旧实现逐键累加,中文输入法下失灵)
 * - 键盘导航:↑/↓ 移动、Enter 选中、Esc 关闭;输入法合成期间不拦截按键
 * - 过滤时跨分组搜索(去重),匹配 label / 别名(英文·全拼·首字母)
 * - 面板原地重绘不闪;对话框入口按编辑器实例触发(多编辑器页面不再误开第一个实例)
 */
import { h, toast, fixedTopInset } from '../ui/dom.js';

const MERMAID = {
  flow: 'graph TD\nA[开始] --> B{条件?}\nB -->|是| C[处理]\nB -->|否| D[结束]\nC --> D',
  mind: 'mindmap\n  根主题\n    分支一\n      要点1\n      要点2\n    分支二\n      要点3',
  seq: 'sequenceDiagram\nparticipant 用户\nparticipant 服务器\n用户->>服务器: 请求\n服务器-->>用户: 响应',
  cls: 'classDiagram\nclass 文章 {\n  +标题\n  +发布()\n}\nclass 评论 {\n  +内容\n}',
  state: 'stateDiagram-v2\n[*] --> 草稿\n草稿 --> 发布: 审核\n发布 --> [*]',
  arch: 'graph LR\nnginx --> php-fpm\nphp-fpm --> mysql\nphp-fpm --> oss',
  gantt: 'gantt\n  title 项目计划\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  需求 :a1, 2026-11-16, 7d\n  section 阶段二\n  开发 :a2, after a1, 14d',
  pie: 'pie title 占比\n  "A" : 60\n  "B" : 40'
};
const CARD = (tp, text) => (ed) => ed.chain().focus()
  .insertContent('<blockquote class="lry-card lry-card-' + tp + '"><p>' + text + '</p></blockquote>').run();
const STATUS = (tp, text) => (ed) => ed.chain().focus().insertStatus(tp, text).run();
/* 触发本实例工具栏上的对话框入口;该按钮不在当前预设里则提示 */
const TOOL = (cmd) => (ed, inst) => {
  const btn = inst.wrapper.querySelector('[data-cmd=' + cmd + ']');
  if (btn) btn.click();
  else toast('当前工具栏配置未启用该功能', 'error');
};
const codeBlock = (ed) => ed.chain().focus().setCodeBlockLang('plain').run();

export function buildGroups() {
  const day = () => new Date().toLocaleDateString('zh-CN');
  const clock = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const mm = (src) => (ed) => ed.chain().focus().insertMermaid(src).run();
  return [
    ['常用', [
      ...[1, 2, 3, 4, 5, 6].map((lv) => ({
        label: '标题 H' + lv, hint: '#'.repeat(lv), alias: 'h' + lv + ' title heading biaoti bt',
        run: (ed) => ed.chain().focus().toggleHeading({ level: lv }).run()
      })),
      { label: '正文', hint: 'p', alias: 'text paragraph zhengwen zw', run: (ed) => ed.chain().focus().setParagraph().run() },
      { label: '引用', hint: '>', alias: 'quote blockquote yinyong yy', run: (ed) => ed.chain().focus().toggleBlockquote().run() },
      { label: '无序列表', hint: '-', alias: 'ul bullet list liebiao lb wuxu', run: (ed) => ed.chain().focus().toggleBulletList().run() },
      { label: '有序列表', hint: '1.', alias: 'ol numbered list youxu', run: (ed) => ed.chain().focus().toggleOrderedList().run() },
      { label: '任务列表', hint: '☑', alias: 'todo task checklist renwu daiban rw', run: (ed) => ed.chain().focus().toggleTaskList().run() },
      { label: '代码块', hint: '```', alias: 'code codeblock daima dm', run: codeBlock },
      { label: '表格', hint: '3×3', alias: 'table biaoge bg', run: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { label: '图片', hint: 'img', alias: 'image img tupian tp', run: TOOL('insertimage') },
      { label: '分割线', hint: '---', alias: 'hr divider line fengexian fgx', run: (ed) => ed.chain().focus().setHorizontalRule().run() },
      { label: '公式', hint: '$$', alias: 'formula math katex gongshi gs tex latex', run: TOOL('formula') }
    ]],
    ['基础卡片', [
      { label: '附件卡', hint: '📎', alias: 'file attachment fujian wj', run: TOOL('attachment') },
      { label: '状态卡·进行中', alias: 'status info zhuangtai jinxingzhong', run: STATUS('info', '进行中') },
      { label: '状态卡·已完成', alias: 'status ok done zhuangtai wancheng', run: STATUS('ok', '已完成') },
      { label: '状态卡·待办', alias: 'status warn todo zhuangtai daiban', run: STATUS('warn', '待办') },
      { label: '状态卡·失败', alias: 'status err fail zhuangtai shibai', run: STATUS('err', '失败') },
      { label: '状态卡·已归档', alias: 'status archived zhuangtai guidang', run: STATUS('done', '已归档') }
    ]],
    ['布局和样式', [
      { label: '高亮块·信息', alias: 'callout info card gaoliangkuai xinxi', run: CARD('info', '信息内容') },
      { label: '高亮块·成功', alias: 'callout success card gaoliangkuai chenggong', run: CARD('success', '成功内容') },
      { label: '高亮块·警示', alias: 'callout warning card gaoliangkuai jingshi', run: CARD('warning', '警示内容') },
      { label: '高亮块·危险', alias: 'callout danger card gaoliangkuai weixian', run: CARD('danger', '危险内容') },
      { label: '折叠块', alias: 'fold details collapse zhedie', run: (ed) => ed.chain().focus().insertFold().run() },
      { label: '两栏布局', hint: '▦', alias: 'columns 2col fenlan lianglan', run: (ed) => ed.chain().focus().insertCols(2).run() },
      { label: '三栏布局', hint: '▦', alias: 'columns 3col fenlan sanlan', run: (ed) => ed.chain().focus().insertCols(3).run() },
      { label: '目录', hint: '[TOC]', alias: 'toc mulu', run: (ed) => ed.chain().focus().insertContent('<p class="lry-toc">[TOC]</p>').run() }
    ]],
    ['程序员专区', [
      { label: '代码块', hint: '```', alias: 'code codeblock daima dm', run: codeBlock },
      { label: '公式·行内', hint: '$', alias: 'inline formula math gongshi hangnei', run: TOOL('formula') },
      { label: '公式·块级', hint: '$$', alias: 'block formula math gongshi kuaiji', run: TOOL('formula') },
      { label: '流程图', hint: 'mermaid', alias: 'flowchart flow liuchengtu lct', run: mm(MERMAID.flow) },
      { label: '时序图', hint: 'mermaid', alias: 'sequence shixutu sxt', run: mm(MERMAID.seq) },
      { label: '类图', hint: 'mermaid', alias: 'uml class leitu', run: mm(MERMAID.cls) },
      { label: '状态图', hint: 'mermaid', alias: 'state zhuangtai', run: mm(MERMAID.state) }
    ]],
    ['画板', [
      { label: '流程图', hint: 'mermaid', alias: 'flowchart flow liuchengtu lct', run: mm(MERMAID.flow) },
      { label: '思维导图', hint: 'mermaid', alias: 'mindmap mind naotu siweidaotu', run: mm(MERMAID.mind) },
      { label: '架构图', hint: 'mermaid', alias: 'architecture jiagoutu', run: mm(MERMAID.arch) },
      { label: '甘特图', hint: 'mermaid', alias: 'gantt gantetu', run: mm(MERMAID.gantt) },
      { label: '饼图', hint: 'mermaid', alias: 'pie bingtu chart', run: mm(MERMAID.pie) }
    ]],
    ['小工具', [
      { label: '今日日期', hint: 'date', alias: 'date riqi', run: (ed) => ed.chain().focus().insertContent(day()).run() },
      { label: '当前时间', hint: 'time', alias: 'time shijian', run: (ed) => ed.chain().focus().insertContent(clock()).run() },
      { label: '链接', hint: 'Ctrl+K', alias: 'link url lianjie', run: TOOL('link') },
      { label: '表情', hint: '☺', alias: 'emoji biaoqing', run: TOOL('emotion') },
      { label: '锚点', alias: 'anchor maodian', run: TOOL('anchor') },
      { label: '特殊字符', alias: 'special char zifu', run: TOOL('spechars') },
      { label: '分页符', hint: '—//—', alias: 'pagebreak fenye', run: (ed) => ed.chain().focus().insertPageBreak().run() },
      { label: '视频', alias: 'video shipin', run: TOOL('insertvideo') },
      { label: '音频', alias: 'audio yinpin', run: TOOL('insertaudio') }
    ]]
  ];
}

/* 光标屏幕坐标(选区矩形左下角);取不到时退化为安全位 */
function caretPoint() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const rect = sel.getRangeAt(0).cloneRange().getBoundingClientRect();
    if (rect && (rect.top || rect.left || rect.width)) return { x: rect.left, y: rect.bottom + 4, h: rect.height || 18 };
  }
  return { x: 80, y: 80, h: 18 };
}

function matchScore(it, f) {
  const label = it.label.toLowerCase();
  if (label.startsWith(f)) return 3;
  if (label.includes(f)) return 2;
  const alias = (it.alias || '').toLowerCase().split(/\s+/);
  if (alias.some((a) => a === f)) return 2;
  if (alias.some((a) => a.startsWith(f))) return 1;
  return 0;
}

/**
 * 过滤结果:跨组、按 label 去重、按得分稳定排序。
 * @returns {Array<{it,group,score}>|null} filter 为空时返回 null(表示按分组标签页展示)
 */
export function matchItems(groups, filter) {
  const f = String(filter || '').toLowerCase().trim();
  if (!f) return null;
  const seen = new Set();
  const out = [];
  let order = 0;
  groups.forEach(([gname, list]) => list.forEach((it) => {
    const score = matchScore(it, f);
    const at = order++;
    if (!score || seen.has(it.label)) return;
    seen.add(it.label);
    out.push({ it, group: gname, score, order: at }); /* order 为全局序:同分时靠前的分组优先 */
  }));
  return out.sort((a, b) => (b.score - a.score) || (a.order - b.order));
}

/* 触发条件(纯函数,测试直接断言):文档末尾刚插入的字符是否唤起面板 */
export function isTrigger({ parentType, parentOffset, oldPos, newPos, oldEmpty }) {
  if (parentType !== 'paragraph' && parentType !== 'heading') return null;
  if (!oldEmpty || oldPos + 1 !== newPos || parentOffset < 1) return null;
  return true;
}

export function mountSlashMenu(inst) {
  const ed = inst.editor;
  const GROUPS = buildGroups();
  const dom = ed.view.dom;
  /* 键盘监听挂在编辑区外层并走捕获:事件目标恰为 view.dom 本身时,直接挂在 view.dom 上的
     监听与 ProseMirror 自带监听同处目标阶段、按注册先后执行(PM 在前),捕获优势失效 */
  const keyHost = dom.parentNode || dom;
  let open = false;
  let filter = '';
  let anchor = null; /* { pos: 触发符文档位置, off: 其在文本块内的偏移, ch, depth } */
  let groupIdx = 0;
  let activeIdx = 0;
  let items = []; /* 当前可选项 [{it,group}] */
  let panel = null;
  let listEl = null;

  const close = () => {
    open = false;
    anchor = null;
    filter = '';
    window.removeEventListener('scroll', onScroll, true);
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    listEl = null;
  };

  /* 触发符到光标的真实文本;触发符已删/光标回退 → null */
  const currentFilter = (state) => {
    if (!open || !anchor) return null;
    const { $from } = state.selection;
    if (!$from.parent.isTextblock || $from.depth !== anchor.depth) return null;
    const off = $from.parentOffset;
    if (off <= anchor.off) return null;
    if ($from.parent.textBetween(anchor.off, anchor.off + 1) !== anchor.ch) return null;
    const text = $from.parent.textBetween(anchor.off + 1, off);
    if (text.length > 24 || /[\n\r]/.test(text)) return null;
    return text;
  };

  const pick = (idx) => {
    const entry = items[idx];
    if (!entry || !anchor) return;
    const { $from } = ed.state.selection;
    const trigPos = anchor.pos;
    const to = $from.pos;
    close();
    /* 先删「触发符 + 过滤词」再执行:转换类动作作用于已清空的段落,不留残字 */
    if (trigPos < to) ed.chain().focus().deleteRange({ from: trigPos, to }).run();
    try { entry.it.run(ed, inst); } catch (e) {
      console.error('[lry-editor] 斜杠面板执行失败:' + entry.it.label, e);
      toast('操作失败:' + e.message, 'error');
    }
  };

  const mark = () => {
    if (!listEl) return;
    [...listEl.children].forEach((c, i) => c.classList.toggle('lry-menu-active', i === activeIdx));
    const cur = listEl.children[activeIdx];
    if (cur && cur.scrollIntoView) {
      try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 无实现环境忽略 */ }
    }
  };

  /* 面板定位:光标下方,视口内收敛;下方放不下翻到光标上方;上边界避让站点固定页头 */
  const place = () => {
    if (!panel) return;
    const p = caretPoint();
    const pw = panel.offsetWidth || 300;
    const ph = panel.offsetHeight || 260;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minTop = fixedTopInset() + 4;
    panel.style.left = Math.max(8, Math.min(p.x, vw - pw - 8)) + 'px';
    panel.style.top = (p.y + ph > vh - 8 ? Math.max(minTop, p.y - p.h - ph - 8) : Math.max(minTop, p.y)) + 'px';
  };
  const onScroll = () => { if (open) place(); };

  const draw = () => {
    if (!open || !panel) return;
    const matched = matchItems(GROUPS, filter);
    items = [];
    panel.textContent = '';
    if (!matched) {
      /* 无过滤:分组标签页 + 当前组 */
      const tabs = h('div', { class: 'lry-slash-tabs' });
      GROUPS.forEach(([name], i) => {
        tabs.appendChild(h('button', {
          type: 'button',
          class: 'lry-tab' + (i === groupIdx ? ' lry-tab-active' : ''),
          onclick: (e) => { e.stopPropagation(); groupIdx = i; activeIdx = 0; draw(); }
        }, name));
      });
      panel.appendChild(tabs);
      GROUPS[groupIdx][1].forEach((it) => items.push({ it, group: GROUPS[groupIdx][0] }));
    } else {
      matched.forEach((m) => items.push(m));
    }
    listEl = h('div', { class: 'lry-slash-list' });
    if (!items.length) listEl.appendChild(h('div', { class: 'lry-menu-item lry-menu-disabled' }, '无匹配项'));
    items.forEach((entry, i) => {
      listEl.appendChild(h('button', {
        type: 'button',
        class: 'lry-menu-item lry-slash-item',
        onmouseenter: () => { if (activeIdx !== i) { activeIdx = i; mark(); } },
        onclick: (e) => { e.preventDefault(); pick(i); }
      },
      h('span', { class: 'lry-menu-text' }, entry.it.label),
      !matched && entry.it.hint ? h('span', { class: 'lry-menu-hint' }, entry.it.hint) : null,
      matched ? h('span', { class: 'lry-menu-hint' }, entry.group) : null));
    });
    if (activeIdx >= items.length) activeIdx = Math.max(0, items.length - 1);
    panel.appendChild(listEl);
    mark();
    place();
  };

  let prevState = ed.state; /* 上一状态:判断"光标是否因刚插入一个字符而前进 1" */
  const onTransaction = ({ transaction }) => {
    const oldState = prevState;
    prevState = ed.state;
    if (open) {
      const f = currentFilter(ed.state);
      if (f === null) { close(); return; }
      if (f !== filter) { filter = f; activeIdx = 0; draw(); } else place();
      return;
    }
    if (!transaction.docChanged) return;
    const oldSel = oldState.selection;
    const sel = ed.state.selection;
    const $from = sel.$from;
    if (!isTrigger({ parentType: $from.parent.type.name, parentOffset: $from.parentOffset, oldPos: oldSel.$from.pos, newPos: $from.pos, oldEmpty: oldSel.empty })) return;
    const off = $from.parentOffset;
    const ch = $from.parent.textBetween(off - 1, off);
    const prev = off >= 2 ? $from.parent.textBetween(off - 2, off - 1) : '';
    const atLineStart = off === 1;
    const hit = (ch === '/' && (atLineStart || /\s/.test(prev))) || (ch === '+' && atLineStart);
    if (!hit) return;
    open = true;
    filter = '';
    groupIdx = 0;
    activeIdx = 0;
    anchor = { pos: $from.pos - 1, off: off - 1, ch, depth: $from.depth };
    panel = h('div', { class: 'lry-popover lry-slash-pop' });
    /* 面板内按下不抢焦点(保住编辑器选区与光标) */
    panel.addEventListener('mousedown', (e) => e.preventDefault());
    (inst.options.doc || document).body.appendChild(panel);
    window.addEventListener('scroll', onScroll, true);
    draw();
  };

  const onKey = (e) => {
    if (!open) return;
    if (e.isComposing || e.keyCode === 229) return; /* 输入法合成期间不拦截 */
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      activeIdx = (activeIdx + d + items.length) % items.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      pick(activeIdx);
    }
  };
  const onMousedown = (e) => {
    if (open && panel && !panel.contains(e.target)) close();
  };

  ed.on('transaction', onTransaction);
  ed.on('blur', () => { if (open) close(); });
  keyHost.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onMousedown, true);

  inst._slashCleanup = () => {
    close();
    ed.off('transaction', onTransaction);
    keyHost.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onMousedown, true);
  };
}

export const slashItemCount = () => buildGroups().reduce((n, g) => n + g[1].length, 0);
