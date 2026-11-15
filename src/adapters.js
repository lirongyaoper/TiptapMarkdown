/**
 * lry-editor 服务端适配层(开源版核心抽象)
 *
 * 编辑器本体零后端假设:上传/在线管理/远程抓图/AI 全部通过 adapter 注入。
 * 内置两个适配器:
 *   memoryAdapter —— 默认。图片转 dataURI 内存保存,demo/无后端开箱即用;
 *                    AI 走本地 mock(演示)。
 *   createUrlAdapter(opts) —— 对接真实后端:可配置端点前缀、CSRF header 名、
 *                    字段名,兼容 OpenAI 风格 JSON 响应。
 * 站点接入:传入自定义 adapter 对象即可(见 README「适配器」)。
 */

const memoryStore = { seq: 0, images: [] };

/** 默认:内存适配器(图片 dataURI;AI mock) */
export const memoryAdapter = {
  name: 'memory',
  async upload(file, onProgress) {
    const url = await new Promise((res, rej) => {
      const FR = (typeof window !== 'undefined' && window.FileReader) || (typeof FileReader !== 'undefined' ? FileReader : null);
      if (!FR) {
        /* Node 环境(无 DOM):Buffer 兜底转 dataURI,便于服务端/测试使用 */
        if (typeof Buffer !== 'undefined' && file.arrayBuffer) {
          (async () => {
            try {
              const buf = Buffer.from(await file.arrayBuffer());
              res('data:' + (file.type || 'application/octet-stream') + ';base64,' + buf.toString('base64'));
            } catch (e) { rej(e); }
          })();
          return;
        }
        throw new Error('当前环境无 FileReader');
      }
      const fr = new FR();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('读取文件失败'));
      fr.readAsDataURL(file);
    });
    memoryStore.images.unshift({ url, title: file.name, mtime: Date.now() });
    if (onProgress) onProgress(100);
    return { url, attid: ++memoryStore.seq, delurl: '', title: file.name, size: file.size, filetype: 1 };
  },
  async list(filetype, start) {
    const all = filetype === 1 ? memoryStore.images : [];
    return { list: all.slice(start || 0, (start || 0) + 40), total: all.length };
  },
  async catch(sources) {
    const list = [];
    for (const s of sources) {
      try {
        const blob = await (await fetch(s)).blob();
        const FR = (typeof window !== 'undefined' && window.FileReader) || (typeof FileReader !== 'undefined' ? FileReader : null);
      if (!FR) {
        /* Node 环境(无 DOM):Buffer 兜底转 dataURI,便于服务端/测试使用 */
        if (typeof Buffer !== 'undefined' && file.arrayBuffer) {
          (async () => {
            try {
              const buf = Buffer.from(await file.arrayBuffer());
              res('data:' + (file.type || 'application/octet-stream') + ';base64,' + buf.toString('base64'));
            } catch (e) { rej(e); }
          })();
          return;
        }
        throw new Error('当前环境无 FileReader');
      }
        const url = await new Promise((res) => { const fr = new FR(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        memoryStore.images.unshift({ url, title: s.slice(-24), mtime: Date.now() });
        list.push({ state: 'SUCCESS', url, source: s });
      } catch (e) { list.push({ state: 'ERROR', source: s }); }
    }
    return { state: list.length ? 'SUCCESS' : 'ERROR', list };
  },
  /* AI:演示用 mock(固定合法 JSON 输出) */
  async ai(messages) {
    return '[]';
  }
};

/**
 * 构造 URL 适配器(真实后端)
 * @param opts {
 *   base: '/index.php?m=attachment&c=api',   // 上传端点前缀(追加 &a=upload 等)
 *   csrfHeader: 'X-CSRF-TOKEN', csrfToken: ()=>window.xxx, // 可选
 *   fileField: 'file', jsonPath: r => r.data,               // 响应解包(默认取 data)
 *   aiUrl: '/index.php?m=attachment&c=editor&a=ai',         // AI SSE 端点(可选)
 *   listUrl/catchUrl: 显式覆盖                              // 可选
 * }
 */
export function createUrlAdapter(opts) {
  const o = Object.assign({
    base: '/api/editor',
    csrfHeader: '', csrfToken: null,
    fileField: 'file', jsonPath: (r) => (r && r.data !== undefined ? r.data : r),
    aiUrl: '', listUrl: '', catchUrl: ''
  }, opts || {});
  const headers = () => {
    const h = {};
    if (o.csrfHeader && o.csrfToken) {
      const t = typeof o.csrfToken === 'function' ? o.csrfToken() : o.csrfToken;
      if (t) h[o.csrfHeader] = t;
    }
    return h;
  };
  const post = async (url, form) => {
    const resp = await fetch(url, { method: 'POST', headers: headers(), body: form, credentials: 'same-origin' });
    const json = await resp.json();
    if (json.status !== undefined && json.status !== 1) throw new Error(json.message || '服务端返回失败');
    return o.jsonPath(json);
  };
  return {
    name: 'url',
    async upload(file, onProgress, extra) {
      const form = new FormData();
      form.append(o.fileField, file);
      if (extra) Object.keys(extra).forEach((k) => form.append(k, extra[k]));
      if (o.csrfToken) form.append('lry_csrf_token', typeof o.csrfToken === 'function' ? o.csrfToken() : o.csrfToken);
      return post(o.base.replace(/&a=\w+.*$/, '') + (o.base.includes('?') ? '&a=upload' : '/upload'), form);
    },
    async list(filetype, start) {
      const url = (o.listUrl || o.base.replace(/&a=\w+.*$/, '') + (o.base.includes('?') ? '&a=list' : '/list')) + '&filetype=' + filetype + '&start=' + (start || 0);
      const json = await (await fetch(url, { headers: headers(), credentials: 'same-origin' })).json();
      return o.jsonPath(json);
    },
    async catch(sources) {
      const form = new FormData();
      sources.forEach((s) => form.append('source[]', s));
      return post(o.catchUrl || o.base.replace(/&a=\w+.*$/, '') + (o.base.includes('?') ? '&a=catch' : '/catch'), form);
    },
    async ai(messages) {
      if (!o.aiUrl) return memoryAdapter.ai(messages);
      const resp = await fetch(o.aiUrl, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
        credentials: 'same-origin',
        body: JSON.stringify({ messages, stream: true })
      });
      /* SSE 流式解析:逐行拼 delta,与官方 openai 兼容 */
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '', out = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            const d = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
            if (obj.type === 'error') throw new Error(obj.data || 'AI 服务错误');
            if (d) out += d;
          } catch (pe) { if (pe instanceof SyntaxError) { /* 半包 */ } else throw pe; }
        }
      }
      return out;
    }
  };
}

/* ---------- 实例适配器解析:create({adapter}) 或全局 setAdapter ---------- */
let globalAdapter = null;
export function setAdapter(a) { globalAdapter = a; }
export function getAdapter(inst) {
  const a = (inst && inst.options && inst.options.adapter) || globalAdapter || memoryAdapter;
  if (typeof a === 'string') {
    if (a === 'memory') return memoryAdapter;
    throw new Error('未知内置适配器: ' + a + '(自定义适配器请传对象)');
  }
  return a;
}
