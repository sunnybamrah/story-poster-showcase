import { defineConfig } from 'vite';
// Use the package's existing decoder worker as a same-origin build asset.
// The import placeholder is the same one its own build fills for the CSP variant.
export const heicWorkerPlugin = () => ({
  name: 'same-origin-heic-worker', enforce: 'pre',
  transform(code, id) {
    if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/heic-to/src/worker.js')) return;
    if (!code.includes('from LIB_HEIF_PATH;')) throw Error('The pinned HEIC worker changed. Review its build before shipping.');
    return code.replace('from LIB_HEIF_PATH;', 'from "./lib/libheif-without-unsafe-eval.js";')
      .replace('const height = image.get_height();', 'const height = image.get_height(); if (!width || !height || width * height > 64000000) throw new Error("Photo dimensions are too large");');
  },
});
export default defineConfig({ plugins: [heicWorkerPlugin()], worker: { plugins: () => [heicWorkerPlugin()] }, root: 'app', publicDir: '../public', build: { outDir: '../app-dist', emptyOutDir: true,
  rolldownOptions: { onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); }, output: { codeSplitting: { groups: [{ name: 'photo-decoder', test: /node_modules\/heic-to\// }, { name: 'ui-kit', test: /node_modules\/(?!heic-to\/)/ }] } } },
} });
