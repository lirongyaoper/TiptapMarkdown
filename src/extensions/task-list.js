/**
 * 任务列表(2026-11-15 五轮,语雀式):
 * 节点名保持官方 taskList/taskItem(content 表达式按名互引,不可改名),
 * 只覆盖序列化层,契约与 md-core 双向闭环——
 *   存储: <ul class="lry-task"><li class="lry-task-item[ lry-task-done]">
 *          <span class="lry-task-check">☑/☐</span>内容…</li></ul>
 *   ☑/☐ 字符前缀正是 md-core stripTaskText 的反向识别标记(htmlToMarkdown
 *   转回 - [x]/- [ ]);class 带 lry- 前缀过白名单,被剥也不损语义(字符仍在)。
 * showdown 侧(li.task-list-item + input)由 normalize 层清洗成本契约形态。
 * 编辑态复用官方 NodeView(可点击 checkbox 切换勾选);序列化走本文件。
 */
import { TaskList as BaseTaskList, TaskItem as BaseTaskItem } from '@tiptap/extension-list';

export const LryTaskList = BaseTaskList.extend({
  parseHTML() {
    return [
      /* priority 压过 bulletList 的裸 ul 规则(PM 不按 CSS 特异性排序) */
      { tag: 'ul.lry-task', priority: 200 },
      { tag: 'ul[data-type="taskList"]', priority: 190 },
      { tag: 'ul.lry-md-task', priority: 180 }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes };
    delete attrs['data-type'];
    attrs.class = 'lry-task';
    return ['ul', attrs, 0];
  }
});

export const LryTaskItem = BaseTaskItem.extend({
  /* nested:true → content 'paragraph block*',与序列化的 div 容器吻合(官方亦如此) */
  addOptions() {
    const base = this.parent ? this.parent() : {};
    return { ...base, nested: true };
  },
  addAttributes() {
    return {
      /* 属性名保持官方 checked:官方 NodeView 勾选回调写 checked 键 */
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el) => {
          if (el.getAttribute('data-checked') !== null) return el.getAttribute('data-checked') === 'true';
          return el.classList.contains('lry-task-done');
        },
        renderHTML: () => ({}) /* 以 class 表达,见 renderHTML */
      }
    };
  },
  parseHTML() {
    return [
      /* contentElement(函数形态,找不到时回退整个 li 防 null 崩):
         解析只取内容容器 div,☑/☐ 标记字符不入内容(序列化标记非内容) */
      { tag: 'li.lry-task-item', priority: 200, contentElement: (el) => el.querySelector(':scope > div.lry-task-body') || el },
      { tag: 'li[data-type="taskItem"]', priority: 190, contentElement: (el) => el.querySelector(':scope > div') || el },
      { tag: 'li.task-list-item', priority: 180, contentElement: (el) => el.querySelector(':scope > div') || el } /* showdown 形态(normalize 后带 div) */
    ];
  },
  renderHTML({ node }) {
    /* PM 约束:content hole 不可与兄弟同层——内容包进容器 div;
       ☑/☐ 留在 li 首字符(md-core stripTaskText 反向识别 - [x]/- [ ]) */
    const done = !!node.attrs.checked;
    return ['li', { class: 'lry-task-item' + (done ? ' lry-task-done' : '') },
      ['span', { class: 'lry-task-check' }, done ? '☑' : '☐'],
      ['div', { class: 'lry-task-body' }, 0]];
  }
});
