import { defineConfig } from 'vite';
import { resolve } from 'path';

/* 单文件 IIFE 产出:dist/lry-editor.js + dist/lry-editor.css
   页面以 <script src> 引入,全局对象 window.LRYEditor;
   npm 场景可 import 'lry-editor'(src/index.js ESM)。 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      formats: ['iife'],
      name: 'LRYEditorBundle',
      fileName: () => 'lry-editor.js'
    },
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    target: 'es2018',
    minify: true
  }
});
