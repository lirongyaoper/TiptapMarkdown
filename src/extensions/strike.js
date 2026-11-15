/**
 * 删除线:解析 s/del/strike(含旧 UEditor 与 md-core 的 <del> 形态),
 * 统一序列化为 <del>(站点契约:md-core 产出与前台渲染均按 del 处理)。
 */
import Strike from '@tiptap/extension-strike';

export const LryStrike = Strike.extend({
  parseHTML() {
    return [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['del', HTMLAttributes, 0];
  }
});
