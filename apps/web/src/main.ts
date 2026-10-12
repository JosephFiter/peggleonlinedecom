import './style.css';
import { parseLevel, EntryType, type Level } from '@peggle/formats';
import { Board } from '@peggle/sim';
import { loadGameFiles, fromFolderPicker, GameFilesError, type GameFiles, type InstallFile } from './gameFiles.ts';
import { ImageStore } from './images.ts';
import { loadEntryImages, loadLevelAssets, type LoadedLevel } from './levelView.ts';
import { GameView, loadGameAssets } from './game.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const folderInput = $<HTMLInputElement>('folder');
const statusEl = $<HTMLParagraphElement>('status');
const viewer = $<HTMLElement>('viewer');
const levelSelect = $<HTMLSelectElement>('level');
const showCollision = $<HTMLInputElement>('show-collision');
const levelInfo = $<HTMLSpanElement>('level-info');
const canvas = $<HTMLCanvasElement>('board');
const shotInfo = $<HTMLSpanElement>('shot-info');

let game: GameFiles | null = null;
let images: ImageStore | null = null;
let current: LoadedLevel | null = null;
let view: GameView | null = null;
let baseLevel: Level | null = null;
let loadToken = 0;

function setStatus(text: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

folderInput.addEventListener('change', () => {
  const files = folderInput.files;
  if (files && files.length > 0) void openGame(fromFolderPicker(files));
});

// Dev server only: load the install pointed to by PEGGLE_DIR (see vite.config.ts).
if (import.meta.env.DEV) {
  const devButton = $<HTMLButtonElement>('dev-load');
  fetch('/__dev_game/list')
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? (r.json() as Promise<string[]>) : null))
    .then((paths) => {
      if (!paths) return;
      devButton.hidden = false;
      devButton.addEventListener('click', async () => {
        setStatus('Leyendo archivos del juego…');
        const files = await Promise.all(
          paths.map(async (path) => ({ path, blob: await (await fetch(`/__dev_game/${encodeURI(path)}`)).blob() })),
        );
        await openGame(files);
      });
    })
    .catch(() => {});
}

async function openGame(files: InstallFile[]): Promise<void> {
  setStatus('Leyendo archivos del juego…');
  try {
    game = await loadGameFiles(files);
    images = new ImageStore(game.paks, game.manifest);
    baseLevel = parseLevel(game.mainPak.read('levels/_base.dat'));
    const levelCount = game.stages.reduce((n, s) => n + s.levels.length, 0);
    setStatus(
      `Listo: ${levelCount} niveles en ${game.stages.length} etapas` +
        (game.levelPacks.length ? `, ${game.levelPacks.length} pack(s) extra` : '') +
        '.',
      'ok',
    );
    fillLevelSelect(game);
    viewer.hidden = false;
    await showLevel(levelSelect.value);
  } catch (err) {
    console.error(err);
    setStatus(err instanceof GameFilesError ? err.message : `Error leyendo el juego: ${String(err)}`, 'err');
  }
}

function fillLevelSelect(g: GameFiles): void {
  levelSelect.replaceChildren();
  g.stages.forEach((stage, si) => {
    const group = document.createElement('optgroup');
    group.label = stage.name ?? stage.comment ?? `Etapa ${si + 1}`;
    stage.levels.forEach((lvl, li) => {
      const opt = document.createElement('option');
      opt.value = `${si}:${li}`;
      opt.textContent = `${lvl.title} (${lvl.file})`;
      group.append(opt);
    });
    levelSelect.append(group);
  });
}

async function showLevel(value: string): Promise<void> {
  if (!game || !images) return;
  const [si, li] = value.split(':').map(Number);
  const stage = game.stages[si!];
  const entry = stage?.levels[li!];
  if (!stage || !entry) return;

  const token = ++loadToken;
  levelInfo.textContent = 'Cargando…';
  try {
    const level = parseLevel(stage.pak.read(`levels/${entry.file}.dat`));
    const loaded = await loadLevelAssets(images, entry.file, level);
    const baseImages = baseLevel ? await loadEntryImages(images, baseLevel) : new Map();
    const assets = await loadGameAssets(images);
    if (token !== loadToken) return;
    current = loaded;
    view?.destroy();
    const board = new Board(level, baseLevel);
    view = new GameView(canvas, loaded, board, assets, baseImages);
    view.showCollision = showCollision.checked;
    view.onShotEnd = (n) => {
      shotInfo.textContent = `Último tiro: ${n} pegs tocados en ${view?.shotTicks ?? 0} ticks (${((view?.shotTicks ?? 0) / 100).toFixed(2)} s)`;
    };
    shotInfo.textContent = 'Apuntá con el mouse y hacé clic para disparar.';
    if (import.meta.env.DEV) (window as unknown as { __peggle: unknown }).__peggle = { game, images, current, view };
    const pegs = level.entries.filter((e) => e.generic.peg);
    const circles = pegs.filter((e) => e.type === EntryType.Circle).length;
    const bricks = pegs.filter((e) => e.type === EntryType.Brick).length;
    const moving = level.entries.filter((e) => e.generic.movementLink).length;
    levelInfo.textContent = `v${level.version} · ${circles} pegs · ${bricks} ladrillos · ${moving} móviles · ${level.entries.length} objetos`;
  } catch (err) {
    console.error(err);
    levelInfo.textContent = `Error: ${String(err)}`;
  }
}

levelSelect.addEventListener('change', () => void showLevel(levelSelect.value));
showCollision.addEventListener('change', () => {
  if (view) view.showCollision = showCollision.checked;
});
