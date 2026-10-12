/**
 * Little-endian reader over a byte buffer, matching the primitive reads the
 * original game performs. Floats come back as the exact float32 value widened
 * to a JS number, so no precision is invented or lost.
 */
export class BinaryReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  pos = 0;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.byteLength) {
      throw new RangeError(`read of ${n} bytes at ${this.pos} overruns buffer of ${this.bytes.byteLength}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u24(): number {
    const lo = this.u16();
    return lo | (this.u8() << 16);
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u64(): bigint {
    this.need(8);
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  }

  take(n: number): Uint8Array {
    this.need(n);
    const v = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  /** PopCap string: int16 byte length followed by the bytes (no terminator). */
  popcapString(): string {
    const len = this.i16();
    return utf8.decode(this.take(len));
  }
}

const utf8 = new TextDecoder('utf-8');

export function bit(flags: number, i: number): boolean {
  return ((flags >>> i) & 1) === 1;
}
