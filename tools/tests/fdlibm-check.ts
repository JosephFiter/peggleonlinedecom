/** Compares the deterministic fdlibm port with V8's Math functions (also fdlibm). */
import * as fd from '../../packages/sim/src/fdlibm.ts';

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const ranges = [1, 4, 10, 100, 1e4, 1e5];
let mism = { sin: 0, cos: 0, atan2: 0 };
let n = 0;
for (const R of ranges) {
  for (let i = 0; i < 200000; i++, n++) {
    const x = (rnd() * 2 - 1) * R;
    const y = (rnd() * 2 - 1) * R;
    if (!Object.is(fd.sin(x), Math.sin(x))) mism.sin++;
    if (!Object.is(fd.cos(x), Math.cos(x))) mism.cos++;
    if (!Object.is(fd.atan2(y, x), Math.atan2(y, x))) mism.atan2++;
  }
}
console.log(`samples: ${n}`, 'mismatches vs Math:', mism);
process.exit(mism.sin + mism.cos + mism.atan2 ? 1 : 0);
