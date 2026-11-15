/**
 * 输出后处理:getHTML 之后做最小结构归一,保持与旧 UEditor 序列化形态一致。
 *
 * PM 解析会把 td/th/li 内的裸文本包成 <p>(schema 要求块内容);旧 UEditor
 * 从不产出 td>p / li>p。对"仅含一个无属性 p"的 td/th/li 解包 —— 多块
 * (Tiptap 编辑产生)原样保留,单块裸文本回退旧形态,结构计数稳定。
 */

export function postprocessOutput(html, doc) {
  if (!html || html.indexOf('<p') < 0 && html.indexOf('<table') < 0) return html;
  const dom = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  const root = dom.body;
  let touched = false;

  /* td/th/li 内单无属性 p 解包(旧 UEditor 形态) */
  root.querySelectorAll('td, th, li').forEach(function (cell) {
    if (cell.children.length !== 1) return;
    const p = cell.firstElementChild;
    if (p.tagName !== 'P') return;
    if (p.attributes.length > 0) return;
    const frag = dom.createDocumentFragment();
    while (p.firstChild) frag.appendChild(p.firstChild);
    cell.replaceChild(frag, p);
    touched = true;
  });

  /* 表格 thead 重组:Tiptap 序列化把所有 tr 平铺进单个 tbody,
     站点契约(旧 UEditor/前台样式)要求表头行在 thead 内 */
  root.querySelectorAll('table').forEach(function (table) {
    if (table.querySelector('thead')) return;
    const tbody = table.querySelector(':scope > tbody');
    const rows = tbody ? [...tbody.children] : [...table.querySelectorAll(':scope > tr')];
    if (!rows.length) return;
    let headEnd = 0;
    while (headEnd < rows.length && rows[headEnd].children.length
      && [...rows[headEnd].children].every((c) => c.tagName === 'TH')) headEnd++;
    if (headEnd === 0) return; /* 无表头行:保持原样 */
    const thead = dom.createElement('thead');
    for (let i = 0; i < headEnd; i++) thead.appendChild(rows[i]);
    table.insertBefore(thead, tbody || rows[headEnd] || null);
    touched = true;
  });

  return touched ? root.innerHTML : html;
}
