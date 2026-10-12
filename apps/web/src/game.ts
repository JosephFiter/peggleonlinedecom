import type { LevelEntry } from '@peggle/formats';
import { Ball, Board, GUN_X, GUN_Y, Hole, type PhysObj, Poly } from '@peggle/sim';
import type { ImageStore, Sprite } from './images.ts';
import { BOARD_HEIGHT, BOARD_WIDTH, LEVEL_ORIGIN, LIT_ROW_OFFSET, PegRow, type LoadedLevel } from './levelView.ts';

/**
 * Playable single-board prototype: aim with the mouse, click to shoot, the
 * simulation runs at the original fixed rate of 100 ticks per second.
 */

export const TICKS_PER_SECOND = 100;
const TICK_MS = 1000 / TICKS_PER_SECOND;

export interface GameAssets {
  ball: Sprite | null;
}

export async function loadGameAssets(images: ImageStore): Promise<GameAssets> {
  return { ball: await images.resource('IMAGE_BALL', 'Game') };
}

export class GameView {
  readonly board: Board;
  private readonly level: LoadedLevel;
  private readonly assets: GameAssets;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly baseImages: Map<LevelEntry, Sprite>;
  private aimAngle = -Math.PI / 2;
  private lit = new Set<PhysObj>();
  private shooting = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  showCollision = false;
  onShotEnd: ((pegsHit: number) => void) | null = null;
  shotTicks = 0;

  constructor(
    canvas: HTMLCanvasElement,
    level: LoadedLevel,
    board: Board,
    assets: GameAssets,
    baseImages: Map<LevelEntry, Sprite>,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.level = level;
    this.board = board;
    this.assets = assets;
    this.baseImages = baseImages;
    canvas.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('click', this.onClick);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('mousemove', this.onMove);
    this.canvas.removeEventListener('click', this.onClick);
  }

  /** Mouse position in level coordinates. */
  private toLevel(ev: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * BOARD_WIDTH;
    const sy = ((ev.clientY - r.top) / r.height) * BOARD_HEIGHT;
    return { x: sx - LEVEL_ORIGIN.x, y: sy - LEVEL_ORIGIN.y };
  }

  private onMove = (ev: MouseEvent): void => {
    const p = this.toLevel(ev);
    // Gun convention: direction (cos a, -sin a); keep it pointing below horizontal.
    let a = Math.atan2(GUN_Y - p.y, p.x - GUN_X);
    if (a > 0) a = a > Math.PI / 2 ? -Math.PI : 0;
    this.aimAngle = a;
    if (!this.shooting) this.board.setGunAngle(a);
  };

  private onClick = (): void => {
    if (this.shooting) return;
    this.shooting = true;
    this.shotTicks = 0;
    this.board.shoot(this.aimAngle);
  };

  private frame = (now: number): void => {
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.tick();
    }
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private tick(): void {
    this.board.step();
    if (this.shooting) this.shotTicks++;
    for (const c of this.board.contacts) if (c.obj.hasPeg) this.lit.add(c.obj);
    if (this.shooting && this.board.balls.length === 0) {
      // End of shot: hit pegs disappear (simplified rules for now).
      const n = this.lit.size;
      for (const o of this.lit) {
        o.collision = false;
        o.visible = false;
      }
      this.lit.clear();
      this.shooting = false;
      this.board.setGunAngle(this.aimAngle);
      this.onShotEnd?.(n);
    }
  }

  // --- rendering -------------------------------------------------------------

  private draw(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    if (this.level.background) ctx.drawImage(this.level.background.canvas, 0, 0);
    ctx.translate(LEVEL_ORIGIN.x, LEVEL_ORIGIN.y);

    const objs = this.board.objects;
    const layer = (o: PhysObj) => {
      const e = o.source as LevelEntry | null;
      if (!e) return 1;
      if (e.generic.background) return 0;
      if (e.generic.foreground || e.generic.foreground2) return 2;
      return 1;
    };
    for (const L of [0, 1, 2]) for (const o of objs) if (layer(o) === L) this.drawObject(o);
    this.drawGun();
    for (const b of this.board.balls) this.drawBall(b);
    if (this.showCollision) this.drawCollision();
    ctx.restore();
  }

  private imageFor(o: PhysObj): Sprite | undefined {
    const e = o.source as LevelEntry | null;
    if (!e) return undefined;
    return this.level.entryImages.get(e) ?? this.baseImages.get(e);
  }

  private drawObject(o: PhysObj): void {
    if (!o.visible) return;
    const ctx = this.ctx;
    const e = o.source as LevelEntry | null;
    const img = this.imageFor(o);
    let x = 0;
    let y = 0;
    let rot = 0;
    if (o instanceof Ball) {
      x = o.x;
      y = o.y;
    } else if (o instanceof Poly) {
      x = o.posX;
      y = o.posY;
      rot = o.rot;
    } else if (o instanceof Hole) {
      x = o.x;
      y = o.y;
    } else {
      return;
    }
    if (img && e) {
      ctx.save();
      ctx.translate(x, y);
      if (rot) ctx.rotate(-rot);
      if (e.generic.imageRotation) ctx.rotate(e.generic.imageRotation);
      ctx.drawImage(img.canvas, (e.generic.imageDX ?? 0) - img.width / 2, (e.generic.imageDY ?? 0) - img.height / 2);
      ctx.restore();
    }
    if (o instanceof Poly && o.hasPeg && e?.data.kind === 'brick') {
      o.refreshLines();
      const lit = this.lit.has(o);
      ctx.beginPath();
      o.lines.forEach((l, i) => (i ? ctx.lineTo(l.ax, l.ay) : ctx.moveTo(l.ax, l.ay)));
      ctx.closePath();
      ctx.fillStyle = lit ? 'rgba(150,215,255,0.95)' : 'rgba(83,124,217,0.95)';
      ctx.fill();
      ctx.strokeStyle = lit ? '#e8f8ff' : '#0d32a7';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (o instanceof Ball && o.hasPeg) {
      const sprite = this.level.pegSprite;
      const row = PegRow.Blue + (this.lit.has(o) ? LIT_ROW_OFFSET : 0);
      if (sprite) {
        const s = o.radius / 10;
        const w = sprite.cellWidth * s;
        const h = sprite.cellHeight * s;
        ctx.drawImage(sprite.canvas, 0, row * sprite.cellHeight, sprite.cellWidth, sprite.cellHeight, x - w / 2, y - h / 2, w, h);
      }
    }
  }

  private drawBall(b: Ball): void {
    const ctx = this.ctx;
    const s = this.assets.ball;
    if (s) ctx.drawImage(s.canvas, b.x - s.width / 2, b.y - s.height / 2);
    else {
      ctx.fillStyle = '#ddd';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGun(): void {
    const ctx = this.ctx;
    const a = this.board.gunAngle;
    ctx.save();
    ctx.strokeStyle = '#ffd36b';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(GUN_X, GUN_Y);
    ctx.lineTo(GUN_X + Math.cos(a) * 70, GUN_Y - Math.sin(a) * 70);
    ctx.stroke();
    if (!this.shooting) {
      const p = this.board.spawnPoint(a);
      this.drawBall(Object.assign(new Ball(false), { x: p.x, y: p.y }));
    }
    ctx.restore();
  }

  private drawCollision(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1;
    for (const o of this.board.objects) {
      if (!o.collision) continue;
      ctx.strokeStyle = o.hasPeg ? '#00ff88' : o.mover ? '#ff44ff' : '#ffee00';
      ctx.beginPath();
      if (o instanceof Ball) {
        ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
      } else if (o instanceof Poly) {
        o.refreshLines();
        for (const l of o.lines) {
          ctx.moveTo(l.ax, l.ay);
          ctx.lineTo(l.bx, l.by);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
