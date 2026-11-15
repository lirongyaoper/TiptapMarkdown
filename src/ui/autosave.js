/**
 * 自动保存(2026-11-15,语雀式"云端自动保存"的本地版):
 * - 变更后防抖 2s 写 localStorage(键含路径+字段名)
 * - 再次进入:有存档且与初始内容不同 → 顶部恢复条(恢复/放弃)
 * - 表单提交与编辑器销毁时清除
 */
export function mountAutosave(inst) {
  const key = 'lry-autosave-' + location.pathname + '-' + (inst.textarea.name || 'content');
  let timer = null;
  const initialHtml = inst.editor.getHTML();

  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify({ html: inst.editor.getHTML(), time: Date.now() }));
    } catch (e) { /* 隐私模式/超限忽略 */ }
  };
  inst.editor.on('update', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 2000);
  });

  /* 恢复条 */
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { saved = null; }
  if (saved && saved.html && saved.html !== initialHtml) {
    const bar = document.createElement('div');
    bar.className = 'lry-autosave-bar';
    const mins = Math.max(1, Math.round((Date.now() - saved.time) / 60000));
    bar.innerHTML = '<span>检测到 ' + mins + ' 分钟前自动保存的未提交内容</span>';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'lry-btn lry-btn-primary';
    restore.textContent = '恢复';
    restore.addEventListener('click', () => {
      inst.setContent(saved.html);
      bar.remove();
    });
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'lry-btn';
    drop.textContent = '放弃';
    drop.addEventListener('click', () => {
      localStorage.removeItem(key);
      bar.remove();
    });
    bar.appendChild(restore);
    bar.appendChild(drop);
    inst.wrapper.prepend(bar);
  }

  const clear = () => {
    if (timer) clearTimeout(timer);
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  };
  if (inst.form) inst.form.addEventListener('submit', clear, true);
  const origDestroy = inst.destroy.bind(inst);
  inst.destroy = function () { clear(); origDestroy(); };
}
