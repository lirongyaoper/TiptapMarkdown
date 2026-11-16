# Changelog

## 1.1.1 (2026-11-17)

修复 移动端行柄「+」不可点(同步自 lryper.com 站内版):

- 根因:`left:2px + translateX(-26px)` 向左外突 23px 悬在编辑器容器外,依赖宿主页面的左 padding 摆放;移动端页面 padding 小时「+」贴屏幕边缘(实测 390px 视口下距屏幕仅 3px),叠加 22px 触摸目标与 `opacity:0` hover 显示(触屏无 hover),基本无法点击
- 修复(≤1023px 触屏/窄屏):取消负偏移,收回 ProseMirror 的 30px 左 padding 内,不再依赖宿主布局;视觉 26px + `::before` 外扩热区至 38px;触屏降透明度(0.5)常显,hover/focus 变 1 的原规则仍生效
- 桌面端(≥1024)形态零变化:外突 23px / 22px / hover 显示,均保持原样

## 1.1.0 (2026-11-16)

新增 **lite 简约版**(留言/评论场景,同步自 lryper.com 站内版):

- 独立构建 `dist/lry-editor-lite.js`(413KB / gzip 132KB)+ `lry-editor-lite.css`,全局对象 `window.LRYEditorLite`,npm 入口 `lry-editor/lite`
- API 与 full 版同形:create/get/getContent/getText/setContent/insertHtml/on('contentChange')/sync/destroy
- 纯文字排版:撤销/重做 · 加粗/斜体/下划线/删除线/行内代码 · 链接(Ctrl+K 紧凑弹层)· 引用/列表 · Unicode 表情 · 清除格式
- maximumWords 超限硬阻断 + 字数计数条、placeholder、只读态(无工具栏)
- 表单同步:200ms 防抖写回 + blur/submit 强制 flush;挂载既有 textarea 时保留 name/id 并移除 required、打 `data-lry-lite` 标记
- 入口输入清洗(剥 script/on*/javascript:);复用 dom/icons/emoji/serialize 与 full 版零分歧
- 新增 `npm run build:lite` / `watch:lite`;test/os-test.mjs 增加 11 项 lite 断言(共 18 项);新增 demo/lite.html

## 1.0.0 (2026-11-16)

首发:从 lryper.com 站内编辑器(历经 9 轮迭代与全量审计)抽出的通用开源版。

- Tiptap v3 内核,89 按钮工具栏(PC 全显 / 移动端 3 行自适应)
- Markdown 双向分栏(源码栏每行「+」行柄,26 项 markdown 行操作)
- 语雀式块:mermaid 画板 / 折叠块 / 分栏 / 任务列表 / 状态卡 / 文件卡 / 四色高亮块
- 行柄菜单(31 项行操作)、斜杠面板(6 组 47 卡片)
- 代码块增强(行号/语言标签/复制)、LaTeX 公式、自动大纲+标题折叠、自动保存
- AI 面板(适配器注入,含生成大纲/流程图/思维导图)
- 适配器抽象:memory(默认零后端) + createUrlAdapter + 自定义对象
- 存量内容兼容层:`<font>`/`_src`/`brush:` 等旧格式自动归一化,roundtrip 语义零丢失
