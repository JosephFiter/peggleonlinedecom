/**
 * Headless shot simulation for debugging:
 *   node tools/sim-shot.ts <Peggle Nights folder> <Level> <angleDegrees>
 * Angle convention: 0 = right, -90 = straight down (as the game's gun).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PakArchive, parseLevel } from '@peggle/formats';
import { Board, Ball } from '@peggle/sim';

const [dir = process.env.PEGGLE_DIR ?? '', name = 'Bjorn1', deg = '-60'] = process.argv.slice(2);
const pak = PakArchive.open(readFileSync(join(dir, 'main.pak')));
const level = parseLevel(pak.read(`levels/${name}.dat`));
const base = parseLevel(pak.read('levels/_base.dat'));
const board = new Board(level, base);
const angle = (Number(deg) * Math.PI) / 180;
const ball = board.shoot(angle);
console.log(`objects: ${board.objects.length}, start (${ball.x}, ${ball.y}) v=(${ball.vx}, ${ball.vy})`);
const hitPegs = new Set<unknown>();
let bounces = 0;
for (let t = 1; t <= 6000; t++) {
  board.step();
  for (const c of board.contacts) {
    bounces++;
    if (c.obj.hasPeg) hitPegs.add(c.obj);
  }
  if (t % 50 === 0 || board.lostBalls.length) {
    console.log(`t=${t} pos=(${ball.x.toFixed(2)}, ${ball.y.toFixed(2)}) v=(${ball.vx.toFixed(3)}, ${ball.vy.toFixed(3)}) pegsHit=${hitPegs.size}`);
  }
  if (board.lostBalls.length) {
    console.log(`ball lost at tick ${t}; contacts=${bounces}, distinct pegs hit=${hitPegs.size}`);
    break;
  }
}
