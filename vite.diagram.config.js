import { defineConfig } from 'vite';
import { resolve } from 'path';

/* 画布布局层的独立构建:dist/lry-diagram-layout.js(IIFE,挂 window.LryDiagramLayout)。
   编辑器主构建直接 import 同一份 layout-core.js;发布端渲染器可按需加载本产物。
   修改 layout-core.js 后需依次运行 build、build:lite、build:diagram。 */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/diagram/layout-core.js'),
      formats: ['iife'],
      name: 'LryDiagramLayout',
      fileName: () => 'lry-diagram-layout.js'
    },
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2018',
    minify: true
  }
});
