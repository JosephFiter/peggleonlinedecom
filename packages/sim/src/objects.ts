import { cosf, divF32, f, normalize, sinf, sqrtf } from './f32.ts';
import type { Mover } from './mover.ts';

/**
 * Physics objects, ported from Sexy::PhysObj and subclasses of the original
 * (see docs/re/physics.md for addresses). Field comments give the original
 * offsets. All arithmetic is float32 per operation, in the original order.
 */

export const ObjType = { Hole: 1, Ball: 2, Circle: 3, Line: 4, Poly: 5 } as const;

const G_DEFAULT = f(0.05);
const TOL = 0.009999999776482582; // float(0.01)

export interface Vec {
  x: number;
  y: number;
}

/** Collision event queued for the game logic (board callback DAT_006cbdd4). */
export interface Contact {
  ball: Ball;
  obj: PhysObj;
}

export abstract class PhysObj {
  abstract readonly type: number;
  // AABB (+0x14..+0x20)
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  collision = true; // +0x24
  visible = true; // +0x25
  canMove = true; // +0x26
  background = false; // +0x27
  ballStopReset = false; // +0x2b
  bouncy = 0; // +0x34
  rolly = 0; // +0x38
  maxBounceVel = 0; // +0x3c
  mover: Mover | null = null; // +0x48
  tick = 0; // +0x4c
  hasPeg = false; // +0xd0 != 0
  id = '';
  logic = '';
  /** Index in the board's object list (stand-in for allocation order). */
  order = 0;
  /** Opaque link back to whatever created the object (level entry, etc.). */
  source: unknown = null;

  abstract setPos(x: number, y: number): void;
  abstract move(dx: number, dy: number): void;
  abstract setVel(vx: number, vy: number): void;

  /** PhysObj::Update (FUN_004a06b0), mover part. */
  updateBase(): void {
    const m = this.mover;
    if (!m) return;
    const ox = m.x;
    const oy = m.y;
    if (this.canMove) {
      this.tick++;
      m.compute(this.tick, 0);
    } else if (m.parent) {
      m.compute(this.tick, 0);
    }
    const nx = m.x;
    const ny = m.y;
    this.setPos(nx, ny);
    this.setVel(f(nx - ox), f(ny - oy));
  }

  update(_world: World): void {
    this.updateBase();
  }
}

/** Minimal view of the world the objects need. */
export interface World {
  gravity: number;
  contacts: Contact[];
}

// ---------------------------------------------------------------------------
// Ball (also used for static circles / round pegs)
// ---------------------------------------------------------------------------

export class Ball extends PhysObj {
  readonly type: number;
  x = 0; // +0xec
  y = 0; // +0xf0
  prevX = 0; // +0xf4
  prevY = 0; // +0xf8
  vx = 0; // +0xfc
  vy = 0; // +0x100
  radius = f(6); // +0x13c
  /** Static circle: no gravity / integration (+0x140). */
  readonly isStatic: boolean;
  collidedThisTick = false; // +0x141
  hitThisTick = false; // +0x142
  passThroughPegs = false; // +0x165
  canHitBalls = true; // +0x16d
  bounceMode = 0; // +0x1a4
  stuckCounter = 0; // +0xe4
  stuckFlag = false; // +0x16e
  private readonly stuckHistory = new Float32Array(12); // +0x10c..
  counter148 = 1000000;
  counter14c = 1000000;
  hold150 = 0;
  counter154 = 0;
  counter158 = 0;
  normalX = 0; // +0x170
  normalY = 0; // +0x174
  impact = 0; // +0x178
  drawX = 0; // +0x134
  drawY = 0; // +0x138
  lost = false;

  constructor(isStatic: boolean) {
    super();
    this.isStatic = isStatic;
    this.type = isStatic ? ObjType.Circle : ObjType.Ball;
    this.setPos(0, 0);
  }

  setPos(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.x0 = f(x - this.radius);
    this.x1 = f(this.radius + x);
    this.y0 = f(y - this.radius);
    this.y1 = f(y + this.radius);
  }

  move(dx: number, dy: number): void {
    this.x = f(dx + this.x);
    this.y = f(dy + this.y);
    this.x0 = f(this.x0 + dx);
    this.x1 = f(this.x1 + dx);
    this.y0 = f(this.y0 + dy);
    this.y1 = f(dy + this.y1);
  }

  setVel(vx: number, vy: number): void {
    this.vx = vx;
    this.vy = vy;
  }

  /** FUN_00492350: place the ball and reset its history positions. */
  place(x: number, y: number): void {
    this.setPos(x, y);
    this.prevX = this.x;
    this.prevY = this.y;
    this.drawX = this.x;
    this.drawY = this.y;
  }

  /** Ball::Update (FUN_00493950). */
  update(world: World): void {
    if (this.isStatic) {
      this.prevX = this.x;
      this.prevY = this.y;
      this.updateBase();
      this.collidedThisTick = true;
      return;
    }
    this.updateBase();
    this.counter148++;
    this.counter14c++;
    if (this.counter154 !== 0 && --this.counter154 === 0) this.counter158 = 0;

    // Stuck detection: every 10 ticks remember the position (up to 6 samples).
    this.stuckCounter++;
    let q = (this.stuckCounter / 10) | 0;
    if (this.stuckCounter % 10 === 0) {
      if (q < 1) q = 1;
      else if (q > 6) q = 6;
      const idx = q - 1;
      this.stuckHistory[idx * 2] = this.x;
      this.stuckHistory[idx * 2 + 1] = this.y;
      let flag = this.stuckFlag;
      this.stuckFlag = false;
      for (let i = 0; i < idx; i++) {
        const dx = f(this.stuckHistory[i * 2]! - this.x);
        const dy = f(this.stuckHistory[i * 2 + 1]! - this.y);
        const d2 = f(f(dx * dx) + f(dy * dy));
        if (4 <= d2) {
          this.stuckCounter = 0;
          break;
        }
        if (0.04000000283122063 <= d2 && !flag) {
          this.stuckCounter -= 5;
          flag = true;
          this.stuckFlag = true;
        }
      }
    }

    this.prevX = this.x;
    this.prevY = this.y;
    if (this.hold150 > 0) {
      this.stuckCounter = 0;
      this.hold150--;
      if (this.hold150 !== 0) {
        this.collidedThisTick = true;
        return;
      }
      // Release from a teleport-style hold (not used by the duel yet).
    }

    this.vy = f(this.vy + world.gravity);

    let vx = this.vx;
    let vy = this.vy;
    if (225 < f(f(vx * vx) + f(vy * vy))) {
      const [nx, ny] = normalize(vx, vy);
      vx = f(nx * 15);
      vy = f(ny * 15);
      this.vx = vx;
      this.vy = vy;
    }
    const r = this.radius;
    this.x0 = f(f(this.x - r) + (vx < 0 ? vx : 0));
    this.x1 = f(f(r + this.x) + (vx > 0 ? vx : 0));
    this.y0 = f(f(this.y - r) + (vy < 0 ? vy : 0));
    this.collidedThisTick = false;
    this.hitThisTick = false;
    this.y1 = f(f(this.y + r) + (vy > 0 ? vy : 0));
    this.drawX = this.x;
    this.drawY = this.y;
  }
}

// ---------------------------------------------------------------------------
// Line segment (Sexy::Line, internal type 4)
// ---------------------------------------------------------------------------

export class Line extends PhysObj {
  readonly type = ObjType.Line;
  ax = 0; // x1 +0xec
  bx = 0; // x2 +0xf0
  ay = 0; // y1 +0xf4
  by = 0; // y2 +0xf8
  dx = 0; // +0xe4
  dy = 0; // +0xe8
  nx = 0; // +0x104
  ny = 0; // +0x108
  c = 0; // +0x10c
  vertical = false; // +0x110
  oneSided = false; // +0x111
  vx = 0; // +0xfc
  vy = 0; // +0x100

  constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
    super();
    this.set(x1, y1, x2, y2);
  }

  /** FUN_0049afe0. */
  set(x1: number, y1: number, x2: number, y2: number): void {
    this.ax = x1;
    this.bx = x2;
    this.ay = y1;
    this.by = y2;
    this.dx = f(x2 - x1);
    this.dy = f(y2 - y1);
    this.x0 = x1;
    this.x1 = x2;
    this.y0 = y1;
    this.y1 = y2;
    if (x2 < x1) {
      this.x0 = x2;
      this.x1 = x1;
    }
    if (this.y1 < this.y0) {
      const t = this.y0;
      this.y0 = this.y1;
      this.y1 = t;
    }
    const ady = Math.abs(f(this.ay - this.by));
    const adx = Math.abs(f(this.ax - this.bx));
    this.vertical = !(ady <= adx);
    const [nx, ny] = normalize(f(this.ay - this.by), f(this.bx - this.ax));
    this.nx = nx;
    this.ny = ny;
    this.c = f(-f(f(this.nx * this.ax) + f(this.ny * this.ay)));
  }

  /** FUN_0049b190: translate keeping direction and normal. */
  setPos(x: number, y: number): void {
    this.ax = x;
    this.ay = y;
    const x2 = f(this.dx + x);
    this.bx = x2;
    const y2 = f(this.dy + y);
    this.by = y2;
    this.c = f(-f(f(this.nx * x) + f(this.ny * y)));
    this.x0 = x;
    this.x1 = x2;
    this.y0 = y;
    this.y1 = y2;
    if (x2 < x) {
      this.x0 = x2;
      this.x1 = x;
    }
    if (this.y1 < this.y0) {
      const t = this.y0;
      this.y0 = this.y1;
      this.y1 = t;
    }
  }

  move(dx: number, dy: number): void {
    this.setPos(f(this.ax + dx), f(this.ay + dy));
  }

  setVel(vx: number, vy: number): void {
    this.vx = vx;
    this.vy = vy;
  }
}

/** Mutable out-parameters shared by the time-of-impact functions. */
export interface Hit {
  t: number; // in: best so far (remaining time); out: time of impact
  cx: number; // contact point
  cy: number;
  nx: number; // surface normal
  ny: number;
  ux: number; // object velocity projected on the normal
  uy: number;
  wx: number; // extra velocity (rotation)
  wy: number;
}

/** FUN_0049b250: u = (n · v_line) n. */
function projectLineVel(line: Line, h: Hit): void {
  const s = f(f(h.nx * line.vx) + f(h.ny * line.vy));
  const ny = h.ny;
  h.ux = f(s * h.nx);
  h.uy = f(s * ny);
}

/** FUN_0049bdf0: intersections of a segment with a circle; writes the first one to out. */
function segmentCircle(line: Line, px: number, py: number, r: number, out: Vec): number {
  const fx = f(line.ax - px);
  const fy = f(line.ay - py);
  const dx = f(line.bx - line.ax);
  const dy = f(line.by - line.ay);
  const A = f(f(dx * dx) + f(dy * dy));
  let B = f(f(fy * dy) + f(fx * dx));
  B = f(B + B);
  const disc = f(f(B * B) - f(f(A * 4) * f(f(f(fx * fx) + f(fy * fy)) - f(r * r))));
  if (disc < 0) return 0;
  const sq = sqrtf(disc);
  let n = 0;
  const t1 = f(f(sq - B) / f(A + A));
  const t2 = f(f(-B - sq) / f(A + A));
  if (0 <= t1 && t1 <= 1) {
    out.x = f(f(f(dx * t1) + fx) + px);
    out.y = f(f(f(dy * t1) + fy) + py);
    n = 1;
  }
  if (t2 < 0 || 1 < t2) return n;
  if (n === 0) {
    out.x = f(f(fx + px) + f(dx * t2));
    out.y = f(f(fy + py) + f(dy * t2));
    return 1;
  }
  return n + 1;
}

const scratch: Vec = { x: 0, y: 0 };

/** FUN_0049b7c0: ball already overlapping the segment at t = 0. */
function lineOverlap(line: Line, px: number, py: number, rb: number, h: Hit): boolean {
  const rr = f(rb - TOL);
  let d = f(f(f(line.ny * py) + f(px * line.nx)) + line.c);
  if (!(Math.abs(d) <= rr)) return false;
  if (!line.vertical) {
    if (f(rb + px) < line.x0) return false;
    if (!(f(px - rb) <= line.x1)) return false;
  } else {
    if (f(rb + py) < line.y0) return false;
    if (!(f(py - rb) <= line.y1)) return false;
  }
  scratch.x = 0;
  scratch.y = 0;
  const n = segmentCircle(line, px, py, rr, scratch);
  if (n === 0) return false;
  if (n !== 1) {
    // Overlapping the face: push out along the normal.
    h.nx = line.nx;
    h.ny = line.ny;
    if (!line.oneSided && d < 0) {
      h.nx = f(h.nx * -1);
      h.ny = f(h.ny * -1);
      d = f(d * -1);
    }
    const k = f(rb - d);
    h.cx = f(px + f(k * h.nx));
    h.cy = f(f(k * h.ny) + py);
    projectLineVel(line, h);
    return true;
  }
  // Touching one end: use the nearer endpoint.
  const ax = f(line.ax - px);
  const ay = f(line.ay - py);
  const bx = f(line.bx - px);
  const by = f(line.by - py);
  const da = f(f(ay * ay) + f(ax * ax));
  const db = f(f(by * by) + f(bx * bx));
  let ex: number;
  let ey: number;
  let ox: number;
  let oy: number;
  if (da < db) {
    ex = line.ax;
    ey = line.ay;
    ox = line.bx;
    oy = line.by;
  } else {
    ex = line.bx;
    ey = line.by;
    ox = line.ax;
    oy = line.ay;
  }
  let lx = f(ex - scratch.x);
  let ly = f(ey - scratch.y);
  if (lx === 0 && ly === 0) {
    const [qx, qy] = normalize(f(ex - ox), f(ey - oy));
    lx = f(qx * 0.009999999776482582);
    ly = f(qy * 0.009999999776482582);
  }
  h.cx = f(px + lx);
  h.cy = f(ly + py);
  const [nx, ny] = normalize(f(px - ex), f(py - ey));
  h.nx = nx;
  h.ny = ny;
  h.cx = f(h.cx + f(h.nx * 0.009999999776482582));
  h.cy = f(h.cy + f(h.ny * 0.009999999776482582));
  projectLineVel(line, h);
  return true;
}

/** FUN_0049b460: sweep against the segment body. */
let firstIteration = true; // DAT_006cbda6
export function resetFirstIteration(): void {
  firstIteration = true;
}

function lineSweep(line: Line, px: number, py: number, vx: number, vy: number, rb: number, h: Hit): boolean {
  let c = line.c;
  let nx = line.nx;
  let ny = line.ny;
  if (!line.oneSided && f(f(nx * f(px - line.ax)) + f(ny * f(py - line.ay))) < 0) {
    nx = f(nx * -1);
    ny = f(ny * -1);
    c = f(c * -1);
  }
  const nv = f(f(ny * vy) + f(vx * nx));
  if (0.20000000298023224 < nv) return false;
  if (nv === 0) {
    if (!firstIteration) return false;
    if (ny !== 0) return false;
    const qx = f(px - f(nx * rb));
    const qy = f(py - f(ny * rb));
    const inRange = !line.vertical ? line.x0 <= qx && qx <= line.x1 : line.y0 <= qy && qy <= line.y1;
    if (inRange) {
      const dist = Math.abs(f(f(f(ny * py) + f(px * nx)) + c));
      if (rb < dist) return false;
      h.t = 0;
      h.cx = px;
      h.cy = py;
      h.ny = ny;
      h.nx = nx;
      h.ux = 0;
      h.uy = 0;
      firstIteration = false;
      return true;
    }
    // Falls through to the general formula (division by zero gives ±Inf/NaN, rejected below).
  }
  const t = f(f(f(f(rb - TOL) - c) - f(f(nx * px) + f(py * ny))) / nv);
  if (t < 0 || !(t < h.t)) return false;
  const x3 = f(f(vx * t) + px);
  const y3 = f(py + f(t * vy));
  const x4 = f(x3 - f(nx * rb));
  const y4 = f(y3 - f(ny * rb));
  if (!line.vertical) {
    if (!(line.x0 <= x4) || !(x4 <= line.x1)) return false;
  } else if (!(line.y0 <= y4) || !(y4 <= line.y1)) {
    return false;
  }
  h.t = t;
  h.cx = f(x3 + f(nx * 0.009999999776482582));
  h.cy = f(y3 + f(ny * 0.009999999776482582));
  h.nx = nx;
  h.ny = ny;
  projectLineVel(line, h);
  return true;
}

/** FUN_0049b2a0: sweep against one endpoint (a circle of radius 0). */
function endpointSweep(
  line: Line,
  px: number,
  py: number,
  vx: number,
  vy: number,
  rb: number,
  ex: number,
  ey: number,
  h: Hit,
): boolean {
  const dx = f(px - ex);
  const dy = f(py - ey);
  const vx2 = f(vx * vx);
  const A = f(vx2 + f(vy * vy));
  let B = f(f(dy * vy) + f(dx * vx));
  B = f(B + B);
  const rr = f(rb - TOL);
  const disc = f(f(B * B) - f(f(A * 4) * f(f(f(dx * dx) + f(dy * dy)) - f(rr * rr))));
  if (!(0 <= disc)) return false;
  const sq = sqrtf(disc);
  const t = f(f(-B - sq) / f(A + A));
  if (!(0 <= t) || !(t < h.t)) return false;
  const len = sqrtf(f(f(vy * vy) + vx2));
  let t2 = f(t - f(0.009999999776482582 / len));
  h.cx = f(px + f(t2 * vx));
  h.cy = f(py + f(t2 * vy));
  if (t2 <= 0) t2 = 0;
  h.t = t2;
  const [nx, ny] = normalize(f(h.cx - ex), f(h.cy - ey));
  h.nx = nx;
  h.ny = ny;
  projectLineVel(line, h);
  return true;
}

/** FUN_0049bc60: full ball-vs-segment time of impact. */
export function lineTOI(line: Line, px: number, py: number, vx: number, vy: number, rb: number, h: Hit, bothEnds: boolean): boolean {
  if (
    !(f(line.x0 - 20) <= f(rb + px)) ||
    !(f(px - rb) <= f(line.x1 + 20)) ||
    !(f(line.y0 - 20) <= f(py + rb)) ||
    !(f(py - rb) <= f(line.y1 + 20))
  ) {
    return false;
  }
  if (lineOverlap(line, px, py, rb, h)) {
    h.t = 0;
    return true;
  }
  let hit = lineSweep(line, px, py, vx, vy, rb, h);
  if (endpointSweep(line, px, py, vx, vy, rb, line.ax, line.ay, h)) hit = true;
  if (bothEnds && endpointSweep(line, px, py, vx, vy, rb, line.bx, line.by, h)) hit = true;
  return hit;
}

/** FUN_004928c0: ball vs static/moving circle. */
export function circleTOI(circle: Ball, px: number, py: number, vx: number, vy: number, rb: number, h: Hit): boolean {
  const R = f(f(circle.radius - TOL) + rb);
  const R2 = f(R * R);
  const cx = circle.x;
  const cy = circle.y;
  const dx = f(px - cx);
  const dy = f(py - cy);
  const d2 = f(f(dx * dx) + f(dy * dy));
  if (d2 < R2) {
    h.cx = px;
    h.cy = py;
    h.t = 0;
    return true;
  }
  const A = f(f(vy * vy) + f(vx * vx));
  let B = f(f(dx * vx) + f(dy * vy));
  B = f(B + B);
  const S12 = f(f(f(px * px) + f(py * py)) + f(f(cy * cy) + f(cx * cx)));
  const P = f(f(cx * px) + f(cy * py));
  const C = f(f(S12 - f(P + P)) - R2);
  const disc = f(f(B * B) - f(f(A * 4) * C));
  if (!(0 <= disc)) return false;
  const sq = sqrtf(disc);
  const A2 = f(A + A);
  let t = f(f(-B - sq) / A2);
  if (!(0 <= t)) t = f(f(sq - B) / A2);
  if (!(0 <= t) || !(t < h.t)) return false;
  h.t = t;
  h.cx = f(px + f(vx * t));
  h.cy = f(py + f(vy * t));
  return true;
}

// ---------------------------------------------------------------------------
// Polygon (Sexy::Poly, internal type 5) — also the base of bricks and the gun
// ---------------------------------------------------------------------------

export class Poly extends PhysObj {
  readonly type = ObjType.Poly;
  posX = 0; // +0x114
  posY = 0; // +0x118
  rot = 0; // +0x11c
  omega = 0; // +0x120
  normalDir = 1; // +0x134
  /** Local points (+0xe8 vector), already scaled in the level file. */
  points: Vec[] = [];
  /** Line start offsets relative to pos (+0xf8 vector). */
  offsets: Vec[] = [];
  lines: Line[] = [];
  closed = false; // +0x12e
  convex = false; // +0x12d
  rotDirty = false; // +0x145
  posDirty = false; // +0x146

  /** FUN_004a15a0: (re)build segments from points, pos and rotation. */
  build(): void {
    const n = this.points.length;
    if (this.lines.length !== n - 1) {
      this.lines = [];
      for (let i = 0; i < n - 1; i++) {
        const l = new Line();
        l.oneSided = this.normalDir !== 0;
        this.lines.push(l);
      }
      this.offsets = this.lines.map(() => ({ x: 0, y: 0 }));
    }
    if (this.rot === 0) {
      for (let i = 0; i < n - 1; i++) {
        const a = this.points[i]!;
        const b = this.points[i + 1]!;
        const l = this.lines[i]!;
        l.set(f(a.x + this.posX), f(a.y + this.posY), f(this.posX + b.x), f(b.y + this.posY));
        this.offsets[i]!.x = f(l.ax - this.posX);
        this.offsets[i]!.y = f(l.ay - this.posY);
      }
      this.computeBounds();
    } else {
      this.buildRotated(this.rot);
    }
    this.classify();
  }

  /** FUN_004a1b30: segments from rotated points. */
  buildRotated(angle: number): void {
    const n = this.points.length;
    if (n < 2) return;
    this.rotDirty = false;
    this.posDirty = false;
    const c = cosf(angle);
    const s = sinf(angle);
    const p0 = this.points[0]!;
    let py = f(f(p0.y * c) - f(s * p0.x));
    let px = f(f(s * p0.y) + f(c * p0.x));
    for (let i = 0; i < n - 1; i++) {
      const b = this.points[i + 1]!;
      const qx = f(f(s * b.y) + f(c * b.x));
      const qy = f(f(b.y * c) - f(s * b.x));
      const l = this.lines[i]!;
      l.set(f(px + this.posX), f(this.posY + py), f(qx + this.posX), f(this.posY + qy));
      this.offsets[i]!.x = f(l.ax - this.posX);
      this.offsets[i]!.y = f(l.ay - this.posY);
      px = qx;
      py = qy;
    }
    this.computeBounds();
  }

  /** FUN_004a1f30: AABB = union of the segments' boxes. */
  computeBounds(): void {
    this.x0 = 1e12;
    this.y0 = 1e12;
    this.x1 = -1e12;
    this.y1 = -1e12;
    this.x0 = f(this.x0);
    this.y0 = f(this.y0);
    this.x1 = f(this.x1);
    this.y1 = f(this.y1);
    for (const l of this.lines) {
      if (l.x0 < this.x0) this.x0 = l.x0;
      if (this.x1 < l.x1) this.x1 = l.x1;
      if (l.y0 < this.y0) this.y0 = l.y0;
      if (this.y1 < l.y1) this.y1 = l.y1;
    }
  }

  /** FUN_004a1920: closed (first == last point) and convex flags. */
  classify(): void {
    const pts = this.points;
    if (pts.length <= 2) return;
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    this.closed = first.x === last.x && first.y === last.y;
    if (!this.closed) {
      this.convex = false;
      return;
    }
    this.convex = true;
    let sign = 0;
    let px = first.x;
    let py = first.y;
    const prev = pts[pts.length - 2]!;
    let ex = f(px - prev.x);
    let ey = f(py - prev.y);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!;
      const qy = p.y;
      const dx = f(p.x - px);
      const dy = f(qy - py);
      const cross = f(f(dy * ex) - f(dx * ey));
      if ((sign < 0 && 0 < cross) || (0 < sign && cross < 0)) {
        this.convex = false;
        return;
      }
      if (sign === 0 && cross !== 0) sign = cross;
      px = p.x;
      ex = dx;
      ey = dy;
      py = qy;
    }
  }

  /** FUN_004a1dc0: new rotation; bounds now, segments lazily. */
  setRotation(angle: number): void {
    let x0 = f(1e12);
    let y0 = f(1e12);
    let x1 = f(-1e12);
    let y1 = f(-1e12);
    const c = cosf(angle);
    const s = sinf(angle);
    for (const p of this.points) {
      const x = f(f(f(s * p.y) + f(c * p.x)) + this.posX);
      const y = f(f(f(p.y * c) - f(s * p.x)) + this.posY);
      if (x < x0) x0 = x;
      if (x1 < x) x1 = x;
      if (y < y0) y0 = y;
      if (!(y <= y1)) y1 = y;
    }
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.rotDirty = true;
  }

  /** FUN_004a2f30: bring segments up to date before testing. */
  refreshLines(): void {
    if (this.rotDirty) {
      this.buildRotated(this.rot);
      return;
    }
    if (this.posDirty) this.translateLines(this.posX, this.posY);
  }

  /** FUN_004a24a0. */
  private translateLines(x: number, y: number): void {
    this.posDirty = false;
    this.posX = x;
    this.posY = y;
    for (let i = 0; i < this.lines.length; i++) {
      const o = this.offsets[i]!;
      this.lines[i]!.setPos(f(this.posX + o.x), f(o.y + this.posY));
    }
  }

  /** FUN_004a25e0. */
  setPos(x: number, y: number): void {
    this.posDirty = true;
    const dx = f(x - this.posX);
    const dy = f(y - this.posY);
    this.posX = x;
    this.posY = y;
    this.x0 = f(dx + this.x0);
    this.x1 = f(dx + this.x1);
    this.y0 = f(dy + this.y0);
    this.y1 = f(dy + this.y1);
  }

  move(dx: number, dy: number): void {
    this.setPos(f(this.posX + dx), f(this.posY + dy));
  }

  setVel(vx: number, vy: number): void {
    for (const l of this.lines) l.setVel(vx, vy);
  }

  /** Poly::Update (FUN_004a35d0), physics-relevant part. */
  update(_world: World): void {
    this.updateBase();
    const m = this.mover;
    if (!m) return;
    const r = m.rot;
    if (this.rot === r) {
      this.omega = 0;
      return;
    }
    let w = f(r - this.rot);
    this.omega = w;
    while (3.1415927410125732 < w) {
      this.omega = f(this.omega - 6.2831854820251465);
      w = this.omega;
    }
    w = this.omega;
    while (w < -3.1415927410125732) {
      this.omega = f(this.omega + 6.2831854820251465);
      w = this.omega;
    }
    this.rot = r;
    this.setRotation(r);
  }
}

/** FUN_004a20b0: ball vs polygon. */
export function polyTOI(poly: Poly, px: number, py: number, vx: number, vy: number, rb: number, h: Hit): boolean {
  if (
    !(f(poly.x0 - 20) <= f(rb + px)) ||
    !(f(px - rb) <= f(poly.x1 + 20)) ||
    !(f(poly.y0 - 20) <= f(py + rb)) ||
    !(f(py - rb) <= f(poly.y1 + 20))
  ) {
    return false;
  }
  poly.refreshLines();
  const convex = poly.convex;
  const insideCheck = poly.normalDir === 1 && poly.closed;
  let best: Line | null = null;
  let bestD = f(1e7);
  let hit: Line | null = null;
  let crossings = 0;
  for (const line of poly.lines) {
    if (lineTOI(line, px, py, vx, vy, rb, h, false)) hit = line;
    if (!insideCheck) continue;
    const d = f(-f(f(line.nx * f(px - line.ax)) + f(line.ny * f(py - line.ay))));
    if (!convex) {
      const y1 = line.ay;
      const y2 = line.by;
      if (
        y1 !== y2 &&
        ((y1 <= py && py < y2) || (y2 <= py && py < y1)) &&
        px < f(f(f(f(py - y1) * f(line.bx - line.ax)) / f(y2 - y1)) + line.ax)
      ) {
        crossings = (crossings + 1) & 0xff;
      }
      if (!(0 < d)) continue;
    }
    if (d < bestD) {
      best = line;
      bestD = d;
    }
  }
  if (convex && 0 < bestD) crossings = 1;
  if ((crossings & 1) !== 0 && best && h.t !== 0) {
    h.t = 0;
    const k = f(bestD + rb);
    h.cx = f(f(k * best.nx) + px);
    h.cy = f(py + f(k * best.ny));
    h.nx = best.nx;
    h.ny = best.ny;
    projectLineVel(best, h);
    hit = best;
  }
  if (!hit) return false;
  if (poly.omega !== 0) {
    const cx = h.cx;
    h.wx = f(f(f(h.cy - poly.posY) * poly.omega) + h.wx);
    h.wy = f(h.wy - f(poly.omega * f(cx - poly.posX)));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** FUN_00492f90: response against a surface (segment / polygon). */
export function surfaceResponse(world: World, ball: Ball, obj: PhysObj, h: Hit, vxIn: number, vyIn: number): void {
  ball.normalX = h.nx;
  ball.normalY = h.ny;
  if (ball.passThroughPegs && obj.hasPeg) {
    world.contacts.push({ ball, obj });
    return;
  }
  ball.setPos(h.cx, h.cy);
  let vx = vxIn;
  let vy = vyIn;
  const rx = f(f(vx - h.ux) - h.wx);
  const ry = f(f(vy - h.uy) - h.wy);
  let impact = f(-f(f(h.nx * rx) + f(h.ny * ry)));
  if (impact < 0) {
    // Separating: the original returns before reporting the contact.
    ball.impact = 0;
    return;
  }
  ball.impact = impact;
  let b = obj.bouncy;
  let r = obj.rolly;
  if (b === 0) b = f(0.82);
  if (r === 0) r = f(1.4);
  if (ball.bounceMode === 1) b = f(f(b + 1) * 0.5);
  else if (ball.bounceMode === 2) b = f(f(b + 3) * 0.25);
  if (0.9900000095367432 < Math.abs(h.nx)) impact = f(impact * 5);
  ball.counter148 = 0;
  if (impact <= r) {
    // Roll: drop the normal component.
    ball.counter14c = 0;
    const d = f(f(vx * h.nx) + f(vy * h.ny));
    const wn = f(f(h.ny * h.wy) + f(h.nx * h.wx));
    let wx = 0;
    let wy = 0;
    if (!(wn <= 0)) {
      wx = f(wn * h.nx);
      wy = f(wn * h.ny);
    }
    h.wx = wx;
    h.wy = wy;
    ball.vx = f(f(h.ux + f(vx - f(d * h.nx))) + wx);
    ball.vy = f(f(h.uy + f(vy - f(d * h.ny))) + wy);
  } else {
    const dn = f(f(vy * h.ny) + f(vx * h.nx));
    if (dn < 0) {
      const ny = h.ny;
      vx = f(b * f(vx - f(f(dn * h.nx) * 2)));
      vy = f(f(vy - f(f(dn * ny) * 2)) * b);
    }
    const ex = f(f(b + 1) * f(h.ux + h.wx));
    const ey = f(f(b + 1) * f(h.uy + h.wy));
    if (0 < f(f(ex * h.nx) + f(ey * h.ny))) ball.move(ex, ey);
    vx = f(ex + vx);
    vy = f(ey + vy);
    ball.vx = vx;
    ball.vy = vy;
    const m = obj.maxBounceVel;
    if (0 < m && f(m * m) < f(f(ball.vx * ball.vx) + f(vy * vy))) {
      const [nx, ny] = normalize(ball.vx, ball.vy);
      ball.vx = f(m * nx);
      ball.vy = f(m * ny);
    }
  }
  if (obj.ballStopReset) ball.stuckCounter = 0;
  world.contacts.push({ ball, obj });
}

/** FUN_00492cd0: response against a circle (round peg or another ball). */
export function circleResponse(world: World, ball: Ball, c: Ball): void {
  const dx = f(ball.x - c.x);
  const dy = f(ball.y - c.y);
  const d2 = f(f(dx * dx) + f(dy * dy));
  const rb = ball.radius;
  const rc = c.radius;
  const [nx, ny] = normalize(f(c.x - ball.x), f(c.y - ball.y));
  const vx = ball.vx;
  const vy = ball.vy;
  ball.normalX = f(-nx);
  ball.normalY = f(-ny);
  let b = c.bouncy;
  let r = c.rolly;
  if (b === 0) b = f(0.9);
  if (r === 0) r = 1;
  if (ball.bounceMode === 1) b = f(f(b + 1) * 0.5);
  else if (ball.bounceMode === 2) b = f(f(b + 3) * 0.25);
  const dot = f(f(ny * f(vy - c.vy)) + f(nx * f(vx - c.vx)));
  let k = f(dot * b);
  if (r < Math.abs(k)) k = f(k + k);
  else ball.counter14c = 0;
  ball.counter148 = 0;
  ball.impact = Math.abs(k);
  if (!ball.passThroughPegs || !c.hasPeg) {
    const q = divF32(k, 999999995905.0);
    const k2 = f(-q * 999999995904.0);
    ball.vx = f(f(k2 * nx) + vx);
    ball.vy = f(f(k2 * ny) + vy);
    const pen = f(f(rc + rb) - sqrtf(d2));
    ball.move(-f(pen * nx), -f(pen * ny));
    if (c.ballStopReset) ball.stuckCounter = 0;
  }
  world.contacts.push({ ball, obj: c });
}

export { G_DEFAULT };
