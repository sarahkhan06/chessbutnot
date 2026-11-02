// Setup commitment and end-of-game verification of the opponent's claims.
import { sha256 } from './hash.js';
import { patternMoves, rankOf } from './geometry.js';
import { startSquare } from './state.js';

// The sixteen types in piece-index order, e.g. 'rnbqkbnrpppppppp'.
export const idsString = (ids, color) => Array.from({ length: 16 }, (_, i) => ids[`${color}${i}`]).join('');

// What a player publishes when readying up: binds them to an arrangement without revealing it.
export const commitment = (color, ids, salt) => sha256(`${color}|${idsString(ids, color)}|${salt}`);

// Replay the public log with the opponent's revealed identities and check every claim they made.
// `setup` maps the opponent's piece ids to types as arranged before move one; `color` is theirs.
// Returns { ok: true } or { ok: false, why, ply } where why is one of
// 'first-move' | 'verdict' | 'bluff' | 'captured' | 'penalty' and ply is the index into `log`.
export function verify(log, setup, color) {
  const pos = {};
  for (const c of ['w', 'b']) for (let i = 0; i < 16; i++) { const id = `${c}${i}`; pos[id] = { square: startSquare(id), moved: false }; }
  const ids = { ...setup };
  const theirs = (id) => id && id[0] === color;
  const far = color === 'w' ? 8 : 1;
  const occupancyFor = (mover) => {
    const snapshot = {};
    for (const id in pos) if (pos[id].square) snapshot[pos[id].square] = id;
    return (sq) => { const id = snapshot[sq]; return id ? (id[0] === mover ? 'own' : 'enemy') : null; };
  };
  let last = null;
  const fail = (why, ply) => ({ ok: false, why, ply });

  for (let ply = 0; ply < log.length; ply++) {
    const e = log[ply];
    switch (e.k) {
      case 'move': {
        const mover = e.pieceId[0];
        const occ = occupancyFor(mover);
        last = { ...e, occ, movedAs: theirs(e.pieceId) ? ids[e.pieceId] : null };
        if (theirs(e.pieceId)) {
          if (!e.moverMoved && !patternMoves(last.movedAs, color, e.from, occ, false).includes(e.to)) return fail('first-move', ply);
          if (last.movedAs === 'p' && rankOf(e.to) === far) ids[e.pieceId] = 'q';
        }
        if (e.capturedId) pos[e.capturedId].square = null;
        pos[e.pieceId] = { square: e.to, moved: true };
        break;
      }
      case 'legal': {
        if (last && theirs(last.pieceId) && !patternMoves(last.movedAs, color, last.from, last.occ, last.moverMoved).includes(last.to)) return fail('verdict', ply);
        break;
      }
      case 'bluff': {
        if (theirs(e.pieceId) && last && e.type !== last.movedAs) return fail('bluff', ply);
        pos[e.pieceId].square = null;
        if (last?.capturedId) pos[last.capturedId] = { square: last.to, moved: !!last.capturedMoved };
        break;
      }
      case 'captured': {
        if (theirs(e.id) && ids[e.id] !== e.type) return fail('captured', ply);
        if (theirs(e.by) && ids[e.by] === 'p' && e.type !== 'p') ids[e.by] = e.type;
        break;
      }
      case 'penalty': {
        if (theirs(e.id) && ids[e.id] !== e.type) return fail('penalty', ply);
        pos[e.id].square = null;
        break;
      }
      default: break; // resign, draw
    }
  }
  return { ok: true };
}
