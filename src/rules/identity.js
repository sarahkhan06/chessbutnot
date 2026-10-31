// Private identities: which piece id is really which type. Only the owner's client holds these.
import { patternMoves, destinations, rankOf } from './geometry.js';
import { pieceAt, occupancy } from './state.js';

export const STANDARD = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r', 'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'];

export function standardIdentity(color) {
  const out = {};
  STANDARD.forEach((t, i) => { out[`${color}${i}`] = t; });
  return out;
}

export function swapIdentity(identity, idA, idB) {
  return { ...identity, [idA]: identity[idB], [idB]: identity[idA] };
}

export function promote(identity, id, toSquare, color) {
  const far = color === 'w' ? 8 : 1;
  if (identity[id] === 'p' && rankOf(toSquare) === far) return { ...identity, [id]: 'q' };
  return identity;
}

export function transform(identity, id, capturedType) {
  if (identity[id] === 'p' && capturedType !== 'p') return { ...identity, [id]: capturedType };
  return identity;
}

export function occupancyBefore(state) {
  const { from, to, pieceId, capturedId } = state.lastMove;
  const color = state.pieces[pieceId].color;
  const now = occupancy(state, color);
  return (square) => {
    if (square === from) return null;
    if (square === to) return capturedId ? 'enemy' : null;
    return now(square);
  };
}

export function isLastMoveLegal(state, identity) {
  const { from, to, pieceId, moverMoved } = state.lastMove;
  const color = state.pieces[pieceId].color;
  return patternMoves(identity[pieceId], color, from, occupancyBefore(state), moverMoved).includes(to);
}

export function legalDestinations(state, identity, from) {
  const id = pieceAt(state, from);
  if (!id) return [];
  const p = state.pieces[id];
  const type = identity[id];
  // A piece's first move must be honest; bluffing opens up from its second move on.
  return destinations(p.color, from, occupancy(state, p.color), p.moved)
    .map(({ to, types }) => ({ to, legal: types.includes(type) }))
    .filter((d) => p.moved || d.legal);
}
