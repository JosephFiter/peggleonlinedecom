/**
 * Parser for the level lists in levels/stages.cfg and level pack .cfg files.
 *
 *   Stage
 *   {
 *     Name: "Spring Fever: Day 1"          (optional, level packs)
 *     Level: Bjorn1, "Crimewave", 300000   (file, title, ace score[, extra])
 *   }
 */

export interface StageLevel {
  /** Level file name without extension, e.g. Bjorn1. */
  file: string;
  title: string;
  aceScore: number;
  extra?: number;
}

export interface Stage {
  name?: string;
  /** The comment line right above the stage, e.g. "1. Guide". */
  comment?: string;
  levels: StageLevel[];
}

export function parseStages(text: string): Stage[] {
  const stages: Stage[] = [];
  let current: Stage | null = null;
  let lastComment: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('//')) {
      const c = line.replace(/^\/+/, '').trim();
      if (c) lastComment = c;
      continue;
    }
    if (/^Stage\b/.test(line)) {
      current = { levels: [] };
      if (lastComment) current.comment = lastComment;
      stages.push(current);
      continue;
    }
    if (line === '}') {
      current = null;
      lastComment = undefined;
      continue;
    }
    if (!current) {
      // Only level definitions live outside challenge pages; stop at the first non-stage block.
      if (/^(Page|Trophy)\b/.test(line)) break;
      continue;
    }
    const name = /^Name:\s*"([^"]*)"/.exec(line);
    if (name) {
      current.name = name[1]!;
      continue;
    }
    const lvl = /^Level:\s*([^,]+?)\s*,\s*"([^"]*)"\s*,\s*(\d+)(?:\s*,\s*(-?\d+))?/.exec(line);
    if (lvl) {
      const level: StageLevel = { file: lvl[1]!, title: lvl[2]!, aceScore: Number(lvl[3]) };
      if (lvl[4] !== undefined) level.extra = Number(lvl[4]);
      current.levels.push(level);
    }
  }
  return stages.filter((s) => s.levels.length > 0);
}
