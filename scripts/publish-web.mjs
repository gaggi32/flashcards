/**
 * Copies the web build (dist-web/, from `npm run build:web`) into the
 * 404canvas site, which serves it at https://404canvas.ch/flashcards.
 *
 *     npm run build:web && npm run publish:web [path/to/404canvas]
 *
 * The site folder defaults to ../404canvas next to this repo. Its
 * public/flashcards/ is replaced as a whole: that folder holds nothing else.
 * Then commit and push the site (see CLAUDE.md, "Web version").
 */

import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(process.argv[2] ?? resolve(root, '..', '404canvas'));
const from = resolve(root, 'dist-web');
const to = resolve(site, 'public', 'flashcards');

if (!existsSync(resolve(from, 'index.html')) || !existsSync(resolve(from, 'sw.js'))) {
  console.error('No web build in dist-web/. Run npm run build:web first.');
  process.exit(1);
}
if (!existsSync(resolve(site, 'next.config.mjs'))) {
  console.error(`${site} does not look like the 404canvas site (no next.config.mjs).`);
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
console.log(`Flashcards web ${version} copied to ${to}`);
