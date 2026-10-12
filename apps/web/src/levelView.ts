import type { BrickData, Level, LevelEntry, PolygonData, Vec2 } from '@peggle/formats';
import type { ImageStore, Sprite } from './images.ts';

/**
 * Static level preview: background, pegs, bricks and decorative objects at
 * their initial positions. Approximate where noted; the exact geometry used for
 * collision will come from the reverse-engineered game code.
 */

export const BOARD_WIDTH = 800;
export const BOARD_HEIGHT = 600;

/**
 * Level coordinates are relative to the play area, which sits inside the
 * screen frame (ball tube on the left, fever meter on the right). The board
 * sets this offset to (75, 40) when a level starts (see docs/re/physics.md).
 */
export const LEVEL_ORIGIN: Vec2 = { x: 75, y: 40 };

/** Rows of IMAGE_BALLPEG / IMAGE_BRICK sprite sheets; the lit (hit) version is row + 4. */
export const PegRow = { Blue: 0, Orange: 1, Purple: 2, Green: 3 } as const;
export const LIT_ROW_OFFSET = 4;

/** Default brick width when the level doesn't store one. */
const DEFAULT_BRICK_WIDTH = 20;

export interface LevelViewOptions {
  showCollision: boolean;
  showImages: boolean;
}

export interface LoadedLevel {
  name: string;
  level: Level;
  background: Sprite | null;
  entryImages: Map<LevelEntry, Sprite>;
  pegSprite: Sprite | null;
  brickSprite: Sprite | null;
}

/** Level entries name images either by full pak path or by bare name in images/levels. */
export function entryImagePath(image: string): string {
  return image.includes('/') || image.includes('\\') ? image : `images/levels/${image}`;
}

export async function loadEntryImages(images: ImageStore, level: Level): Promise<Map<LevelEntry, Sprite>> {
  const entryImages = new Map<LevelEntry, Sprite>();
  await Promise.all(
    level.entries.map(async (e) => {
      if (!e.generic.image) return;
      const s = await images.load(entryImagePath(e.generic.image));
      if (s) entryImages.set(e, s);
    }),
  );
  return entryImages;
}

export async function loadLevelAssets(images: ImageStore, name: string, level: Level): Promise<LoadedLevel> {
  const entryImages = await loadEntryImages(images, level);
  const [background, pegSprite, brickSprite] = await Promise.all([
    images.load(`levels/${name}`),
    images.resource('IMAGE_BALLPEG', 'Game'),
    images.resource('IMAGE_BRICK', 'Game'),
  ]);
  return { name, level, background, entryImages, pegSprite, brickSprite };
}

export function renderLevel(ctx: CanvasRenderingContext2D, l: LoadedLevel, opts: LevelViewOptions): void {
  ctx.save();
  ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  if (l.background) ctx.drawImage(l.background.canvas, 0, 0);
  ctx.translate(LEVEL_ORIGIN.x, LEVEL_ORIGIN.y);

  const passes: ((e: LevelEntry) => boolean)[] = [
    (e) => e.generic.background,
    (e) => !e.generic.background && !e.generic.foreground && !e.generic.foreground2,
    (e) => !e.generic.background && (e.generic.foreground || e.generic.foreground2),
  ];
  if (opts.showImages) {
    for (const inPass of passes) {
      for (const e of l.level.entries) if (inPass(e)) drawEntry(ctx, l, e);
    }
  }
  if (opts.showCollision) {
    for (const e of l.level.entries) drawCollision(ctx, e);
  }
  ctx.restore();
}

export function entryPos(e: LevelEntry): Vec2 | undefined {
  const d = e.data;
  const own = 'pos' in d ? d.pos : undefined;
  if (own) return own;
  const m = e.generic.movementLink?.movement;
  return m?.objectPos ?? m?.anchor;
}

function drawEntry(ctx: CanvasRenderingContext2D, l: LoadedLevel, e: LevelEntry): void {
  const g = e.generic;
  if (!g.visible) return;
  const d = e.data;
  const pos = entryPos(e);

  // Decorative/attached image, used by bumpers, polygons and custom objects.
  const img = l.entryImages.get(e);
  if (img && pos && d.kind !== 'emitter') {
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (d.kind === 'polygon' && d.rotation) ctx.rotate(-d.rotation * DEG);
    if (g.imageRotation) ctx.rotate(g.imageRotation);
    ctx.drawImage(img.canvas, (g.imageDX ?? 0) - img.width / 2, (g.imageDY ?? 0) - img.height / 2);
    ctx.restore();
  }

  if (!g.peg) return;
  if (d.kind === 'circle' && pos) {
    drawPeg(ctx, l.pegSprite, pos, d.radius, PegRow.Blue);
  } else if (d.kind === 'brick' && pos) {
    drawBrick(ctx, d, pos, 'rgba(83,124,217,0.95)', 'rgba(13,50,167,1)');
  }
}

function drawPeg(ctx: CanvasRenderingContext2D, sprite: Sprite | null, pos: Vec2, radius: number, row: number): void {
  if (!sprite) {
    ctx.fillStyle = '#537cd9';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Sprite cell is drawn for the standard 10px peg and scaled for others.
  const scale = radius / 10;
  const w = sprite.cellWidth * scale;
  const h = sprite.cellHeight * scale;
  ctx.drawImage(sprite.canvas, 0, row * sprite.cellHeight, sprite.cellWidth, sprite.cellHeight, pos.x - w / 2, pos.y - h / 2, w, h);
}

const DEG = Math.PI / 180;

/** Outline of a brick in board coordinates. Angles are stored in degrees. */
export function brickOutline(d: BrickData, pos: Vec2): Vec2[] {
  const width = d.width ?? DEFAULT_BRICK_WIDTH;
  const a = -d.angle * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const toWorld = (x: number, y: number): Vec2 => ({ x: pos.x + x * cos - y * sin, y: pos.y + x * sin + y * cos });

  if (!d.curved) {
    // Straight brick: `length` runs perpendicular to `angle`.
    const hl = d.length / 2;
    const hw = width / 2;
    return [toWorld(-hw, -hl), toWorld(hw, -hl), toWorld(hw, hl), toWorld(-hw, hl)];
  }
  // Curved brick: an annular sector whose centre lies `length` behind pos.
  const sector = (d.sectorAngle ?? 0) * DEG;
  const n = Math.max(2, d.curvePoints ?? 4);
  const inner = d.length - width / 2;
  const outer = d.length + width / 2;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = -sector / 2 + (sector * i) / (n - 1);
    pts.push(toWorld(Math.cos(t) * outer - d.length, Math.sin(t) * outer));
  }
  for (let i = n - 1; i >= 0; i--) {
    const t = -sector / 2 + (sector * i) / (n - 1);
    pts.push(toWorld(Math.cos(t) * inner - d.length, Math.sin(t) * inner));
  }
  return pts;
}

function drawBrick(ctx: CanvasRenderingContext2D, d: BrickData, pos: Vec2, fill: string, stroke: string): void {
  const pts = brickOutline(d, pos);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function polygonWorldPoints(d: PolygonData, pos: Vec2): Vec2[] {
  const s = d.scale ?? 1;
  const a = -(d.rotation ?? 0) * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return d.points.map((p) => ({ x: pos.x + (p.x * cos - p.y * sin) * s, y: pos.y + (p.x * sin + p.y * cos) * s }));
}

function drawCollision(ctx: CanvasRenderingContext2D, e: LevelEntry): void {
  if (!e.generic.collision) return;
  const d = e.data;
  const pos = entryPos(e) ?? { x: 0, y: 0 };
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = e.generic.peg ? '#00ff88' : e.generic.movementLink ? '#ff44ff' : '#ffee00';
  ctx.beginPath();
  switch (d.kind) {
    case 'circle':
      ctx.arc(pos.x, pos.y, d.radius, 0, Math.PI * 2);
      break;
    case 'rod':
      ctx.moveTo(d.a.x, d.a.y);
      ctx.lineTo(d.b.x, d.b.y);
      break;
    case 'polygon': {
      const pts = polygonWorldPoints(d, pos);
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      break;
    }
    case 'brick': {
      const pts = brickOutline(d, pos);
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      break;
    }
    case 'teleport':
      ctx.rect(pos.x - d.width / 2, pos.y - d.height / 2, d.width, d.height);
      break;
    default:
      break;
  }
  ctx.stroke();
  ctx.restore();
}
