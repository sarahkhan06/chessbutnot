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
// Only the replay's own state is trusted: an entry's `moverMoved`, origin and capture are checked
// against it, and `pieces` (the final board, if given) must match where the replay ends up, so a
// forged log cannot vouch for itself. Returns { ok: true } or { ok: false, why, ply } where why is
// 'first-move' | 'verdict' | 'bluff' | 'captured' | 'penalty' | 'log' and ply is the index into `log`.
export function verify(log, setup, color, pieces = null) {
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
        const p = pos[e.pieceId];
        if (!p || p.square !== e.from) return fail('log', ply);
        const occupant = Object.keys(pos).find((id) => pos[id].square === e.to) ?? null;
        if (occupant !== (e.capturedId ?? null) || (occupant && occupant[0] === mover)) return fail('log', ply);
        const occ = occupancyFor(mover);
        const moverMoved = p.moved, capturedMoved = occupant ? pos[occupant].moved : null;
        last = { ...e, moverMoved, capturedMoved, occ, movedAs: theirs(e.pieceId) ? ids[e.pieceId] : null };
        if (theirs(e.pieceId)) {
          if (!moverMoved && !patternMoves(last.movedAs, color, e.from, occ, false).includes(e.to)) return fail('first-move', ply);
          if (last.movedAs === 'p' && rankOf(e.to) === far) ids[e.pieceId] = 'q';
        }
        if (occupant) pos[occupant].square = null;
        pos[e.pieceId] = { square: e.to, moved: true };
        break;
      }
      case 'legal': {
        if (last && theirs(last.pieceId) && !patternMoves(last.movedAs, color, last.from, last.occ, last.moverMoved).includes(last.to)) return fail('verdict', ply);
        break;
      }
      case 'bluff': {
        if (!last || last.pieceId !== e.pieceId) return fail('log', ply);
        if (theirs(e.pieceId) && e.type !== last.movedAs) return fail('bluff', ply);
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
        if (!pos[e.id] || pos[e.id].square === null) return fail('log', ply);
        if (theirs(e.id) && ids[e.id] !== e.type) return fail('penalty', ply);
        pos[e.id].square = null;
        break;
      }
      default: break; // resign, draw
    }
  }
  if (pieces) for (const id in pos) if ((pieces[id]?.square ?? null) !== pos[id].square) return fail('log', log.length);
  return { ok: true };
}
