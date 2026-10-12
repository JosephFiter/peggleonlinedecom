import type { BrickData } from '@peggle/formats';
import { cosf, f, idiv, sinf } from './f32.ts';
import type { Vec } from './objects.ts';

/**
 * Brick outline in local coordinates, ported from Brick::BuildGeometry
 * (FUN_00495810). The result is a closed point list for a Poly.
 *
 * Fields (original offsets): length +0x148, sector +0x14c, left/right angle
 * +0x150/+0x154, width +0x158, angle +0x15c, offset +0x160/+0x164, curve
 * segments +0x168, type +0x16c. Type 5 is a straight brick; types 1/2 have a
 * straight outer edge, 3/4 a straight inner edge, anything else is curved.
 */

const PI_F = 3.1415927410125732; // float(π) stored as double

function rad(deg: number): number {
  return f(f(deg * PI_F) / 180);
}

export function brickPoints(d: BrickData): Vec[] {
  const type = d.brickType ?? 0;
  let length = f(d.length);
  if (type === 5 && 600 < length) length = 600;
  const width = f(d.width ?? 20);
  // The file stores the interior segment count directly (default 2); the
  // parser exposes it as count + 2 like the community editor does.
  const stored = d.curvePoints !== undefined ? d.curvePoints - 2 : 2;
  const n = stored < 1 ? 0 : stored;
  const curvedOuter = !(type === 1 || type === 2 || type === 5);
  const curvedInner = !(type === 3 || type === 4 || type === 5);

  const A = f(d.angle);
  const S = f(d.sectorAngle ?? 0);
  const aMid = rad(A);
  const aStart = rad(f(A - S * 0.5));
  const aEnd = rad(f(A + S * 0.5));
  const L = length;
  const LW = f(width + length);

  const pts: Vec[] = [];
  const P = (a: number, r: number): Vec => ({ x: f(cosf(a) * r), y: f(sinf(a) * -r) });
  const interp = (k: number, from: number, to: number): number => {
    const t = f((k + 1) / (n + 1));
    return f(f(f(1 - t) * from) + f(to * t));
  };
  const snap = (p58: Vec, p50: Vec): void => {
    if (!(0.009999999776482582 <= Math.abs(f(p58.x - p50.x)))) p50.x = p58.x;
    else if (Math.abs(f(p58.y - p50.y)) < 0.009999999776482582) p50.y = p58.y;
  };

  // --- outer edge (radius L), from aEnd to aStart ---
  let mid1: Vec;
  let p58: Vec; // aStart side
  let p50: Vec; // aEnd side
  if (curvedOuter) {
    pts.push(P(aEnd, L));
    for (let k = 0; k < n; k++) pts.push(P(interp(k, aEnd, aStart), L));
    pts.push(P(aStart, L));
    const a = pts[idiv(n + 2, 2)]!;
    const b = pts[idiv(n + 1, 2)]!;
    mid1 = { x: f(f(a.x + b.x) * 0.5), y: f(f(b.y + a.y) * 0.5) };
    p58 = { x: 0, y: 0 };
    p50 = { x: 0, y: 0 };
  } else {
    if (type === 2) {
      const c = cosf(aMid);
      const s = f(-sinf(aMid));
      const wc = f(c * width);
      const ws = f(width * s);
      p58 = { x: f(f(cosf(aStart) * LW) - wc), y: f(f(sinf(aStart) * -LW) - ws) };
      p50 = { x: f(f(cosf(aEnd) * LW) - wc), y: f(f(sinf(aEnd) * -LW) - ws) };
    } else if (type === 5) {
      const c = cosf(aMid);
      const cx = f(c * L);
      const s = sinf(aMid);
      const cy = f(s * -L);
      const hs = f(f(s * L) * 0.5);
      const hc = f(f(c * L) * 0.5);
      p58 = { x: f(cx + hs), y: f(cy + hc) };
      p50 = { x: f(cx - hs), y: f(cy - hc) };
    } else {
      p58 = P(aStart, L);
      p50 = P(aEnd, L);
    }
    snap(p58, p50);
    pts.push({ x: p50.x, y: p50.y }, { x: p58.x, y: p58.y });
    mid1 = { x: f(f(p50.x + p58.x) * 0.5), y: f(f(p50.y + p58.y) * 0.5) };
  }

  // --- inner edge (radius L+W), from aStart to aEnd ---
  let mid2: Vec;
  const base = pts.length;
  if (curvedInner) {
    pts.push(P(aStart, LW));
    for (let k = 0; k < n; k++) pts.push(P(interp(k, aStart, aEnd), LW));
    pts.push(P(aEnd, LW));
    const a = pts[idiv(n + 2, 2) + base]!;
    const b = pts[idiv(n + 1, 2) + base]!;
    mid2 = { x: f(f(a.x + b.x) * 0.5), y: f(f(b.y + a.y) * 0.5) };
  } else {
    let q58: Vec;
    let q50: Vec;
    if (type === 4) {
      const c = cosf(aMid);
      const s = f(-sinf(aMid));
      const wc = f(c * width);
      const ws = f(width * s);
      q58 = { x: f(f(cosf(aStart) * L) + wc), y: f(f(sinf(aStart) * -L) + ws) };
      q50 = { x: f(f(cosf(aEnd) * L) + wc), y: f(f(sinf(aEnd) * -L) + ws) };
    } else if (type === 5) {
      const a14 = f(rad(f(d.leftAngle ?? 0)) + aMid);
      const a18 = f(aMid + rad(f(d.rightAngle ?? 0)));
      q58 = { x: f(f(cosf(a14) * width) + p58.x), y: f(f(sinf(a14) * -width) + p58.y) };
      q50 = { x: f(f(cosf(a18) * width) + p50.x), y: f(f(sinf(a18) * -width) + p50.y) };
    } else {
      q58 = P(aStart, LW);
      q50 = P(aEnd, LW);
    }
    snap(q58, q50);
    pts.push({ x: q58.x, y: q58.y }, { x: q50.x, y: q50.y });
    mid2 = { x: f(f(q50.x + q58.x) * 0.5), y: f(f(q50.y + q58.y) * 0.5) };
  }

  pts.push({ x: pts[0]!.x, y: pts[0]!.y });

  // Center the outline on the brick's position.
  const offX = f(f(d.unkC8 ?? 0) + f(f(mid2.x + mid1.x) * 0.5));
  const offY = f(f(d.unkC9 ?? 0) + f(f(mid2.y + mid1.y) * 0.5));
  for (const p of pts) {
    p.x = f(p.x - offX);
    p.y = f(p.y - offY);
  }
  return pts;
}
