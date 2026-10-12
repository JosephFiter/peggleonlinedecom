/**
 * PeggleNights.exe (Steam) is a PopCap DRM launcher. The real game executable
 * is appended to it after a "!popcapdrmprotect!" marker and is not encrypted.
 * This extracts it so it can be analysed (e.g. with Ghidra).
 *
 *   node tools/extract-inner-exe.ts "<Peggle Nights folder>" [out.exe]
 *
 * Default output: game/PeggleNights.inner.exe (gitignored; never commit it).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dir = process.argv[2] ?? process.env.PEGGLE_DIR;
if (!dir) {
  console.error('usage: node tools/extract-inner-exe.ts <Peggle Nights folder> [out.exe]');
  process.exit(2);
}
const out = process.argv[3] ?? 'game/PeggleNights.inner.exe';
const exe = readFileSync(join(dir, 'PeggleNights.exe'));

const marker = exe.indexOf('!popcapdrmprotect!', 0, 'latin1');
if (marker < 0) throw new Error('DRM marker not found: is this the Steam/PopCap build?');
const mz = exe.indexOf('MZ', marker, 'latin1');
const pe = mz + exe.readUInt32LE(mz + 0x3c);
if (exe.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('no PE header after DRM marker');

// The inner image ends where its last section's raw data ends.
const sectionCount = exe.readUInt16LE(pe + 6);
const sectionTable = pe + 24 + exe.readUInt16LE(pe + 20);
let end = 0;
for (let i = 0; i < sectionCount; i++) {
  const s = sectionTable + 40 * i;
  end = Math.max(end, exe.readUInt32LE(s + 20) + exe.readUInt32LE(s + 16));
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, exe.subarray(mz, mz + end));
console.log(`inner exe: offset 0x${mz.toString(16)}, ${end} bytes -> ${out}`);
