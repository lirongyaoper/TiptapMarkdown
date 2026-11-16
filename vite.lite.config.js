import { defineConfig } from 'vite';
import { resolve } from 'path';

/* 简约版(留言/评论场景)单文件 IIFE 产出:dist/lry-editor-lite.js + dist/lry-editor-lite.css
   页面以 <script src> 引入,全局对象 window.LRYEditorLite;
   npm 场景可 import 'lry-editor/lite'(src/lite.js ESM)。
   与主构建(vite.config.js)互不影响;cssFileName 必须显式指定,
   否则 CSS 按包名输出为 lry-editor.css 会覆盖 full 版产物。 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/lite.js'),
      formats: ['iife'],
      name: 'LRYEditorLiteBundle',
      fileName: () => 'lry-editor-lite.js',
      cssFileName: 'lry-editor-lite'
    },
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    target: 'es2018',
    minify: true
  }
});
