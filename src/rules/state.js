// Public game state: everything both players are entitled to know. Pure reducers.
import { FILES } from './geometry.js';

const other = (c) => (c === 'w' ? 'b' : 'w');
const clone = (s) => structuredClone(s);
const bump = (s) => { s.version += 1; return s; };

// Previous and current position only: lets a player see what just happened without turning the
// game into a lookup (remembering how pieces moved is the deduction half of the game).
function boardOf(s) {
  const board = {}, faceUp = {};
  for (const id in s.pieces) {
    const p = s.pieces[id];
    if (p.square) board[id] = p.square;
    if (p.faceUp) faceUp[id] = p.faceUp;
  }
  return { board, faceUp };
}
const record = (s, entry) => { s.history = [...s.history, { ...entry, ...boardOf(s) }].slice(-2); return s; };
// Full append-only log of public events: never rendered, used to verify the opponent at game over.
const logEvent = (s, e) => { s.log = [...(s.log || []), e]; return s; };

// Where piece `id` (e.g. 'w12') stands before the first move.
export function startSquare(id) {
  const color = id[0], i = Number(id.slice(1));
  const back = color === 'w' ? 1 : 8, front = color === 'w' ? 2 : 7;
  return FILES[i % 8] + (i < 8 ? back : front);
}

export function createState() {
  const pieces = {};
  for (const color of ['w', 'b']) {
    for (let i = 0; i < 16; i++) {
      pieces[`${color}${i}`] = { color, square: startSquare(`${color}${i}`), faceUp: null, moved: false };
    }
  }
  return {
    phase: 'setup', turn: 'w', version: 0, gen: 0,
    stage: { w: 'arranging', b: 'arranging' },
    pieces, lost: { w: [], b: [] },
    lastMove: null, pending: null, penaltyId: null, picker: null,
    winner: null, reason: null, history: [], log: [], drawOffer: null,
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
export const startPlay = (state) => bump(record({ ...clone(state), phase: 'play', turn: 'w' }, { kind: 'start' }));
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
  s.drawOffer = null;
  logEvent(s, { k: 'move', from, to, pieceId: id, capturedId: targetId, moverMoved: mover.moved, capturedMoved: lastMove.capturedMoved });
  return bump(record(s, { kind: 'move', from, to, capture: !!targetId }));
}

export function acceptLastMove(state) {
  const s = clone(state);
  if (s.lastMove) s.lastMove.challengeable = false;
  return bump(s);
}

function endGame(s, winner, reason) {
  s.phase = 'over'; s.winner = winner; s.reason = reason; s.pending = null; s.penaltyId = null; s.picker = null; s.drawOffer = null;
  return s;
}

export function revealLost(state, id, type) {
  const s = clone(state);
  const color = s.pieces[id].color;
  const entry = s.lost[color].find((e) => e.id === id);
  if (!entry) throw new Error(`${id} is not lost`);
  entry.type = type;
  logEvent(s, { k: 'captured', id, type, by: entry.by });
  if (type === 'k') endGame(s, other(color), 'king-captured');
  return bump(s);
}

// A wrong challenge only proves the move was legal for the piece: its identity stays hidden.
export function resolveLegal(state) {
  const s = clone(state);
  s.lastMove.challengeable = false;
  // Wrong challenge: the mover removes one of the challenger's pieces.
  s.pending = 'penaltyPick'; s.picker = s.pieces[s.lastMove.pieceId].color; s.drawOffer = null;
  logEvent(s, { k: 'legal' });
  return bump(record(s, { kind: 'legal', from: s.lastMove.from, to: s.lastMove.to }));
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
  s.drawOffer = null;
  logEvent(s, { k: 'bluff', pieceId, type });
  if (type === 'k') endGame(s, s.turn, 'king-bluffed');
  else { s.pending = 'penaltyPick'; s.picker = s.turn; }
  return bump(record(s, { kind: 'bluff', type, from: s.lastMove.from, to }));
}

export function applyPenalty(state, id, type) {
  const s = clone(state);
  const color = s.pieces[id].color;
  const square = s.pieces[id].square;
  s.pieces[id].square = null;
  s.lost[color].push({ id, type, by: null });
  s.pending = null; s.penaltyId = null; s.picker = null; s.drawOffer = null;
  logEvent(s, { k: 'penalty', id, type });
  if (type === 'k') endGame(s, other(color), 'king-penalty');
  return bump(record(s, { kind: 'penalty', type, from: null, to: square }));
}

export const resignGame = (state, color) => bump(logEvent(endGame(clone(state), other(color), 'resigned'), { k: 'resign', color }));
export const agreeDraw = (state) => bump(logEvent(endGame(clone(state), null, 'draw'), { k: 'draw' }));
export const offerDraw = (state, color) => bump({ ...clone(state), drawOffer: color });
export const declineDraw = (state) => bump({ ...clone(state), drawOffer: null });
