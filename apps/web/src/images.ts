import type { ImageDef, PakArchive, ResourceManifest } from '@peggle/formats';
import { decodeJ2K } from './j2k.ts';

/**
 * Loads images out of the user's pak files following the SexyApp
 * ResourceManager conventions the original game uses:
 *
 *  - paths have no extension; the first existing of png/jpg/gif/jp2 is used
 *  - alpha comes from a sibling `name_.ext` (or `_name.ext`), read from its
 *    red channel, overriding any alpha the main image has
 *  - if only the alpha file exists, the image is white with that alpha
 *  - `alphaimage` / `alphagrid` name the alpha file explicitly
 *  - `alphacolor` replaces RGB with a fixed color
 */

const EXTENSIONS = ['png', 'jpg', 'gif', 'jp2', 'j2k'] as const;

export interface Sprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  rows: number;
  cols: number;
  cellWidth: number;
  cellHeight: number;
}

export class ImageStore {
  private readonly paks: PakArchive[];
  private readonly manifest: ResourceManifest;
  private readonly cache = new Map<string, Promise<Sprite | null>>();

  /** Paks are searched in order; put level packs before main.pak so they can override. */
  constructor(paks: PakArchive[], manifest: ResourceManifest) {
    this.paks = paks;
    this.manifest = manifest;
  }

  /** Load a manifest resource such as IMAGE_BALLPEG. */
  resource(id: string, group?: string): Promise<Sprite | null> {
    const def = this.manifest.image(id, group);
    if (!def) return Promise.resolve(null);
    return this.load(def.path, def);
  }

  /** Load by pak path without extension, e.g. `levels/Bjorn1` or `images/levels/flame4`. */
  load(path: string, def?: Pick<ImageDef, 'rows' | 'cols' | 'alphaImage' | 'alphaGrid' | 'alphaColor'>): Promise<Sprite | null> {
    const key = `${path.toLowerCase()}|${def?.rows ?? 1}x${def?.cols ?? 1}|${def?.alphaImage ?? ''}|${def?.alphaColor ?? ''}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.decode(path, def).catch((err) => {
        console.warn(`failed to load image ${path}:`, err);
        return null;
      });
      this.cache.set(key, p);
    }
    return p;
  }

  private find(pathNoExt: string): { bytes: Uint8Array; ext: string } | null {
    // A path may already carry an extension (level files reference some that way).
    const explicit = /\.([a-z0-9]{3})$/i.exec(pathNoExt);
    const candidates = explicit ? [pathNoExt] : EXTENSIONS.map((x) => `${pathNoExt}.${x}`);
    for (const c of candidates) {
      for (const pak of this.paks) {
        if (pak.has(c)) return { bytes: pak.read(c), ext: c.slice(c.lastIndexOf('.') + 1).toLowerCase() };
      }
    }
    return null;
  }

  private findAlpha(path: string, def?: Pick<ImageDef, 'alphaImage' | 'alphaGrid'>): { bytes: Uint8Array; ext: string } | null {
    const explicit = def?.alphaImage ?? def?.alphaGrid;
    if (explicit) return this.find(explicit);
    const base = path.replace(/\.[a-z0-9]{3}$/i, '');
    const slash = base.lastIndexOf('/');
    const dir = base.slice(0, slash + 1);
    const name = base.slice(slash + 1);
    return this.find(`${dir}_${name}`) ?? this.find(`${base}_`);
  }

  private async decode(
    path: string,
    def?: Pick<ImageDef, 'rows' | 'cols' | 'alphaImage' | 'alphaGrid' | 'alphaColor'>,
  ): Promise<Sprite | null> {
    const main = this.find(path);
    const alphaFile = this.findAlpha(path, def);
    if (!main && !alphaFile) return null;

    const mainData = main ? await decodeBytes(main.bytes, main.ext) : null;
    const alphaData = alphaFile ? await decodeBytes(alphaFile.bytes, alphaFile.ext) : null;
    const width = mainData?.width ?? alphaData!.width;
    const height = mainData?.height ?? alphaData!.height;
    const out = mainData ?? new ImageData(width, height);
    const px = out.data;

    if (!mainData) {
      const rgb = def?.alphaColor ?? 0xffffff;
      fillRgb(px, rgb);
    } else if (def?.alphaColor !== undefined && !alphaData) {
      // Image's own luminance becomes alpha, color is replaced.
      for (let i = 0; i < px.length; i += 4) px[i + 3] = px[i]!;
      fillRgb(px, def.alphaColor);
    }

    if (alphaData) {
      if (def?.alphaColor !== undefined) fillRgb(px, def.alphaColor);
      applyAlpha(out, alphaData, def?.alphaGrid ? (def.rows ?? 1) : 1, def?.alphaGrid ? (def.cols ?? 1) : 1);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(out, 0, 0);
    const rows = def?.rows ?? 1;
    const cols = def?.cols ?? 1;
    return { canvas, width, height, rows, cols, cellWidth: width / cols, cellHeight: height / rows };
  }
}

function fillRgb(px: Uint8ClampedArray, rgb: number): void {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
}

/** Copies the alpha image's red channel into `dst` alpha; grid mode maps cell by cell. */
function applyAlpha(dst: ImageData, alpha: ImageData, rows: number, cols: number): void {
  const d = dst.data;
  const a = alpha.data;
  const cellW = dst.width / cols;
  const cellH = dst.height / rows;
  const aCellW = alpha.width / cols;
  const aCellH = alpha.height / rows;
  for (let y = 0; y < dst.height; y++) {
    const cy = Math.floor(y / cellH);
    const ay = Math.min(alpha.height - 1, Math.floor(cy * aCellH + ((y - cy * cellH) * aCellH) / cellH));
    for (let x = 0; x < dst.width; x++) {
      const cx = Math.floor(x / cellW);
      const ax = Math.min(alpha.width - 1, Math.floor(cx * aCellW + ((x - cx * cellW) * aCellW) / cellW));
      d[(y * dst.width + x) * 4 + 3] = a[(ay * alpha.width + ax) * 4]!;
    }
  }
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' };

async function decodeBytes(bytes: Uint8Array, ext: string): Promise<ImageData> {
  if (ext === 'jp2' || ext === 'j2k') return decodeJ2K(bytes);
  const type = MIME[ext];
  if (!type) throw new Error(`unsupported image type .${ext}`);
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}
