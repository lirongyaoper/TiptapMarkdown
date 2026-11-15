/**
 * 代码块 NodeView 升级(2026-11-15,语雀式):
 * 顶栏(语言标签+复制按钮)+ 行号列 + pre(编辑区)。
 * 序列化不变(仍 pre.brush:),getHTML 走 renderHTML,本视图仅编辑态增强。
 */
function parseBrush(cls) {
  const m = /brush:([^;]+)/.exec(cls || '');
  return m ? m[1].trim() : 'plain';
}

export function codeBlockNodeView(inst) {
  const LANG_NAMES = { js: 'JavaScript', php: 'PHP', python: 'Python', html: 'HTML', css: 'CSS',
    sql: 'SQL', bash: 'Bash', java: 'Java', cpp: 'C/C++', c: 'C', ts: 'TypeScript', plain: '纯文本' };
  /* Tiptap v3 NodeView 工厂签名:对象参数 */
  return ({ node, view, getPos }) => {
    const box = document.createElement('div');
    box.className = 'lry-codebox';
    const bar = document.createElement('div');
    bar.className = 'lry-codebar';
    const lang = document.createElement('span');
    lang.className = 'lry-codebar-lang';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'lry-codebar-copy';
    copy.textContent = '复制';
    copy.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const text = node.textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => {
        copy.textContent = '已复制';
        setTimeout(() => { copy.textContent = '复制'; }, 1200);
      });
    });
    bar.appendChild(lang);
    bar.appendChild(copy);

    const gutter = document.createElement('div');
    gutter.className = 'lry-codegutter';
    /* contentDOM 与 schema 结构严格一致:pre 直接承载内容(契约无 code 子层) */
    const pre = document.createElement('pre');
    pre.className = node.attrs.cls || '';

    const syncDecor = () => {
      const brush = parseBrush(node.attrs.cls);
      lang.textContent = LANG_NAMES[brush] || brush;
      const lines = Math.max(1, node.textContent.split('\n').length);
      let g = '';
      for (let i = 1; i <= lines; i++) g += i + '\n';
      gutter.textContent = g;
    };
    syncDecor();

    box.appendChild(bar);
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'lry-codebody';
    bodyWrap.appendChild(gutter);
    bodyWrap.appendChild(pre);
    box.appendChild(bodyWrap);

    return {
      dom: box,
      contentDOM: pre,
      update(n) {
        if (n.type.name !== 'codeBlock') return false;
        if (n.attrs.cls !== node.attrs.cls) pre.className = n.attrs.cls || '';
        node = n;
        syncDecor();
        return true;
      },
      ignoreMutation(m) {
        return !box.contains(m.target) || m.target === gutter || m.target === bar || bar.contains(m.target);
      }
    };
  };
}
