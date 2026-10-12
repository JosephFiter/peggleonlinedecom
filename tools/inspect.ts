/**
 * Dev helper: prints facts about the local install that the web app relies on.
 *   node tools/inspect.ts <Peggle Nights folder>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PakArchive, ResourceManifest } from '@peggle/formats';

const dir = process.argv[2] ?? process.env.PEGGLE_DIR ?? '';
const pak = PakArchive.open(readFileSync(join(dir, 'main.pak')));
const manifest = ResourceManifest.parse(new TextDecoder().decode(pak.read('properties/resources.xml')));
console.log('resources:', manifest.resources.length);
for (const id of ['IMAGE_BALLPEG', 'IMAGE_BRICK', 'IMAGE_BALL', 'IMAGE_PEGSHADOW', 'IMAGE_BBUCKET']) {
  const img = manifest.image(id, 'Game');
  console.log(id, img && { path: img.path, rows: img.rows, cols: img.cols, alphaImage: img.alphaImage, alphaColor: img.alphaColor });
}
const exts = ['png', 'jpg', 'gif', 'jp2', 'tga', 'j2k'];
const missing = manifest.resources.filter(
  (r) => r.kind === 'Image' && !r.path.startsWith('!ref:') && !exts.some((x) => pak.has(`${r.path}.${x}`) || pak.has(`${r.path}_.${x}`)),
);
console.log('images not found in main.pak:', missing.map((r) => r.path));
