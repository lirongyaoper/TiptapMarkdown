/**
 * Markdown 粘贴识别:纯文本剪贴板 + looksLikeMarkdown 评分 ≥2 → 转换插入。
 * 评分逻辑逐行平移自旧 ueditor.all.js markdown-paste 插件(2026-11-15)。
 */
/* 2026-11-23 v1.2.0:粘贴增强共用 */
import { Slice } from '@tiptap/pm/model';
import { ensureShowdown, safeMdToHtml, normalizeYuqueHtml } from './ensure.js';

function looksLikeMarkdown(text) {
  if (!text || text.length < 6) return false;
  const lines = text.split('\n');
  let ulLines = 0, olLines = 0, headings = 0, quotes = 0;
  let sampled = 0, codeLines = 0, inFence = false;
  for (let i = 0; i < lines.length && i < 200; i++) {
    const line = lines[i];
    sampled++;
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { codeLines++; continue; }
    if (/^#{1,6}\s+\S/.test(line)) headings++;
    else if (/^\s*[-*+]\s+\S/.test(line)) ulLines++;
    else if (/^\s*\d{1,3}[.、)]\s+\S/.test(line)) olLines++;
    else if (/^>\s?\S/.test(line)) quotes++;
  }
  if (sampled >= 3 && codeLines / sampled > 0.8) return false;
  let score = 0;
  if (headings > 0) score += 2;
  if (/^(```|~~~)/m.test(text)) score += 2;
  if (/\[[^\]\n]+\]\([^\)\n]+\)/.test(text)) score += 2;
  if (/!\[[^\]\n]*\]\([^\)\n]+\)/.test(text)) score += 2;
  if (/\*\*[^*\n]+\*\*/.test(text) || /~~[^~\n]+~~/.test(text)) score += 1;
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[0] || '')) score += 1;
  if (ulLines >= 2) score += 1;
  if (olLines >= 2) score += 1;
  if (quotes >= 1 && headings + ulLines + olLines > 0) score += 1;
  return score >= 2;
}

/**
 * Markdown 文本 → 富文本插入(粘贴识别 / 导入对话框 / .md 文件拖入共用)。
 * showdown 缺失或转换失败时原样按纯文本插入,绝不丢内容。
 */
export async function insertMarkdownText(inst, text) {
  let out = null;
  try {
    await ensureShowdown();
    out = safeMdToHtml(text);
  } catch (e) { out = null; }
  if (out === null) {
    console.warn('[lry-editor] Markdown 转换失败,回退原文', text.slice(0, 80));
    inst.editor.chain().insertContent(text).run();
    return false;
  }
  inst.editor.chain().insertContent(normalizeYuqueHtml(out)).run();
  return true;
}

export async function readMarkdownFile(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('读取文件失败'));
    r.readAsText(file);
  });
}

/**
 * .md 文件导入(2026-11-23:编辑区拖入 .md/.markdown 文件):读文本 → 转换插入。
 */
export async function importMarkdownFile(inst, file) {
  let text = '';
  try {
    text = await readMarkdownFile(file);
  } catch (e) {
    inst.editor.chain().insertContent(file.name).run();
    return false;
  }
  return insertMarkdownText(inst, text);
}

/**
 * 粘贴的 HTML 里带代码块时,整段按块结构插入(2026-11-24)。
 *
 * 背景:ProseMirror 的默认落位会把切片两端的文本块"打开"并与光标所在段落融合。
 * 只含一个 <pre> 的切片因此被摊成段落里的纯文本——从网页、GitHub、VS Code、其它
 * 编辑器复制来的代码块连同语言一并丢失,在空行上粘贴也是如此(自 11-15 起一直如此)。
 * 这里把切片闭合后整段插入:代码块是代码块,前后的文字各归其段。
 * 光标已在代码块内时不接管:那种情况要把代码文字续写进当前代码块。
 */
export function handleCodeBlockPaste(inst, slice) {
  if (!slice || !slice.content || !slice.content.size || inst._pastePlain) return false;
  const ed = inst.editor;
  if (ed.state.selection.$from.parent.type.spec.code === true) return false;
  let has = false;
  slice.content.descendants((n) => {
    if (n.type.name === 'codeBlock') has = true;
    return !has;
  });
  if (!has) return false;
  const tr = ed.state.tr.replaceSelection(new Slice(slice.content, 0, 0))
    .scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste');
  ed.view.dispatch(tr);
  return true;
}

/**
 * 粘贴增强(同步返回 true 表示已接管):
 * - Ctrl/⌘+Shift+V:强制按纯文本插入(逐行成段,不带任何源格式)
 * - 选中文本后粘贴单个网址:把选中文字转成链接(Notion/语雀同款)
 */
export function handlePasteEnhance(inst, event) {
  const cd = event.clipboardData;
  if (!cd) return false;
  const ed = inst.editor;
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !inst._pastePlain) {
    const text = cd.getData('text/plain');
    if (!text) return false;
    event.preventDefault();
    ed.chain().insertContent(text.split(/\r?\n/).map((line) => ({
      type: 'paragraph', content: line ? [{ type: 'text', text: line }] : []
    }))).run();
    return true;
  }
  const { empty } = ed.state.selection;
  if (empty) return false;
  const text = cd.getData('text/plain').trim();
  if (!text || text.length > 2000 || /[\s<>"]/.test(text)) return false;
  if (!/^(?:https?:\/\/|www\.)[^\s<>"']+$/i.test(text)) return false;
  const href = /^https?:\/\//i.test(text) ? text : 'https://' + text;
  event.preventDefault();
  /* 与链接对话框一致:新窗口打开带 rel=noopener */
  ed.chain().setLink({ href, target: '_blank', rel: 'noopener' }).run();
  return true;
}

/**
 * 处理粘贴事件;同步返回 true 表示已拦截(转换异步进行)。
 * 仅当剪贴板无富文本(纯文本粘贴)且评分达标时转换。
 */
export function handleMarkdownPaste(inst, event, clipboardData) {
  if (inst._pastePlain) return false;
  const html = clipboardData.getData('text/html');
  if (html && html.replace(/<[^>]+>/g, '').trim()) return false;
  const text = clipboardData.getData('text/plain');
  if (!text || !looksLikeMarkdown(text)) return false;

  event.preventDefault();
  insertMarkdownText(inst, text).catch((e) => {
    console.warn('[lry-editor] markdown 粘贴转换失败,回退原文', e);
    inst.editor.chain().insertContent(text).run();
  });
  return true;
}
