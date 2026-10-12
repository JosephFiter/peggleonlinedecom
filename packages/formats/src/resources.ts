/**
 * Parser for PopCap's properties/resources.xml manifest (SexyApp
 * ResourceManager format). Kept DOM-free so it runs in Node and in workers.
 */

export type ResourceKind = 'Image' | 'Sound' | 'Font';

export interface ResourceDef {
  kind: ResourceKind;
  /** Full id including the group's idprefix, e.g. IMAGE_BALLPEG. */
  id: string;
  /** Resource group, e.g. "Game". */
  group: string;
  /** Path inside the pak without extension, forward slashes, e.g. images/game/ballpeg. */
  path: string;
  attrs: Record<string, string>;
}

export interface ImageDef extends ResourceDef {
  kind: 'Image';
  rows: number;
  cols: number;
  /** Explicit alpha image path (same directory rules as `path`). */
  alphaImage?: string;
  /** Alpha image laid out as a grid of cells matching rows/cols. */
  alphaGrid?: string;
  /** When set, RGB is replaced by this color and the image's own luminance becomes alpha. */
  alphaColor?: number;
}

export class ResourceManifest {
  readonly resources: ResourceDef[] = [];
  private readonly byId = new Map<string, ResourceDef>();

  static parse(xml: string): ResourceManifest {
    const m = new ResourceManifest();
    const noComments = xml.replace(/<!--[\s\S]*?-->/g, '');
    const tagRe = /<\s*(\/?)\s*([A-Za-z]+)([^>]*?)\/?\s*>/g;
    let group = '';
    let basePath = '';
    let idPrefix = '';
    for (const match of noComments.matchAll(tagRe)) {
      const closing = match[1] === '/';
      const tag = match[2]!;
      const attrs = parseAttrs(match[3] ?? '');
      if (tag === 'Resources') {
        if (closing) {
          group = '';
        } else {
          group = attrs.id ?? '';
          basePath = '';
          idPrefix = '';
        }
      } else if (tag === 'SetDefaults' && !closing) {
        basePath = attrs.path ?? '';
        idPrefix = attrs.idprefix ?? '';
      } else if ((tag === 'Image' || tag === 'Sound' || tag === 'Font') && !closing) {
        const rawPath = attrs.path ?? '';
        const path = rawPath.startsWith('!ref:') ? rawPath : joinPath(basePath, rawPath);
        const base: ResourceDef = { kind: tag, id: idPrefix + (attrs.id ?? ''), group, path, attrs };
        m.add(tag === 'Image' ? toImageDef(base, basePath) : base);
      }
    }
    return m;
  }

  private add(r: ResourceDef): void {
    this.resources.push(r);
    // Later groups may redefine ids (e.g. IMAGE_BALL); keep the first and
    // expose per-group lookup for the rest.
    if (!this.byId.has(r.id)) this.byId.set(r.id, r);
  }

  get(id: string, group?: string): ResourceDef | undefined {
    if (group) return this.resources.find((r) => r.id === id && r.group === group);
    return this.byId.get(id);
  }

  image(id: string, group?: string): ImageDef | undefined {
    const r = this.get(id, group);
    return r?.kind === 'Image' ? (r as ImageDef) : undefined;
  }

  group(name: string): ResourceDef[] {
    return this.resources.filter((r) => r.group === name);
  }
}

function toImageDef(r: ResourceDef, basePath: string): ImageDef {
  const a = r.attrs;
  const def: ImageDef = {
    ...r,
    kind: 'Image',
    rows: a.rows ? Number(a.rows) : 1,
    cols: a.cols ? Number(a.cols) : 1,
  };
  if (a.alphaimage) def.alphaImage = joinPath(basePath, a.alphaimage);
  if (a.alphagrid) def.alphaGrid = joinPath(basePath, a.alphagrid);
  if (a.alphacolor !== undefined) def.alphaColor = parseInt(a.alphacolor, 16) || 0;
  return def;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g)) {
    out[m[1]!.toLowerCase()] = m[2]!;
  }
  return out;
}

function joinPath(base: string, p: string): string {
  const norm = p.replace(/\\/g, '/');
  return base ? `${base.replace(/\/$/, '')}/${norm}` : norm;
}
