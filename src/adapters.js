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
  async upload(file, onProgress, extra) {
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
    /* 只有图片进图库(在线管理只列图片);视频/音频/附件同样返回 dataURI,供拖入即传功能演示 */
    const isImg = (extra && extra.filetype === 1) || /^image\//.test(file.type || '') || /\.(png|jpe?g|gif|bmp|webp|avif|svg)$/i.test(file.name || '');
    if (isImg) memoryStore.images.unshift({ url, title: file.name, mtime: Date.now() });
    if (onProgress) onProgress(100);
    return { url, attid: ++memoryStore.seq, delurl: '', title: file.name, size: file.size, filetype: isImg ? 1 : 2 };
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
        const buf = Buffer.from(await blob.arrayBuffer());
        const url = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + buf.toString('base64');
        memoryStore.images.unshift({ url, title: s.slice(-24), mtime: Date.now() });
        list.push({ state: 'SUCCESS', url, source: s });
        continue;
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
    aiUrl: '', listUrl: '', catchUrl: '',
    chunkUrl: '', chunked: false, timeout: 300000, retries: 3, retryDelay: 800
  }, opts || {});
  const headers = () => {
    const h = {};
    if (o.csrfHeader && o.csrfToken) {
      const t = typeof o.csrfToken === 'function' ? o.csrfToken() : o.csrfToken;
      if (t) h[o.csrfHeader] = t;
    }
    return h;
  };
  const csrfValue = () => typeof o.csrfToken === 'function' ? o.csrfToken() : o.csrfToken;
  const actionUrl = (base, action) => {
    const raw = String(base || '');
    if (!raw.includes('?')) return raw.replace(/\/+$/, '') + '/' + action;
    const hashAt = raw.indexOf('#');
    const path = raw.slice(0, hashAt >= 0 ? hashAt : raw.length).split('?')[0];
    const hash = hashAt >= 0 ? raw.slice(hashAt) : '';
    const url = new URL(raw, 'http://lry-editor.local');
    url.searchParams.delete('a');
    url.searchParams.set('a', action);
    return path + url.search + hash;
  };
  const fetchWithTimeout = async (url, init, signal) => {
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    const timer = o.timeout > 0 ? setTimeout(abort, o.timeout) : null;
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      if (ctrl.signal.aborted && !(signal && signal.aborted)) throw new Error('请求超时(' + o.timeout + 'ms),请检查网络后重试');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
    }
  };
  const requestJson = async (url, init, signal) => {
    const resp = await fetchWithTimeout(url, {
      headers: headers(), credentials: 'same-origin', ...init
    }, signal);
    if (resp.ok === false) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (json && json.status !== undefined && json.status !== 1) throw new Error(json.message || json.msg || '服务端返回失败');
    return o.jsonPath(json);
  };
  const post = (url, form, signal) => requestJson(url, { method: 'POST', body: form }, signal);
  const addCsrf = (form) => {
    const token = csrfValue();
    if (token) form.append('lry_csrf_token', token);
    return form;
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const adapter = {
    name: 'url',
    async upload(file, onProgress, extra) {
      const form = addCsrf(new FormData());
      form.append(o.fileField, file);
      /* extra 里只带可序列化的值:回调、module 空值与 AbortSignal 都不进表单 */
      if (extra) Object.keys(extra).forEach((k) => {
        const v = extra[k];
        if (k !== 'signal' && typeof v !== 'function' && v !== undefined && v !== null) form.append(k, v);
      });
      return post(actionUrl(o.base, 'upload'), form, extra && extra.signal);
    },
    async list(filetype, start, signal) {
      const base = o.listUrl || actionUrl(o.base, 'list');
      const sep = base.includes('?') ? '&' : '?';
      return requestJson(base + sep + 'filetype=' + filetype + '&start=' + (start || 0), { method: 'GET' }, signal);
    },
    async catch(sources, signal) {
      const form = addCsrf(new FormData());
      sources.forEach((s) => form.append('source[]', s));
      return post(o.catchUrl || actionUrl(o.base, 'catch'), form, signal);
    },
    async ai(messages, options) {
      if (!o.aiUrl) return memoryAdapter.ai(messages);
      const opts = options || {};
      const resp = await fetchWithTimeout(o.aiUrl, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
        credentials: 'same-origin',
        body: JSON.stringify({ messages, stream: true })
      }, opts.signal);
      if (resp.ok === false || !resp.body) throw new Error('HTTP ' + resp.status);
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '', out = '';
      const consume = (raw) => {
        const line = raw.trim();
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let obj;
        try { obj = JSON.parse(payload); } catch (e) { return; /* 半包或非 JSON 帧 */ }
        if (obj.type === 'error') throw new Error(obj.data || 'AI 服务错误');
        const delta = (obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content)
          || (obj.type === 'data' ? obj.data : null);
        if (delta) {
          out += delta;
          if (opts.onDelta) opts.onDelta(delta);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          consume(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      buf += dec.decode();
      if (buf.trim()) consume(buf);
      return out;
    }
  };

  /* 分片协议与主站 attachment/api 一致,但仅在显式配置 chunkUrl 或 chunked:true 时启用,
     避免假设所有 /api/editor 后端都实现 init/part/finish。 */
  if (o.chunkUrl || o.chunked) {
    adapter.uploadChunk = async (file, options) => {
      const opts = options || {};
      const filetype = opts.filetype || 2;
      const url = o.chunkUrl || actionUrl(o.base, 'upload_chunk');
      const init = addCsrf(new FormData());
      init.append('op', 'init');
      init.append('filename', file.name);
      init.append('filesize', file.size);
      init.append('filetype', filetype);
      if (opts.module) init.append('module', opts.module);
      const started = await post(url, init, opts.signal);
      const uploadId = started && started.upload_id;
      const chunkSize = +(started && started.chunk_size) || 5 * 1024 * 1024;
      const chunkTotal = +(started && started.chunk_total) || Math.ceil(file.size / chunkSize);
      if (!uploadId || !chunkSize || !chunkTotal) throw new Error('分片初始化响应缺少 upload_id/chunk_size/chunk_total');
      for (let i = 0; i < chunkTotal; i++) {
        const part = addCsrf(new FormData());
        part.append('upload_id', uploadId);
        part.append('index', i);
        part.append('file', file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size)), file.name + '.part' + i);
        let lastErr = null;
        for (let attempt = 0; attempt < o.retries; attempt++) {
          try { await post(url, part, opts.signal); lastErr = null; break; }
          catch (e) {
            lastErr = e;
            if (opts.signal && opts.signal.aborted) throw e;
            if (attempt + 1 < o.retries) await wait(o.retryDelay * (attempt + 1));
          }
        }
        if (lastErr) throw lastErr;
        if (opts.onProgress) opts.onProgress(Math.round(((i + 1) / chunkTotal) * 100));
      }
      const finish = addCsrf(new FormData());
      finish.append('op', 'finish');
      finish.append('upload_id', uploadId);
      return post(url, finish, opts.signal);
    };
  }
  return adapter;
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
