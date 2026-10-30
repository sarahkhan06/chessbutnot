// Pure move geometry for every piece type. No notion of identity or state.
export const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];
export const FILES = 'abcdefgh';

export const sq = (file, rank) => (file < 0 || file > 7 || rank < 1 || rank > 8 ? null : FILES[file] + rank);
export const fileOf = (s) => FILES.indexOf(s[0]);
export const rankOf = (s) => Number(s[1]);
export const startRanks = (color) => (color === 'w' ? [1, 2] : [8, 7]);

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

function slide(from, occ, dirs) {
  const out = [];
  const f0 = fileOf(from), r0 = rankOf(from);
  for (const [df, dr] of dirs) {
    for (let i = 1; ; i++) {
      const s = sq(f0 + df * i, r0 + dr * i);
      if (!s) break;
      const o = occ(s);
      if (o === 'own') break;
      out.push(s);
      if (o === 'enemy') break;
    }
  }
  return out;
}

function step(from, occ, deltas) {
  const f0 = fileOf(from), r0 = rankOf(from);
  return deltas.map(([df, dr]) => sq(f0 + df, r0 + dr)).filter((s) => s && occ(s) !== 'own');
}

function pawn(color, from, occ, hasMoved) {
  const dir = color === 'w' ? 1 : -1;
  const f0 = fileOf(from), r0 = rankOf(from);
  const out = [];
  const one = sq(f0, r0 + dir);
  if (one && occ(one) === null) {
    out.push(one);
    const two = sq(f0, r0 + 2 * dir);
    if (!hasMoved && startRanks(color).includes(r0) && two && occ(two) === null) out.push(two);
  }
  for (const df of [-1, 1]) {
    const d = sq(f0 + df, r0 + dir);
    if (d && occ(d) === 'enemy') out.push(d);
  }
  return out;
}

export function patternMoves(type, color, from, occ, hasMoved) {
  switch (type) {
    case 'r': return slide(from, occ, ORTHO);
    case 'b': return slide(from, occ, DIAG);
    case 'q': return slide(from, occ, [...ORTHO, ...DIAG]);
    case 'n': return step(from, occ, KNIGHT);
    case 'k': return step(from, occ, [...ORTHO, ...DIAG]);
    case 'p': return pawn(color, from, occ, hasMoved);
    default: return [];
  }
}

export function destinations(color, from, occ, hasMoved) {
  const byTo = new Map();
  for (const t of TYPES) {
    for (const to of patternMoves(t, color, from, occ, hasMoved)) {
      if (!byTo.has(to)) byTo.set(to, []);
      byTo.get(to).push(t);
    }
  }
  return [...byTo].map(([to, types]) => ({ to, types }));
}
