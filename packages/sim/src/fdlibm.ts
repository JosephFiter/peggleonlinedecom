/**
 * Deterministic sin / cos / atan / atan2 for IEEE doubles.
 *
 * Math.sin and friends are not required to be bit-identical across JS
 * engines, and the online mode needs both players to compute exactly the same
 * values. These are straight ports of the classic fdlibm algorithms (the ones
 * V8 and SpiderMonkey also use), written with plain double arithmetic only, so
 * they produce the same bits everywhere.
 *
 * Argument reduction only covers |x| < 2^19·π/2, far beyond anything the game
 * feeds in (angles and movement phases are small).
 */

const buf = new DataView(new ArrayBuffer(8));

function hi(x: number): number {
  buf.setFloat64(0, x);
  return buf.getInt32(0);
}

function lo(x: number): number {
  buf.setFloat64(0, x);
  return buf.getUint32(4);
}

function fromWords(h: number, l: number): number {
  buf.setInt32(0, h);
  buf.setUint32(4, l);
  return buf.getFloat64(0);
}

// --- kernels ---------------------------------------------------------------

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x: number, y: number, iy: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number, y: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// --- argument reduction ----------------------------------------------------

const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;

/** Returns n (quadrant) and writes x - n·π/2 as y0 + y1. */
function remPio2(x: number, y: [number, number]): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    y[0] = x;
    y[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        y[0] = z - PIO2_1T;
        y[1] = z - y[0] - PIO2_1T;
      } else {
        z -= PIO2_2;
        y[0] = z - PIO2_2T;
        y[1] = z - y[0] - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      y[0] = z + PIO2_1T;
      y[1] = z - y[0] + PIO2_1T;
    } else {
      z += PIO2_2;
      y[0] = z + PIO2_2T;
      y[1] = z - y[0] + PIO2_2T;
    }
    return -1;
  }
  if (ix > 0x413921fb) throw new RangeError(`fdlibm: argument too large for reduction: ${x}`);

  const t = Math.abs(x);
  const n = (t * INVPIO2 + 0.5) | 0;
  const fn = n;
  let r = t - fn * PIO2_1;
  let w = fn * PIO2_1T;
  const j = ix >> 20;
  y[0] = r - w;
  let i = j - ((hi(y[0]) >> 20) & 0x7ff);
  if (i > 16) {
    let tt = r;
    w = fn * PIO2_2;
    r = tt - w;
    w = fn * PIO2_2T - (tt - r - w);
    y[0] = r - w;
    i = j - ((hi(y[0]) >> 20) & 0x7ff);
    if (i > 49) {
      tt = r;
      w = fn * PIO2_3;
      r = tt - w;
      w = fn * PIO2_3T - (tt - r - w);
      y[0] = r - w;
    }
  }
  y[1] = r - y[0] - w;
  if (hx < 0) {
    y[0] = -y[0];
    y[1] = -y[1];
    return -n;
  }
  return n;
}

const red: [number, number] = [0, 0];

export function sin(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x, red);
  switch (n & 3) {
    case 0:
      return kernelSin(red[0], red[1], 1);
    case 1:
      return kernelCos(red[0], red[1]);
    case 2:
      return -kernelSin(red[0], red[1], 1);
    default:
      return -kernelCos(red[0], red[1]);
  }
}

export function cos(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x, red);
  switch (n & 3) {
    case 0:
      return kernelCos(red[0], red[1]);
    case 1:
      return -kernelSin(red[0], red[1], 1);
    case 2:
      return -kernelCos(red[0], red[1]);
    default:
      return kernelSin(red[0], red[1], 1);
  }
}

// --- atan / atan2 ----------------------------------------------------------

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];

export function atan(x0: number): number {
  let x = x0;
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lo(x) !== 0)) return x + x;
    return hx > 0 ? ATANHI[3]! + ATANLO[3]! : -ATANHI[3]! - ATANLO[3]!;
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e200000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  const zz = ATANHI[id]! - (x * (s1 + s2) - ATANLO[id]! - x);
  return hx < 0 ? -zz : zz;
}

const PI = 3.1415926535897931160e0;
const PI_O_2 = 1.5707963267948965580e0;
const PI_O_4 = 7.8539816339744827900e-1;
const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  const lx = lo(x);
  const hy = hi(y);
  const iy = hy & 0x7fffffff;
  const ly = lo(y);
  if ((ix | ((lx | -lx) >>> 31)) > 0x7ff00000 || (iy | ((ly | -ly) >>> 31)) > 0x7ff00000) return x + y;
  if (hx === 0x3ff00000 && lx === 0) return atan(y);
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1:
        return y;
      case 2:
        return PI;
      default:
        return -PI;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI_O_4;
        case 1:
          return -PI_O_4;
        case 2:
          return 3 * PI_O_4;
        default:
          return -3 * PI_O_4;
      }
    }
    switch (m) {
      case 0:
        return 0;
      case 1:
        return -0;
      case 2:
        return PI;
      default:
        return -PI;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 : PI_O_2;
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) z = PI_O_2 + 0.5 * PI_LO;
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}
