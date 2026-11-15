/**
 * Markdown 粘贴识别:纯文本剪贴板 + looksLikeMarkdown 评分 ≥2 → 转换插入。
 * 评分逻辑逐行平移自旧 ueditor.all.js markdown-paste 插件(2026-11-15)。
 */
import { ensureShowdown, safeMdToHtml } from './ensure.js';

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
  (async () => {
    try {
      await ensureShowdown();
      const out = safeMdToHtml(text);
      if (out === null) throw new Error('转换失败');
      inst.editor.chain().focus().insertContent(out).run();
    } catch (e) {
      console.warn('[lry-editor] markdown 粘贴转换失败,回退原文', e);
      inst.editor.chain().focus().insertContent(text).run();
    }
  })();
  return true;
}
