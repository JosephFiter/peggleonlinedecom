/**
 * Robustness check: shoots many angles on every level and reports ticks where
 * the ball centre ends up inside a closed polygon/brick or a round peg.
 *   node tools/tests/penetration-check.ts "<Peggle Nights folder>"
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PakArchive, parseLevel } from '@peggle/formats';
import { Ball, Board, Poly } from '@peggle/sim';

const dir = process.argv[2] ?? process.env.PEGGLE_DIR ?? '';
const paks = [PakArchive.open(readFileSync(join(dir, 'main.pak'))), ...readdirSync(join(dir, 'levelpacks')).map((f) => PakArchive.open(readFileSync(join(dir, 'levelpacks', f))))];
const base = parseLevel(paks[0]!.read('levels/_base.dat'));

function insidePoly(p: Poly, x: number, y: number): boolean {
  let c = false;
  for (const l of p.lines) if ((l.ay > y) !== (l.by > y) && x < ((l.bx - l.ax) * (y - l.ay)) / (l.by - l.ay) + l.ax) c = !c;
  return c;
}

let shots = 0;
let bad = 0;
const badLevels = new Map<string, number>();
for (const pak of paks) {
  for (const e of pak.entries.filter((e) => e.key.startsWith('levels/') && e.key.endsWith('.dat') && !e.key.includes('_base'))) {
    const level = parseLevel(pak.read(e.name));
    for (let deg = -170; deg <= -10; deg += 10) {
      const board = new Board(level, base);
      const ball = board.shoot((deg * Math.PI) / 180);
      shots++;
      for (let t = 0; t < 1500 && board.balls.length; t++) {
        board.step();
        let inside = false;
        for (const o of board.objects) {
          if (!o.collision || o === ball) continue;
          if (o instanceof Poly && o.closed) {
            o.refreshLines();
            if (o.x0 <= ball.x && ball.x <= o.x1 && o.y0 <= ball.y && ball.y <= o.y1 && insidePoly(o, ball.x, ball.y)) inside = true;
          } else if (o instanceof Ball && o.isStatic) {
            const dx = ball.x - o.x;
            const dy = ball.y - o.y;
            if (dx * dx + dy * dy < (o.radius - 0.5) ** 2) inside = true;
          }
          if (inside) {
            if (process.env.VERBOSE) {
              const src = o.source as { data?: { kind?: string }; generic?: { id?: string } } | null;
              console.log(`${e.name} deg=${deg} t=${t}: inside ${src?.data?.kind ?? o.id} id=${src?.generic?.id ?? ''} type=${o.type} ball=(${ball.x.toFixed(2)},${ball.y.toFixed(2)}) v=(${ball.vx.toFixed(2)},${ball.vy.toFixed(2)}) mover=${!!o.mover} convex=${(o as Poly).convex}`);
            }
            break;
          }
        }
        if (inside) {
          bad++;
          badLevels.set(e.name, (badLevels.get(e.name) ?? 0) + 1);
          break;
        }
      }
    }
  }
}
console.log(`shots: ${shots}, shots with ball inside a solid: ${bad}`);
for (const [k, v] of [...badLevels].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k}: ${v}`);
