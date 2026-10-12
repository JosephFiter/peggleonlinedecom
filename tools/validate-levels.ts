/**
 * Parses every level in the local game install and checks that each file is
 * consumed exactly, byte for byte. Nothing is written to disk.
 *
 *   node tools/validate-levels.ts "F:\SteamLibrary\steamapps\common\Peggle Nights"
 *
 * The path can also come from the PEGGLE_DIR environment variable.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PakArchive, parseLevel, EntryType } from '@peggle/formats';

const gameDir = process.argv[2] ?? process.env.PEGGLE_DIR;
if (!gameDir || !existsSync(join(gameDir, 'main.pak'))) {
  console.error('usage: node tools/validate-levels.ts <Peggle Nights install folder>');
  process.exit(2);
}

const paks: [string, PakArchive][] = [['main.pak', PakArchive.open(readFileSync(join(gameDir, 'main.pak')))]];
const packDir = join(gameDir, 'levelpacks');
if (existsSync(packDir)) {
  for (const f of readdirSync(packDir).filter((f) => f.toLowerCase().endsWith('.pak'))) {
    paks.push([`levelpacks/${f}`, PakArchive.open(readFileSync(join(packDir, f)))]);
  }
}

const typeNames = new Map<number, string>(Object.entries(EntryType).map(([k, v]) => [v, k]));
let ok = 0;
let failed = 0;
const typeCounts = new Map<string, number>();
const versions = new Map<number, number>();

for (const [pakName, pak] of paks) {
  // trailer/*.dat share the extension but are not levels (likely attract-mode recordings).
  const levels = pak.entries.filter((e) => e.key.endsWith('.dat') && !e.key.startsWith('trailer/'));
  for (const entry of levels) {
    try {
      const level = parseLevel(pak.read(entry.name));
      versions.set(level.version, (versions.get(level.version) ?? 0) + 1);
      for (const e of level.entries) {
        const name = typeNames.get(e.type) ?? `type${e.type}`;
        typeCounts.set(name, (typeCounts.get(name) ?? 0) + 1);
      }
      ok++;
    } catch (err) {
      failed++;
      console.error(`FAIL ${pakName}:${entry.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

console.log(`levels parsed: ${ok}, failed: ${failed}`);
console.log('versions:', Object.fromEntries(versions));
console.log('entries by type:', Object.fromEntries(typeCounts));
process.exit(failed ? 1 : 0);
