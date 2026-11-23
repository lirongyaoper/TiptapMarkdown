/**
 * 涂鸦画板:canvas 手绘(画笔/橡皮/粗细/颜色/撤销/清空)→ PNG 上传插入。
 * 对齐旧 UEditor scrawl 功能;输出走统一上传通道(base64→blob)。
 */
import { h, dialog, toast } from './dom.js';
import { uploadFile } from '../upload.js';

export function openScrawlDialog(inst) {
  const W = 560, H = 300;
  const cv = h('canvas', { width: W, height: H, class: 'lry-scrawl-canvas' });
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  let tool = 'pen', color = '#333333', size = 3, drawing = false;
  const undoStack = [];
  const snapshot = () => undoStack.push(ctx.getImageData(0, 0, W, H));
  const undo = () => { const img = undoStack.pop(); if (img) ctx.putImageData(img, 0, 0); };

  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (W / r.width), y: (p.clientY - r.top) * (H / r.height) };
  };
  const start = (e) => { e.preventDefault(); snapshot(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    if (tool === 'pen') { ctx.strokeStyle = color; ctx.lineWidth = size; ctx.globalCompositeOperation = 'source-over'; }
    else { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size * 3; ctx.globalCompositeOperation = 'source-over'; }
    ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const end = () => { drawing = false; ctx.globalCompositeOperation = 'source-over'; };
  cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false });
  cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', end);

  const penBtn = h('button', { type: 'button', class: 'lry-btn lry-btn-active', onclick: () => { tool = 'pen'; penBtn.classList.add('lry-btn-active'); eraserBtn.classList.remove('lry-btn-active'); } }, '画笔');
  const eraserBtn = h('button', { type: 'button', class: 'lry-btn', onclick: () => { tool = 'eraser'; eraserBtn.classList.add('lry-btn-active'); penBtn.classList.remove('lry-btn-active'); } }, '橡皮');
  const sizeSel = h('select', { class: 'lry-input' },
    [1, 3, 5, 8, 14].map((s) => h('option', { value: s }, s + 'px')));
  sizeSel.value = '3';
  sizeSel.addEventListener('change', () => { size = +sizeSel.value; });
  const colorIn = h('input', { type: 'color', class: 'lry-color-native', value: '#333333' });
  colorIn.addEventListener('input', () => { color = colorIn.value; });

  dialog({ title: '涂鸦', width: '620px', okText: '保存并插入',
    body: h('div', null,
      h('div', { class: 'lry-btn-row', style: { marginBottom: 8 } },
        penBtn, eraserBtn, sizeSel, colorIn,
        h('button', { type: 'button', class: 'lry-btn', onclick: undo }, '撤销'),
        h('button', { type: 'button', class: 'lry-btn', onclick: () => { snapshot(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); } }, '清空')),
      cv,
      h('div', { class: 'lry-tip' }, '手机可用手指直接绘制')),
    async onOk(api) {
      const dataUrl = cv.toDataURL('image/png');
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const f = new File([blob], 'scrawl-' + Date.now() + '.png', { type: 'image/png' });
        const r = await uploadFile(f, { filetype: 1, module: inst.options.module }, inst);
        inst.editor.chain().focus().setImage({ src: r.url, title: '涂鸦' }).run();
        toast('涂鸦已插入', 'success');
      } catch (e) { toast(e.message, 'error'); return false; }
    } });
}
