# Changelog

## 1.4.3 (2026-11-25)

同步站内编辑器两轮优化,full 与 lite 版本号统一为 1.4.3。既有 HTML 存储契约不变。

- **Markdown 文件导入(1.4.2)**:工具栏新增「导入 Markdown 文件」,支持选择 `.md` / `.markdown`;选择后直接转换插入,非法扩展名与空文件明确提示且不修改内容;对话框保留粘贴入口并支持拖入文件
- **导入归一**:粘贴导入也经过语雀块归一,Mermaid 围栏正确还原为画板存储契约
- **焦点修复(1.4.3)**:Markdown 源码输入或删除并同步预览时,不再强制聚焦富文本编辑区,光标与输入法状态留在源码栏
- **文件读取兼容**:统一 `File.text()` 与 `FileReader` 回退,文件选择和编辑区拖入共用同一读取逻辑

### 构建与测试

- full `891.80KB / gzip 292.79KB`,lite `432.97KB / gzip 138.10KB`,独立布局层 `21.92KB / gzip 8.69KB`
- `npm run build` / `build:lite` / `build:diagram` 三条构建;full 与 lite 版本号统一为 1.4.3
- `test/os-test.mjs` 100 → **118 项**:文件类型/空文件校验、`.md` / `.markdown` 导入、粘贴入口与画板归一、源码输入/删除焦点保持;full 工具栏断言改为逐命令核对
- `test/os-browser.mjs` 33 → **38 项**:真实 Chromium 文件读取导入、对话框关闭、键盘输入/删除后的源码焦点保持

## 1.4.1 (2026-11-25)

同步 `lryper.com` 站内编辑器 1.3 / 1.4 系列增量,并保留开源版零后端适配器与独立发布结构。既有 HTML 主契约不变:画板仍是 `<pre class="lry-mermaid">`,公式仍是 `\(…\)` / `\[…\]`;新增布局信息仅作为 Mermaid 注释写入图源。

- **可视化自由画板**:流程图 / 思维导图 / UML 类图可直接拖拽编辑;节点自由摆放、连线跟随、子图重算、思维导图确定性排版
- **自由画布**:多选 / 框选、左侧工具条、文字 / 图形 / 连线 / 贴纸 / 图片、右键菜单、复制剪切粘贴、平移缩放、PNG / SVG 导出
- **共享布局层**:节点坐标与自由元素存入图源末尾 `%% lry-layout v1` 单行 JSON;编辑器与发布端共用 `layout-core.js`,新增独立产物 `dist/lry-diagram-layout.js`(`window.LryDiagramLayout`)
- **公式编辑**:KaTeX 懒加载与编辑态渲染、实时预览、符号面板、Ctrl/⌘+Enter 确认、双击 / 回车编辑、行内与块级切换、代码块与文末安全落位
- **插入槽位**:空段落原位替换、块后自动补可写段落;行柄 / 斜杠 / 工具栏入口统一
- **折叠与 Markdown**:折叠块真正支持开合;`:::fold` / `:::cols` / `:::col` 可嵌套,画板与容器导出再导入不丢外壳;状态卡 / 文件卡 / Mermaid 围栏往返保真
- **图片对话框**:支持画板选图回调、多图选择与确定后关闭;所有上传 / 列表 / 抓图仍走实例 adapter
- **开源适配层增强**:AI 支持流式增量与取消,修复多实例面板串用;URL 适配器修复 REST 端点拼接,支持可选 init/part/finish 分片、单片重试、进度、CSRF 与超时
- **安全**:画板布局与剪贴板视为不可信输入,颜色只接受十六进制 / transparent,图片拒绝 `javascript:` 等协议;布局 JSON 转义四字节字符与 HTML 尖括号

### 构建与测试

- full `890.69KB / gzip 292.30KB`,lite `432.97KB / gzip 138.10KB`,独立布局层 `21.92KB / gzip 8.69KB`
- `npm run build` / `build:lite` / `build:diagram` 三条构建;lite 版本号同步修正为 1.4.1
- `test/os-test.mjs` 78 → **100 项**:布局往返 / 恶意布局过滤、公式解析与落位、折叠开合、嵌套 Markdown 容器、AI 前置指令、SSE 半包 / 取消、分片重试、REST 端点、资源基址
- `test/os-browser.mjs` 28 → **33 项**:真实 Mermaid 画板、自由工具切换、源码布局恢复、KaTeX 渲染、公式符号面板,以及原有移动端 / 高亮 / 粘贴回归
- demo 增加公式样例;补齐 Mermaid / KaTeX 许可证;YzmCMS 升级包同步到 1.4.1



代码块补全与「预告下一行」(同步自 lryper.com 站内版)。**存储契约零变化**:代码块仍是 `<pre class="brush:js;toolbar:false;">`,语法着色只是编辑态装饰,不进序列化。

- **编辑态语法高亮**:代码块在编辑时即按语言着色,与渲染端共用同一份 highlight.js(58 种语言)和调色板(10 套主题);按代码块节点缓存,文档里出现非空代码块时才懒加载,打包体积不增长;加载失败只是不高亮
- **代码块顶栏语言下拉**:语言名变为可点按钮,弹出带搜索的语言表(回车选中)
- **粘贴的代码块保留语言**:`<code class="language-xxx">` 换算为 `brush:` 契约形态(常见别名归一);外部代码块按块结构插入,不再被摊成段落里的纯文本
- **粘贴自动识别语言**:向纯文本代码块粘贴多行内容时按确定性特征识别(`<?php`、shebang、可解析的 JSON、`SELECT…FROM`、`def f():`…),认不出保持纯文本,不猜
- **跳出代码块**:空行上回车(连按两次回车)/ `Esc` / 末行 `↓` / 点击代码块下方的空白
- Tab / Shift+Tab 缩进与反缩进(多行选区统一处理);单元格内的代码块 Tab 仍是缩进
- **预告下一行**:文末是代码块、表格、画板等块时,其下方画出一行待写行,行首「+」常显——点行内任意处新起一段并落进去,点「+」新起一段并打开行菜单

### 开源版适配(1.2.0 / 1.2.1 共同)

- **适配器贯穿**:拖入/粘贴上传、对话框上传、在线管理、图转存、lite 贴图等每个调用点都带实例——每个实例的 `adapter` 在该实例的所有入口生效(此前部分入口会静默回落到全局适配器)
- 代码高亮资源随包分发:`third-party/highlight/`(highlight.js 11.12.0 自定义构建 + 调色板)。基址与 showdown / mermaid 同法,从 `<script src="…/dist/lry-editor.js">` 推断;可用 `window.LRY_EDITOR_HIGHLIGHT_BASE` 单独覆写,或用 `window.LRY_EDITOR_BASE` 统一覆写;页面已自带 `window.hljs` 时不重复加载
- 默认 memory 适配器支持非图片文件:视频/音频/附件存 dataURI,返回 `filetype: 2`,不进图库
- URL 适配器的上传表单只带可序列化字段(`file` / `filetype` / `module`;此前把 `onProgress` 回调的源码也当成字段发给了服务端)
- 默认 memory 适配器的图转存在无 `FileReader` 的环境(Node / SSR)改走 Buffer 兜底(此前该分支引用了未定义的变量,恒判转存失败;浏览器路径不变)

### 测试

- `test/os-test.mjs` 18 → 78 项(jsdom):适配器贯穿(每个实例的 adapter 在拖入/粘贴/对话框/在线管理/图转存/lite 贴图各入口生效)、工具栏预设(full 90 / mini 24 个命令全部渲染)、CMS 集成形态(挂在既有 textarea 上、`window.LRY_EDITOR_BASE` 指定平铺包根)、URL 适配器的端点拼接与表单字段、上下文工具条、列宽拖拽、斜杠面板、查找条、自动排版、导出、代码块按键与预告下一行、语言识别、粘贴代码块保留语言
- 新增 `npm run test:browser`(真实 Chromium,28 项):第三方资源基址推断与懒加载(文档里没有代码块时不请求 highlight.js,出现代码块后才从 `third-party/highlight/` 加载)、令牌着色的实际计算色、语言下拉、预告行点击、连按回车跳出、默认适配器下的粘贴/拖入、上下文条、查找条、390px 视口、零 pageerror
- demo 首页补上代码块样例(载入即着色,文末可见预告下一行),斜杠面板卡片数更正为 51
- YzmCMS 集成升级包 `lry-editor-yzmcms-upgrade.tar.gz` 同步到 1.2.1:替换 4 个 js/css、新增 `third-party/highlight/`、`form.class.php` 的 `?v=` 升到 1.2.1、5 个前台模板的 lite 资源补上 `?v=1.2.1`(此前没有)。用包内 `form.class.php` 的原样输出在真实 Chromium 里验证 27 项(上传与在线管理走 YzmCMS 端点形态的桩);**未在真实 YzmCMS 站点上做登录后的端到端验证**
- `package.json` 的 `puppeteer-core` 范围由 `^19` 更正为 `^25.17.0`——lock 文件与实际安装一直是 25.17.0,浏览器回归即在它上面跑

## 1.2.0 (2026-11-24)

编辑体验升级(同步自 lryper.com 站内版),并补齐 1.1.1 之后站内几轮未发布的增量。全部为增量能力,**既有存储契约零变化**(存量 roundtrip 回归 359 断言不变)。

- **上下文工具条**:光标进入链接 / 选中图片 / 光标或单元格选区在表格内时,在锚点上方浮现对应操作条(三态互斥)
  - 链接:网址 · 编辑(Ctrl+K)· 复制 · 移除
  - 图片:对齐(默认/左浮/居中/右浮)· 宽度 25/50/75/100% · 说明 · 替换 · 删除;双击图片进入编辑对话框
  - 表格:上/下插行 · 左/右插列 · 删行/删列 · 合并/拆分 · 表头行开关 · 单元格背景色 · 对齐 · 表格属性
- **表格列宽拖拽**:单元格右内侧手柄,拖拽实时预览,松手写回该列各单元格的 `width` 属性(像素),一次可撤销
- **划词浮动工具条**:选中文本时在选区上方浮现格式条(full 10 钮 / lite 6 钮),自研零依赖,点击后选区保持可连续施加
- **斜杠面板 2.5**:6 组 51 张卡片;只在行首或空白之后的 `/`(以及行首 `+`)触发,网址/路径里的斜杠不再误弹;↑↓ 循环导航、Enter 选中、跨组搜索,别名支持英文/全拼/首字母
- **查找替换浮动条**:由模态对话框改为编辑器内浮动条(不打断输入);全部匹配高亮、跨 mark 边界匹配、区分大小写/全词/正则、全部替换单事务;Ctrl+F / Ctrl+H
- **图片等比缩放手柄**、**首行缩进**(工具栏开关:全部顶层段落缩进 2 字符,仅作用顶层段落,引用/列表/折叠体内不缩进)
- **粘贴/拖拽增强**:视频/音频/附件拖入或粘贴即经适配器上传并插入对应节点(`dropFiles: false` 可关);`.md` 文件拖入按 Markdown 导入;选中文本后粘贴单个网址转为链接;Ctrl/⌘+Shift+V 强制纯文本;图文混排剪贴板不再丢文字
- **导出**:工具栏「导出」下拉 → Markdown / 网页(.html)/ Word(.doc)/ 纯文本;站内相对地址按 `window.LRY_EDITOR_EXPORT_BASE` 或页面 origin 补全
- **字数详情**:点击状态栏字数 → 中文字数/西文单词/字符数(含·不含空白)/段落/标题/预估阅读时间
- **取色器**:原生取色器 + 十六进制输入(支持 `#abc` 简写)+ 最近使用(localStorage,8 色)
- **自动排版**:「清除行首尾空格」「合并连续空行」「清除空段落」全部生效(旧实现只算不写回);`autoTypeset: { emptyParas, trimSpaces, mergeBlank, paste }` 可配置,`paste: true` 时粘贴后自动应用
- **AI 结果智能插入**:含 Markdown 结构的结果转为富文本(```mermaid 围栏 → 画板块),纯文本按文本插入(旧实现把结果当 HTML 解析,代码里的 `<div>` 会被吞成真标签)
- **快捷键**:Ctrl/⌘+Shift+H 高亮;链接对话框校验协议(`javascript:` / `data:` 拒绝)
- **浮层定位**:不盖编辑器工具栏、不与宿主页面的固定页头重叠(自动探测页头高度),下方放不下时向上弹
- **lite 简约版**:划词浮动工具条(6 钮)、待办清单(契约同 full:`ul.lry-task` + ☑/☐ 字符)、可选贴图 `images: true`(经适配器上传);工具栏 14 → 15 钮
- **修复(Markdown 分栏)**:预览侧增量替换的 off-by-one(高亮块内回车导致预览卡片消失);showdown 给标题生成的锚点 id 导致首块被反复重插;多行高亮块在预览侧被并成一行
- 体积:full 623KB → 682KB(gzip 223KB);lite 413KB → 432KB(gzip 138KB)

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
