import type { Movement } from '@peggle/formats';
import { atan2f, cosf, f, ftol, idiv, imod, sinf } from './f32.ts';

/**
 * Port of Sexy::Mover (position along a movement path as a function of the
 * owner's tick counter). Follows the original instruction by instruction:
 * FUN_0049d310 (phase) and FUN_0049d430 (position).
 */

const TWO_PI = 6.2831854820251465; // float(2π) stored as double
const HALF_PI = 1.5707963705062866; // float(π/2) stored as double
const PI_F = f(Math.PI); // 3.1415927f

export class Mover {
  type: number; // signed: negative = reverse direction
  anchorX: number;
  anchorY: number;
  period: number;
  offset: number;
  radius1: number;
  radius2: number;
  startPhase: number;
  moveRotation: number;
  pause1: number;
  pause2: number;
  phase1: number;
  phase2: number;
  postDelayPhase: number;
  maxAngle: number;
  rotation: number;
  /** Current output position (+0x54/+0x58) and rotation (+0x64). */
  x: number;
  y: number;
  rot: number;
  /** Parent mover this one rides on (+0x48) and the parent position last seen (+0x4c/+0x50). */
  parent: Mover | null = null;
  parentX = 0;
  parentY = 0;

  constructor(m: Movement) {
    this.type = m.reverse ? -m.type : m.type;
    this.anchorX = f(m.anchor.x);
    this.anchorY = f(m.anchor.y);
    this.period = m.timePeriod;
    this.offset = m.offset ?? 0;
    this.radius1 = m.radius1 ?? 0;
    this.radius2 = m.radius2 ?? 0;
    this.startPhase = f(m.startPhase ?? 0);
    this.moveRotation = f(m.moveRotation ?? 0);
    this.pause1 = m.pause1 ?? 0;
    this.pause2 = m.pause2 ?? 0;
    this.phase1 = m.phase1 ?? 0;
    this.phase2 = m.phase2 ?? 0;
    this.postDelayPhase = f(m.postDelayPhase ?? 0);
    this.maxAngle = f(m.maxAngle ?? 0);
    this.rotation = f(m.rotation ?? 0);
    // Without a stored position the sync code copies the anchor.
    this.x = f(m.objectPos?.x ?? m.anchor.x);
    this.y = f(m.objectPos?.y ?? m.anchor.y);
    this.rot = f(m.unk11 ?? 0);
    if (m.subMovementOffset) {
      this.parentX = f(m.subMovementOffset.x);
      this.parentY = f(m.subMovementOffset.y);
    }
  }

  /** FUN_0049d310: normalized phase in [0,1) for a tick, accounting for pauses. */
  phase(tick: number): number {
    const P = this.period;
    let v: number;
    if (this.pause1 < 1) {
      v = ftol(f(f(this.startPhase * P) + (this.offset + tick)));
    } else {
      const total = this.pause2 + P + this.pause1;
      const a = this.offset + tick;
      let u: number;
      if (total <= 0) {
        u = this.pause1; // unreachable with sane data; mirrors EDX on that path
      } else {
        const e1 = idiv(P * this.phase1, 100);
        const e2 = idiv((this.phase2 - this.phase1) * P, 100) + this.pause1 + e1;
        const r = imod(ftol(f(this.postDelayPhase * total)) + a, total);
        if (r <= e1) u = r;
        else if (r <= this.pause1 + e1) u = e1;
        else if (r <= e2) u = r - this.pause1;
        else if (r <= this.pause2 + e2) u = e2 - this.pause1;
        else u = r - this.pause2 - this.pause1;
      }
      v = ftol(f(f(this.startPhase * P) + u));
    }
    return f(imod(v, P) / P);
  }

  /** Applies the parent's displacement since last time (FUN_0049d240). */
  private followParent(): void {
    const p = this.parent;
    if (!p) return;
    const dx = f(p.x - this.parentX);
    const dy = f(p.y - this.parentY);
    this.x = f(dx + this.x);
    this.y = f(dy + this.y);
    this.anchorX = f(this.anchorX + dx);
    this.anchorY = f(dy + this.anchorY);
    this.parentX = p.x;
    this.parentY = p.y;
  }

  /** FUN_0049d430: computes x, y, rot for `tick` (+ `frac` of a tick, 0 in the simulation). */
  compute(tick: number, frac = 0): void {
    this.followParent();
    const type = this.type;
    const P = this.period;
    if (type === 0 || P < 1) {
      this.x = this.anchorX;
      this.y = this.anchorY;
      this.rot = this.rotation;
      return;
    }
    const kind = ftol(f(Math.abs(type)));
    const dir = type >= 0 ? 1 : -1;
    const ph = f(f(frac / P) + this.phase(tick));
    const r1 = f(this.radius1);
    const rY = this.radius2 !== 0 ? f(this.radius2) : r1;
    const ax = this.anchorX;
    const ay = this.anchorY;
    const angle = () => f(f(ph * TWO_PI) * dir);

    switch (kind) {
      case 1: {
        const a = angle();
        this.x = ax;
        this.y = f(ay - f(sinf(a) * rY));
        this.rot = this.rotation;
        break;
      }
      case 2: {
        const a = angle();
        this.x = f(f(cosf(a) * r1) + ax);
        this.y = ay;
        this.rot = this.rotation;
        break;
      }
      case 3: {
        const a = angle();
        this.x = f(f(cosf(a) * r1) + ax);
        this.y = f(ay - f(sinf(a) * rY));
        this.rot = this.rotation;
        break;
      }
      case 4: {
        const a = angle();
        this.x = f(f(cosf(a) * r1) + ax);
        const a2 = f(a + a);
        this.y = f(ay - f(f(sinf(a2) * rY) * 0.5));
        this.rot = this.rotation;
        break;
      }
      case 5: {
        const a = angle();
        const a2 = f(a + a);
        this.x = f(f(sinf(a2) * r1) + ax);
        this.y = f(ay - f(sinf(a) * rY));
        this.rot = this.rotation;
        break;
      }
      case 6:
      case 7: {
        const A = this.maxAngle !== 0 ? this.maxAngle : PI_F;
        const s = sinf(f(f(ph * TWO_PI) - HALF_PI));
        const a = f(f(f(s + 1) * A) * 0.5);
        if (kind === 6) {
          this.x = f(f(cosf(a) * r1) + ax);
          this.y = f(ay - f(sinf(a) * rY));
        } else {
          this.x = f(f(sinf(a) * r1) + ax);
          this.y = f(ay - f(cosf(a) * rY));
        }
        this.rot = this.rotation;
        break;
      }
      case 8: {
        const r = this.maxAngle !== 0 ? f(dir * this.maxAngle) : f(f(ph * TWO_PI) * dir);
        this.rot = f(r + this.rotation);
        this.x = ax;
        this.y = ay;
        break;
      }
      case 9: {
        const A = this.maxAngle !== 0 ? this.maxAngle : PI_F;
        const s = sinf(f(ph * TWO_PI));
        const r = f(f(f(s * A) + this.moveRotation) * dir);
        this.rot = f(r + this.rotation);
        this.x = ax;
        this.y = ay;
        break;
      }
      case 11: {
        this.x = ax;
        const frac2 = f(ph - ftol(ph));
        this.y = f(ay - f(f(frac2 * rY) * dir));
        this.rot = this.rotation;
        break;
      }
      case 12: {
        const frac2 = f(ph - ftol(ph));
        this.x = f(f(f(r1 * frac2) * dir) + ax);
        this.y = ay;
        this.rot = this.rotation;
        break;
      }
      case 13:
      case 14: {
        let a: number;
        if (kind === 13) {
          a = angle();
        } else {
          const A = this.maxAngle !== 0 ? this.maxAngle : PI_F;
          const s = sinf(f(f(this.phase(tick) - this.startPhase) * TWO_PI));
          const X = f(f(f(s * A) + this.moveRotation) * dir);
          const Y = f(dir * f(this.startPhase * TWO_PI));
          a = f(X + Y);
        }
        this.x = f(f(cosf(a) * r1) + ax);
        this.y = f(ay - f(sinf(a) * rY));
        if (this.radius2 !== 0 && r1 !== 0) {
          const a2 = f(a + HALF_PI);
          const t1 = f(sinf(a2) * rY);
          const dy = f(ay - f(ay - t1));
          const dx = f(f(f(cosf(a2) * r1) + ax) - ax);
          this.rot = f(atan2f(dy, dx) + this.rotation);
        } else {
          this.rot = f(this.rotation + a);
        }
        break;
      }
      case 15: {
        const a = angle();
        const a4 = f(4 * a);
        const a3 = f(a * 3);
        const x0 = f(f(f(r1 * 0.800000011920929) * cosf(a4)) + ax);
        this.x = f(f(f(r1 * 0.20000000298023224) * cosf(a3)) + x0);
        const y0 = f(ay - f(f(rY * 0.800000011920929) * sinf(a3)));
        const y1 = f(f(f(rY * -0) * cosf(f(a + a))) + y0);
        this.y = f(y1 - f(f(rY * 0.1772499978542328) * sinf(a4)));
        break;
      }
      default:
        break;
    }

    if (this.moveRotation !== 0) {
      // FUN_0061ee30: rotate (x, y) around the anchor by moveRotation.
      const c = cosf(this.moveRotation);
      const s = sinf(this.moveRotation);
      const dx = f(this.x - ax);
      const dy = f(this.y - ay);
      this.x = f(f(ax + f(dx * c)) + f(dy * s));
      this.y = f(f(ay + f(c * dy)) - f(dx * s));
    }
  }
}
