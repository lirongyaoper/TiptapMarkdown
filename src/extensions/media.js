/**
 * 嵌入类节点:图片/视频/音频/iframe/附件/锚点/表情。
 * 序列化契约与旧 UEditor 输出对齐:
 * - 视频 <video class="edui-faked-video" controls preload="none" width height src>
 * - 附件 <a class="insertfile" href>标题</a>
 * - 锚点 <a name="x"></a>
 * - 表情:Unicode emoji 纯文本 + 旧版图片表情(img)兼容解析
 */
import { Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';

export const LryImage = Image.extend({
  name: 'image',
  /* 旧 UEditor 的图片总是段落内 inline 形态(<p><img></p>),
     保持一致避免 [points=10]<img>[/points] 这类文本标记被拆块 */
  inline: true,
  group: 'inline',
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null, parseHTML: (el) => el.getAttribute('width') },
      height: { default: null, parseHTML: (el) => el.getAttribute('height') },
      /* UEditor 图片对齐:float:left/right;center → display:block;margin:0 auto */
      float: {
        default: null,
        parseHTML: (el) => {
          const f = el.getAttribute('float');
          if (f === 'left' || f === 'right' || f === 'none') return f === 'none' ? null : f;
          const style = el.getAttribute('style') || '';
          if (/float\s*:\s*left/.test(style)) return 'left';
          if (/float\s*:\s*right/.test(style)) return 'right';
          return null;
        }
      },
      center: {
        default: false,
        parseHTML: (el) => /display\s*:\s*block/.test(el.getAttribute('style') || '') &&
          /margin[^;]*auto/.test(el.getAttribute('style') || '')
      }
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = { ...HTMLAttributes };
    delete attrs.float;
    delete attrs.center;
    const style = [];
    if (node.attrs.float === 'left' || node.attrs.float === 'right') style.push('float:' + node.attrs.float);
    if (node.attrs.center) style.push('display:block', 'margin-left:auto', 'margin-right:auto');
    if (style.length) attrs.style = style.join(';');
    return ['img', attrs];
  },
  addCommands() {
    return {
      setImage: (options) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: { src: options.src, alt: options.alt || '', title: options.title || '',
          width: options.width || null, height: options.height || null }
      })
    };
  },
  /* 图片等比缩放手柄(2026-11-21 现代编辑器增强):
     悬停/选中图片出现右下角拖拽点,拖拽以宽度为基准等比缩放(40px~容器宽);
     尺寸持久化走 width/height 属性(服务端 remove_xss 的 img 属性白名单已放行),
     序列化仍由 renderHTML 输出,NodeView 仅负责编辑态交互与属性回写 */
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrap = document.createElement('span');
      wrap.className = 'lry-imgwrap';
      const img = document.createElement('img');
      const handle = document.createElement('span');
      handle.className = 'lry-img-resize';
      handle.title = '拖拽调整大小';

      const sync = (n) => {
        img.setAttribute('src', n.attrs.src || '');
        if (n.attrs.alt != null) img.setAttribute('alt', n.attrs.alt); else img.removeAttribute('alt');
        if (n.attrs.title) img.setAttribute('title', n.attrs.title); else img.removeAttribute('title');
        if (n.attrs.width) img.setAttribute('width', n.attrs.width); else img.removeAttribute('width');
        if (n.attrs.height) img.setAttribute('height', n.attrs.height); else img.removeAttribute('height');
        const st = [];
        if (n.attrs.float === 'left' || n.attrs.float === 'right') st.push('float:' + n.attrs.float);
        if (n.attrs.center) st.push('display:block', 'margin-left:auto', 'margin-right:auto');
        if (st.length) img.setAttribute('style', st.join(';')); else img.removeAttribute('style');
        wrap.classList.toggle('lry-imgwrap-left', n.attrs.float === 'left');
        wrap.classList.toggle('lry-imgwrap-right', n.attrs.float === 'right');
        wrap.classList.toggle('lry-imgwrap-center', !!n.attrs.center);
      };
      sync(node);

      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = img.getBoundingClientRect();
        let startW = rect.width;
        let startH = rect.height;
        if (!startW || !startH) {
          /* 无布局环境/隐藏图片:以属性值或常用缺省起步 */
          startW = parseInt(img.getAttribute('width'), 10) || 400;
          startH = parseInt(img.getAttribute('height'), 10) || Math.round(startW * 0.75);
        }
        const ratio = startH / startW;
        const startX = e.clientX;
        const container = wrap.closest('.lry-editor-content') || wrap.parentElement;
        const maxW = container && container.clientWidth ? container.clientWidth : 1200;
        const move = (ev) => {
          const w = Math.max(40, Math.min(Math.round(startW + (ev.clientX - startX)), Math.max(40, maxW)));
          img.setAttribute('width', w);
          img.setAttribute('height', Math.round(w * ratio));
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          const w = parseInt(img.getAttribute('width'), 10) || startW;
          const h = parseInt(img.getAttribute('height'), 10) || Math.round(w * ratio);
          editor.chain().focus().command(({ tr }) => {
            const pos = typeof getPos === 'function' ? getPos() : getPos;
            if (typeof pos === 'number') tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: w, height: h });
            return true;
          }).run();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });

      wrap.appendChild(img);
      wrap.appendChild(handle);
      return {
        dom: wrap,
        update(updatedNode) {
          if (updatedNode.type.name !== 'image') return false;
          node = updatedNode;
          sync(node);
          return true;
        },
        /* 手柄事件自行处理,不进 ProseMirror 事件流 */
        stopEvent(e) {
          return e.target === handle;
        },
        ignoreMutation() { return true; }
      };
    };
  }
});

export const LryVideo = Node.create({
  name: 'lryVideo',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      width: { default: null, parseHTML: (el) => el.getAttribute('width') },
      height: { default: null, parseHTML: (el) => el.getAttribute('height') },
      /* 兼容存量 <embed> 旧产物 */
      poster: { default: null },
      cls: { default: 'edui-faked-video', parseHTML: (el) => el.getAttribute('class') || 'edui-faked-video' }
    };
  },
  parseHTML() {
    return [
      { tag: 'video' },
      { tag: 'embed[type*=video]' },
      { tag: 'object[type*=video]' }
    ];
  },
  renderHTML({ node }) {
    const attrs = {
      class: node.attrs.cls || 'edui-faked-video',
      controls: 'controls',
      preload: 'none',
      src: node.attrs.src
    };
    if (node.attrs.width) attrs.width = node.attrs.width;
    if (node.attrs.height) attrs.height = node.attrs.height;
    if (node.attrs.poster) attrs.poster = node.attrs.poster;
    return ['video', attrs];
  },
  addCommands() {
    return {
      insertVideo: (options) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: options
      })
    };
  }
});

export const LryAudio = Node.create({
  name: 'lryAudio',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'audio' }, { tag: 'embed[type*=audio]' }];
  },
  renderHTML({ node }) {
    return ['audio', { src: node.attrs.src, controls: 'controls', preload: 'none' }];
  },
  addCommands() {
    return {
      insertAudio: (options) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: options
      })
    };
  }
});

export const LryIframe = Node.create({
  name: 'lryIframe',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      width: { default: 420, parseHTML: (el) => el.getAttribute('width') || 420 },
      height: { default: 300, parseHTML: (el) => el.getAttribute('height') || 300 },
      frameborder: { default: '0' },
      scrolling: { default: null }
    };
  },
  parseHTML() {
    return [{ tag: 'iframe' }];
  },
  renderHTML({ node }) {
    const attrs = {
      src: node.attrs.src, width: node.attrs.width, height: node.attrs.height,
      frameborder: node.attrs.frameborder, allowfullscreen: 'allowfullscreen'
    };
    if (node.attrs.scrolling) attrs.scrolling = node.attrs.scrolling;
    return ['iframe', attrs];
  },
  addCommands() {
    return {
      insertIframe: (options) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: options
      })
    };
  }
});

/* 附件:<a class="lry-filecard-link" href="/uploads/...">文件名</a>
   (lry- 前缀过服务端 class 白名单;旧 insertfile 形态仅作解析兼容) */
export const LryAttachment = Node.create({
  name: 'lryAttachment',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      href: { default: null },
      title: { default: null }
    };
  },
  parseHTML() {
    /* priority 压过 Link mark 的 a[href] 规则,否则附件卡被吃成普通链接;
       getAttrs 从元素文本提取文件名(旧形态无 title 属性) */
    const take = (el) => ({
      href: el.getAttribute('href'),
      title: (el.textContent || '').trim() || el.getAttribute('title') || null
    });
    return [
      { tag: 'a.lry-filecard-link', priority: 300, getAttrs: take },
      { tag: 'a.insertfile', priority: 290, getAttrs: take }
    ];
  },
  renderHTML({ node }) {
    return ['a', { class: 'lry-filecard-link', href: node.attrs.href }, node.attrs.title || '附件'];
  },
  addCommands() {
    return {
      insertAttachment: (options) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: options
      })
    };
  }
});

/* 锚点:序列化 <a name="x"></a>(inputRule 同旧 UEditor:a[name] 无 href 即锚点) */
export const LryAnchor = Node.create({
  name: 'lryAnchor',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { name: { default: null } };
  },
  parseHTML() {
    return [{
      tag: 'a[name]',
      getAttrs: (el) => (el.getAttribute('href') ? false : { name: el.getAttribute('name') })
    }];
  },
  renderHTML({ node }) {
    return ['a', { name: node.attrs.name }];
  },
  addCommands() {
    return {
      insertAnchor: (name) => ({ commands }) => commands.insertContent({
        type: this.name, attrs: { name }
      })
    };
  }
});
