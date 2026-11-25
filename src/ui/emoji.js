/**
 * 表情选择器:Unicode emoji 分类面板(现代形态,替换旧百度远程图表情——
 * 旧图床 http://img.baidu.com 在 https 站点早已是死链)。
 */
import { h, popover, closePopover } from './dom.js';

const GROUPS = [
  ['常用', ['😀','😁','😂','🤣','😊','😍','😘','😜','🤔','😎','😭','😡','👍','👎','👏','🙏','💪','🤝','✌️','👌','🤙','👋','🖐️','❤️','💔','✨','🔥','🎉','🎂','🌹']],
  ['表情', ['😅','😉','😋','😎','😏','😞','😥','😔','😖','😴','🤤','😪','😷','🤒','🤕','🥳','🥺','😭','😤','😱','🤯','😳','🥵','🥶','😇','🤠','🤡','👻','💀','👽']],
  ['手势', ['👋','🤚','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅']],
  ['动物', ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦉','🦄','🐝','🐛','🦋','🐌','🐞','🐢','🐍','🐙','🦕']],
  ['物品', ['💻','🖥️','📱','⌨️','🖱️','💾','📷','🎥','📞','📺','🔋','🔌','💡','🔦','📚','✏️','📎','✂️','🔒','🔑','🔨','🧲','💊','🎁','🎈','🎀','🏆','⚽','🏀','🎮']],
  ['符号', ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','☮️','✨','⭐','🌟','💫','⚡','🔥','🌈','☀️','🌙','⛅','❄️','💧']]
];
/* 清理误植词 */
GROUPS.forEach((g) => { g[1] = g[1].filter((e) => !/^[\u4e00-\u9fa5]/.test(e) && e.length); });

/**
 * @param opts { onPick(emoji), title }  给了 onPick:选完交给调用方(画板贴纸),不往正文里插
 */
export function openEmojiPicker(anchor, inst, opts) {
  const pick = opts && typeof opts.onPick === 'function' ? opts.onPick : null;
  const tabs = h('div', { class: 'lry-emoji-tabs' });
  const pane = h('div', { class: 'lry-emoji-pane' });
  const show = (gi) => {
    pane.innerHTML = '';
    [...tabs.children].forEach((c, i) => c.classList.toggle('lry-tab-active', i === gi));
    GROUPS[gi][1].forEach((e) => {
      pane.appendChild(h('button', { type: 'button', class: 'lry-emoji', onclick: () => {
        if (pick) pick(e);
        else inst.editor.chain().focus().insertContent(e).run();
        closePopover();
      } }, e));
    });
  };
  GROUPS.forEach(([name], i) => {
    tabs.appendChild(h('button', { type: 'button', class: 'lry-tab', onclick: () => show(i) }, name));
  });
  show(0);
  const title = opts && opts.title ? h('div', { class: 'lry-emoji-title' }, opts.title) : null;
  popover(anchor, h('div', { class: 'lry-emoji-panel' }, title, tabs, pane), { className: 'lry-emoji-pop' + (title ? ' lry-emoji-pop-titled' : '') });
}
