# 适配器(Adapter)约定

lry-editor 的所有服务端交互(上传/在线管理/远程抓图/AI)都通过 adapter 对象注入。内置两个:`memory`(默认,demo 用)与 `createUrlAdapter` 工厂。本文定义自定义适配器的完整契约。

两种注入方式:全局 `LRYEditor.setAdapter(obj)`,或按实例 `LRYEditor.create({ adapter: obj })`(优先于全局)。拖入/粘贴上传、对话框上传、在线管理、图转存、lite 贴图——**实例的每一个入口都走该实例自己的 adapter**;没传 `adapter` 的实例才用全局。

## 方法总表

| 方法 | 必需 | 签名 | 返回 |
|---|---|---|---|
| upload | ✓ | `(file: File, onProgress?: (pct)=>void, extra: {filetype, module}) => Promise<UploadResult>` | `{ url, title?, size?, filetype? }` |
| list | ✓ | `(filetype: 1\|2, start: number) => Promise<ListResult>` | `{ list: [{url, title?, mtime?}], total }` |
| catch | ✓ | `(sources: string[]) => Promise<CatchResult>` | `{ state: 'SUCCESS'\|'ERROR', list: [{state, url?, source}] }` |
| ai | ✓ | `(messages: [{role, content}]) => Promise<string>` | 模型文本输出 |
| uploadChunk | 可选 | `(file, {filetype, module, onProgress}) => Promise<UploadResult>` | 同 upload;实现后 >5MB 文件自动走此通道 |

## 各方法细则

### upload(file, onProgress, extra)

- `filetype`:1=图片,2=文件(视频/音频/文档)
- 视频/音频/附件拖入或粘贴进编辑器时同样调用 `upload`(`filetype: 2`):返回的 `url` 落入 `<video>` / `<audio>` / 文件卡;不需要此行为时 `create({ dropFiles: false })` 关闭(`.md` 文件始终按 Markdown 导入,不走上传)
- `onProgress(pct)`:0-100 进度回调(可选)
- 返回 `url` 必须是可直接放入 `<img src>` / `<a href>` 的地址(dataURI、相对路径、绝对 URL 均可)
- 抛异常即上传失败,编辑器 toast 展示 `e.message`

### list(filetype, start)

- 在线管理面板(图片对话框)的数据源;`start` 分页起点,建议每页 40
- `total` 用于判断是否还有下一页
- 图库只列 `list(1, …)`(图片);`filetype: 2` 的上传结果不出现在图库

### catch(sources)

- 批量转存远程图片(Word 粘贴/图转存按钮调用)
- 每项 `state` 独立;失败项保留原 URL

### ai(messages)

- 入参为 OpenAI 兼容消息数组;返回模型完整文本
- 流式:内部消费 SSE(参考 `createUrlAdapter` 中 aiUrl 实现,支持 OpenAI `delta.content` 与 `{type:'data'}` 两种帧)
- AI 面板对输出做 mermaid 头部识别(`graph `/`mindmap`/… 开头)自动转为画板块
- 结果的插入方式按内容判定:含 Markdown 结构(标题/列表/代码围栏,含 ```` ```mermaid ```` 围栏)的结果转为富文本块插入;纯文本按文本插入,其中的 `<div>` 之类不会被当成标签

## createUrlAdapter 配置项

```js
LRYEditor.createUrlAdapter({
  base: '/api/editor',     // 端点前缀:拼 /upload /list /catch
  listUrl: '',             // 显式覆盖(可省)
  catchUrl: '',            // 显式覆盖(可省)
  aiUrl: '',               // AI SSE 端点(OpenAI 兼容)
  csrfHeader: '',          // 如 'X-CSRF-TOKEN'
  csrfToken: null,         // string 或 ()=>string
  fileField: 'file',       // 上传表单字段名
  jsonPath: (r) => r.data  // 响应 JSON 解包函数
})
```

默认预期服务端响应:`{ status: 1, data: {...} }`(status 非 1 视为失败并展示 message)。

## 大文件分片示例(自定义 uploadChunk)

```js
async uploadChunk(file, { onProgress }) {
  const CHUNK = 5 * 1024 * 1024;
  const id = crypto.randomUUID();
  for (let i = 0, part = 0; i < file.size; i += CHUNK, part++) {
    await fetch(`/api/chunk?id=${id}&index=${part}`, {
      method: 'POST', body: file.slice(i, i + CHUNK)
    });
    onProgress(Math.min(100, Math.round((i + CHUNK) * 100 / file.size)));
  }
  const r = await fetch(`/api/chunk?id=${id}&op=finish`, { method: 'POST' });
  return (await r.json()).data;
}
```
