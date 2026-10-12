import { BinaryReader } from './binary.ts';

/**
 * PopCap .pak archive (main.pak, levelpacks/*.pak).
 *
 * Layout, after XOR-ing every byte with 0xF7:
 *   u32 magic 0xBAC04AC0, u32 version 0
 *   repeated: u8 flags (0x80 = end of table), u8 nameLen, name,
 *             u32 size, u64 FILETIME
 *   file data, concatenated in table order
 */
export const PAK_MAGIC = 0xbac04ac0;
const PAK_XOR = 0xf7;

export interface PakEntry {
  /** Path as stored, e.g. `levels\Bjorn1.dat`. */
  name: string;
  /** Normalized lookup key: lowercase, forward slashes. */
  key: string;
  offset: number;
  size: number;
  fileTime: bigint;
}

export function normalizePakPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
}

export class PakArchive {
  readonly entries: PakEntry[];
  private readonly data: Uint8Array;
  private readonly byKey: Map<string, PakEntry>;

  private constructor(data: Uint8Array, entries: PakEntry[]) {
    this.data = data;
    this.entries = entries;
    this.byKey = new Map(entries.map((e) => [e.key, e]));
  }

  static open(raw: Uint8Array): PakArchive {
    const data = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i]! ^ PAK_XOR;

    const r = new BinaryReader(data);
    const magic = r.u32();
    if (magic !== PAK_MAGIC) {
      throw new Error(`not a PopCap pak (magic 0x${magic.toString(16)})`);
    }
    const version = r.u32();
    if (version !== 0) throw new Error(`unsupported pak version ${version}`);

    const table: Omit<PakEntry, 'offset'>[] = [];
    const latin1 = new TextDecoder('latin1');
    for (;;) {
      const flags = r.u8();
      if (flags & 0x80) break;
      const name = latin1.decode(r.take(r.u8()));
      const size = r.u32();
      const fileTime = r.u64();
      table.push({ name, key: normalizePakPath(name), size, fileTime });
    }

    let offset = r.pos;
    const entries = table.map((e) => {
      const entry = { ...e, offset };
      offset += e.size;
      return entry;
    });
    if (offset !== data.length) {
      throw new Error(`pak size mismatch: table describes ${offset} bytes, file has ${data.length}`);
    }
    return new PakArchive(data, entries);
  }

  has(path: string): boolean {
    return this.byKey.has(normalizePakPath(path));
  }

  get(path: string): PakEntry | undefined {
    return this.byKey.get(normalizePakPath(path));
  }

  /** Returns a view into the decoded archive; copy it if you need to keep it mutable. */
  read(path: string): Uint8Array {
    const e = this.get(path);
    if (!e) throw new Error(`file not in pak: ${path}`);
    return this.data.subarray(e.offset, e.offset + e.size);
  }

  list(prefix = ''): PakEntry[] {
    const p = normalizePakPath(prefix);
    return this.entries.filter((e) => e.key.startsWith(p));
  }
}
