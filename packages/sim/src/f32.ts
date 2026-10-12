import * as fdlibm from './fdlibm.ts';

/**
 * float32 arithmetic matching the original game.
 *
 * The game runs x87 code with the FPU in 24-bit precision (Direct3D 7 sets it
 * when the device is created) and spills most intermediates to float
 * variables, so every operation rounds to float32. For an operation on two
 * float32 values, computing in double and rounding once with Math.fround gives
 * exactly the same result (double has more than 2·24+2 bits), so `f(a * b)`
 * etc. reproduce the original bit for bit. See docs/re/physics.md.
 */
export const f = Math.fround;

/**
 * float32(x / d) with a single correct rounding, for float32 x and an
 * arbitrary double d. Needed where the game divides by a double constant that
 * is not representable as float (Math.fround(x / d) could double-round).
 */
export function divF32(x: number, d: number): number {
  const q = x / d;
  const r = f(q);
  if (r === q || !Number.isFinite(q)) return r;
  // The only ambiguous case: q landed exactly on the midpoint between two floats.
  const other = nextFloatToward(r, q);
  const mid = (r + other) / 2;
  if (q !== mid) return r;
  // Sign of the exact remainder x - mid·d decides which way the true quotient lies.
  const [ph, pl] = twoProduct(mid, d);
  const rem = x - ph - pl;
  if (rem === 0) return r; // exact tie: fround already applied ties-to-even
  const above = rem / d > 0; // true quotient > mid
  const hiF = r > other ? r : other;
  const loF = r > other ? other : r;
  return above ? hiF : loF;
}

/** float32(x * d) with a single correct rounding (see divF32). */
export function mulF32(x: number, d: number): number {
  const [ph, pl] = twoProduct(x, d);
  const r = f(ph);
  if (pl === 0 || r === ph) return r;
  const other = nextFloatToward(r, ph);
  const mid = (r + other) / 2;
  if (ph !== mid) return r;
  const hiF = r > other ? r : other;
  const loF = r > other ? other : r;
  return pl > 0 ? hiF : loF;
}

const f32buf = new Float32Array(1);
const u32buf = new Uint32Array(f32buf.buffer);

/** The float32 adjacent to r in the direction of t. */
function nextFloatToward(r: number, t: number): number {
  f32buf[0] = r;
  if (r === 0) {
    u32buf[0] = 1;
    return t > 0 ? f32buf[0]! : -f32buf[0]!;
  }
  const up = (t > r) === (r > 0);
  u32buf[0] = up ? u32buf[0]! + 1 : u32buf[0]! - 1;
  return f32buf[0]!;
}

const SPLIT = 134217729; // 2^27 + 1

/** Exact product a·b = hi + lo (Dekker / Veltkamp). */
function twoProduct(a: number, b: number): [number, number] {
  const p = a * b;
  let t = SPLIT * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLIT * b;
  const bh = t - (t - b);
  const bl = b - bh;
  const err = al * bl - (p - ah * bh - al * bh - ah * bl);
  return [p, err];
}

/** The game's sinf/cosf: CRT double sin/cos of a float argument, rounded to float. */
export function sinf(x: number): number {
  return f(fdlibm.sin(x));
}

export function cosf(x: number): number {
  return f(fdlibm.cos(x));
}

export function atan2f(y: number, x: number): number {
  return f(fdlibm.atan2(y, x));
}

/** CRT sqrt on a float argument, rounded to float (FUN_0044b060). */
export function sqrtf(x: number): number {
  return f(Math.sqrt(x));
}

/** C float-to-int conversion (__ftol2): truncation toward zero. */
export function ftol(x: number): number {
  return Math.trunc(x) | 0;
}

/** C integer division truncating toward zero. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b) | 0;
}

/** C remainder (sign follows the dividend). */
export function imod(a: number, b: number): number {
  return a % b | 0;
}

/** Normalize (FUN_0044b0b0): len = sqrtf(x²+y²); two divisions; unchanged if len == 0. */
export function normalize(x: number, y: number): [number, number] {
  const len = sqrtf(f(f(x * x) + f(y * y)));
  if (len !== 0) return [f(x / len), f(y / len)];
  return [x, y];
}
