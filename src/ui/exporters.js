/**
 * 导出与统计(2026-11-23 v1.2.0)。
 *
 * 导出菜单:Markdown(沿用分栏转换)/ 网页(.html)/ Word(.doc)/ 纯文本(.txt)。
 * - Word 导出走「HTML + Office 命名空间头」,Word/WPS 直接打开,不引三方库
 * - 站内相对地址(/uploads/…)按 window.LRY_EDITOR_EXPORT_BASE 或页面 origin
 *   补全为绝对地址(OSS/CDN 部署由页面注入基址)
 * - 导出内容即提交内容(getContent 契约形态),所见即所得
 *
 * 字数统计:中英文分列(中文按字、西文按词)+ 段落/标题数 + 预估阅读时间;
 * computeStats 为纯函数,单测直接断言。
 */
import { h, popover, closePopover, toast } from './dom.js';
import { ensureShowdown, safeHtmlToMd } from '../md/ensure.js';

const DOC_CSS = 'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.8;max-width:800px;margin:32px auto;padding:0 16px;color:#24292f}'
  + 'h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.4em 0 .6em}h1{font-size:1.9em}h2{font-size:1.55em}h3{font-size:1.3em}h4{font-size:1.12em}'
  + 'p{margin:0 0 1em}blockquote{margin:1em 0;padding:.4em 1em;border-left:4px solid #d0d7de;color:#57606a;background:#f6f8fa}'
  + 'pre{background:#f6f8fa;padding:12px 14px;border-radius:6px;overflow:auto;font:13px/1.6 Consolas,monospace;white-space:pre-wrap;tab-size:4}'
  + 'code{font-family:Consolas,monospace;font-size:.92em;background:#eff1f3;padding:1px 4px;border-radius:3px}pre code{background:none;padding:0}'
  + 'img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #d0d7de;padding:6px 10px}th{background:#f6f8fa}'
  + 'mark{background:#fff3b0}a{color:#0969da}ul,ol{padding-left:1.6em}li{margin:.2em 0}';
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD_RUN = /[\p{L}\p{N}_]+(?:['\u2019\-][\p{L}\p{N}_]+)*/gu;

/* 站内相对地址 → 绝对地址(仅 / 开头、非 // 协议相对) */
export function absoluteUrls(html) {
  let base = '';
  try { base = String(window.LRY_EDITOR_EXPORT_BASE || (window.location && window.location.origin) || '').replace(/\/$/, ''); } catch (e) { base = ''; }
  if (!base) return html;
  return String(html).replace(/\s(src|href)="(\/[^/"][^"]*)"/g, (m, attr, url) => ' ' + attr + '="' + base + url + '"');
}

export function buildDocument(title, body, forWord) {
  const t = String(title || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const head = forWord
    ? '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' + t + '</title>'
      + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->'
      + '<style>@page{margin:2cm;}body{max-width:none;margin:0;}</style>'
    : '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + t + '</title>';
  return head + '<style>' + DOC_CSS + '</style></head><body>' + body + '</body></html>';
}

function docTitle() {
  const input = document.querySelector('input[name=title], input[name=subject], input[name=notetitle]');
  const raw = (input && input.value) || (document.title || '') || 'lry-export';
  return raw.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || 'lry-export';
}

function download(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 1000);
}

/* 导出正文:去掉编辑器里无法离线呈现的活动内容 */
function exportBody(inst) {
  return absoluteUrls(inst.getContent()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportHtml(inst) {
  download(docTitle() + '-' + stamp() + '.html', 'text/html;charset=utf-8', buildDocument(docTitle(), exportBody(inst), false));
  toast('已导出网页文件', 'success');
}

export function exportWord(inst) {
  download(docTitle() + '-' + stamp() + '.doc', 'application/msword', buildDocument(docTitle(), exportBody(inst), true));
  toast('已导出 Word 文件', 'success');
}

export function exportText(inst) {
  download(docTitle() + '-' + stamp() + '.txt', 'text/plain;charset=utf-8', inst.editor.getText({ blockSeparator: '\n\n' }));
  toast('已导出纯文本', 'success');
}

export async function exportMarkdown(inst) {
  try { await ensureShowdown(); } catch (e) { toast('Markdown 组件不可用:' + e.message, 'error'); return false; }
  const md = safeHtmlToMd(inst.getContent());
  if (md === null) { toast('内容转换失败', 'error'); return false; }
  download(docTitle() + '-' + stamp() + '.md', 'text/markdown;charset=utf-8', md);
  toast('已导出 Markdown', 'success');
  return true;
}

/* ---------- 导出菜单(工具栏「导出」下拉) ---------- */
export function openExportMenu(anchor, inst) {
  const item = (label, hint, fn) => h('button', {
    type: 'button', class: 'lry-menu-item', onclick: () => { closePopover(); fn(); }
  }, h('span', { class: 'lry-menu-text' }, label), hint ? h('span', { class: 'lry-menu-hint' }, hint) : null);
  const menu = h('div', { class: 'lry-menu' },
    item('Markdown', '.md', () => exportMarkdown(inst)),
    item('网页文件', '.html', () => exportHtml(inst)),
    item('Word 文档', '.doc', () => exportWord(inst)),
    item('纯文本', '.txt', () => exportText(inst)));
  return popover(anchor, menu, { className: 'lry-export-pop' });
}

/* ---------- 字数统计 ---------- */
/**
 * @param {Node} doc ProseMirror 文档
 * @returns {{chars:number, charsAll:number, words:number, cjk:number, latin:number,
 *            paragraphs:number, headings:number, minutes:number}}
 */
export function computeStats(doc) {
  const text = doc ? doc.textContent : '';
  const cjk = (text.match(CJK) || []).length;
  /* 西文按词计:须在去空白之前数,否则相邻单词会被并成一个;中文字符替换为空格作分界 */
  const latin = (text.replace(CJK, ' ').match(WORD_RUN) || []).length;
  const noWs = text.replace(/\s/g, '');
  let paragraphs = 0;
  let headings = 0;
  if (doc) {
    doc.descendants((n) => {
      if (n.type.name === 'heading') headings++;
      else if (n.isTextblock && n.content.size) paragraphs++; /* 段落不含标题 */
    });
  }
  const minutes = Math.ceil(cjk / 400 + latin / 200);
  return {
    chars: noWs.length,
    charsAll: text.length,
    words: cjk + latin,
    cjk,
    latin,
    paragraphs,
    headings,
    minutes
  };
}

export function renderStatsPanel(doc) {
  const s = computeStats(doc);
  const row = (label, value) => h('div', { class: 'lry-stats-row' }, h('span', null, label), h('b', null, String(value)));
  return h('div', { class: 'lry-stats' },
    row('总字数', s.words),
    row('中文字符', s.cjk),
    row('西文单词', s.latin),
    row('字符数(不含空白)', s.chars),
    row('字符数(含空白)', s.charsAll),
    row('段落', s.paragraphs),
    row('标题', s.headings),
    row('预估阅读', s.minutes ? s.minutes + ' 分钟' : '—'),
    h('div', { class: 'lry-tip' }, '中文按字、西文按词计;阅读速度按中文 400 字/分钟、西文 200 词/分钟估算'));
}
