/**
 * 斜杠面板 2.0(语雀式 40+ 卡片,2026-11-15):
 * 段落内输入 "/" 或行首 "+" 唤起;分组标签页;输入过滤(支持拼音首字母)。
 * 分组:常用 / 基础卡片 / 布局和样式 / 程序员专区 / 画板 / 小工具。
 */
import { h, popover, closePopover } from '../ui/dom.js';

const PY = { biaoti: '标题', biaoge: '表格', daima: '代码', gongshi: '公式', liuchengtu: '流程图', naotu: '脑图',
  zhedie: '折叠', fenlan: '分栏', zhuangtai: '状态', tupian: '图片', shipin: '视频', fujian: '附件',
  gaoliang: '高亮', liebiao: '列表', gantetu: '甘特', shixutu: '时序' };

function setHeading(ed, level) { ed.chain().focus().toggleHeading({ level }).run(); }

const GROUPS = [
  ['常用', [
    { label: '标题 H1', hint: '#', run: (ed) => setHeading(ed, 1) },
    { label: '标题 H2', hint: '##', run: (ed) => setHeading(ed, 2) },
    { label: '标题 H3', hint: '###', run: (ed) => setHeading(ed, 3) },
    { label: '标题 H4', hint: '####', run: (ed) => setHeading(ed, 4) },
    { label: '标题 H5', hint: '#####', run: (ed) => setHeading(ed, 5) },
    { label: '标题 H6', hint: '######', run: (ed) => setHeading(ed, 6) },
    { label: '正文', hint: 'p', run: (ed) => ed.chain().focus().setParagraph().run() },
    { label: '引用', hint: '>', run: (ed) => ed.chain().focus().toggleBlockquote().run() },
    { label: '无序列表', hint: '-', run: (ed) => ed.chain().focus().toggleBulletList().run() },
    { label: '有序列表', hint: '1.', run: (ed) => ed.chain().focus().toggleOrderedList().run() },
    { label: '代码块', hint: '```', run: (ed) => ed.chain().focus().setCodeBlockLang('plain').run() },
    { label: '表格', hint: '3x3', run: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: '图片', hint: 'img', run: () => document.querySelector('[data-cmd=insertimage]').click() },
    { label: '分割线', hint: '---', run: (ed) => ed.chain().focus().setHorizontalRule().run() },
    { label: '公式(块级)', hint: '$$', run: (ed) => ed.chain().focus().insertContent({ type: 'lryMathBlock', attrs: { tex: 'E=mc^2' } }).run() }
  ]],
  ['基础卡片', [
    { label: '图片', run: () => document.querySelector('[data-cmd=insertimage]').click() },
    { label: '表格', run: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: '附件卡(文件嵌入)', run: () => document.querySelector('[data-cmd=attachment]') && document.querySelector('[data-cmd=attachment]').click() },
    { label: '状态卡·进行中', run: (ed) => ed.chain().focus().insertStatus('info', '进行中').run() },
    { label: '状态卡·已完成', run: (ed) => ed.chain().focus().insertStatus('ok', '已完成').run() },
    { label: '状态卡·待办', run: (ed) => ed.chain().focus().insertStatus('warn', '待办').run() },
    { label: '状态卡·失败', run: (ed) => ed.chain().focus().insertStatus('err', '失败').run() },
    { label: '状态卡·已归档', run: (ed) => ed.chain().focus().insertStatus('done', '已归档').run() }
  ]],
  ['布局和样式', [
    /* 统一 lry-card 四色体系(与 md-core :::info 语法/前台 CSS 对齐;
       lry-alert 五类仅作存量解析兼容,不再是插入入口) */
    { label: '高亮块·信息', run: (ed) => ed.chain().focus().insertContent('<blockquote class="lry-card lry-card-info"><p>信息内容</p></blockquote>').run() },
    { label: '高亮块·成功', run: (ed) => ed.chain().focus().insertContent('<blockquote class="lry-card lry-card-success"><p>成功内容</p></blockquote>').run() },
    { label: '高亮块·警示', run: (ed) => ed.chain().focus().insertContent('<blockquote class="lry-card lry-card-warning"><p>警示内容</p></blockquote>').run() },
    { label: '高亮块·危险', run: (ed) => ed.chain().focus().insertContent('<blockquote class="lry-card lry-card-danger"><p>危险内容</p></blockquote>').run() },
    { label: '折叠块', run: (ed) => ed.chain().focus().insertFold().run() },
    { label: '两栏布局', run: (ed) => ed.chain().focus().insertCols(2).run() },
    { label: '三栏布局', run: (ed) => ed.chain().focus().insertCols(3).run() },
    { label: '目录(TOC)', run: (ed) => ed.chain().focus().insertContent('<p class="lry-toc">[TOC]</p>').run() }
  ]],
  ['程序员专区', [
    { label: '代码块', run: (ed) => ed.chain().focus().setCodeBlockLang('plain').run() },
    { label: '公式·行内', run: (ed) => ed.chain().focus().insertContent({ type: 'lryMathInline', attrs: { tex: 'x^2' } }).run() },
    { label: '公式·块级', run: (ed) => ed.chain().focus().insertContent({ type: 'lryMathBlock', attrs: { tex: 'E=mc^2' } }).run() },
    { label: '流程图', run: (ed) => ed.chain().focus().insertMermaid('graph TD\nA[开始] --> B{条件?}\nB -->|是| C[处理]\nB -->|否| D[结束]\nC --> D').run() },
    { label: '时序图', run: (ed) => ed.chain().focus().insertMermaid('sequenceDiagram\nparticipant 用户\nparticipant 服务器\n用户->>服务器: 请求\n服务器-->>用户: 响应').run() },
    { label: '类图(UML)', run: (ed) => ed.chain().focus().insertMermaid('classDiagram\nclass 文章 {\n  +标题\n  +发布()\n}\nclass 评论 {\n  +内容\n}').run() },
    { label: '状态图', run: (ed) => ed.chain().focus().insertMermaid('stateDiagram-v2\n[*] --> 草稿\n草稿 --> 发布: 审核\n发布 --> [*]').run() }
  ]],
  ['画板', [
    { label: '流程图', run: (ed) => ed.chain().focus().insertMermaid('graph TD\nA[开始] --> B{条件?}\nB -->|是| C[处理]\nB -->|否| D[结束]\nC --> D').run() },
    { label: '思维导图', run: (ed) => ed.chain().focus().insertMermaid('mindmap\n  根主题\n    分支一\n      要点1\n      要点2\n    分支二\n      要点3').run() },
    { label: '架构图', run: (ed) => ed.chain().focus().insertMermaid('graph LR\nnginx --> php-fpm\nphp-fpm --> mysql\nphp-fpm --> oss').run() },
    { label: '甘特图', run: (ed) => ed.chain().focus().insertMermaid('gantt\n  title 项目计划\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  需求 :a1, 2026-11-16, 7d\n  section 阶段二\n  开发 :a2, after a1, 14d').run() },
    { label: '饼图', run: (ed) => ed.chain().focus().insertMermaid('pie title 占比\n  "A" : 60\n  "B" : 40').run() }
  ]],
  ['小工具', [
    { label: '今日日期', run: (ed) => ed.chain().focus().insertContent(new Date().toLocaleDateString('zh-CN')).run() },
    { label: '当前时间', run: (ed) => ed.chain().focus().insertContent(new Date().toLocaleTimeString('zh-CN', { hour12: false })).run() },
    { label: '锚点', run: () => document.querySelector('[data-cmd=anchor]') && document.querySelector('[data-cmd=anchor]').click() },
    { label: '特殊字符', run: () => document.querySelector('[data-cmd=spechars]') && document.querySelector('[data-cmd=spechars]').click() },
    { label: '分页符', run: (ed) => ed.chain().focus().insertPageBreak().run() },
    { label: '视频', run: () => document.querySelector('[data-cmd=insertvideo]').click() },
    { label: '音频', run: () => document.querySelector('[data-cmd=insertaudio]').click() }
  ]]
];

function allCount() { return GROUPS.reduce((n, g) => n + g[1].length, 0); }

/* 光标屏幕坐标 */
function caretPoint() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const rect = range.getBoundingClientRect();
  if (rect && (rect.top || rect.left)) return { x: rect.left, y: rect.bottom + 4 };
  const span = document.createElement('span');
  span.textContent = '\u200b';
  range.insertNode(span);
  const r2 = span.getBoundingClientRect();
  span.parentNode.removeChild(span);
  return { x: r2.left, y: r2.bottom + 4 };
}

function matchItem(it, filter) {
  if (!filter) return true;
  if (it.label.includes(filter)) return true;
  for (const k in PY) if (filter === k || k.startsWith(filter)) return PY[k] === it.label.slice(0, PY[k].length) || it.label.includes(PY[k]);
  return false;
}

export function mountSlashMenu(inst) {
  const ed = inst.editor;
  let open = false;
  let filter = '';
  let groupIdx = 0;

  const dom = ed.view.dom;
  const onKey = (e) => {
    if (!open) {
      if (e.key === '/' || e.key === '+') {
        const { $from } = ed.state.selection;
        const inPara = ['paragraph', 'heading'].includes($from.parent.type.name);
        if (!inPara) return;
        if (e.key === '+' && $from.parentOffset !== 0) return;
        setTimeout(() => show(), 0);
      }
      return;
    }
    if (e.key === 'Escape') { closePopover(); open = false; return; }
    if (e.key === 'Backspace') {
      filter = filter.slice(0, -1);
      if (!filter) { closePopover(); open = false; }
      else render();
      return;
    }
    if (e.key.length === 1) { filter += e.key; render(); }
  };
  const onMousedown = (e) => {
    if (open && !e.target.closest('.lry-popover')) { closePopover(); open = false; }
  };
  dom.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onMousedown, true);

  function render() {
    const anchor = document.createElement('span');
    const p = caretPoint();
    anchor.style.cssText = 'position:fixed;left:' + (p ? p.x : 100) + 'px;top:' + (p ? p.y : 100) + 'px';
    document.body.appendChild(anchor);

    const panel = h('div', { class: 'lry-slash' });
    const tabs = h('div', { class: 'lry-slash-tabs' });
    GROUPS.forEach(([name], i) => {
      tabs.appendChild(h('button', {
        type: 'button',
        class: 'lry-tab' + (i === groupIdx ? ' lry-tab-active' : ''),
        onclick: (e) => { e.stopPropagation(); groupIdx = i; render(); }
      }, name));
    });
    const list = h('div', { class: 'lry-slash-list' });
    const items = GROUPS[groupIdx][1].filter((it) => matchItem(it, filter));
    if (!items.length) {
      list.appendChild(h('div', { class: 'lry-menu-item lry-menu-disabled' }, '无匹配项'));
    }
    items.forEach((it) => {
      list.appendChild(h('button', {
        type: 'button', class: 'lry-menu-item',
        onclick: () => {
          const del = filter.length + 1;
          const { from, to } = ed.state.selection;
          ed.chain().focus().deleteRange({ from: Math.max(0, from - del), to }).run();
          it.run(ed);
          closePopover(); open = false;
        }
      }, h('span', { class: 'lry-menu-text' }, it.label), it.hint ? h('span', { class: 'lry-menu-hint' }, it.hint) : null));
    });
    panel.appendChild(tabs);
    panel.appendChild(list);
    popover(anchor, panel, { className: 'lry-slash-pop' });
    setTimeout(() => { if (anchor.parentNode) anchor.parentNode.removeChild(anchor); }, 0);
  }
  function show() {
    open = true;
    filter = '';
    groupIdx = 0;
    render();
  }

  inst._slashCleanup = () => {
    dom.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onMousedown, true);
  };
}

export const slashItemCount = allCount;
