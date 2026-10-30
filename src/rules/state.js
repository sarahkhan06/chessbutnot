// Public game state: everything both players are entitled to know. Pure reducers.
import { FILES } from './geometry.js';

const other = (c) => (c === 'w' ? 'b' : 'w');
const clone = (s) => structuredClone(s);
const bump = (s) => { s.version += 1; return s; };

export function createState() {
  const pieces = {};
  for (const color of ['w', 'b']) {
    const back = color === 'w' ? 1 : 8, front = color === 'w' ? 2 : 7;
    for (let i = 0; i < 16; i++) {
      pieces[`${color}${i}`] = { color, square: FILES[i % 8] + (i < 8 ? back : front), faceUp: null, moved: false };
    }
  }
  return {
    phase: 'setup', turn: 'w', version: 0, gen: 0,
    stage: { w: 'arranging', b: 'arranging' },
    pieces, lost: { w: [], b: [] },
    lastMove: null, pending: null, penaltyId: null,
    winner: null, reason: null,
  };
}

export function pieceAt(state, square) {
  for (const id in state.pieces) if (state.pieces[id].square === square) return id;
  return null;
}

export function occupancy(state, color) {
  return (square) => {
    const id = pieceAt(state, square);
    return id ? (state.pieces[id].color === color ? 'own' : 'enemy') : null;
  };
}

export const setStage = (state, color, stage) => bump({ ...clone(state), stage: { ...state.stage, [color]: stage } });
export const startPlay = (state) => bump({ ...clone(state), phase: 'play', turn: 'w' });
// Local bookkeeping only: deliberately does not bump `version`, so a side waiting on a reply
// is never "newer" than the side that already answered it.
export const setPending = (state, pending, penaltyId = null) => ({ ...clone(state), pending, penaltyId });

export function applyMove(state, from, to) {
  const id = pieceAt(state, from);
  if (!id) throw new Error(`no piece at ${from}`);
  const mover = state.pieces[id];
  if (mover.color !== state.turn) throw new Error(`not ${mover.color}'s turn`);
  const targetId = pieceAt(state, to);
  if (targetId && state.pieces[targetId].color === mover.color) throw new Error('cannot capture own piece');
  const s = clone(state);
  const lastMove = { from, to, pieceId: id, capturedId: targetId, challengeable: true, moverMoved: mover.moved, capturedMoved: targetId ? state.pieces[targetId].moved : null };
  if (targetId) {
    s.pieces[targetId].square = null;
    s.lost[s.pieces[targetId].color].push({ id: targetId, type: null, by: id });
  }
  s.pieces[id].square = to;
  s.pieces[id].moved = true;
  s.lastMove = lastMove;
  s.turn = other(state.turn);
  return bump(s);
}

export function acceptLastMove(state) {
  const s = clone(state);
  if (s.lastMove) s.lastMove.challengeable = false;
  return bump(s);
}

function endGame(s, winner, reason) {
  s.phase = 'over'; s.winner = winner; s.reason = reason; s.pending = null; s.penaltyId = null;
  return s;
}

export function revealLost(state, id, type) {
  const s = clone(state);
  const color = s.pieces[id].color;
  const entry = s.lost[color].find((e) => e.id === id);
  if (!entry) throw new Error(`${id} is not lost`);
  entry.type = type;
  if (type === 'k') endGame(s, other(color), 'king-captured');
  return bump(s);
}

export function resolveLegal(state, type) {
  const s = clone(state);
  s.pieces[s.lastMove.pieceId].faceUp = type;
  s.lastMove.challengeable = false;
  return bump(s);
}

export function resolveBluff(state, type) {
  const s = clone(state);
  const { pieceId, capturedId, to, capturedMoved } = s.lastMove;
  const color = s.pieces[pieceId].color;
  s.pieces[pieceId].square = null;
  s.lost[color].push({ id: pieceId, type, by: null });
  if (capturedId) {
    s.pieces[capturedId].square = to;
    s.pieces[capturedId].moved = capturedMoved;
    s.lost[other(color)] = s.lost[other(color)].filter((e) => e.id !== capturedId);
  }
  s.lastMove.challengeable = false;
  if (type === 'k') endGame(s, s.turn, 'king-bluffed');
  else s.pending = 'penaltyPick';
  return bump(s);
}

export function applyPenalty(state, id, type) {
  const s = clone(state);
  const color = s.pieces[id].color;
  s.pieces[id].square = null;
  s.lost[color].push({ id, type, by: null });
  s.pending = null; s.penaltyId = null;
  if (type === 'k') endGame(s, other(color), 'king-penalty');
  return bump(s);
}
