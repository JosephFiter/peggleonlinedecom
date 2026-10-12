import { BinaryReader, bit } from './binary.ts';

/**
 * Peggle level (.dat) parser.
 *
 * Field layout follows the community documentation of the format (PeggleEdit
 * by IntelOrca was used as a reference; no code was copied). Every field is
 * kept, including the ones whose meaning is not yet known, because any of them
 * may turn out to affect the physics. Unknown values are named `unk*` with the
 * flag bit or position they come from so they can be matched up against the
 * disassembly later.
 */

export const EntryType = {
  Rod: 2,
  Polygon: 3,
  Circle: 5,
  Brick: 6,
  Teleport: 8,
  Emitter: 9,
} as const;

export const MovementType = {
  None: 0,
  VerticalCycle: 1,
  HorizontalCycle: 2,
  Circle: 3,
  HorizontalInfinity: 4,
  VerticalInfinity: 5,
  HorizontalArc: 6,
  VerticalArc: 7,
  Rotate: 8,
  RotateBackAndForth: 9,
  Unused: 10,
  VerticalWrap: 11,
  HorizontalWrap: 12,
  RotateAroundCircle: 13,
  RetraceCircle: 14,
  WeirdShape: 15,
} as const;

export interface Vec2 {
  x: number;
  y: number;
}

/** Either a constant or a named variable/expression evaluated by the game. */
export type VariableFloat = { kind: 'static'; value: number } | { kind: 'variable'; expr: string };

export interface PegInfo {
  /** Peg type byte (1 in all shipped levels so far). */
  type: number;
  flags: number;
  /** "Variable" peg: may be picked to become orange/green/purple. */
  canBeOrange: boolean;
  /** Crumbles quickly when hit. */
  quickDisappear: boolean;
  unk2?: number;
  unk4?: number;
  unk5?: number;
  unk7?: number;
}

export interface Movement {
  type: number;
  reverse: boolean;
  anchor: Vec2;
  /** Period of the movement cycle, in game ticks. */
  timePeriod: number;
  flags: number;
  offset?: number;
  radius1?: number;
  startPhase?: number;
  /** Radians. */
  moveRotation?: number;
  radius2?: number;
  pause1?: number;
  pause2?: number;
  phase1?: number;
  phase2?: number;
  postDelayPhase?: number;
  maxAngle?: number;
  unk11?: number;
  /** Radians. */
  rotation?: number;
  subMovementOffset?: Vec2;
  subMovement?: MovementLink;
  objectPos?: Vec2;
}

/**
 * id 0 = no movement, id 1 = movement stored inline, anything else refers to a
 * movement defined by an earlier entry (shared movement).
 */
export interface MovementLink {
  id: number;
  movement?: Movement;
}

export interface GenericData {
  flags: number;
  collision: boolean;
  visible: boolean;
  canMove: boolean;
  background: boolean;
  baseObject: boolean;
  ballStopReset: boolean;
  foreground: boolean;
  drawSort: boolean;
  foreground2: boolean;
  drawFloat: boolean;
  shadow: boolean;
  rolly?: number;
  bouncy?: number;
  unk4?: number;
  solidColor?: number;
  outlineColor?: number;
  image?: string;
  imageDX?: number;
  imageDY?: number;
  /** Radians, as stored. */
  imageRotation?: number;
  unk16?: number;
  id?: string;
  unk18?: number;
  sound?: number;
  logic?: string;
  maxBounceVelocity?: number;
  subId?: number;
  flipperFlags?: number;
  peg?: PegInfo;
  movementLink?: MovementLink;
}

export interface RodData {
  kind: 'rod';
  flags: number;
  a: Vec2;
  b: Vec2;
  unk0?: number;
  unk1?: number;
}

export interface PolygonData {
  kind: 'polygon';
  flagsA: number;
  flagsB: number;
  rotation?: number;
  unkA3?: number;
  scale?: number;
  normalDir?: number;
  pos?: Vec2;
  points: Vec2[];
  unkB0?: number;
  growType?: number;
}

export interface CircleData {
  kind: 'circle';
  flagsA: number;
  flagsB?: number;
  pos?: Vec2;
  radius: number;
}

export interface BrickData {
  kind: 'brick';
  flagsA: number;
  flagsB: number;
  flagsC: number;
  unkA2?: number;
  unkA3?: number;
  unkA5?: number;
  unkA1?: number;
  pos?: Vec2;
  unkB0?: number;
  unkB1?: number;
  unkB2?: number;
  unkC8?: number;
  unkC9?: number;
  /** 5 = straight brick, otherwise curved. */
  brickType?: number;
  curved: boolean;
  /** Number of curve segments (stored value + 2). */
  curvePoints?: number;
  leftAngle?: number;
  rightAngle?: number;
  unkC6?: number;
  sectorAngle?: number;
  width?: number;
  textureFlip: boolean;
  length: number;
  angle: number;
  unkTail: number;
}

export interface TeleportData {
  kind: 'teleport';
  flags: number;
  width: number;
  height: number;
  unk1?: number;
  unk3?: number;
  unk5?: number;
  entry?: LevelEntry;
  pos?: Vec2;
  unk6?: Vec2;
}

export interface EmitterData {
  kind: 'emitter';
  mainVar: number;
  flags: number;
  image: string;
  width: number;
  height: number;
  mainVar0?: number;
  mainVar1?: number;
  mainVar2?: string;
  mainVar3?: number;
  unk13a?: VariableFloat;
  unk13b?: VariableFloat;
  pos?: Vec2;
  emitImage: string;
  unknownEmitRate: number;
  unk2: number;
  rotation: number;
  maxQuantity: number;
  timeBeforeFadeOut: number;
  fadeInTime: number;
  lifeDuration: number;
  emitRate: VariableFloat;
  emitAreaMultiplier: VariableFloat;
  rotationParams?: { initial: VariableFloat; velocity: VariableFloat; unk: number };
  scaleParams?: { min: VariableFloat; velocity: VariableFloat; maxRand: number };
  colorParams?: { r: VariableFloat; g: VariableFloat; b: VariableFloat };
  opacity?: VariableFloat;
  velocityParams?: {
    minX: VariableFloat;
    minY: VariableFloat;
    maxX: number;
    maxY: number;
    accelX: number;
    accelY: number;
  };
  directionParams?: {
    speed: number;
    randomSpeed: number;
    acceleration: number;
    angle: number;
    randomAngle: number;
  };
  unk6?: Vec2;
}

export interface UnknownData {
  kind: 'unknown';
}

export type EntryData = RodData | PolygonData | CircleData | BrickData | TeleportData | EmitterData | UnknownData;

export interface LevelEntry {
  type: number;
  /** Byte offset of the entry in the file, for cross-referencing with hex dumps. */
  fileOffset: number;
  generic: GenericData;
  data: EntryData;
}

export interface Level {
  version: number;
  headerByte: number;
  entries: LevelEntry[];
}

export class LevelParseError extends Error {
  readonly entryIndex: number;
  readonly offset: number;
  constructor(message: string, entryIndex: number, offset: number) {
    super(`entry ${entryIndex} @ 0x${offset.toString(16)}: ${message}`);
    this.entryIndex = entryIndex;
    this.offset = offset;
  }
}

export function parseLevel(bytes: Uint8Array): Level {
  const r = new BinaryReader(bytes);
  const version = r.i32();
  const headerByte = r.u8();
  const count = r.i32();
  const entries: LevelEntry[] = [];
  for (let i = 0; i < count; i++) {
    const start = r.pos;
    try {
      const e = readEntry(r, version);
      if (e) entries.push(e);
    } catch (err) {
      throw new LevelParseError(err instanceof Error ? err.message : String(err), i, start);
    }
  }
  if (r.remaining !== 0) {
    throw new LevelParseError(`${r.remaining} trailing bytes after last entry`, count, r.pos);
  }
  return { version, headerByte, entries };
}

function readEntry(r: BinaryReader, version: number): LevelEntry | null {
  const fileOffset = r.pos;
  const magic = r.i32();
  if (magic === 0) return null;
  if (magic !== 1) throw new Error(`bad entry magic ${magic}`);
  const type = r.i32();
  const generic = readGeneric(r, version);
  const data = readEntryData(r, type, version);
  return { type, fileOffset, generic, data };
}

function readGeneric(r: BinaryReader, version: number): GenericData {
  const f = version < 0x0f ? r.u24() : r.u32();
  const g: GenericData = {
    flags: f,
    collision: bit(f, 5),
    visible: bit(f, 6),
    canMove: bit(f, 7),
    background: bit(f, 14),
    baseObject: bit(f, 15),
    ballStopReset: bit(f, 20),
    foreground: bit(f, 22),
    drawSort: bit(f, 24),
    foreground2: bit(f, 25),
    drawFloat: bit(f, 28),
    shadow: version >= 0x50 ? bit(f, 30) : true,
  };
  if (bit(f, 0)) g.rolly = r.f32();
  if (bit(f, 1)) g.bouncy = r.f32();
  if (bit(f, 4)) g.unk4 = r.i32();
  if (bit(f, 8)) g.solidColor = r.u32();
  if (bit(f, 9)) g.outlineColor = r.u32();
  if (bit(f, 10)) g.image = r.popcapString();
  if (bit(f, 11)) g.imageDX = r.f32();
  if (bit(f, 12)) g.imageDY = r.f32();
  if (bit(f, 13)) g.imageRotation = r.f32();
  if (bit(f, 16)) g.unk16 = r.i32();
  if (bit(f, 17)) g.id = r.popcapString();
  if (bit(f, 18)) g.unk18 = r.i32();
  if (bit(f, 19)) g.sound = r.u8();
  if (bit(f, 21)) g.logic = r.popcapString();
  if (bit(f, 23)) g.maxBounceVelocity = r.f32();
  if (bit(f, 26)) g.subId = r.i32();
  if (bit(f, 27)) g.flipperFlags = r.u8();
  if (bit(f, 2)) g.peg = readPegInfo(r);
  if (bit(f, 3)) g.movementLink = readMovementLink(r, version);
  return g;
}

function readPegInfo(r: BinaryReader): PegInfo {
  const type = r.u8();
  const f = r.u8();
  const p: PegInfo = {
    type,
    flags: f,
    canBeOrange: bit(f, 1),
    quickDisappear: bit(f, 3),
  };
  if (bit(f, 2)) p.unk2 = r.i32();
  if (bit(f, 4)) p.unk4 = r.i32();
  if (bit(f, 5)) p.unk5 = r.u8();
  if (bit(f, 7)) p.unk7 = r.u8();
  return p;
}

function readMovementLink(r: BinaryReader, version: number): MovementLink {
  const id = r.i32();
  const link: MovementLink = { id };
  if (id === 1) link.movement = readMovement(r, version);
  return link;
}

function readMovement(r: BinaryReader, version: number): Movement {
  const shape = r.i8();
  const m: Movement = {
    type: Math.abs(shape),
    reverse: shape < 0,
    anchor: readVec2(r),
    timePeriod: r.i16(),
    flags: 0,
  };
  const f = r.u16();
  m.flags = f;
  if (bit(f, 0)) m.offset = r.i16();
  if (bit(f, 1)) m.radius1 = r.i16();
  if (bit(f, 2)) m.startPhase = r.f32();
  if (bit(f, 3)) m.moveRotation = r.f32();
  if (bit(f, 4)) m.radius2 = r.i16();
  if (bit(f, 5)) m.pause1 = r.i16();
  if (bit(f, 6)) m.pause2 = r.i16();
  if (bit(f, 7)) m.phase1 = r.u8();
  if (bit(f, 8)) m.phase2 = r.u8();
  if (bit(f, 9)) m.postDelayPhase = r.f32();
  if (bit(f, 10)) m.maxAngle = r.f32();
  if (bit(f, 11)) m.unk11 = r.f32();
  if (bit(f, 14)) m.rotation = r.f32();
  if (bit(f, 12)) {
    m.subMovementOffset = readVec2(r);
    m.subMovement = readMovementLink(r, version);
  }
  if (bit(f, 13)) m.objectPos = readVec2(r);
  return m;
}

function readEntryData(r: BinaryReader, type: number, version: number): EntryData {
  switch (type) {
    case EntryType.Rod:
      return readRod(r);
    case EntryType.Polygon:
      return readPolygon(r, version);
    case EntryType.Circle:
      return readCircle(r, version);
    case EntryType.Brick:
      return readBrick(r, version);
    case EntryType.Teleport:
      return readTeleport(r, version);
    case EntryType.Emitter:
      return readEmitter(r);
    default:
      throw new Error(`unknown entry type ${type}`);
  }
}

function readVec2(r: BinaryReader): Vec2 {
  const x = r.f32();
  return { x, y: r.f32() };
}

function readVariableFloat(r: BinaryReader): VariableFloat {
  return r.u8() > 0 ? { kind: 'static', value: r.f32() } : { kind: 'variable', expr: r.popcapString() };
}

function readRod(r: BinaryReader): RodData {
  const flags = r.u8();
  const d: RodData = { kind: 'rod', flags, a: readVec2(r), b: readVec2(r) };
  if (bit(flags, 0)) d.unk0 = r.f32();
  if (bit(flags, 1)) d.unk1 = r.f32();
  return d;
}

function readPolygon(r: BinaryReader, version: number): PolygonData {
  const flagsA = r.u8();
  const flagsB = version >= 0x23 ? r.u8() : 0;
  const d: PolygonData = { kind: 'polygon', flagsA, flagsB, points: [] };
  if (bit(flagsA, 2)) d.rotation = r.f32();
  if (bit(flagsA, 3)) d.unkA3 = r.f32();
  if (bit(flagsA, 5)) d.scale = r.f32();
  if (bit(flagsA, 1)) d.normalDir = r.u8();
  if (bit(flagsA, 4)) d.pos = readVec2(r);
  const n = r.i32();
  if (n < 0 || n > 10000) throw new Error(`implausible polygon point count ${n}`);
  for (let i = 0; i < n; i++) d.points.push(readVec2(r));
  if (bit(flagsB, 0)) d.unkB0 = r.u8();
  if (bit(flagsB, 1)) d.growType = r.i32();
  return d;
}

function readCircle(r: BinaryReader, version: number): CircleData {
  const flagsA = r.u8();
  const d: CircleData = { kind: 'circle', flagsA, radius: 0 };
  if (version >= 0x52) d.flagsB = r.u8();
  if (bit(flagsA, 1)) d.pos = readVec2(r);
  d.radius = r.f32();
  return d;
}

function readBrick(r: BinaryReader, version: number): BrickData {
  const flagsA = r.u8();
  const flagsB = version >= 0x23 ? r.u8() : 0;
  const partial: Partial<BrickData> = {};
  if (bit(flagsA, 2)) partial.unkA2 = r.f32();
  if (bit(flagsA, 3)) partial.unkA3 = r.f32();
  if (bit(flagsA, 5)) partial.unkA5 = r.f32();
  if (bit(flagsA, 1)) partial.unkA1 = r.u8();
  if (bit(flagsA, 4)) partial.pos = readVec2(r);
  if (bit(flagsB, 0)) partial.unkB0 = r.u8();
  if (bit(flagsB, 1)) partial.unkB1 = r.i32();
  if (bit(flagsB, 2)) partial.unkB2 = r.i16();

  const flagsC = r.u16();
  let curved = true;
  if (bit(flagsC, 8)) partial.unkC8 = r.f32();
  if (bit(flagsC, 9)) partial.unkC9 = r.f32();
  if (bit(flagsC, 2)) {
    partial.brickType = r.u8();
    if (partial.brickType === 5) curved = false;
  }
  if (bit(flagsC, 3)) partial.curvePoints = r.u8() + 2;
  if (bit(flagsC, 5)) partial.leftAngle = r.f32();
  if (bit(flagsC, 6)) {
    partial.rightAngle = r.f32();
    partial.unkC6 = r.f32();
  }
  if (bit(flagsC, 4)) partial.sectorAngle = r.f32();
  if (bit(flagsC, 7)) partial.width = r.f32();
  const length = r.f32();
  const angle = r.f32();
  const unkTail = r.u32();
  return {
    kind: 'brick',
    flagsA,
    flagsB,
    flagsC,
    ...partial,
    curved,
    textureFlip: bit(flagsC, 10),
    length,
    angle,
    unkTail,
  };
}

function readTeleport(r: BinaryReader, version: number): TeleportData {
  const flags = r.u8();
  const d: TeleportData = { kind: 'teleport', flags, width: r.i32(), height: r.i32() };
  if (bit(flags, 1)) d.unk1 = r.i16();
  if (bit(flags, 3)) d.unk3 = r.i32();
  if (bit(flags, 5)) d.unk5 = r.i32();
  if (bit(flags, 4)) d.entry = readEntry(r, version) ?? undefined;
  if (bit(flags, 2)) d.pos = readVec2(r);
  if (bit(flags, 6)) d.unk6 = readVec2(r);
  return d;
}

function readEmitter(r: BinaryReader): EmitterData {
  const mainVar = r.i32();
  const f = r.u16();
  const image = r.popcapString();
  const width = r.i32();
  const height = r.i32();
  const head: Partial<EmitterData> = {};
  if (mainVar === 2) {
    head.mainVar0 = r.i32();
    head.mainVar1 = r.f32();
    head.mainVar2 = r.popcapString();
    head.mainVar3 = r.u8();
    if (bit(f, 13)) {
      head.unk13a = readVariableFloat(r);
      head.unk13b = readVariableFloat(r);
    }
  }
  if (bit(f, 5)) head.pos = readVec2(r);
  const d: EmitterData = {
    kind: 'emitter',
    mainVar,
    flags: f,
    image,
    width,
    height,
    ...head,
    emitImage: r.popcapString(),
    unknownEmitRate: r.f32(),
    unk2: r.f32(),
    rotation: r.f32(),
    maxQuantity: r.i32(),
    timeBeforeFadeOut: r.f32(),
    fadeInTime: r.f32(),
    lifeDuration: r.f32(),
    emitRate: readVariableFloat(r),
    emitAreaMultiplier: readVariableFloat(r),
  };
  if (bit(f, 12)) {
    d.rotationParams = { initial: readVariableFloat(r), velocity: readVariableFloat(r), unk: r.f32() };
  }
  if (bit(f, 7)) {
    d.scaleParams = { min: readVariableFloat(r), velocity: readVariableFloat(r), maxRand: r.f32() };
  }
  if (bit(f, 8)) {
    d.colorParams = { r: readVariableFloat(r), g: readVariableFloat(r), b: readVariableFloat(r) };
  }
  if (bit(f, 9)) d.opacity = readVariableFloat(r);
  if (bit(f, 10)) {
    d.velocityParams = {
      minX: readVariableFloat(r),
      minY: readVariableFloat(r),
      maxX: r.f32(),
      maxY: r.f32(),
      accelX: r.f32(),
      accelY: r.f32(),
    };
  }
  if (bit(f, 11)) {
    d.directionParams = {
      speed: r.f32(),
      randomSpeed: r.f32(),
      acceleration: r.f32(),
      angle: r.f32(),
      randomAngle: r.f32(),
    };
  }
  if (bit(f, 6)) d.unk6 = readVec2(r);
  return d;
}

/** World position of an entry, whichever sub-record stores it. */
export function entryPosition(e: LevelEntry): Vec2 | undefined {
  const d = e.data;
  switch (d.kind) {
    case 'circle':
    case 'polygon':
    case 'brick':
    case 'teleport':
    case 'emitter':
      return d.pos;
    case 'rod':
      return { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
    default:
      return undefined;
  }
}
