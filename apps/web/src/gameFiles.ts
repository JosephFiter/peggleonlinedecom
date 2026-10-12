import { PakArchive, ResourceManifest, parseStages, type Stage } from '@peggle/formats';

/**
 * The user's Peggle Nights install, read entirely in the browser. Nothing in
 * here is ever uploaded anywhere.
 */
export interface GameFiles {
  mainPak: PakArchive;
  /** Level packs (levelpacks/*.pak), in folder order. */
  levelPacks: { name: string; pak: PakArchive }[];
  /** Search order for assets: level packs first so they can add/override files. */
  paks: PakArchive[];
  manifest: ResourceManifest;
  stages: GameStage[];
  /** music/*.ogg and *.mo3, by lowercase file name. */
  music: Map<string, Blob>;
}

/** A file from the install, with its path relative to the install folder. */
export interface InstallFile {
  path: string;
  blob: Blob;
}

/** Converts the FileList of an `<input webkitdirectory>`, dropping the top folder name. */
export function fromFolderPicker(files: Iterable<File>): InstallFile[] {
  return [...files].map((f) => {
    const parts = (f.webkitRelativePath || f.name).replace(/\\/g, '/').split('/');
    return { path: (parts.length > 1 ? parts.slice(1) : parts).join('/'), blob: f };
  });
}

export interface GameStage extends Stage {
  /** Which pak the stage's levels live in. */
  pak: PakArchive;
  source: string;
}

export class GameFilesError extends Error {}

export async function loadGameFiles(files: Iterable<InstallFile>): Promise<GameFiles> {
  const byPath = new Map<string, Blob>();
  for (const f of files) byPath.set(f.path.replace(/\\/g, '/').toLowerCase(), f.blob);

  const mainFile = byPath.get('main.pak');
  if (!mainFile) {
    throw new GameFilesError(
      'No encontré main.pak. Elegí la carpeta de instalación de Peggle Nights (la que contiene PeggleNights.exe y main.pak).',
    );
  }

  let mainPak: PakArchive;
  try {
    mainPak = PakArchive.open(new Uint8Array(await mainFile.arrayBuffer()));
  } catch (err) {
    throw new GameFilesError(`main.pak no es un archivo válido de Peggle: ${err instanceof Error ? err.message : err}`);
  }
  if (!mainPak.has('levels/stages.cfg') || !mainPak.has('properties/resources.xml')) {
    throw new GameFilesError('main.pak no parece ser de Peggle Nights (faltan levels/stages.cfg o properties/resources.xml).');
  }

  const levelPacks: GameFiles['levelPacks'] = [];
  const packPaths = [...byPath.keys()].filter((p) => p.startsWith('levelpacks/') && p.endsWith('.pak')).sort();
  for (const p of packPaths) {
    try {
      levelPacks.push({ name: p.slice('levelpacks/'.length), pak: PakArchive.open(new Uint8Array(await byPath.get(p)!.arrayBuffer())) });
    } catch (err) {
      console.warn(`skipping level pack ${p}:`, err);
    }
  }

  const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
  const manifest = ResourceManifest.parse(text(mainPak.read('properties/resources.xml')));

  const stages: GameStage[] = parseStages(text(mainPak.read('levels/stages.cfg'))).map((s) => ({
    ...s,
    pak: mainPak,
    source: 'main.pak',
  }));
  for (const { name, pak } of levelPacks) {
    const cfg = pak.entries.find((e) => e.key.endsWith('.cfg') && !e.key.includes('/'));
    if (!cfg) continue;
    for (const s of parseStages(text(pak.read(cfg.name)))) stages.push({ ...s, pak, source: name });
  }

  const music = new Map<string, Blob>();
  for (const [p, f] of byPath) {
    if (p.startsWith('music/')) music.set(p.slice('music/'.length), f);
  }

  return {
    mainPak,
    levelPacks,
    paks: [...levelPacks.map((l) => l.pak), mainPak],
    manifest,
    stages,
    music,
  };
}
