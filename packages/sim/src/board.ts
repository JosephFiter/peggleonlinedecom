import type { Level, LevelEntry, Movement, MovementLink } from '@peggle/formats';
import { brickPoints } from './brick.ts';
import { cosf, f, sinf } from './f32.ts';
import { Mover } from './mover.ts';
import {
  Ball,
  type Contact,
  type Hit,
  Line,
  ObjType,
  PhysObj,
  Poly,
  circleResponse,
  circleTOI,
  lineTOI,
  polyTOI,
  resetFirstIteration,
  surfaceResponse,
  type World,
} from './objects.ts';

/**
 * The board's physics world: object list, cannon and per-tick update, ported
 * from Board::UpdatePhysics (FUN_0040de20) and the collision pass
 * (FUN_004547c0 / FUN_00493390).
 */

export const BOARD_WIDTH = 650; // +0x780
export const BOARD_HEIGHT = 560; // +0x784
export const GUN_X = 325; // 400 - 75
export const GUN_Y = 30; // 70 - 40
export const LAUNCH_SPEED = 4;

/** A "Hole" (teleport/bucket): detection is done by game logic, not collisions. */
export class Hole extends PhysObj {
  readonly type = ObjType.Hole;
  x = 0; // +0xf4
  y = 0; // +0xf8
  width = 0; // +0x104
  height = 0; // +0x108
  setPos(x: number, y: number): void {
    this.move(f(x - this.x), f(y - this.y));
  }
  move(dx: number, dy: number): void {
    this.x = f(dx + this.x);
    this.y = f(dy + this.y);
    this.x0 = f(this.x0 + dx);
    this.x1 = f(this.x1 + dx);
    this.y0 = f(this.y0 + dy);
    this.y1 = f(dy + this.y1);
  }
  setVel(): void {}
  /** FUN_0049a4c0 (rectangle part): is the point inside? */
  contains(px: number, py: number): boolean {
    const hw = f(this.width * 0.5);
    const hh = f(this.height * 0.5);
    return f(this.x - hw) <= px && px <= f(hw + this.x) && f(this.y - hh) <= py && py <= f(hh + this.y);
  }
}

export interface BoardOptions {
  /** Claude's power: the lobster-claw flippers from _base are only active with it. */
  flippers?: boolean;
}

export class Board implements World {
  gravity = f(0.05);
  objects: PhysObj[] = [];
  balls: Ball[] = [];
  gun: Poly;
  gunAngle = f(-Math.PI / 2);
  contacts: Contact[] = [];
  /** Board tick counter. */
  tick = 0;
  /** Balls that left the board this tick. */
  lostBalls: Ball[] = [];

  private readonly movers = new Map<Movement, Mover>();

  constructor(level: Level, base: Level | null, opts: BoardOptions = {}) {
    for (const e of level.entries) this.addEntry(e, opts);
    if (base) for (const e of base.entries) this.addEntry(e, opts);
    this.resolveMoverParents(level);
    if (base) this.resolveMoverParents(base);
    this.gun = this.makeGun();
    this.objects.push(this.gun);
    this.objects.forEach((o, i) => (o.order = i));
    // Power-dependent objects start disabled (the game toggles them per power).
    if (!opts.flippers) {
      for (const o of this.objects) {
        if (o.id === 'flipper') {
          o.collision = false;
          o.visible = false;
        }
      }
    }
  }

  // --- construction --------------------------------------------------------

  private moverFor(link: MovementLink | undefined): Mover | null {
    const m = link?.movement;
    if (!m) return null;
    let mv = this.movers.get(m);
    if (!mv) {
      mv = new Mover(m);
      this.movers.set(m, mv);
    }
    return mv;
  }

  /** Wires up shared parent movers (a movement's sub-movement link). */
  private resolveMoverParents(level: Level): void {
    const visit = (link: MovementLink | undefined) => {
      const m = link?.movement;
      if (!m) return;
      const mv = this.moverFor(link);
      const sub = m.subMovement;
      if (mv && sub) {
        const target = sub.target ?? sub.movement;
        if (target) {
          let parent = this.movers.get(target);
          if (!parent) {
            parent = new Mover(target);
            this.movers.set(target, parent);
          }
          mv.parent = parent;
        }
        if (sub.movement) visit(sub);
      }
    };
    for (const e of level.entries) visit(e.generic.movementLink);
  }

  private applyGeneric(obj: PhysObj, e: LevelEntry): void {
    const g = e.generic;
    obj.collision = g.collision;
    obj.visible = g.visible;
    obj.canMove = g.canMove;
    obj.background = g.background;
    obj.ballStopReset = g.ballStopReset;
    obj.bouncy = f(g.bouncy ?? 0);
    obj.rolly = f(g.rolly ?? 0);
    obj.maxBounceVel = f(g.maxBounceVelocity ?? 0);
    obj.tick = g.tickOffset ?? 0;
    obj.hasPeg = !!g.peg;
    obj.id = g.id ?? '';
    obj.logic = g.logic ?? '';
    obj.mover = this.moverFor(g.movementLink);
    obj.source = e;
  }

  private addEntry(e: LevelEntry, opts: BoardOptions): void {
    const d = e.data;
    switch (d.kind) {
      case 'circle': {
        const b = new Ball((d.flagsA & 1) !== 0);
        this.applyGeneric(b, e);
        b.radius = f(d.radius);
        const pos = b.mover ? { x: b.mover.x, y: b.mover.y } : (d.pos ?? { x: 0, y: 0 });
        b.place(f(pos.x), f(pos.y));
        this.objects.push(b);
        break;
      }
      case 'polygon': {
        const p = new Poly();
        this.applyGeneric(p, e);
        p.points = d.points.map((q) => ({ x: f(q.x), y: f(q.y) }));
        p.normalDir = d.normalDir ?? 1;
        p.omega = f(d.unkA3 ?? 0);
        if (p.mover) {
          p.posX = p.mover.x;
          p.posY = p.mover.y;
          p.rot = p.mover.rot;
        } else {
          p.posX = f(d.pos?.x ?? 0);
          p.posY = f(d.pos?.y ?? 0);
          p.rot = f(d.rotation ?? 0);
        }
        p.build();
        this.objects.push(p);
        break;
      }
      case 'rod': {
        const l = new Line(f(d.a.x), f(d.a.y), f(d.b.x), f(d.b.y));
        this.applyGeneric(l, e);
        this.objects.push(l);
        break;
      }
      case 'brick': {
        const p = new Poly();
        this.applyGeneric(p, e);
        p.points = brickPoints(d);
        // Brick reuses the polygon fields: rotation (+0x11c), omega, normalDir.
        p.normalDir = d.unkA1 ?? 1;
        p.omega = f(d.unkA3 ?? 0);
        if (p.mover) {
          p.posX = p.mover.x;
          p.posY = p.mover.y;
          p.rot = p.mover.rot;
        } else {
          p.posX = f(d.pos?.x ?? 0);
          p.posY = f(d.pos?.y ?? 0);
          p.rot = f(d.unkA2 ?? 0);
        }
        p.build();
        this.objects.push(p);
        break;
      }
      case 'teleport': {
        const h = new Hole();
        this.applyGeneric(h, e);
        h.width = d.width;
        h.height = d.height;
        const pos = h.mover ? { x: h.mover.x, y: h.mover.y } : (d.pos ?? { x: 0, y: 0 });
        h.x = f(pos.x);
        h.y = f(pos.y);
        h.x0 = f(h.x - d.width / 2);
        h.x1 = f(h.x + d.width / 2);
        h.y0 = f(h.y - d.height / 2);
        h.y1 = f(h.y + d.height / 2);
        this.objects.push(h);
        break;
      }
      default:
        break;
    }
  }

  /** The cannon's collision triangle (Gun, FUN_00497cc0). */
  private makeGun(): Poly {
    const g = new Poly();
    g.id = 'gun';
    g.normalDir = 1;
    g.points = [
      { x: f(30 + 60), y: 0 },
      { x: 60, y: -10 },
      { x: 60, y: 10 },
      { x: f(30 + 60), y: 0 },
    ];
    g.posX = GUN_X;
    g.posY = GUN_Y;
    g.rot = 0;
    g.build();
    g.closed = true;
    g.convex = true;
    this.layoutGun(g, this.gunAngle);
    return g;
  }

  private layoutGun(g: Poly, angle: number): void {
    const c = cosf(angle);
    const s = sinf(angle);
    const rot = (x: number, y: number) => {
      const dx = f(x - GUN_X);
      const dy = f(y - GUN_Y);
      return {
        x: f(f(GUN_X + f(dx * c)) + f(dy * s)),
        y: f(f(GUN_Y + f(c * dy)) - f(dx * s)),
      };
    };
    const p0 = rot(f(f(30 + GUN_X) + 60), GUN_Y);
    const p1 = rot(f(GUN_X + 60), f(GUN_Y - 10));
    const p2 = rot(f(GUN_X + 60), f(10 + GUN_Y));
    const pts = [p0, p1, p2];
    g.lines.forEach((l, i) => {
      const a = pts[i]!;
      const b = pts[(i + 1) % 3]!;
      l.set(a.x, a.y, b.x, b.y);
      l.oneSided = true;
      g.offsets[i]!.x = f(l.ax - GUN_X);
      g.offsets[i]!.y = f(l.ay - GUN_Y);
    });
    g.computeBounds();
  }

  /** Where a ball of radius r sits in the cannon at `angle`. */
  spawnPoint(angle: number, r = f(6)): { x: number; y: number } {
    const c = cosf(angle);
    const s = sinf(angle);
    const x = f(f(f(26 + r) + GUN_X) + 60);
    const y = f(GUN_Y + 1);
    const dx = f(x - GUN_X);
    const dy = f(y - GUN_Y);
    return {
      x: f(f(GUN_X + f(dx * c)) + f(dy * s)),
      y: f(f(GUN_Y + f(c * dy)) - f(dx * s)),
    };
  }

  setGunAngle(angle: number): void {
    this.gunAngle = f(angle);
    this.layoutGun(this.gun, this.gunAngle);
  }

  /** Gun::Shoot (FUN_00498e70): launch a ball at the current gun angle. */
  shoot(angle = this.gunAngle): Ball {
    this.setGunAngle(angle);
    const ball = new Ball(false);
    const p = this.spawnPoint(this.gunAngle, ball.radius);
    ball.place(p.x, p.y);
    const vy = f(-LAUNCH_SPEED * sinf(this.gunAngle));
    const vx = f(cosf(this.gunAngle) * LAUNCH_SPEED);
    ball.setVel(vx, vy);
    ball.order = this.objects.length;
    this.objects.push(ball);
    this.balls.push(ball);
    return ball;
  }

  // --- simulation -----------------------------------------------------------

  /** One fixed physics tick (FUN_0040de20). */
  step(): void {
    this.tick++;
    this.contacts = [];
    this.lostBalls = [];
    for (const o of this.objects) o.update(this);
    this.collisionPass();
    for (const ball of this.balls) {
      if (!ball.collidedThisTick) ball.move(ball.vx, ball.vy);
      const r = ball.radius;
      if (
        BOARD_HEIGHT + 10 < f(ball.y - r) ||
        BOARD_WIDTH + 10 < f(ball.x - r) ||
        f(r + ball.x) < -10 ||
        f(r + ball.y) < -10
      ) {
        ball.lost = true;
        this.lostBalls.push(ball);
      }
    }
    if (this.lostBalls.length) {
      this.balls = this.balls.filter((b) => !b.lost);
      this.objects = this.objects.filter((o) => !(o instanceof Ball) || !o.lost);
    }
  }

  /** FUN_004547c0: for each ball, gather overlapping objects and move it. */
  private collisionPass(): void {
    for (const ball of this.balls) {
      const cands: PhysObj[] = [];
      for (const o of this.objects) {
        if (o === ball || !o.collision) continue;
        if (o.type !== ObjType.Circle && o.type !== ObjType.Line && o.type !== ObjType.Poly) continue;
        if (ball.x0 <= o.x1 && o.x0 <= ball.x1 && ball.y0 <= o.y1 && o.y0 <= ball.y1) cands.push(o);
      }
      if (cands.length) this.moveBall(ball, cands);
    }
  }

  /** FUN_00493390: continuous collision for one ball over one tick. */
  private moveBall(ball: Ball, cands: PhysObj[]): boolean {
    if (ball.isStatic || !ball.collision) return false;
    let hitAny = false;
    let rem = f(1);
    const h: Hit = { t: rem, cx: 0, cy: 0, nx: 0, ny: 0, ux: 0, uy: 0, wx: 0, wy: 0 };
    ball.collidedThisTick = true;
    resetFirstIteration();
    for (let iter = 0; iter < 20; iter++) {
      const px = ball.x;
      const py = ball.y;
      const vx = ball.vx;
      const vy = ball.vy;
      h.cx = h.cy = h.nx = h.ny = h.ux = h.uy = h.wx = h.wy = 0;
      let hitObj: PhysObj | null = null;
      for (const o of cands) {
        if (o.type === ObjType.Line) {
          if (lineTOI(o as Line, px, py, vx, vy, ball.radius, h, true)) {
            hitObj = o;
            h.wx = 0;
            h.wy = 0;
          }
        } else if (o.type === ObjType.Poly) {
          if (polyTOI(o as Poly, px, py, vx, vy, ball.radius, h)) hitObj = o;
        } else if (o.type === ObjType.Circle) {
          if (circleTOI(o as Ball, px, py, vx, vy, ball.radius, h)) hitObj = o;
        }
      }
      if (!hitObj) {
        ball.x = f(ball.x + f(ball.vx * rem));
        ball.y = f(f(rem * ball.vy) + ball.y);
        return hitAny;
      }
      if (!ball.passThroughPegs || !hitObj.hasPeg) {
        ball.hitThisTick = true;
        hitAny = true;
        if (hitObj.type === ObjType.Circle) {
          ball.setPos(h.cx, h.cy);
          circleResponse(this, ball, hitObj as Ball);
        } else {
          surfaceResponse(this, ball, hitObj, h, vx, vy);
        }
        ball.drawX = ball.x;
        ball.drawY = ball.y;
        rem = f(rem - h.t);
        h.t = rem;
      } else {
        this.contacts.push({ ball, obj: hitObj });
        cands.splice(cands.indexOf(hitObj), 1);
      }
    }
    return hitAny;
  }
}
