/**
 * lry-editor 全局配置:工具栏预设 / 字体字号 / 代码语言 / 特殊字符 / 模板
 * 工具栏预设与旧 UEditor 90 按钮全量对齐(2026-11-15 方案定稿)。
 */

/* 代码块语言表(与旧 UEditor insertcode 55 项一致,brush 名为准) */
export const CODE_LANGS = {
  as3: 'ActionScript', bash: 'Bash/Shell', c: 'C', cpp: 'C/C++', csharp: 'C#',
  css: 'CSS', dart: 'Dart', delphi: 'Delphi/Pascal', diff: 'Diff',
  dockerfile: 'Dockerfile', erlang: 'Erlang', go: 'Go', gradle: 'Gradle',
  groovy: 'Groovy', haskell: 'Haskell', html: 'HTML', http: 'HTTP',
  ini: 'INI/TOML', java: 'Java', js: 'JavaScript', json: 'JSON',
  julia: 'Julia', kotlin: 'Kotlin', latex: 'LaTeX', less: 'Less', lua: 'Lua',
  makefile: 'Makefile', matlab: 'Matlab', mind: 'Mind', nginx: 'Nginx',
  objectivec: 'Objective-C', perl: 'Perl', php: 'PHP', plain: '纯文本',
  powershell: 'PowerShell', properties: 'Properties', protobuf: 'Protobuf',
  python: 'Python', r: 'R', ruby: 'Ruby', rust: 'Rust', scala: 'Scala',
  scss: 'SCSS', sql: 'SQL', swift: 'Swift', ts: 'TypeScript', vb: 'VB',
  vbnet: 'VB.net', wasm: 'WebAssembly', xml: 'XML', yaml: 'YAML',
  apache: 'Apache', cmake: 'CMake', clojure: 'Clojure', elixir: 'Elixir',
  graphql: 'GraphQL'
};

/* highlight.js 语言 id → 上述 brush 名的映射(渲染高亮用;不在表中的以 plain 处理) */
export const BRUSH_TO_HLJS = {
  js: 'javascript', cpp: 'cpp', csharp: 'csharp', html: 'xml', xml: 'xml',
  ts: 'typescript', plain: 'plaintext', delphi: 'delphi', objectivec: 'objectivec',
  vbnet: 'vbnet', vb: 'vbnet', scss: 'scss', less: 'less', yaml: 'yaml',
  json: 'json', dockerfile: 'dockerfile', makefile: 'makefile', ini: 'ini',
  properties: 'ini', graphql: 'graphql', wasm: 'x86asm'
};

export const FONTS = [
  { label: '默认', value: '' },
  { label: '宋体', value: 'SimSun, Songti SC, serif' },
  { label: '微软雅黑', value: "'Microsoft YaHei', 'Hiragino Sans GB', sans-serif" },
  { label: '黑体', value: 'SimHei, Heiti SC, sans-serif' },
  { label: '楷体', value: 'KaiTi, Kaiti SC, serif' },
  { label: '仿宋', value: 'FangSong, Fangsong SC, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Consolas', value: 'Consolas, monospace' }
];

export const FONT_SIZES = [
  { label: '10px', value: '10px' }, { label: '11px', value: '11px' },
  { label: '12px', value: '12px' }, { label: '13px', value: '13px' },
  { label: '14px', value: '14px' }, { label: '15px', value: '15px' },
  { label: '16px', value: '16px' }, { label: '18px', value: '18px' },
  { label: '20px', value: '20px' }, { label: '24px', value: '24px' },
  { label: '28px', value: '28px' }, { label: '32px', value: '32px' },
  { label: '36px', value: '36px' }, { label: '48px', value: '48px' }
];

export const LINE_HEIGHTS = ['1', '1.2', '1.5', '1.75', '2', '2.5', '3'];
export const LETTER_SPACINGS = ['0', '0.5px', '1px', '2px', '3px', '5px', '8px'];
export const ROW_SPACINGS = ['0', '5px', '10px', '15px', '20px', '25px', '30px', '40px'];

/* 颜色面板(前景/背景/高亮共用一板,末位"清除色") */
export const COLORS = [
  '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
  '#ff0000', '#ff6600', '#ff9900', '#ffcc00', '#ffff00', '#99cc00',
  '#339933', '#009966', '#00cccc', '#0099ff', '#0066ff', '#6633ff',
  '#9933ff', '#ff33cc', '#ff6699', '#cc3333', '#996633', '#336600'
];

export const SPECIAL_CHARS = [
  '“”‘’', '—…·ˉˇ¨〃', '∈∏∑∕√∝∞∟∠∣∥∧∨∩∪', '∫∮∴∵∶∷∽≈≌≒≠≡≤≥≦≧≯≮',
  '⊕⊙⊥⊿', '①②③④⑤⑥⑦⑧⑨⑩⑪⑫', 'ⒶⒷⒸ', '❝❞❖❈❉❀✿♥♦♣♠',
  '→←↑↓↔↕⇒⇔', '€£¥℃℉‰№㎡㎜㎝㎞㏄㏎㏑㏒㏕', 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ',
  'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわをんゔ',
  '阿啊埃挨哎唉哀皑癌蔼矮艾碍爱隘', 'ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ'
];

/* 插入模板(对齐旧 template 对话框:标题+正文) */
export const TEMPLATES = [
  {
    title: '图文混排', html: '<h2>小标题</h2><p>正文段落,<strong>加粗</strong>与<em>斜体</em>示例。</p><p><img src="" alt="图片说明"></p>'
  },
  {
    title: '两栏表格', html: '<table><tbody><tr><th>项目</th><th>说明</th></tr><tr><td>—</td><td>—</td></tr><tr><td>—</td><td>—</td></tr></tbody></table>'
  },
  {
    title: '代码教程', html: '<h2>环境准备</h2><p>先安装依赖:</p><pre class="brush:bash;toolbar:false;">npm install</pre><h2>开始使用</h2><p>示例代码:</p><pre class="brush:js;toolbar:false;">console.log("hello");</pre>'
  },
  {
    title: '提示块', html: '<blockquote class="lry-alert lry-alert-warning"><p>注意事项:这里是提示内容。</p></blockquote><blockquote class="lry-alert lry-alert-info"><p>补充说明:这里是说明内容。</p></blockquote>'
  }
];

/* 全量工具栏(对齐旧 ueditor.config.js 默认 toolbar,按 90 按钮全量) */
export const TOOLBAR_FULL = [
  ['fullscreen', 'source', 'markdown', '|', 'undo', 'redo', '|',
    'bold', 'italic', 'underline', 'fontborder', 'strikethrough', 'superscript', 'subscript', '|',
    'removeformat', 'formatmatch', 'pasteplain', 'autotypeset', 'blockquote', '|',
    'forecolor', 'backcolor', 'lrymark', '|',
    'insertorderedlist', 'insertunorderedlist', '|', 'selectall', 'cleardoc', '|',
    'rowspacingtop', 'rowspacingbottom', 'lineheight', 'letterspacing', '|',
    'customstyle', 'paragraph', 'fontfamily', 'fontsize', '|',
    'directionalityltr', 'directionalityrtl', 'indent', 'outdent', '|',
    'justifyleft', 'justifycenter', 'justifyright', 'justifyjustify', '|',
    'touppercase', 'tolowercase', '|', 'link', 'unlink', 'anchor', '|',
    'imagenone', 'imageleft', 'imagecenter', 'imageright', '|',
    'simpleupload', 'insertimage', 'emotion', 'scrawl', 'insertvideo', 'insertaudio', 'attachment', 'insertframe', 'insertcode', 'pagebreak', 'template', 'background', 'formula', 'horizontal', 'date', 'time', 'spechars', 'wordimage', '|',
    'inserttable', 'insertrow', 'insertcol', 'deleterow', 'deletecol', 'mergecells', 'mergeright', 'mergedown', 'splittocells', 'splittorows', 'splittocols', 'edittable', 'edittd', 'insertparagraphbeforetable', 'deletetable', '|',
    'print', 'preview', 'searchreplace', '|', 'contentimport', 'exportmd', 'ai', 'help']
];

/* mini 工具栏(对齐旧 form::editor_mini) */
export const TOOLBAR_MINI = [
  ['fullscreen', 'source', '|', 'undo', 'redo', '|', 'removeformat', 'formatmatch', 'pasteplain',
    'bold', 'italic', 'underline', 'blockquote', 'forecolor', '|',
    'paragraph', 'fontsize', 'fontfamily', '|',
    'simpleupload', 'insertimage', 'link', 'unlink', 'emotion', 'insertcode', 'insertaudio', 'date', 'time']
];

/* 论坛前台全量(旧 default/add.html 用默认 toolbar,wordcount 关) */
export const TOOLBAR_FORUM = TOOLBAR_FULL;
