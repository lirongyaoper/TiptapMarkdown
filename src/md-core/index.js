/**
 * lry-editor md-core —— 2026-11-15 自 ueditor.all.js:31815-33780 平移(逻辑零改动)。
 * 平移方式:原段为 UE.* 全局函数赋值 + 浅依赖(utils.each/domUtils.remove),
 * 此处以局部 UE 命名空间包壳并导出,showdown 懒加载路径改指本包 third-party/。
 * 供 markdown 分栏模式 / markdownPaste / contentimport / exportmd 共用。
 */

/* ---- 平移垫片:原段仅有的两个外部依赖 ---- */
var utils = {
  each: function (obj, fn) {
    if (!obj) return;
    if (obj.length != null && typeof obj !== 'function') {
      for (var i = 0; i < obj.length; i++) fn(obj[i], i, obj);
    } else {
      for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) fn(obj[k], k, obj);
    }
  }
};
var domUtils = {
  remove: function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); }
};

var UE = { };

/* ============ Markdown 公共核心 ============ */
/* 供 markdown-paste / markdown-shortcut / markdown-mode / contentimport / exportmd 共用：
   - UE.postprocessMarkdownHtml：showdown 输出 → 编辑器约定格式
   - UE.markdownShowdownOptions：统一 showdown 配置（GFM 兼容 + 防误判项）
   - UE.markdownSanitizeHtml：导入内容先行的属性/协议消毒（编辑器过滤是二道防线）
   - UE._markdownConvert / UE.markdownToHtml：Markdown → 编辑器 HTML（含 front matter 提取）
   - UE.htmlToMarkdown：编辑器 HTML → Markdown（导出 / 退出 Markdown 模式共用）
   - UE.markdownNeedsEscaping：判断源文是否含会被误读为 Markdown 格式的字符 */

/* 代码块语言 → brush 名（2026-11-09 起与 highlight.js 语言 id 对齐；未知语言原样保留，往返不丢） */
UE.mdLangToBrush = (function () {
    var map = {
        javascript: "js", node: "js", nodejs: "js", jsx: "js", mjs: "js",
        typescript: "ts", tsx: "ts",
        jsp: "java", kotlin: "kotlin", swift: "swift", dart: "dart", scala: "scala", groovy: "groovy",
        xhtml: "xml", xslt: "xml", svg: "xml", vue: "html", cshtml: "html", jinja: "html",
        sass: "scss", stylus: "css",
        sh: "bash", shell: "bash", zsh: "bash", console: "bash", terminal: "bash", bat: "plain",
        "c#": "csharp", cs: "csharp", "c++": "cpp", objc: "objectivec",
        mysql: "sql", pgsql: "sql", sqlite: "sql",
        rails: "ruby", golang: "go", rlang: "r",
        yml: "yaml", toml: "ini", conf: "ini", config: "ini", properties: "properties", props: "properties",
        markdown: "markdown", md: "markdown", text: "plain", txt: "plain", diff: "diff",
        powershell: "powershell", ps1: "powershell", posh: "powershell", pwsh: "powershell",
        vb: "vb", vbscript: "vbscript", pascal: "delphi", objectpascal: "delphi",
        actionscript: "actionscript", actionscript3: "actionscript", as3: "actionscript",
        tex: "latex", docker: "dockerfile", ps: "powershell", pl: "perl", py: "python", python3: "python",
        protobuf: "protobuf", proto: "protobuf", graphql: "graphql", gql: "graphql",
        julia: "julia", erlang: "erlang", haskell: "haskell", hs: "haskell",
        html: "html", xml: "xml", css: "css", less: "less", http: "http", ini: "ini",
        json: "json", yaml: "yaml", c: "c", cpp: "cpp", java: "java", php: "php",
        python: "python", bash: "bash", sql: "sql", ruby: "ruby", go: "go", rust: "rust",
        lua: "lua", perl: "perl", r: "r", matlab: "matlab", latex: "latex",
        dockerfile: "dockerfile", nginx: "nginx", makefile: "makefile", cmake: "cmake",
        apache: "apache", elixir: "elixir", clojure: "clojure", wasm: "wasm",
        plaintext: "plain", plain: "plain", "": "plain"
    };
    return function (lang) {
        var name = String(lang || "").toLowerCase().replace(/^\s+|\s+$/g, "");
        if (!/^[a-z0-9#+._-]*$/.test(name) || name.length > 16) {
            return "plain";
        }
        return map[name] !== undefined ? map[name] : name;
    };
})();

/* brush 名 → 围栏语言标识（导出方向）。旧 brush（ps/pl/as3…）映射到新语言 id，
   未知的原样输出，不再压成 plain */
UE.mdBrushToLang = function (brush) {
    var b = String(brush || "").toLowerCase().replace(/^\s+|\s+$/g, "");
    var map = {
        js: "js", css: "css", java: "java", php: "php", python: "python", bash: "bash",
        sql: "sql", cpp: "cpp", xml: "xml", html: "html", csharp: "csharp", ts: "ts",
        plain: "", text: "", plaintext: "", ps: "powershell", pl: "perl", as3: "actionscript",
        vb: "vb", delphi: "delphi", erlang: "erlang", groovy: "groovy", scala: "scala",
        mind: "", jfx: "java", cf: "", diff: "diff"
    };
    return map[b] !== undefined ? map[b] : b;
};

/* pre class 解析：{ brush, theme }（class 形如 "brush:js;toolbar:false;theme:monokai;"） */
UE.mdBrushInfo = function (cls) {
    var s = String(cls || "");
    var bm = s.match(/brush:\s*([^;\s]+)/i);
    var tm = s.match(/theme:\s*([^;\s]+)/i);
    return {
        brush: bm ? bm[1] : "",
        theme: tm ? tm[1] : ""
    };
};

/* 裸域名链接补协议：Markdown 里 [x](oss.lrybk.com/path) 这类无协议目标，showdown 原样
   输出 href="oss.lrybk.com/path"，浏览器按相对路径解析致链接失效，论坛 handle_url 外链
   跳转又只认 http/https。这里统一补 https://。仅认“域名样”目标：host.tld 带路径/查询/锚点，
   或无路径但带 www. 前缀 / 常见 TLD；不动相对路径(/、./、#、?)、协议相对(//)、已带协议、mailto/tel 等。 */
UE.mdNormalizeBareUrl = (function () {
    var SCHEME_AUTH = /^[a-z][a-z0-9+.-]*:\/\//i;   // http:// https:// ftp:// …（带 authority）
    var SCHEME_OTHER = /^(?:mailto|tel|fax|sms|callto|skype|data|javascript|vbscript|livescript|file|about|blob|filesystem|view-source|news|irc|xmpp|geo|magnet|urn|bitcoin|webcal|feed):/i;
    var HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,})$/i;
    // 无路径时仅认常见 TLD，避免把 report.pdf / file.html 这类相对文件名误判为域名
    var COMMON_TLD = /^(?:com|net|org|edu|gov|mil|int|cn|io|co|me|cc|tv|info|biz|xyz|top|vip|club|shop|site|online|tech|app|dev|ai|it|de|uk|us|jp|fr|ru|tw|hk|sg)$/i;
    return function (url) {
        var s = String(url == null ? "" : url);
        var t = s.replace(/^\s+|\s+$/g, "");
        if (!t || SCHEME_AUTH.test(t) || SCHEME_OTHER.test(t) || /^[\/#?.]/.test(t)) {
            return s;
        }
        var idx = t.search(/[\/?#]/);
        var host = (idx === -1 ? t : t.slice(0, idx)).replace(/:\d+$/, "");
        var rest = idx === -1 ? "" : t.slice(idx);
        var m = host.match(HOST);
        if (!m) {
            return s;
        }
        if (rest || /^www\./i.test(host) || COMMON_TLD.test(m[1])) {
            return "https://" + t;
        }
        return s;
    };
})();

/* Markdown HTML 后处理：统一为编辑器约定格式
   - 残留的 <pre><code class="language-x">（缩进式代码块；围栏已由预处理接管）转 insertcode 的 <pre class="brush:x;toolbar:false;">
   - 任务列表 checkbox（编辑器会过滤 input 标签）转 ☑/☐ 字符
   - 裸域名链接 href 补 https://（见 UE.mdNormalizeBareUrl） */
UE.postprocessMarkdownHtml = function (html) {
    html = String(html);
    // 代码块：<pre><code class="language-xxx">…</code></pre> → <pre class="brush:xxx;toolbar:false;">…</pre>
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/gi, function (all, attrs, code) {
        var lang = "plain";
        var m = (attrs || "").match(/(?:^|\s)(?:language-|lang-)([a-z0-9#+._-]+)/i);
        if (m) {
            lang = UE.mdLangToBrush(m[1]);
        }
        return '<pre class="brush:' + lang + ';toolbar:false;">' + code + "</pre>";
    });
    // 任务列表勾选框 → ☑/☐（编辑器过滤规则会剔除 input 标签；type 位置两种顺序都兼容）
    html = html.replace(/<input\b[^>]*>/gi, function (input) {
        if (!/type\s*=\s*["']?checkbox/i.test(input)) {
            return input;
        }
        return /checked/i.test(input) ? "\u2611" : "\u2610";
    });
    // 裸域名链接补 https://（[x](oss.lrybk.com/path) → href="https://oss.lrybk.com/path"）
    html = html.replace(/<a\s[^>]*>/gi, function (tag) {
        return tag.replace(/(\s)href\s*=\s*(?:"([^"]*)"|'([^']*)')/i, function (attr, sp, dq, sq) {
            var href = dq !== undefined ? dq : sq;
            var norm = UE.mdNormalizeBareUrl(href);
            if (norm === href) {
                return attr;
            }
            var quote = dq !== undefined ? '"' : "'";
            return sp + "href=" + quote + norm + quote;
        });
    });
    return html;
};

/* 统一 showdown 配置（GFM 兼容 + 防常见误判） */
UE.markdownShowdownOptions = function () {
    return {
        tables: true,                                // 表格解析
        strikethrough: true,                         // ~~删除线~~
        tasklists: true,                             // - [x] 任务列表
        simplifiedAutoLink: true,                    // 自动识别 URL
        parseImgDimensions: true,                    // ![alt](url =100x200) 图片尺寸
        excludeTrailingPunctuationFromURLs: true,    // 链接尾部标点不并入 URL
        ghCompatibleHeaderId: true,                  // 标题锚点 id
        requireSpaceBeforeHeadingText: true,         // # 后必须空格（"#话题" 是话题标签不是标题）
        literalMidWordUnderscores: true,             // snake_case 不转斜体
        disableForced4SpacesIndentedSublists: true,  // 两空格缩进子列表（GFM 风格）
        encodeEmails: false,                         // 邮箱不做实体混淆（中文内容混排更干净）
        metadata: true                               // 识别 YAML front matter 并从正文剔除
    };
};

/* CSS 白名单消毒（2026-11-09）：只保留安全属性，值逐项正则校验。
   入参为浏览器已解码实体后的 style 文本；含 url( / expression / javascript: / @import /
   反斜杠转义 / 注释 / 尖括号 / 残留实体 的值整条丢弃。
   返回规范化后的 "prop:value;prop:value"（无安全属性时返回空串）。 */
UE.sanitizeCssStyle = (function () {
    var NUM = "-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
    var LEN = "(?:" + NUM + "(?:px|em|rem|pt|pc|%|ex|ch|vw|vh|cm|mm|in)|0|auto|inherit|initial|normal)";
    var COLOR = "(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?)\\(\\s*" + NUM + "%?\\s*,\\s*" + NUM + "%?\\s*,\\s*" + NUM +
        "%?\\s*(?:,\\s*" + NUM + "%?\\s*)?\\)|[a-z]{3,24})";
    var BORDER_PART = "(?:" + LEN + "|none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset|thin|medium|thick|windowtext|" + COLOR + ")";
    function re(src) {
        return new RegExp("^(?:" + src + ")$", "i");
    }
    var reLen = re(LEN);
    var reLens = re(LEN + "(?:\\s+" + LEN + "){0,3}");
    var reColor = re(COLOR);
    var reBorder = re(BORDER_PART + "(?:\\s+" + BORDER_PART + "){0,2}");
    var rules = {
        "color": reColor,
        "background-color": reColor,
        "background": reColor,
        "font-family": /^[a-z0-9\u00a0-\uffff ,'"_.-]{1,200}$/i,
        "font-size": re(LEN + "|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger"),
        "font-weight": /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
        "font-style": /^(?:normal|italic|oblique)$/i,
        "text-decoration": /^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/i,
        "text-align": /^(?:left|right|center|justify|start|end)$/i,
        "text-indent": reLen,
        "line-height": re(LEN + "|" + NUM),
        "letter-spacing": reLen,
        "margin": reLens,
        "margin-top": reLen,
        "margin-bottom": reLen,
        "margin-left": reLen,
        "margin-right": reLen,
        "padding": reLens,
        "padding-left": reLen,
        "padding-right": reLen,
        "border": reBorder,
        "width": reLen,
        "height": reLen,
        "max-width": reLen,
        "float": /^(?:left|right|none)$/i,
        "vertical-align": /^(?:baseline|sub|super|top|middle|bottom|text-top|text-bottom)$/i,
        "direction": /^(?:ltr|rtl)$/i,
        "white-space": /^(?:normal|nowrap|pre|pre-wrap|pre-line)$/i,
        "border-collapse": /^(?:collapse|separate)$/i
    };
    var BAD = /url\s*\(|expression|javascript\s*:|vbscript\s*:|@import|behaviou?r\s*:|-moz-binding|\\|\/\*|\*\/|[<>&{}\x00-\x1f\x7f]/i;
    var sanitize = function (css) {
        css = String(css == null ? "" : css);
        if (!css || /\\|\/\*/.test(css)) {
            // 反斜杠转义 / 注释可拼接出任意属性名，整条丢弃
            return "";
        }
        var out = [];
        var seen = {};
        var parts = css.split(";");
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            var idx = part.indexOf(":");
            if (idx <= 0) {
                continue;
            }
            var prop = part.substring(0, idx).replace(/^\s+|\s+$/g, "").toLowerCase();
            var val = part.substring(idx + 1).replace(/^\s+|\s+$/g, "").replace(/\s*!important$/i, "");
            if (!rules.hasOwnProperty(prop) || !val || val.length > 200 || BAD.test(val)) {
                continue;
            }
            if (!rules[prop].test(val)) {
                continue;
            }
            // 统一为双引号属性内可安全承载的形式
            val = val.replace(/"/g, "'").replace(/\s+/g, " ");
            if (seen.hasOwnProperty(prop)) {
                out[seen[prop]] = prop + ":" + val;
            } else {
                seen[prop] = out.length;
                out.push(prop + ":" + val);
            }
        }
        return out.join(";");
    };
    sanitize.rules = rules;
    return sanitize;
})();

/* URL 协议校验（白名单）：放行 http(s)/mailto/tel/ftp、相对路径/锚点/协议相对、
   data:image（栅格图）；其余协议（javascript/vbscript/blob/filesystem/search-ms 等）一律拒绝 */
UE.markdownSafeUrl = function (url) {
    var clean = String(url == null ? "" : url).replace(/[\x00-\x20\x7f\s]+/g, "");
    if (!clean) {
        return true;
    }
    var scheme = clean.match(/^([a-z][a-z0-9+.-]*):/i);
    if (!scheme) {
        return true;
    }
    var proto = scheme[1].toLowerCase();
    if (proto === "http" || proto === "https" || proto === "mailto" ||
        proto === "tel" || proto === "ftp") {
        return true;
    }
    if (proto === "data") {
        return /^data:image\/(png|jpe?g|gif|webp|bmp)[;,]/i.test(clean);
    }
    return false;
};

/* 导入 Markdown 的 HTML 消毒（2026-11-09 改为惰性文档 DOM 遍历）：
   showdown 会原样放行 HTML 片段，这里先剔除危险元素/事件属性/危险协议，
   style 走 CSS 白名单（不再整条删除），编辑器自身 whiteList 过滤是二道防线。
   在 createHTMLDocument 的惰性文档中解析：图片不加载、脚本不执行，
   也不会出现正则切标签被引号内 ">" 截断而漏掉事件属性的问题。 */
UE.markdownSanitizeHtml = (function () {
    var DROP = {
        script: 1, style: 1, object: 1, applet: 1, form: 1, link: 1, meta: 1, base: 1,
        frame: 1, frameset: 1, noscript: 1, template: 1, svg: 1, math: 1, portal: 1
    };
    var URL_ATTR = {
        href: 1, src: 1, action: 1, formaction: 1, data: 1, poster: 1, background: 1,
        lowsrc: 1, dynsrc: 1, cite: 1, longdesc: 1, codebase: 1, _src: 1, _url: 1
    };
    function inertDoc() {
        try {
            return document.implementation.createHTMLDocument("");
        } catch (e) {
            return null;
        }
    }
    function cleanEl(el) {
        var attrs = [];
        for (var i = 0; i < el.attributes.length; i++) {
            attrs.push(el.attributes[i].name);
        }
        for (var j = 0; j < attrs.length; j++) {
            var name = attrs[j];
            var lname = name.toLowerCase();
            var val = el.getAttribute(name);
            if (/^on/.test(lname) || lname === "srcdoc" || lname === "formaction" ||
                lname === "srcset" || lname === "xmlns" || /^xml/.test(lname)) {
                el.removeAttribute(name);
                continue;
            }
            if (lname === "style") {
                var css = UE.sanitizeCssStyle(val);
                if (css) {
                    el.setAttribute("style", css);
                } else {
                    el.removeAttribute("style");
                }
                continue;
            }
            if (URL_ATTR[lname] || /:href$/.test(lname)) {
                if (!UE.markdownSafeUrl(val)) {
                    if (lname === "href") {
                        el.setAttribute("href", "#");
                    } else {
                        el.removeAttribute(name);
                    }
                }
            }
        }
    }
    function walk(node) {
        var child = node.firstChild;
        while (child) {
            var next = child.nextSibling;
            if (child.nodeType === 1) {
                var tag = child.tagName.toLowerCase();
                if (DROP[tag] || tag.indexOf(":") !== -1) {
                    node.removeChild(child);
                } else {
                    cleanEl(child);
                    walk(child);
                }
            } else if (child.nodeType === 8) {
                node.removeChild(child);
            }
            child = next;
        }
    }
    return function (html) {
        html = String(html == null ? "" : html);
        if (!html) {
            return "";
        }
        var doc = inertDoc();
        if (!doc || !doc.body) {
            // 极端环境兜底：去掉所有尖括号标签，仅保留文本
            return html.replace(/<[^>]*>/g, "");
        }
        var box = doc.createElement("div");
        box.innerHTML = html;
        walk(box);
        return box.innerHTML;
    };
})();

/* 全局去重的脚本加载器：同一 URL 只加载一次，多编辑器实例共享（代码高亮 / KaTeX / showdown）。
   回调在脚本 onload 或 onerror 后统一触发，由调用方自行判断全局对象是否就绪。 */
UE.loadScriptOnce = (function () {
    var state = {};
    return function (url, cb) {
        var st = state[url];
        if (st && st.done) {
            if (cb) {
                cb();
            }
            return;
        }
        if (st) {
            if (cb) {
                st.cbs.push(cb);
            }
            return;
        }
        st = state[url] = { done: false, cbs: cb ? [cb] : [] };
        var script = document.createElement("script");
        script.src = url;
        script.onload = script.onerror = function () {
            st.done = true;
            var q = st.cbs.splice(0);
            for (var i = 0; i < q.length; i++) {
                try {
                    q[i]();
                } catch (e) {
                }
            }
        };
        (document.head || document.getElementsByTagName("head")[0]).appendChild(script);
    };
})();

/* ---------- Markdown 扩展语法支持表（预处理管线与 htmlToMarkdown 共用） ---------- */
/* 提示块类型：GitHub 语法 > [!NOTE] 等，亦认中文标签 */
UE.mdAlertTypes = {
    order: ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"],
    label: { NOTE: "提示", TIP: "技巧", IMPORTANT: "重要", WARNING: "警告", CAUTION: "注意" },
    alias: {
        NOTE: "NOTE", TIP: "TIP", IMPORTANT: "IMPORTANT", WARNING: "WARNING", CAUTION: "CAUTION",
        "提示": "NOTE", "技巧": "TIP", "重要": "IMPORTANT", "警告": "WARNING", "注意": "CAUTION"
    }
};

/* 语雀高亮块（2026-11 语雀语法对齐）：:::info / :::success / :::warning / :::danger 容器，
   亦认 GitHub 提示块类型与中文别名（note→info、tip→success、important→warning、caution→danger）。
   呈现为 lry-card 彩色卡片（区别于 GitHub 式 lry-alert 左边条），导出还原为 ::: 容器语法。
   alias 查找顺序：原样 → 大写 → 小写（info/INFO/Info 均可）。 */
UE.mdCardTypes = {
    order: ["info", "success", "warning", "danger"],
    label: { info: "信息", success: "成功", warning: "警示", danger: "危险" },
    color: { info: "#0969DA", success: "#1A7F37", warning: "#BF8700", danger: "#CF222E" },
    bg: { info: "#F1F8FF", success: "#F0FFF4", warning: "#FFF8E5", danger: "#FFF5F5" },
    alias: {
        info: "info", INFO: "info",
        success: "success", SUCCESS: "success",
        warning: "warning", WARNING: "warning",
        danger: "danger", DANGER: "danger",
        note: "info", NOTE: "info",
        tip: "success", TIP: "success",
        important: "warning", IMPORTANT: "warning",
        caution: "danger", CAUTION: "danger",
        "信息": "info", "成功": "success", "警告": "warning", "危险": "danger",
        "提示": "info", "技巧": "success", "重要": "warning", "注意": "danger"
    }
};

/* 语雀风格行内高亮色板：value 为空串 = 默认黄（导出 ==高亮== 标记，无内联样式）；
   彩色高亮存 <mark style="background-color:…">，导出保留为内联 HTML，往返无损。
   color 仅用于界面色块展示。 */
UE.mdHighlightColors = [
    { label: "默认黄", value: "", color: "#FFF3A3" },
    { label: "红色", value: "#FFD6D6", color: "#FFD6D6" },
    { label: "橙色", value: "#FFE3C2", color: "#FFE3C2" },
    { label: "绿色", value: "#C8F2D2", color: "#C8F2D2" },
    { label: "蓝色", value: "#CCE3FF", color: "#CCE3FF" },
    { label: "紫色", value: "#E7DAFF", color: "#E7DAFF" },
    { label: "青色", value: "#C4F1EE", color: "#C4F1EE" }
];

/* emoji 短码（GitHub 常用子集）：:smile: → 😄；字符本身导出时原样保留，往返无损 */
UE.mdEmoji = {
    smile: "\ud83d\ude04", smiley: "\ud83d\ude03", grin: "\ud83d\ude01", laughing: "\ud83d\ude06",
    joy: "\ud83d\ude02", rofl: "\ud83e\udd23", wink: "\ud83d\ude09", blush: "\ud83d\ude0a",
    heart_eyes: "\ud83d\ude0d", kissing_heart: "\ud83d\ude18", thinking: "\ud83e\udd14",
    neutral_face: "\ud83d\ude10", unamused: "\ud83d\ude12", sweat_smile: "\ud83d\ude05",
    sweat: "\ud83d\ude13", pensive: "\ud83d\ude14", confused: "\ud83d\ude15", cry: "\ud83d\ude22",
    sob: "\ud83d\ude2d", angry: "\ud83d\ude20", rage: "\ud83d\ude21", scream: "\ud83d\ude31",
    sunglasses: "\ud83d\ude0e", sleeping: "\ud83d\ude34", mask: "\ud83d\ude37", innocent: "\ud83d\ude07",
    smirk: "\ud83d\ude0f", relieved: "\ud83d\ude0c", yum: "\ud83d\ude0b", stuck_out_tongue: "\ud83d\ude1b",
    flushed: "\ud83d\ude33", open_mouth: "\ud83d\ude2e", astonished: "\ud83d\ude32",
    disappointed: "\ud83d\ude1e", worried: "\ud83d\ude1f", tired_face: "\ud83d\ude2b",
    weary: "\ud83d\ude29", fearful: "\ud83d\ude28", slightly_smiling_face: "\ud83d\ude42",
    upside_down_face: "\ud83d\ude43", hugs: "\ud83e\udd17", star_struck: "\ud83e\udd29",
    partying_face: "\ud83e\udd73", nerd_face: "\ud83e\udd13", roll_eyes: "\ud83d\ude44",
    "+1": "\ud83d\udc4d", thumbsup: "\ud83d\udc4d", "-1": "\ud83d\udc4e", thumbsdown: "\ud83d\udc4e",
    ok_hand: "\ud83d\udc4c", clap: "\ud83d\udc4f", wave: "\ud83d\udc4b", pray: "\ud83d\ude4f",
    muscle: "\ud83d\udcaa", raised_hands: "\ud83d\ude4c", point_right: "\ud83d\udc49",
    point_left: "\ud83d\udc48", point_up: "\ud83d\udc46", point_down: "\ud83d\udc47",
    v: "\u270c\ufe0f", handshake: "\ud83e\udd1d", eyes: "\ud83d\udc40",
    heart: "\u2764\ufe0f", broken_heart: "\ud83d\udc94", sparkling_heart: "\ud83d\udc96",
    two_hearts: "\ud83d\udc95", star: "\u2b50", star2: "\ud83c\udf1f", sparkles: "\u2728",
    fire: "\ud83d\udd25", boom: "\ud83d\udca5", zap: "\u26a1", sunny: "\u2600\ufe0f",
    cloud: "\u2601\ufe0f", umbrella: "\u2614", snowflake: "\u2744\ufe0f", rainbow: "\ud83c\udf08",
    rocket: "\ud83d\ude80", tada: "\ud83c\udf89", gift: "\ud83c\udf81", trophy: "\ud83c\udfc6",
    bell: "\ud83d\udd14", bulb: "\ud83d\udca1", book: "\ud83d\udcd6", books: "\ud83d\udcda",
    memo: "\ud83d\udcdd", pencil2: "\u270f\ufe0f", bookmark: "\ud83d\udd16", pushpin: "\ud83d\udccc",
    paperclip: "\ud83d\udcce", link: "\ud83d\udd17", lock: "\ud83d\udd12", unlock: "\ud83d\udd13",
    key: "\ud83d\udd11", hammer: "\ud83d\udd28", wrench: "\ud83d\udd27", gear: "\u2699\ufe0f",
    package: "\ud83d\udce6", mag: "\ud83d\udd0d", calendar: "\ud83d\udcc5",
    chart_with_upwards_trend: "\ud83d\udcc8", bar_chart: "\ud83d\udcca", clipboard: "\ud83d\udccb",
    computer: "\ud83d\udcbb", iphone: "\ud83d\udcf1", email: "\ud83d\udce7", phone: "\u260e\ufe0f",
    camera: "\ud83d\udcf7", hourglass: "\u231b", alarm_clock: "\u23f0", moneybag: "\ud83d\udcb0",
    coffee: "\u2615", tea: "\ud83c\udf75", beer: "\ud83c\udf7a", cake: "\ud83c\udf70",
    apple: "\ud83c\udf4e", pizza: "\ud83c\udf55", white_check_mark: "\u2705",
    heavy_check_mark: "\u2714\ufe0f", x: "\u274c", warning: "\u26a0\ufe0f", no_entry: "\u26d4",
    no_entry_sign: "\ud83d\udeab", exclamation: "\u2757", question: "\u2753", bangbang: "\u203c\ufe0f",
    information_source: "\u2139\ufe0f", heavy_plus_sign: "\u2795", heavy_minus_sign: "\u2796",
    arrow_right: "\u27a1\ufe0f", arrow_left: "\u2b05\ufe0f", arrow_up: "\u2b06\ufe0f",
    arrow_down: "\u2b07\ufe0f", recycle: "\u267b\ufe0f", new: "\ud83c\udd95", "100": "\ud83d\udcaf",
    construction: "\ud83d\udea7", rotating_light: "\ud83d\udea8", bug: "\ud83d\udc1b",
    dog: "\ud83d\udc36", cat: "\ud83d\udc31", panda_face: "\ud83d\udc3c", see_no_evil: "\ud83d\ude48",
    speech_balloon: "\ud83d\udcac", thought_balloon: "\ud83d\udcad", zzz: "\ud83d\udca4",
    ghost: "\ud83d\udc7b", robot: "\ud83e\udd16", alien: "\ud83d\udc7d", skull: "\ud83d\udc80",
    hankey: "\ud83d\udca9", poop: "\ud83d\udca9", cn: "\ud83c\udde8\ud83c\uddf3"
};

/* ---------- Markdown → 编辑器 HTML 预处理管线（2026-11-09 三轮升级） ----------
   showdown 之前先抽出「不应按 Markdown 解析」或「showdown 不支持」的结构，换成纯字母数字占位符
   （showdown 不转义字母数字），转换后再还原为编辑器约定的最终 HTML：
   1. 围栏代码块 ``` / ~~~：自研解析（showdown 遇到带参数的 info string 会解析失败），
      支持 ```js theme=monokai；```math 视为公式块
   2. <div style="…" markdown="1">…</div>：内部递归按 Markdown 转换，样式合并回顶层块
   3. 语雀高亮块 :::info / :::success / :::warning / :::danger（亦认 GitHub 类型与中文别名）
   4. 提示块 > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]（亦认 提示/技巧/重要/警告/注意）
   5. 脚注定义 [^x]: …（引用 [^x] 保留标签文本，不重编号，往返无损）；[TOC] 目录行
   6. 公式 $$…$$ / \[…\]（独占行）/ $…$ / \(…\)：转换前抽出，防止 _ * 被当作 Markdown
   7. ==高亮==、:emoji: 短码、转义 \$ \= \:
   第 6、7 步期间行内代码 / HTML 标签 / 链接地址 / 裸 URL 受保护，不会被误改。
   递归（对齐块、提示块内部）共用同一份占位符仓库，最外层统一还原。 */
UE._mdPipeline = (function () {
    var MAX_DEPTH = 6;

    function escHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function newState() {
        // 每次转换随机 nonce：占位符带 nonce，用户文本恰为 LRYPH0PH 之类也不会被误还原
        return { store: [], fnDefs: [], fnSeen: {}, depth: 0,
            nonce: (Math.random().toString(36).slice(2) + "abcdefgh").slice(0, 8) };
    }

    // 存入最终 HTML，返回占位符；块级占位符独占一段（保留原缩进，列表内的块不打断列表）
    function hold(state, html, block, indent) {
        state.store.push({ html: html, block: !!block });
        var token = "LRYPH" + state.nonce + "x" + (state.store.length - 1) + "PH";
        if (!block) {
            return token;
        }
        return "\n\n" + (indent || "") + token + "\n\n";
    }

    /* ---- 1. 围栏代码块 ---- */
    function parseFenceInfo(info) {
        var tokens = String(info || "").replace(/^\{|\}$/g, "").split(/[\s,]+/);
        var lang = "", theme = "";
        for (var i = 0; i < tokens.length; i++) {
            var t = tokens[i];
            if (!t) {
                continue;
            }
            var kv = t.match(/^([a-z-]+)=["']?([^"']*)["']?$/i);
            if (kv) {
                if (kv[1].toLowerCase() === "theme" && /^[a-z0-9_-]{1,32}$/i.test(kv[2])) {
                    theme = kv[2].toLowerCase();
                }
                continue;
            }
            if (!lang) {
                lang = t.replace(/^\./, "");
            }
        }
        return { lang: lang, theme: theme };
    }

    function fenceHtml(info, code) {
        var fi = parseFenceInfo(info);
        if (/^(math|latex-math|katex|tex-math)$/i.test(fi.lang)) {
            return mathBlockHtml(code);
        }
        var brush = UE.mdLangToBrush(fi.lang);
        // 与旧版 showdown 围栏输出保持一致：非空代码补尾随换行；空围栏给 <br/> 占位（编辑器空 pre 约定）
        var content = code ? escHtml(code) + "\n" : "<br/>";
        return '<pre class="brush:' + brush + ";toolbar:false;" + (fi.theme ? "theme:" + fi.theme + ";" : "") + '">' +
            content + "</pre>";
    }

    function extractFences(md, state) {
        var lines = md.split("\n");
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/^([ \t]{0,12})(`{3,}|~{3,})[ \t]*(.*)$/);
            // 反引号围栏的 info 不能再含反引号（CommonMark），否则是行内代码
            if (!m || (m[2].charAt(0) === "`" && m[3].indexOf("`") !== -1)) {
                out.push(lines[i]);
                continue;
            }
            var indent = m[1].replace(/\t/g, "    ");
            var fence = m[2];
            var ch = fence.charAt(0);
            var body = [];
            var j = i + 1;
            for (; j < lines.length; j++) {
                var cm = lines[j].match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
                if (cm && cm[1].charAt(0) === ch && cm[1].length >= fence.length) {
                    break;
                }
                var ln = lines[j];
                if (indent.length) {
                    ln = ln.replace(new RegExp("^ {0," + indent.length + "}"), "");
                }
                body.push(ln);
            }
            // 未闭合围栏按 CommonMark 规则延续到文末
            i = j;
            out.push(hold(state, fenceHtml(m[3].replace(/\s+$/, ""), body.join("\n")), true, indent));
        }
        return out.join("\n");
    }

    /* ---- 2. 对齐/样式块 <div style="…" markdown="1"> ---- */
    function mergeBlockStyle(html, css) {
        var doc = document.implementation.createHTMLDocument("");
        var box = doc.createElement("div");
        box.innerHTML = html;
        for (var c = box.firstChild; c; c = c.nextSibling) {
            if (c.nodeType !== 1 || /^(pre|hr|table)$/i.test(c.tagName)) {
                continue;
            }
            var own = c.getAttribute("style") || "";
            // 元素自身样式优先，外层块样式补齐缺失属性
            c.setAttribute("style", UE.sanitizeCssStyle(css + ";" + own));
        }
        return box.innerHTML;
    }

    function extractMdDivs(md, state, convertInner) {
        return md.replace(/(^|\n)([ \t]*)<div\b([^>]*\bmarkdown\s*=\s*["']?1["']?[^>]*)>([\s\S]*?)<\/div>[ \t]*(?=\n|$)/gi,
            function (all, lead, indent, attrs, inner) {
                if (/<div\b/i.test(inner)) {
                    // 嵌套 div 不在本语法范围内，保持原样交给 showdown（按 HTML 块放行）
                    return all;
                }
                var sm = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
                var css = UE.sanitizeCssStyle(sm ? (sm[1] != null ? sm[1] : sm[2]) : "");
                var html = convertInner(inner);
                if (css) {
                    html = mergeBlockStyle(html, css);
                }
                return lead + hold(state, html, true, indent);
            });
    }

    /* ---- 2.5 语雀高亮块 :::info / :::success / :::warning / :::danger ---- */
    function extractCards(md, state, convertInner) {
        var lines = md.split("\n");
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/^([ \t]{0,3})(:{3,})[ \t]*([A-Za-z\u4e00-\u9fa5]{0,20})[ \t]*$/);
            if (!m) {
                out.push(lines[i]);
                continue;
            }
            var type = m[3] ? (UE.mdCardTypes.alias[m[3]] || UE.mdCardTypes.alias[m[3].toUpperCase()] ||
                UE.mdCardTypes.alias[m[3].toLowerCase()]) : "info";
            if (!type) {
                // 未知类型：整段原样保留（连同闭合行一起，避免闭合 ::: 被误当新卡片开头）
                var kEnd = i + 1;
                for (; kEnd < lines.length; kEnd++) {
                    if (/^[ \t]{0,3}:{3,}[ \t]*$/.test(lines[kEnd])) {
                        break;
                    }
                }
                for (var k = i; k <= kEnd && k < lines.length; k++) {
                    out.push(lines[k]);
                }
                i = kEnd;
                continue;
            }
            var fence = m[2];
            var body = [];
            var j = i + 1;
            for (; j < lines.length; j++) {
                var cm = lines[j].match(/^[ \t]{0,3}(:{3,})[ \t]*$/);
                if (cm && cm[1].length >= fence.length) {
                    break;
                }
                body.push(lines[j]);
            }
            // 未闭合容器延续到文末（j 越界时整段消费完）
            i = j;
            var inner = convertInner(body.join("\n"));
            out.push(hold(state, '<blockquote class="lry-card lry-card-' + type + '">' +
                (inner || "<p><br/></p>") + "</blockquote>", true, m[1]));
        }
        return out.join("\n");
    }

    /* ---- 3. 提示块 ---- */
    function extractAlerts(md, state, convertInner) {
        var lines = md.split("\n");
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/^([ \t]{0,3})>[ \t]?\[!([A-Za-z]+|[\u4e00-\u9fa5]{2})\][ \t]*$/);
            var type = m && UE.mdAlertTypes.alias[m[2].toUpperCase()] || (m && UE.mdAlertTypes.alias[m[2]]);
            if (!type) {
                out.push(lines[i]);
                continue;
            }
            var body = [];
            var j = i + 1;
            for (; j < lines.length && /^[ \t]{0,3}>/.test(lines[j]); j++) {
                body.push(lines[j].replace(/^[ \t]{0,3}>[ \t]?/, ""));
            }
            i = j - 1;
            var inner = convertInner(body.join("\n"));
            out.push(hold(state, '<blockquote class="lry-alert lry-alert-' + type.toLowerCase() + '">' +
                (inner || "<p><br/></p>") + "</blockquote>", true, m[1]));
        }
        return out.join("\n");
    }

    /* ---- 4. 脚注定义 / 目录 ---- */
    var FN_LABEL = "[A-Za-z0-9_\\-\\u00c0-\\uffff]{1,40}";

    function extractFootnoteDefs(md, state) {
        var lines = md.split("\n");
        var out = [];
        var re = new RegExp("^[ ]{0,3}\\[\\^(" + FN_LABEL + ")\\]:[ \\t]?(.*)$");
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(re);
            if (!m) {
                out.push(lines[i]);
                continue;
            }
            var body = [m[2]];
            var j = i + 1;
            // 续行：缩进 ≥2 空格或 Tab 的非空行（中间允许空行，后面仍有缩进行时）
            for (; j < lines.length; j++) {
                if (/^( {2,}|\t)\S/.test(lines[j])) {
                    body.push(lines[j].replace(/^( {2,4}|\t)/, ""));
                } else if (!lines[j].replace(/\s/g, "") && j + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[j + 1])) {
                    body.push("");
                } else {
                    break;
                }
            }
            i = j - 1;
            if (!state.fnSeen.hasOwnProperty(m[1])) {
                state.fnSeen[m[1]] = state.fnDefs.length;
                state.fnDefs.push({ label: m[1], md: body.join("\n") });
            }
        }
        return out.join("\n");
    }

    function extractToc(md, state) {
        return md.replace(/(^|\n)[ \t]{0,3}\[(?:TOC|toc|Toc)\][ \t]*(?=\n|$)/g, function (all, lead) {
            return lead + hold(state, '<p class="lry-toc">[TOC]</p>', true);
        });
    }

    /* ---- 5. 公式 ---- */
    function mathInlineHtml(tex, display) {
        tex = String(tex).replace(/^\s+|\s+$/g, "");
        return '<span class="lry-math">' + (display ? "\\[" : "\\(") + escHtml(tex) + (display ? "\\]" : "\\)") + "</span>";
    }

    function mathBlockHtml(tex) {
        tex = String(tex).replace(/^\s+|\s+$/g, "");
        return '<p class="lry-math lry-math-block">\\[' + escHtml(tex) + "\\]</p>";
    }

    // 行内 $…$ 判定：首尾不能是空白、闭合 $ 后不能紧跟数字；不含中文且要像公式（防 "$5 和 $6" 误判）
    function looksLikeInlineMath(content, next) {
        if (!content || /^\s|\s$/.test(content) || /\d/.test(next || "")) {
            return false;
        }
        if (/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(content) && !/[\\^_{}]/.test(content)) {
            return false;
        }
        return /[\\^_{}]/.test(content) || /[A-Za-z\u0370-\u03ff]/.test(content);
    }

    // 位置 i 处的字符是否被奇数个反斜杠转义
    function isEscaped(text, i) {
        var n = 0;
        for (var k = i - 1; k >= 0 && text.charAt(k) === "\\"; k--) {
            n++;
        }
        return n % 2 === 1;
    }

    function lineStartAt(text, i) {
        var k = i - 1;
        while (k >= 0 && (text.charAt(k) === " " || text.charAt(k) === "\t")) {
            k--;
        }
        return k < 0 || text.charAt(k) === "\n";
    }

    function lineEndAt(text, i) {
        var k = i;
        while (k < text.length && (text.charAt(k) === " " || text.charAt(k) === "\t")) {
            k++;
        }
        return k >= text.length || text.charAt(k) === "\n";
    }

    function extractDisplayMath(text, state) {
        var out = "";
        var i = 0;
        while (i < text.length) {
            var c = text.charAt(i);
            if (c === "$" && text.charAt(i + 1) === "$" && !isEscaped(text, i)) {
                var j = text.indexOf("$$", i + 2);
                while (j !== -1 && isEscaped(text, j)) {
                    j = text.indexOf("$$", j + 1);
                }
                if (j !== -1 && text.substring(i + 2, j).replace(/\s/g, "") &&
                    text.substring(i + 2, j).indexOf("\n\n") === -1) {
                    var tex = text.substring(i + 2, j);
                    if (lineStartAt(text, i) && lineEndAt(text, j + 2)) {
                        out += hold(state, mathBlockHtml(tex), true);
                    } else {
                        out += hold(state, mathInlineHtml(tex, true), false);
                    }
                    i = j + 2;
                    continue;
                }
            }
            // \[ … \] 只认独占行的块级形态（行内 \[ 是 Markdown 的转义方括号）
            if (c === "\\" && text.charAt(i + 1) === "[" && !isEscaped(text, i) && lineStartAt(text, i)) {
                var e = text.indexOf("\\]", i + 2);
                while (e !== -1 && isEscaped(text, e)) {
                    e = text.indexOf("\\]", e + 1);
                }
                if (e !== -1 && lineEndAt(text, e + 2) && text.substring(i + 2, e).replace(/\s/g, "") &&
                    text.substring(i + 2, e).indexOf("\n\n") === -1) {
                    out += hold(state, mathBlockHtml(text.substring(i + 2, e)), true);
                    i = e + 2;
                    continue;
                }
            }
            out += c;
            i++;
        }
        return out;
    }

    function extractInlineMath(text, state) {
        var out = "";
        var i = 0;
        while (i < text.length) {
            var c = text.charAt(i);
            if (c === "\\" && text.charAt(i + 1) === "(" && !isEscaped(text, i)) {
                var e = text.indexOf("\\)", i + 2);
                while (e !== -1 && isEscaped(text, e)) {
                    e = text.indexOf("\\)", e + 1);
                }
                if (e !== -1 && text.substring(i + 2, e).replace(/\s/g, "") &&
                    text.substring(i + 2, e).indexOf("\n\n") === -1) {
                    out += hold(state, mathInlineHtml(text.substring(i + 2, e)), false);
                    i = e + 2;
                    continue;
                }
            }
            if (c === "$" && !isEscaped(text, i)) {
                if (text.charAt(i + 1) === "$") {
                    out += "$$";
                    i += 2;
                    continue;
                }
                var j = i + 1;
                var found = -1;
                while (j < text.length) {
                    var cj = text.charAt(j);
                    if (cj === "\\") {
                        j += 2;
                        continue;
                    }
                    if (cj === "\n" && text.charAt(j + 1) === "\n") {
                        break;
                    }
                    if (cj === "$") {
                        found = j;
                        break;
                    }
                    j++;
                }
                if (found > i + 1 && looksLikeInlineMath(text.substring(i + 1, found), text.charAt(found + 1))) {
                    out += hold(state, mathInlineHtml(text.substring(i + 1, found)), false);
                    i = found + 1;
                    continue;
                }
            }
            out += c;
            i++;
        }
        return out;
    }

    /* ---- 保护区：行内代码 / HTML 标签 / 链接地址 / 裸 URL ---- */
    function protect(text, list, state) {
        var put = function (s) {
            list.push(s);
            return "LRYPT" + state.nonce + "x" + (list.length - 1) + "PT";
        };
        // 行内代码（同长反引号闭合，不跨空行）
        text = text.replace(/(`+)(?!`)((?:(?!\n\n)[\s\S])*?[^`])\1(?!`)/g, function (all) {
            return put(all);
        });
        // 尖括号自动链接与 HTML 标签（属性值里可能含 $ = : 等字符）
        text = text.replace(/<(?:[a-zA-Z][\w:-]*(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?|\/[a-zA-Z][\w:-]*\s*|[a-z][a-z0-9+.-]*:[^\s<>]*)>/g, function (all) {
            return put(all);
        });
        // 链接/图片地址 ](…)
        text = text.replace(/\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\s*\)/g, function (all) {
            return put(all);
        });
        // 裸 URL
        text = text.replace(/\b(?:https?|ftp):\/\/[^\s<>()"']+/gi, function (all) {
            return put(all);
        });
        return text;
    }

    function unprotect(text, list, state) {
        // 保护区可能嵌套占位（如链接地址里还有 URL），反复还原
        var re = new RegExp("LRYPT" + state.nonce + "x(\\d+)PT", "g");
        for (var n = 0; n < 4 && re.test(text); n++) {
            re.lastIndex = 0;
            text = text.replace(re, function (all, idx) {
                return list[+idx] !== undefined ? list[+idx] : all;
            });
        }
        re.lastIndex = 0;
        return text;
    }

    /* ---- 5.5 表格分隔行规整化：showdown 2.x 只认 :--- / ---: / :---:，
       :-: / :-- 等短形态会被当普通段落，统一补足 3 个 - 并留空格 ---- */
    function normalizeTableSep(md) {
        return md.split("\n").map(function (line) {
            if (line.indexOf("|") === -1 || line.indexOf("-") === -1) {
                return line;
            }
            var m = line.match(/^(\s*)(\|?)([ :|-]*\|[ :|-]*)(\|?)(\s*)$/);
            if (!m || !/-/.test(m[3])) {
                return line;
            }
            var cells = m[3].split("|").map(function (c) {
                var bare = c.replace(/\s/g, "");
                if (!/-/.test(bare)) {
                    return c;
                }
                var left = bare.charAt(0) === ":";
                var right = bare.charAt(bare.length - 1) === ":";
                var dashes = bare.replace(/:/g, "");
                while (dashes.length < 3) {
                    dashes += "-";
                }
                return (left ? ": " : " ") + dashes + (right ? " :" : " ");
            });
            return m[1] + m[2] + cells.join("|") + m[4] + m[5];
        }).join("\n");
    }

    /* ---- 6. 行内扩展语法 ---- */
    function inlineSyntax(text, state) {
        // 本方言的转义：\$ \= \: → 实体（showdown 不认这三个转义）
        text = text.replace(/\\([$=:])/g, function (all, ch, offset, s) {
            return isEscaped(s, offset) ? all : "&#" + ch.charCodeAt(0) + ";";
        });
        // ==高亮==
        text = text.replace(/(^|[^=\\])==(?=[^\s=])([^=\n]*[^\s=\\])==(?!=)/g, function (all, lead, inner) {
            return lead + hold(state, "<mark>" + escHtml(inner) + "</mark>", false);
        });
        // :emoji:
        text = text.replace(/(^|[^\\\w:]):([a-z0-9_+-]{1,40}):(?![\w:])/g, function (all, lead, name) {
            return UE.mdEmoji.hasOwnProperty(name) ? lead + UE.mdEmoji[name] : all;
        });
        // 脚注引用 [^label]
        text = text.replace(new RegExp("\\[\\^(" + FN_LABEL + ")\\]", "g"), function (all, label, offset, str) {
            if (offset > 0 && str.charAt(offset - 1) === "\\") {
                return all;
            }
            return hold(state, '<sup class="lry-fn">' + escHtml(label) + "</sup>", false);
        });
        return text;
    }

    /* ---- 管线主体 ---- */
    function preprocess(md, state, convertInner) {
        md = String(md == null ? "" : md).replace(/\r\n?/g, "\n");
        // YAML front matter 原样保留给 showdown（metadata 选项负责剔除），不参与预处理
        var front = "";
        var fm = md.match(/^(?:---|\u00ab\u00ab\u00ab)[ \t]*\n[\s\S]*?\n(?:---|\u00bb\u00bb\u00bb)[ \t]*(?:\n|$)/);
        if (fm && state.depth === 0) {
            front = fm[0];
            md = md.substring(front.length);
        }
        md = extractFences(md, state);
        md = extractMdDivs(md, state, convertInner);
        md = extractCards(md, state, convertInner);
        md = extractAlerts(md, state, convertInner);
        md = extractFootnoteDefs(md, state);
        md = extractToc(md, state);
        var plist = [];
        md = normalizeTableSep(md);
        md = protect(md, plist, state);
        md = extractDisplayMath(md, state);
        md = extractInlineMath(md, state);
        md = inlineSyntax(md, state);
        md = unprotect(md, plist, state);
        return front + md;
    }

    // 占位符还原：块级占位符所在的 <p> 整体替换，其余就地替换；已存 HTML 里可能还有占位符，反复还原
    function restore(html, state) {
        var ph = "LRYPH" + state.nonce + "x";
        var blockRe = new RegExp("<p\\b[^>]*>\\s*" + ph + "(\\d+)PH\\s*</p>", "g");
        var inlineRe = new RegExp(ph + "(\\d+)PH", "g");
        for (var n = 0; n < MAX_DEPTH + 2; n++) {
            var before = html;
            html = html.replace(blockRe, function (all, idx) {
                var v = state.store[+idx];
                return v && v.block ? v.html : all;
            });
            html = html.replace(inlineRe, function (all, idx) {
                var v = state.store[+idx];
                return v === undefined ? all : v.html;
            });
            if (html === before) {
                break;
            }
        }
        return html;
    }

    function footnotesHtml(state, convertInner) {
        if (!state.fnDefs.length) {
            return "";
        }
        var parts = [];
        for (var i = 0; i < state.fnDefs.length; i++) {
            var def = state.fnDefs[i];
            var inner = convertInner(def.md);
            // 单段内容拆掉外层 <p>，与标签同处一段
            var single = inner.match(/^\s*<p>([\s\S]*?)<\/p>\s*$/);
            if (single && single[1].indexOf("<p") === -1) {
                inner = single[1];
            }
            parts.push('<p class="lry-fn-def"><sup class="lry-fn-label">' + escHtml(def.label) + "</sup> " + inner + "</p>");
        }
        return '<div class="lry-footnotes">' + parts.join("") + "</div>";
    }

    // 单层转换：预处理 + showdown（不还原占位符，最外层统一处理）
    function convertLayer(md, state, opts) {
        var converter = new showdown.Converter(opts);
        var inner = function (sub) {
            if (state.depth >= MAX_DEPTH) {
                return "<p>" + escHtml(sub) + "</p>";
            }
            state.depth++;
            try {
                var subOpts = {};
                for (var k in opts) {
                    if (opts.hasOwnProperty(k)) {
                        subOpts[k] = opts[k];
                    }
                }
                subOpts.metadata = false;
                return convertLayer(sub, state, subOpts).html;
            } finally {
                state.depth--;
            }
        };
        var pre = preprocess(md, state, inner);
        return { html: converter.makeHtml(pre), converter: converter, inner: inner };
    }

    return {
        newState: newState,
        convertLayer: convertLayer,
        restore: restore,
        footnotesHtml: footnotesHtml,
        parseFenceInfo: parseFenceInfo,
        looksLikeInlineMath: looksLikeInlineMath,
        escHtml: escHtml
    };
})();

/* Markdown → 编辑器 HTML：依赖 window.showdown（由调用方保证已加载）
   返回 { html, meta }；meta 为 YAML front matter 对象（无则 null） */
UE._markdownConvert = function (markdownText, extraOptions) {
    var out = { html: "", meta: null };
    if (!window.showdown || !window.showdown.Converter) {
        return out;
    }
    var opts = UE.markdownShowdownOptions();
    if (extraOptions) {
        for (var k in extraOptions) {
            if (extraOptions.hasOwnProperty(k)) {
                opts[k] = extraOptions[k];
            }
        }
    }
    try {
        var P = UE._mdPipeline;
        var state = P.newState();
        var layer = P.convertLayer(markdownText || "", state, opts);
        var html = layer.html + P.footnotesHtml(state, layer.inner);
        html = P.restore(html, state);
        html = UE.postprocessMarkdownHtml(html);
        out.html = UE.markdownSanitizeHtml(html);
        try {
            var meta = layer.converter.getMetadata(false);
            if (meta) {
                for (var kk in meta) {
                    if (meta.hasOwnProperty(kk)) {
                        out.meta = meta;
                        break;
                    }
                }
            }
        } catch (e) {
        }
    } catch (e) {
        out.html = "";
    }
    return out;
};

/* 兼容旧签名：只返回 HTML 字符串 */
UE.markdownToHtml = function (markdownText, extraOptions) {
    return UE._markdownConvert(markdownText, extraOptions).html;
};

/* 判断 Markdown 源文若按纯文本发布是否会被误读为格式（退出 Markdown 模式时的提示依据） */
UE.markdownNeedsEscaping = function (md) {
    md = String(md == null ? "" : md);
    if (!md) {
        return false;
    }
    if (/^#{1,6}\s+\S/m.test(md)) { return true; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/m.test(md)) { return true; }
    if (/^\s*(```|~~~)/m.test(md)) { return true; }
    if (/^>\s?\S/m.test(md)) { return true; }
    if (/^\s*[-*+]\s+\S/m.test(md)) { return true; }
    if (/^\s*\d{1,3}[.)]\s+\S/m.test(md)) { return true; }
    if (/!\[[^\]\n]*\]\([^\)\n]+\)/.test(md)) { return true; }
    if (/\[[^\]\n]+\]\([^\)\n]+\)/.test(md)) { return true; }
    if (/(\*\*|__)(?=\S)[\s\S]*?\S\1/.test(md)) { return true; }
    if (/~~[^~\n]+~~/.test(md)) { return true; }
    if (/`[^`\n]+`/.test(md)) { return true; }
    if (/^\s*\|.*\|\s*$/m.test(md)) { return true; }
    if (/==[^=\s][^=\n]*==/.test(md)) { return true; }
    if (/\$\$[\s\S]+?\$\$|\$[^$\s][^$\n]*\$|\\\([\s\S]+?\\\)/.test(md)) { return true; }
    if (/\[\^[^\]\s]+\]|^\s*\[TOC\]\s*$/im.test(md)) { return true; }
    if (/^:::|^[ \t]{0,3}:::/m.test(md)) { return true; }
    return false;
};

/* 编辑器 HTML → Markdown（2026-11-09 三轮升级：保真模式）
   导出 / Markdown 模式双向同步共用的反向转换。
   保真原则：凡是 Markdown 标记能表达的（标题/粗斜/删除/行内代码/链接/图片/简单表格/
   列表/任务列表/引用/分割线/围栏/公式/高亮/提示块/脚注/目录）一律用标记；
   其余富文本信息（span 样式、上下标、下划线、字框、对齐块、浮动图片、视频音频、
   复杂表格）保留为内联 HTML，导入方向会原样还原。
   opts:
     preserveLeadingNbsp: 段首 &nbsp; 缩进转全角空格保留，默认 false（清除）
     keepLineBreaks:      段内 <br> 保留为硬换行（"  ⏎"），默认 true；false 时合并为空格
     richFormat:          保真模式，默认 true；false 时导出纯 Markdown（丢弃样式/媒体/复杂表格） */
UE.htmlToMarkdown = (function () {
    var INLINE_BLOCK = {
        p: 1, div: 1, blockquote: 1, pre: 1, table: 1, hr: 1,
        h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, ul: 1, ol: 1, dl: 1, figure: 1
    };

    /* 块级样式属性（p/h 上的对齐、缩进、行距、段距等）→ <div style markdown="1"> 包裹 */
    var BLOCK_STYLE_KEYS = ["text-align", "text-indent", "line-height", "letter-spacing",
        "margin-top", "margin-bottom", "margin-left", "margin-right", "direction"];

    function escText(text, ctx) {
        text = String(text).replace(/([*_~[\]`\\])/g, "\\$1");
        // 字面 < 与 & 转实体，避免往返时被当作活 HTML（& 须先于 < 转，防止二次编码）
        text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        // 行首 <mark>/<span> 等内联 HTML 开头的情形在调用处处理，这里只处理文本
        if (!ctx || !ctx.preserveNbsp) {
            text = text.replace(/\u00a0/g, " ");
        }
        return text;
    }

    // 单元格文本：| 转义、换行转 <br>（输入已是行内转换结果）
    function escCell(text) {
        return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
    }

    // 行内代码：内容含反引号时加长围栏并留空格衬垫（GFM 规则）
    function codeSpan(text) {
        text = String(text).replace(/\u00a0/g, " ");
        if (/`/.test(text)) {
            var fence = "``";
            while (text.indexOf(fence) !== -1 && fence.length < 10) {
                fence += "`";
            }
            if (/^`/.test(text)) { text = " " + text; }
            if (/`$/.test(text)) { text = text + " "; }
            return fence + text + fence;
        }
        return "`" + text + "`";
    }

    // 含空白/圆括号的 URL 用 <…> 包裹
    function safeUrl(url) {
        url = String(url == null ? "" : url).replace(/^\s+|\s+$/g, "");
        return /[\s()]/.test(url) ? "<" + url.replace(/</g, "%3C").replace(/>/g, "%3E") + ">" : url;
    }

    // 代码围栏长度须长于内容里已出现的反引号串
    function fenceFor(text) {
        var n = 3;
        var re = /`{3,}/g, m;
        while ((m = re.exec(text))) {
            n = Math.max(n, m[0].length + 1);
        }
        return new Array(n + 1).join("`");
    }

    function stripTaskText(text) {
        var m = text.match(/^\s*([\u2610\u2611☐☑])\s*/);
        if (m) {
            return {
                checked: m[1] === "\u2611" || m[1] === "☑",
                rest: text.substring(m[0].length)
            };
        }
        return null;
    }

    // 行内强调：内容首尾空白移到标记外侧（CommonMark 侧贴规则下 "** x **" 不构成强调）
    function wrapInline(inner, delim) {
        var lead = (inner.match(/^[ \t\n]+/) || [""])[0];
        var tail = (inner.match(/[ \t\n]+$/) || [""])[0];
        var core = inner.substring(lead.length, inner.length - tail.length);
        return core ? lead + delim + core + delim + tail : inner;
    }

    /* ---------- 样式解析 ---------- */

    function parseStyle(node) {
        var out = {};
        var css = node.getAttribute && node.getAttribute("style");
        if (!css) {
            return out;
        }
        var parts = css.split(";");
        for (var i = 0; i < parts.length; i++) {
            var idx = parts[i].indexOf(":");
            if (idx <= 0) {
                continue;
            }
            var prop = parts[i].substring(0, idx).replace(/^\s+|\s+$/g, "").toLowerCase();
            var val = parts[i].substring(idx + 1).replace(/^\s+|\s+$/g, "").replace(/\s*!important$/i, "");
            if (val) {
                out[prop] = val;
            }
        }
        return out;
    }

    // 长度比较（em≈16px 换算近似，用于 text-indent 等近阈值判断）
    function pickBlockStyle(node) {
        var st = parseStyle(node);
        var align = (node.getAttribute("align") || "").toLowerCase();
        if (align === "center" || align === "right" || align === "left" || align === "justify") {
            st["text-align"] = st["text-align"] || align;
        }
        var parts = [];
        for (var i = 0; i < BLOCK_STYLE_KEYS.length; i++) {
            var key = BLOCK_STYLE_KEYS[i];
            if (st[key]) {
                parts.push(key + ":" + st[key]);
            }
        }
        return parts.join(";");
    }

    // span 的富文本样式（颜色/字体/字号/字重/字框…）；返回规范化 style 串
    function pickSpanStyle(node) {
        var st = parseStyle(node);
        var keys = ["color", "background-color", "font-family", "font-size", "font-weight",
            "font-style", "letter-spacing", "text-decoration", "border"];
        var parts = [];
        for (var i = 0; i < keys.length; i++) {
            if (st[keys[i]] && st[keys[i]].toLowerCase() !== "normal" &&
                st[keys[i]].toLowerCase() !== "inherit") {
                parts.push(keys[i] + ":" + st[keys[i]]);
            }
        }
        var css = UE.sanitizeCssStyle(parts.join(";"));
        return css;
    }

    function htmlAttr(name, val) {
        return name + '="' + String(val == null ? "" : val).replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;").replace(/</g, "&lt;") + '"';
    }

    /* ---------- 行内转换 ---------- */

    function inlineNodes(node, ctx) {
        var out = "";
        for (var child = node.firstChild; child; child = child.nextSibling) {
            out += inlineNode(child, ctx);
        }
        return out;
    }

    function inlineNode(node, ctx) {
        if (node.nodeType === 3) {
            return escText(node.nodeValue, ctx);
        }
        if (node.nodeType !== 1) {
            return "";
        }
        var tag = node.tagName.toLowerCase();
        var inner = function () {
            return inlineNodes(node, ctx);
        };
        var href, text, src, alt, style, st, cls, rich;
        switch (tag) {
            case "br":
                // 硬换行用哨兵占位（段内行尾空白清理后再还原为 "  \n"，避免被剥掉）
                return ctx && ctx.keepLineBreaks === false ? " " : "\u0001";
            case "strong":
            case "b":
                return wrapInline(inner(), "**");
            case "em":
            case "i":
                return wrapInline(inner(), "*");
            case "u":
                return "<u>" + inner() + "</u>";
            case "del":
            case "s":
            case "strike":
                return wrapInline(inner(), "~~");
            case "code":
                return codeSpan(node.textContent);
            case "sup":
                // 脚注引用 → [^label]
                if (/\blry-fn\b/.test((node.getAttribute("class") || ""))) {
                    return "[^" + (node.textContent || "").replace(/\s/g, "") + "]";
                }
                return ctx.rich ? "<sup>" + inner() + "</sup>" : inner();
            case "sub":
                return ctx.rich ? "<sub>" + inner() + "</sub>" : inner();
            case "kbd":
                return "<kbd>" + inner() + "</kbd>";
            case "mark":
                /* 语雀式高亮导出（2026-11）：
                   - 无底色 → ==高亮== 标记（干净 Markdown，往返还原为 <mark>）
                   - 带底色 → 保留 <mark style="background-color:…"> 内联 HTML（保真往返）
                   - 核心内容首尾含 =、跨行（含 <br> 哨兵）或为空 → 回退无样式 mark HTML 保往返 */
                var mkInner = inner();
                var mkSt = parseStyle(node);
                var mkBg = mkSt["background-color"] || mkSt["background"] || "";
                var mkCss = mkBg ? UE.sanitizeCssStyle("background-color:" + mkBg) : "";
                if (mkCss && ctx.rich) {
                    return "<mark " + htmlAttr("style", mkCss) + ">" + mkInner + "</mark>";
                }
                var mkCore = mkInner.replace(/^[ \t\n]+|[ \t\n]+$/g, "");
                if (mkCore && !/[=\n\u0001]/.test(mkCore)) {
                    return wrapInline(mkInner, "==");
                }
                return "<mark>" + mkInner + "</mark>";
            case "q":
                return '"' + inner() + '"';
            case "a":
                href = node.getAttribute("href") || "";
                text = inner().replace(/\s+/g, " ").replace(/^ | $/g, "");
                if (!text) {
                    return href ? "<" + safeUrl(href) + ">" : "";
                }
                if (href && href !== "#" && !/^\s*javascript:/i.test(href)) {
                    return "[" + text + "](" + safeUrl(href) + ")";
                }
                return text;
            case "img":
                src = node.getAttribute("src") || node.getAttribute("_src") || "";
                alt = node.getAttribute("alt") || "";
                cls = node.getAttribute("class") || "";
                style = node.getAttribute("style") || "";
                if (cls.indexOf("edui-faked-video") !== -1) {
                    // 视频占位图 → 还原为 <video> 存储 HTML（与 getContent 的输出规则一致）
                    if (!ctx.rich) {
                        var vsrc = node.getAttribute("_url") || src;
                        return vsrc ? "[视频](" + safeUrl(vsrc) + ")" : "";
                    }
                    return "<img " + htmlAttr("class", cls) + " " + htmlAttr("_url", node.getAttribute("_url") || "") +
                        " " + htmlAttr("src", src) + " " + htmlAttr("width", node.getAttribute("width") || "") +
                        " " + htmlAttr("height", node.getAttribute("height") || "") +
                        (style ? " " + htmlAttr("style", UE.sanitizeCssStyle(style)) : "") + ">";
                }
                st = parseStyle(node);
                var w = node.getAttribute("width"), h = node.getAttribute("height");
                if ((!w || !h) && st.width) { w = w || st.width; }
                if ((!w || !h) && st.height) { h = h || st.height; }
                var size = (w && h && parseInt(w, 10) > 0 && parseInt(h, 10) > 0)
                    ? " =" + parseInt(w, 10) + "x" + parseInt(h, 10) : "";
                var float_ = st["float"];
                if (ctx.rich && (float_ === "left" || float_ === "right")) {
                    var ist = UE.sanitizeCssStyle(
                        (float_ ? "float:" + float_ + ";" : "") +
                        (w && parseInt(w, 10) > 0 ? "width:" + parseInt(w, 10) + "px;" : ""));
                    return "<img " + htmlAttr("src", src) + (alt ? " " + htmlAttr("alt", alt) : "") +
                        (ist ? " " + htmlAttr("style", ist) : "") + ">";
                }
                return "![" + alt + "](" + safeUrl(src) + size + ")";
            case "span":
                if (/\blry-math\b/.test((node.getAttribute("class") || "")) &&
                    !/lry-math-block/.test(node.getAttribute("class") || "")) {
                    return "$" + mathTextOf(node) + "$";
                }
                // UEditor 内部用 span+line-through 表示删除线，导出还原为 ~~text~~
                st = parseStyle(node);
                var deco = (st["text-decoration"] || "").replace(/\s/g, "");
                if (/line-through/i.test(deco)) {
                    return wrapInline(inner(), "~~");
                }
                if (ctx.rich) {
                    var spanCss = pickSpanStyle(node)
                        .split(";")
                        .filter(function (kv) { return kv && !/^text-decoration:/i.test(kv); })
                        .join(";");
                    if (spanCss) {
                        return "<span " + htmlAttr("style", spanCss) + ">" + inner() + "</span>";
                    }
                }
                return inner();
            case "font":
                if (ctx.rich) {
                    var color = node.getAttribute("color");
                    var face = node.getAttribute("face");
                    var css = UE.sanitizeCssStyle(
                        (color ? "color:" + color + ";" : "") + (face ? "font-family:" + face + ";" : ""));
                    if (css) {
                        return "<span " + htmlAttr("style", css) + ">" + inner() + "</span>";
                    }
                }
                return inner();
            case "label":
            case "cite":
            case "small":
            case "big":
            case "tt":
            case "abbr":
                return inner();
            case "embed":
            case "video":
            case "audio":
            case "iframe":
                var msrc = node.getAttribute("src") || node.getAttribute("_url") || "";
                if (!ctx.rich) {
                    var mname = { embed: "视频", video: "视频", audio: "音频", iframe: "嵌入页" }[tag];
                    return msrc ? "[" + mname + "](" + safeUrl(msrc) + ")" : "";
                }
                var mAttrs = ["src", "width", "height", "align", "poster", "preload", "type", "wmode"];
                var mBools = ["controls", "autoplay", "loop", "allowfullscreen", "allowscriptaccess"];
                var parts = [];
                for (var mi = 0; mi < mAttrs.length; mi++) {
                    var mv = node.getAttribute(mAttrs[mi]);
                    if (mv !== null && mv !== undefined && mv !== "") {
                        parts.push(htmlAttr(mAttrs[mi].toLowerCase(), mv));
                    }
                }
                for (var mb = 0; mb < mBools.length; mb++) {
                    if (node.hasAttribute && node.hasAttribute(mBools[mb])) {
                        parts.push(mBools[mb]);
                    }
                }
                var mstyle = node.getAttribute("style") || "";
                if (mstyle) {
                    var mcss = UE.sanitizeCssStyle(mstyle);
                    if (mcss) {
                        parts.push(htmlAttr("style", mcss));
                    }
                }
                return "<" + tag + " " + parts.join(" ") + "></" + tag + ">";
            default:
                // 未知行内元素按文本展开，避免内容丢失
                return node.textContent || "";
        }
    }

    // HTML 标签包裹的文本在段首时，Markdown 语法字符前的反斜杠转义会被标签遮住，需在标签内部开头补
    function inlineNodesLineSafe(node, ctx, atLineStart) {
        var out = inlineNodes(node, ctx);
        if (atLineStart && /^<(?:u|sup|sub|kbd|mark|span|font)\b/i.test(out)) {
            // 去掉首个标签前的空白后在标签内第一个文本位置转义 Markdown 语法字符
            out = out.replace(/^(<(?:u|sup|sub|kbd|mark|span|font)\b[^>]*>)(\s*)([#>*+-]|```)*/,
                function (all, openTag, ws) {
                    return openTag + ws;
                });
            var m = out.match(/^(<(?:u|sup|sub|kbd|mark|span|font)\b[^>]*>)([\s\S]*)$/);
            if (m && /^[#>]/.test(m[2])) {
                out = m[1] + "\\" + m[2];
            }
        }
        return out;
    }

    /* ---------- 表格 ---------- */

    function tableIsSimple(table) {
        for (var i = 0; i < table.rows.length; i++) {
            for (var j = 0; j < table.rows[i].cells.length; j++) {
                var cell = table.rows[i].cells[j];
                if ((parseInt(cell.getAttribute("colspan") || "1", 10) || 1) > 1 ||
                    (parseInt(cell.getAttribute("rowspan") || "1", 10) || 1) > 1) {
                    return false;
                }
                if (cell.getAttribute("style")) {
                    return false;
                }
            }
        }
        var tstyle = table.getAttribute("style");
        return !tstyle || !/[;:]/.test(tstyle.replace(/\s/g, ""));
    }

    function tableToMd(table, ctx) {
        var rows = [];
        var trs = table.rows;
        for (var i = 0; i < trs.length; i++) {
            var cells = [];
            for (var j = 0; j < trs[i].cells.length; j++) {
                var cellMd = inlineNodes(trs[i].cells[j], { keepLineBreaks: false, rich: ctx.rich })
                    .replace(/\s+/g, " ").replace(/^ | $/g, "");
                cells.push(escCell(cellMd));
            }
            rows.push(cells);
        }
        if (!rows.length) {
            return "";
        }
        var colCount = 0;
        for (var r = 0; r < rows.length; r++) {
            colCount = Math.max(colCount, rows[r].length);
        }
        if (!colCount) {
            return "";
        }
        var firstRowIsTh = trs[0].cells.length > 0 &&
            trs[0].cells[0].tagName.toLowerCase() === "th";
        // 无 th 时首行若为纯短文本（≤12字），提为表头提高可读性；否则补空表头
        var useFirstRowAsHeader = false;
        if (!firstRowIsTh && trs.length >= 2) {
            var tds = trs[0].cells;
            var allShort = tds.length > 0;
            for (var c = 0; c < tds.length; c++) {
                var t = (tds[c].textContent || "").replace(/\s+/g, " ").replace(/^ | $/g, "");
                if (!t || t.length > 12) {
                    allShort = false;
                    break;
                }
            }
            useFirstRowAsHeader = allShort;
        }
        var header = firstRowIsTh || useFirstRowAsHeader ? rows[0] : [];
        while (header.length < colCount) {
            header.push("");
        }
        var lines = [];
        lines.push("| " + header.join(" | ") + " |");
        // 表头对齐方式（th 或被提为表头的那行）
        var aligns = [];
        var headRow = firstRowIsTh || useFirstRowAsHeader ? trs[0] : null;
        for (var a = 0; a < colCount; a++) {
            var al = "";
            if (headRow && headRow.cells[a]) {
                var stc = (headRow.cells[a].getAttribute("align") || "") +
                    (headRow.cells[a].getAttribute("style") || "");
                if (/text-align\s*:\s*center|^center$/i.test(stc)) {
                    al = "center";
                } else if (/text-align\s*:\s*right|^right$/i.test(stc)) {
                    al = "right";
                }
            }
            aligns.push(al);
        }
        var sep = [];
        for (var s = 0; s < colCount; s++) {
            sep.push(aligns[s] === "center" ? ":---:" : aligns[s] === "right" ? "---:" : "---");
        }
        lines.push("| " + sep.join(" | ") + " |");
        var bodyStart = firstRowIsTh || useFirstRowAsHeader ? 1 : 0;
        for (var b = bodyStart; b < rows.length; b++) {
            var row = rows[b].slice();
            while (row.length < colCount) {
                row.push("");
            }
            row.length = colCount;
            lines.push("| " + row.join(" | ") + " |");
        }
        return lines.join("\n") + "\n\n";
    }

    // 富表格：原样保留（只清洗属性与样式，结构递归序列化）
    function tableToHtmlMd(table, ctx) {
        var ROWSET = { tbody: 1, thead: 1, tfoot: 1, tr: 1 };
        var CELL = { td: 1, th: 1 };
        function attrsOf(el, allowed) {
            var parts = [];
            for (var i = 0; i < allowed.length; i++) {
                var name = allowed[i];
                var v = el.getAttribute(name);
                if (v === null || v === undefined || v === "") {
                    continue;
                }
                if (name === "style") {
                    v = UE.sanitizeCssStyle(v);
                    if (!v) {
                        continue;
                    }
                }
                parts.push(htmlAttr(name, v));
            }
            return parts.length ? " " + parts.join(" ") : "";
        }
        function walk(el) {
            var out = "";
            for (var c = el.firstChild; c; c = c.nextSibling) {
                if (c.nodeType === 3) {
                    // 表格以 HTML 块导出，文本节点须实体转义，避免字面 <img> 变成活标签
                    out += c.nodeValue.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                } else if (c.nodeType === 1) {
                    var t = c.tagName.toLowerCase();
                    if (ROWSET[t] || CELL[t]) {
                        out += "<" + t + attrsOf(c, CELL[t]
                            ? ["rowspan", "colspan", "align", "style"]
                            : ["align", "style"]) + ">" + walk(c) + "</" + t + ">";
                    } else {
                        out += inlineNode(c, ctx);
                    }
                }
            }
            return out;
        }
        return "<table" + attrsOf(table, ["border", "width", "align", "cellspacing", "cellpadding", "style"]) +
            ">" + walk(table) + "</table>\n\n";
    }

    function hasBlockChild(node) {
        for (var c = node.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 1 && INLINE_BLOCK[c.tagName.toLowerCase()]) {
                return true;
            }
        }
        return false;
    }

    function listToMd(listEl, indent, ctx) {
        var ordered = listEl.tagName.toLowerCase() === "ol";
        var childIndent = indent + (ordered ? "   " : "  ");
        var out = "";
        var index = parseInt(listEl.getAttribute("start") || "1", 10) || 1;
        for (var li = listEl.firstChild; li; li = li.nextSibling) {
            if (li.nodeType !== 1 || li.tagName.toLowerCase() !== "li") {
                continue;
            }
            var marker = ordered ? (index + ". ") : "- ";
            index++;
            // 任务列表勾选态（input 形态或历史导入的 ☑/☐ 前缀）
            var task = null;
            var checkbox = li.getElementsByTagName("input")[0];
            if (checkbox && /checkbox/i.test(checkbox.getAttribute("type") || "")) {
                task = checkbox.getAttribute("checked") !== null;
                checkbox.parentNode && checkbox.parentNode.removeChild(checkbox);
            }
            var liInline = "";
            var liBlocks = "";
            for (var c = li.firstChild; c; c = c.nextSibling) {
                if (c.nodeType === 3) {
                    liInline += escText(c.nodeValue, ctx);
                } else if (c.nodeType === 1) {
                    var ct = c.tagName.toLowerCase();
                    if (ct === "ul" || ct === "ol") {
                        liBlocks += "\n" + listToMd(c, childIndent, ctx);
                    } else if (ct === "p" || ct === "div") {
                        // UEditor 的 li 内容通常包一层 <p>，展开为行内文本保持 "- 文字" 单行形态；
                        // 内部含块级元素（表格/代码块等）时按缩进块展开
                        if (hasBlockChild(c)) {
                            liBlocks += "\n" + blocksToMd(c, childIndent, ctx);
                        } else {
                            liInline += inlineNodes(c, ctx);
                        }
                    } else if (INLINE_BLOCK[ct]) {
                        liBlocks += "\n" + indentBlock(blockToMd(c, ctx), childIndent);
                    } else {
                        liInline += inlineNode(c, ctx);
                    }
                }
            }
            var content = liInline.replace(/^[\s]+/, "").replace(/[\s]+$/, "");
            var tk = stripTaskText(content);
            if (task !== null) {
                content = tk ? tk.rest : content;
            } else if (tk) {
                task = tk.checked;
                content = tk.rest;
            }
            if (content && marker === "- ") {
                content = escapeLineStart(content);
            }
            var prefix = marker + (task !== null ? (task ? "[x] " : "[ ] ") : "");
            out += indent + prefix + content;
            if (liBlocks) {
                out += "\n" + liBlocks.replace(/^\n/, "");
            }
            out += "\n";
        }
        return out;
    }

    // 行首 Markdown 语法字符转义 + 内联 HTML 开头补零宽空格（供段落与列表项共用）
    function escapeLineStart(text) {
        text = String(text);
        if (/^<(?:u|sup|sub|kbd|mark|span|font)\b/i.test(text)) {
            // 行首是内联 HTML：# / > 在标签内开头处转义，防止整行被识别为标题/引用
            var em = text.match(/^(<(?:u|sup|sub|kbd|mark|span|font)\b[^>]*>)([\s\S]*)$/i);
            if (em && /^[#>]/.test(em[2])) {
                return em[1] + "\\" + em[2];
            }
            return text;
        }
        return text
            .replace(/^(\s{0,3})(#{1,6})(\s)/, "$1\\$2$3")
            .replace(/^(\s{0,3})([-*+])(\s)/, "$1\\$2$3")
            .replace(/^(\s{0,3})(\d{1,3})([.)])(\s)/, "$1$2\\$3$4")
            .replace(/^(\s{0,3})(>)(\s?)/, "$1\\$2$3");
    }

    // 非空行前加缩进（用于列表项内的块级内容）
    function indentBlock(block, indent) {
        if (!indent || !block) {
            return block;
        }
        return block.replace(/^(.+)$/gm, indent + "$1");
    }

    function paraToMd(node, ctx) {
        var pt = inlineNodes(node, ctx).replace(/[ \t]+$/gm, "");
        // 还原硬换行哨兵（此时行尾真实空白已清理，不会误伤）
        pt = pt.replace(/\u0001/g, "  \n");
        if (!pt.replace(/\s/g, "")) {
            return "";
        }
        if (!ctx.preserveNbsp) {
            pt = pt.replace(/^[ \t]+/mg, "");
        } else {
            pt = pt.replace(/^[ \u00a0]+/mg, function (lead) {
                return new Array(lead.length + 1).join("\u00a0");
            });
        }
        return paraTextToMd(pt);
    }

    // 段落文本（已还原硬换行）→ Markdown：行首语法字符转义 + 内联 HTML 开头补零宽空格
    function paraTextToMd(pt) {
        var lines = pt.split("\n");
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (/^<(?:u|sup|sub|kbd|mark|span|font)\b/i.test(l)) {
                var em = l.match(/^(<(?:u|sup|sub|kbd|mark|span|font)\b[^>]*>)([\s\S]*)$/i);
                if (em && /^[#>]/.test(em[2])) {
                    lines[i] = em[1] + "\\" + em[2];
                    continue;
                }
                continue;
            }
            l = l
                .replace(/^[ \t]*(#{1,6})([ \t])/, "\\$1$2")
                .replace(/^[ \t]*(>)([ \t]?)/, "\\$1$2")
                .replace(/^[ \t]*([-*+])([ \t])/, "\\$1$2")
                .replace(/^[ \t]*(\d{1,3})([.)])([ \t])/, "$1\\$2$3")
                .replace(/^[ \t]*(`{3,})/, function (x) {
                    return x.replace(/`/g, "\\`");
                });
            lines[i] = l;
        }
        return lines.join("\n") + "\n\n";
    }

    /* ---------- 块级转换 ---------- */

    function blockToMd(node, ctx) {
        var tag = node.tagName.toLowerCase();
        var cls = (node.getAttribute("class") || "").toLowerCase();
        switch (tag) {
            case "h1":
            case "h2":
            case "h3":
            case "h4":
            case "h5":
            case "h6":
                var level = parseInt(tag.charAt(1), 10);
                var ht = inlineNodes(node, ctx).replace(/^[\s]+|[\s]+$/g, "");
                if (!ht) {
                    return "";
                }
                var headMd = new Array(level + 1).join("#") + " " + ht + "\n\n";
                var hstyle = ctx.rich ? pickBlockStyle(node) : "";
                return hstyle ? '<div ' + htmlAttr("style", hstyle) + ' markdown="1">' +
                    headMd.replace(/\n+$/, "") + "</div>\n\n" : headMd;
            case "p":
                // 目录
                if (/\blry-toc\b/.test(cls)) {
                    return "[TOC]\n\n";
                }
                // 块级公式
                if (/\blry-math-block\b/.test(cls)) {
                    return "$$\n" + mathTextOf(node) + "\n$$\n\n";
                }
                var pstyle = ctx.rich ? pickBlockStyle(node) : "";
                if (pstyle) {
                    var pin = inlineNodes(node, ctx).replace(/[ \t]+$/gm, "").replace(/\u0001/g, "  \n");
                    if (pin.replace(/\s/g, "")) {
                        return '<div ' + htmlAttr("style", pstyle) + ' markdown="1">' +
                            paraTextToMd(pin.replace(/\n+$/, "")).replace(/\n\n$/, "") + "</div>\n\n";
                    }
                    return "";
                }
                return paraToMd(node, ctx);
            case "div":
                // 脚注区
                if (/\blry-footnotes\b/.test(cls)) {
                    return footnoteDivToMd(node, ctx);
                }
                if (hasBlockChild(node)) {
                    return blocksToMd(node, "", ctx);
                }
                return paraToMd(node, ctx);
            case "blockquote":
                // 语雀高亮块：lry-card-xxx → :::xxx 容器（内部内容不加 > 前缀）
                var cardM = cls.match(/\blry-card-([a-z]+)/);
                if (cardM && UE.mdCardTypes.alias[cardM[1]]) {
                    var cardBody = blocksToMd(node, "", ctx).replace(/\n+$/, "");
                    return ":::" + UE.mdCardTypes.alias[cardM[1]] + "\n" + cardBody + "\n:::\n\n";
                }
                // 提示块：class 命中取捕获组，否则取 data-alert 字符串（不能对字符串用 am[1]）
                var am = cls.match(/\blry-alert-([a-z]+)/);
                var atype = (am ? am[1] : (node.getAttribute("data-alert") || "")).toUpperCase();
                if (atype && UE.mdAlertTypes.alias[atype]) {
                    var alertType = UE.mdAlertTypes.alias[atype];
                    var abq = blocksToMd(node, "", ctx).replace(/\s+$/, "");
                    return "> [!" + alertType + "]\n" +
                        abq.split("\n").map(function (l) {
                            return l ? "> " + l : ">";
                        }).join("\n") + "\n\n";
                }
                var bq = blocksToMd(node, "", ctx).replace(/\s+$/, "");
                if (!bq) {
                    return "";
                }
                return bq.split("\n").map(function (l) {
                    return l ? "> " + l : ">";
                }).join("\n") + "\n\n";
            case "pre":
                var info = UE.mdBrushInfo(node.getAttribute("class"));
                var lang = UE.mdBrushToLang(info.brush);
                // pre 内 &nbsp; 是缩进/空格占位（insertcode 序列化约定），还原为普通空格
                var codeText = node.textContent.replace(/\u00a0/g, " ").replace(/\n+$/, "");
                var fence = fenceFor(codeText);
                return fence + lang + (info.theme ? " theme=" + info.theme : "") +
                    "\n" + codeText + "\n" + fence + "\n\n";
            case "table":
                return tableIsSimple(node) ? tableToMd(node, ctx) :
                    (ctx.rich ? tableToHtmlMd(node, ctx) : tableToMd(node, ctx));
            case "ul":
            case "ol":
                // 列表末尾补一个空行，与后续块（标题/段落）分隔：
                // 否则源码栏 blockBounds 会把列表与紧邻标题并成一块，行级命令易误伤列表项
                var listMd = listToMd(node, "", ctx);
                return listMd ? listMd + "\n" : "";
            case "dl":
                var dlOut = "";
                for (var d = node.firstChild; d; d = d.nextSibling) {
                    if (d.nodeType !== 1) {
                        continue;
                    }
                    var dt = d.tagName.toLowerCase();
                    if (dt === "dt") {
                        dlOut += inlineNodes(d, ctx).replace(/^[\s]+|[\s]+$/g, "") + "\n\n";
                    } else if (dt === "dd") {
                        dlOut += indentBlock(blockToMd(d, ctx), "  ");
                    }
                }
                return dlOut;
            case "dt":
            case "dd":
                return inlineNodes(node, ctx).replace(/^[\s]+|[\s]+$/g, "") + "\n\n";
            case "hr":
                return "---\n\n";
            case "figure":
                return blocksToMd(node, "", ctx);
            case "figcaption":
                var fc = inlineNodes(node, ctx).replace(/^[\s]+|[\s]+$/g, "");
                return fc ? "*" + fc + "*\n\n" : "";
            default:
                // 容器级行内元素（裸 img/a/strong 等）须转换节点自身；
                // inlineNodes 只遍历子节点，会把无子节点的 <img> 丢成空串
                var t = inlineNode(node, ctx).replace(/^[\s]+|[\s]+$/g, "");
                return t ? t + "\n\n" : "";
        }
    }

    // 公式节点文本（存储形态 \(…\) / \[…\]，textContent 已自动解码实体）
    function mathTextOf(node) {
        var text = (node.textContent || "").replace(/^\s+|\s+$/g, "");
        // 存储形态 \(tex\) / \[tex\]：剥掉首尾定界符各 2 个字符
        var m = text.match(/^\\[[(]([\s\S]*)\\[\])]$/);
        return m ? m[1] : text;
    }

    function footnoteDivToMd(node, ctx) {
        var out = "";
        for (var c = node.firstChild; c; c = c.nextSibling) {
            if (c.nodeType !== 1 || c.tagName.toLowerCase() !== "p") {
                continue;
            }
            var cc = (c.getAttribute("class") || "").toLowerCase();
            if (!/\blry-fn-def\b/.test(cc)) {
                continue;
            }
            // 剥掉开头的标签 sup，取剩余内容
            var clone = c.cloneNode(true);
            var first = clone.firstChild;
            if (first && first.nodeType === 1 && first.tagName.toLowerCase() === "sup") {
                var label = (first.textContent || "").replace(/\s/g, "");
                clone.removeChild(first);
                var bodyMd = inlineNodes(clone, ctx).replace(/^\s+|\s+$/g, "");
                out += "[^" + label + "]: " + bodyMd + "\n";
            }
        }
        return out ? out + "\n" : "";
    }

    function blocksToMd(container, indent, ctx) {
        var out = "";
        for (var child = container.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 3) {
                var txt = child.nodeValue.replace(/\s+/g, " ");
                if (txt.replace(/^ | $/g, "")) {
                    out += indent + escText(txt.replace(/^ | $/g, ""), ctx) + "\n\n";
                }
            } else if (child.nodeType === 1) {
                out += indentBlock(blockToMd(child, ctx), indent);
            }
        }
        return out;
    }

    return function (html, opts) {
        opts = opts || {};
        var ctx = {
            preserveNbsp: opts.preserveLeadingNbsp === true,
            keepLineBreaks: opts.keepLineBreaks !== false,
            rich: opts.richFormat !== false
        };
        // 惰性文档解析：不可信 HTML 中的 img/svg 不会发起资源加载或触发事件（与 markdownSanitizeHtml 一致）
        var inert = null;
        try {
            inert = document.implementation.createHTMLDocument("");
        } catch (e) {
        }
        var div = (inert && inert.body) ? inert.createElement("div") : document.createElement("div");
        div.innerHTML = String(html == null ? "" : html);
        var md = blocksToMd(div, "", ctx);
        // 压缩 3+ 连续空行为 2 个，收尾整洁
        md = md.replace(/\n{3,}/g, "\n\n").replace(/^[ \t\n]+/, "");
        md = md.replace(/\s+$/, "");
        return md + (md ? "\n" : "");
    };
})();



/* 语雀风格行内高亮命令（lrymark，2026-11）：
   execCommand("lrymark", value)：
     - ""            套默认黄 → <mark>（无 style，Markdown 往返 ==高亮==）
     - "#RRGGBB"     套彩色 → <mark style="background-color:…">（导出保留内联 HTML）
     - "default"/"clear" 清除选中区高亮（跨段部分选中亦正确拆解）
   选区整体处于同色高亮内时再次执行同色 = 取消（语雀式切换）；
   换色执行会先剥掉旧 mark 再套新色，不产生嵌套 mark。 */

/* ---- 导出(md-core 公共面) ---- */
export const postprocessMarkdownHtml = UE.postprocessMarkdownHtml;
export const markdownShowdownOptions = UE.markdownShowdownOptions;
export const sanitizeCssStyle = UE.sanitizeCssStyle;
export const markdownSafeUrl = UE.markdownSafeUrl;
export const markdownSanitizeHtml = UE.markdownSanitizeHtml;
export const mdAlertTypes = UE.mdAlertTypes;
export const mdCardTypes = UE.mdCardTypes;
export const mdHighlightColors = UE.mdHighlightColors;
export const mdEmoji = UE.mdEmoji;
export const mdPipeline = UE._mdPipeline;
export const markdownConvert = UE._markdownConvert;
export const markdownToHtml = UE.markdownToHtml;
export const markdownNeedsEscaping = UE.markdownNeedsEscaping;
export const htmlToMarkdown = UE.htmlToMarkdown;
export const mdLangToBrush = UE.mdLangToBrush;
export const mdBrushToLang = UE.mdBrushToLang;
export const mdBrushInfo = UE.mdBrushInfo;
export const mdNormalizeBareUrl = UE.mdNormalizeBareUrl;
export const loadScriptOnce = UE.loadScriptOnce;
