/**
 * AI 助手面板(2026-11-15 由旧 Vue2 对话框原生重写,对齐 attachment/editor/ai 新端点)
 * 功能:翻译/续写/摘要/丰富/优化整篇 + 自由输入;SSE 流式;插入/替换选区。
 */
import { h, dialog, toast } from '../ui/dom.js';
import { getAdapter } from '../adapters.js';

const CSRF = () => (window.LRY_CSRF_TOKEN || window.lry_csrf_token || '');

const FUNCTIONS = [
  { key: 'translate', label: '翻译', prompt: '请将下面的内容翻译成英文,保持原有格式:\n\n{selectText}' },
  { key: 'continueWrite', label: '续写', prompt: '请根据下面的内容继续续写,保持文风一致:\n\n{selectText}' },
  { key: 'summarize', label: '摘要', prompt: '请用简洁的中文总结下面内容的要点:\n\n{html}' },
  { key: 'extend', label: '丰富', prompt: '请对下面的内容进行扩写丰富,使其更详细生动:\n\n{selectText}' },
  { key: 'optimizeWhole', label: '优化', prompt: '请优化下面整篇文章的表达,使其更流畅专业:\n\n{html}' },
  /* 语雀式 AI(2026-11-15):mermaid 输出自动转画板块 */
  { key: 'outline', label: '生成大纲', prompt: '请为下面的内容生成层级大纲(用「标题一/标题二」缩进文本),仅输出大纲本身:\n\n{html}' },
  { key: 'flowchart', label: '画流程图', prompt: '请把下面内容的核心流程画成 mermaid flowchart。仅输出 mermaid 源码(以 graph TD 开头,不要围栏不要解释):\n\n{html}' },
  { key: 'mindmap', label: '画思维导图', prompt: '请把下面内容的知识结构画成 mermaid mindmap。仅输出 mermaid 源码(以 mindmap 开头,不要围栏不要解释):\n\n{html}' }
];

/* mermaid 源识别:输出直接变画板块 */
const MERMAID_HEADS = ['graph ', 'graph\n', 'flowchart', 'sequencediagram', 'mindmap', 'classdiagram', 'statediagram', 'gantt', 'pie', 'erdiagram', 'journey'];
function looksMermaid(text) {
  const t = String(text || '').trim().toLowerCase().replace(/^[\r\n]+/, '');
  return MERMAID_HEADS.some((h) => t.startsWith(h));
}

export function mountAiPanel(inst) {
  inst.aiApi = { open: () => openPanel(inst) };
}
let edInst = null;

function openPanel(inst) {
  edInst = inst;
  const ed = inst.editor;
  const input = h('textarea', { class: 'lry-input', rows: 3, placeholder: '输入指令或问题,选中内容会作为上下文…' });
  const output = h('div', { class: 'lry-ai-output' }, h('div', { class: 'lry-ai-placeholder' }, 'AI 结果将在这里流式输出'));
  const btnRow = h('div', { class: 'lry-btn-row' });
  const actions = h('div', { class: 'lry-btn-row', style: { marginTop: 8, display: 'none' } });
  let resultText = '';
  let streamAbort = null;

  const insertBtn = h('button', { type: 'button', class: 'lry-btn lry-btn-primary', onclick: () => {
    if (looksMermaid(resultText)) {
      /* AI 画图输出 → 画板块 */
      ed.chain().focus().insertMermaid(resultText.trim().replace(/^```[a-z]*\n?|```$/g, '')).run();
    } else {
      ed.chain().focus().insertContent(resultText).run();
    }
    api.close();
  } }, '插入到光标处');
  const replaceBtn = h('button', { type: 'button', class: 'lry-btn', onclick: () => {
    const { from, to } = ed.state.selection;
    if (from === to) { toast('请先选中要替换的内容', 'error'); return; }
    ed.chain().focus().insertContentAt({ from, to }, resultText).run();
    api.close();
  } }, '替换选区');
  actions.append(insertBtn, replaceBtn);

  async function run(prompt) {
    if (streamAbort) return;
    output.innerHTML = '';
    resultText = '';
    actions.style.display = 'none';
    const status = h('div', { class: 'lry-ai-status' }, '生成中…');
    output.appendChild(status);
    try {
      streamAbort = 'running';
      status.remove();
      /* 经 adapter:memory=mock, url=SSE 流式, 自定义=任意实现 */
      const adapter = getAdapter(edInst);
      resultText = await adapter.ai([{ role: 'user', content: prompt }]);
      output.textContent = resultText;
      output.scrollTop = output.scrollHeight;
      if (resultText) actions.style.display = 'flex';
      else output.textContent = '(空响应)';
    } catch (e) {
      if (streamAbort !== 'abort') {
        output.textContent = '请求失败:' + e.message;
      }
    } finally {
      streamAbort = null;
    }
  }

  FUNCTIONS.forEach((f) => {
    btnRow.appendChild(h('button', {
      type: 'button', class: 'lry-btn',
      onclick: () => {
        const sel = ed.state.selection;
        const selectText = sel.empty ? '' : ed.state.doc.textBetween(sel.from, sel.to, '\n');
        let prompt = f.prompt;
        if (prompt.includes('{selectText}') && !selectText) {
          toast('该功能需要先选中内容', 'error');
          return;
        }
        prompt = prompt.replace('{selectText}', selectText).replace('{html}', ed.getHTML());
        run(prompt);
      }
    }, f.label));
  });
  btnRow.appendChild(h('button', {
    type: 'button', class: 'lry-btn lry-btn-primary',
    onclick: () => {
      const v = input.value.trim();
      if (!v) { toast('请输入指令', 'error'); return; }
      const sel = ed.state.selection;
      const selectText = sel.empty ? '' : ed.state.doc.textBetween(sel.from, sel.to, '\n');
      run(selectText ? selectText + '\n\n指令:' + v : v);
    }
  }, '发送'));

  const api = dialog({
    title: 'AI 助手', width: '560px', noFooter: true,
    onClose() { if (streamAbort === 'running') streamAbort = 'abort'; },
    body: h('div', null, btnRow, input, output, actions)
  });
}
