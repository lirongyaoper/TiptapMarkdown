/**
 * 画布剪贴板(v1.4.1):复制 / 剪切 / 粘贴的内容怎么存、怎么跟系统剪贴板打交道。
 *
 * 复制下来的东西叫"剪贴板内容"(payload):{ kind: 'flow' | 'mind' | 'class', nodes / edges / rels / notes, items, pos },
 * 由各画板自己拼(它们知道自己的模型长什么样),这里只管存取:
 *   - 页面内存里留最近一份:同一个页面里跨画板粘贴(发帖页只有一块编辑器,各画板之间)走它,不需要任何权限;
 *   - 系统剪贴板里写一段文本:开头一行给人看的说明,后面两行 %% 注释是内容本身(单行 JSON,与布局块用同一个函数序列化),
 *     换个标签页、刷新页面之后照样能贴回来。
 *
 * 往系统剪贴板写:优先 Clipboard API(要 HTTPS),不行就退到 execCommand('copy')——它会同步触发一次 copy 事件,
 * 焦点在画布上时由画布的 onCopy 把同一份文本写进去。读:只有 Clipboard API 可用时才读得到(HTTP 站点上
 * 右键菜单的"粘贴"只能用页面内存里的那份;键盘 Ctrl+V 走浏览器的 paste 事件,不受这个限制)。
 */
import { jsonText } from './layout-core.js';

export const COPY_MARK = '%% lry-copy v1';
const KIND_LABEL = { flow: '流程图', mind: '思维导图', class: '类图' };
let memory = null;

/** 剪贴板内容 → 写进系统剪贴板的文本 */
export function encodeClipboard(payload) {
  const kind = KIND_LABEL[payload && payload.kind] || '画板';
  return 'lry-editor 画板剪贴板(' + kind + ',可粘贴回 ' + kind + '画板)\n' + COPY_MARK + '\n%% ' + jsonText(Object.assign({ v: 1 }, payload));
}

/** 系统剪贴板里的文本 → 剪贴板内容;不是我们写的(或者坏了)返回 null,不抛异常 */
export function decodeClipboard(text) {
  const s = String(text || '');
  const at = s.indexOf(COPY_MARK);
  if (at < 0) return null;
  const line = s.slice(at + COPY_MARK.length).replace(/^\r?\n/, '');
  const m = /^%% ([^\n\r]*)/.exec(line);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]);
    if (!o || typeof o !== 'object' || !KIND_LABEL[o.kind]) return null;
    return o;
  } catch (e) { return null; }
}

/* 页面内存里的最近一份(跨画板粘贴用) */
export function setMemory(payload) { memory = payload ? { payload: JSON.parse(JSON.stringify(payload)), at: Date.now() } : null; }
export function getMemory() { return memory; }

function execCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  (document.body || document.documentElement).appendChild(ta);
  ta.select();
  if (ta.setSelectionRange) ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = !!document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/** 把文本写进系统剪贴板;写不进去(老浏览器、没权限)也只是跨标签页粘贴用不了,页面内粘贴不受影响 */
export function copyToSystem(text) {
  return new Promise((resolve) => {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && nav.clipboard && nav.clipboard.writeText && typeof window !== 'undefined' && window.isSecureContext) {
      try {
        nav.clipboard.writeText(text).then(() => resolve(true), () => resolve(execCopy(text)));
        return;
      } catch (e) { /* 落到下面的退路 */
      }
    }
    resolve(typeof document !== 'undefined' && document.execCommand ? execCopy(text) : false);
  });
}

/** 读系统剪贴板里的文本;读不到(非 HTTPS、用户拒绝、旧浏览器)返回 null */
export function readSystem() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!(nav && nav.clipboard && nav.clipboard.readText && typeof window !== 'undefined' && window.isSecureContext)) return Promise.resolve(null);
  try {
    return nav.clipboard.readText().then((t) => t, () => null);
  } catch (e) { return Promise.resolve(null); }
}
