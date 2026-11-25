/**
 * lry-editor 上传接线(开源版:全部经 adapter,详见 src/adapters.js)
 * adapter 可实现 upload / uploadChunk(可选) / list / catch;
 * 默认 memoryAdapter(dataURI 开箱即用),生产用 createUrlAdapter 或自定义对象。
 */
import { getAdapter } from './adapters.js';

const CHUNK_THRESHOLD = 5 * 1024 * 1024;

export async function uploadFile(file, opts = {}, inst = null) {
  const adapter = getAdapter(inst);
  const filetype = opts.filetype || (/\.(png|jpe?g|gif|bmp|webp|avif|svg)$/i.test(file.name) ? 1 : 2);
  if (adapter.uploadChunk && file.size > CHUNK_THRESHOLD) {
    return adapter.uploadChunk(file, { filetype, module: opts.module, onProgress: opts.onProgress, signal: opts.signal });
  }
  return adapter.upload(file, opts.onProgress, { filetype, module: opts.module || '', signal: opts.signal });
}

export async function listAttachments(filetype, start, inst = null, signal) {
  const adapter = getAdapter(inst);
  const r = await adapter.list(filetype, start, signal);
  return r || { list: [], total: 0 };
}

export async function catchImages(sources, inst = null, signal) {
  const adapter = getAdapter(inst);
  return adapter.catch(sources, signal);
}

export function isImageFile(f) {
  return f && (f.type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|avif|svg)$/i.test(f.name || ''));
}
