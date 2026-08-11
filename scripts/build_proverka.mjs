import { build } from 'esbuild';
import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const site = join(root, 'site');
const vendor = join(site, 'assets', 'vendor');

await rm(join(vendor, 'pdfjs'), { recursive: true, force: true });
await rm(join(vendor, 'tesseract'), { recursive: true, force: true });
await mkdir(join(site, 'assets', 'js'), { recursive: true });
await mkdir(join(vendor, 'pdfjs'), { recursive: true });
await mkdir(join(vendor, 'tesseract', 'core'), { recursive: true });
await mkdir(join(vendor, 'tesseract', 'lang'), { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'proverka.js')],
  outfile: join(site, 'assets', 'js', 'proverka.bundle.js'),
  bundle: true,
  minify: true,
  sourcemap: false,
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox102', 'safari15.4'],
  external: ['/assets/*'],
  legalComments: 'eof',
});

await copyFile(
  join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.min.mjs'),
  join(vendor, 'pdfjs', 'pdf.min.mjs'),
);
await copyFile(
  join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'),
  join(vendor, 'pdfjs', 'pdf.worker.min.mjs'),
);
await copyFile(
  join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  join(vendor, 'tesseract', 'worker.min.js'),
);

const coreRoot = join(root, 'node_modules', 'tesseract.js-core');
for (const file of await readdir(coreRoot)) {
  if (['tesseract-core-lstm.js', 'tesseract-core-lstm.wasm'].includes(file)) {
    await copyFile(join(coreRoot, file), join(vendor, 'tesseract', 'core', file));
  }
}

for (const language of ['rus', 'eng']) {
  await copyFile(
    join(root, 'node_modules', `@tesseract.js-data/${language}`, '4.0.0_best_int', `${language}.traineddata.gz`),
    join(vendor, 'tesseract', 'lang', `${language}.traineddata.gz`),
  );
}

console.log('Proverka production bundle and local OCR assets built.');
