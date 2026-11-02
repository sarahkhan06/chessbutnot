// Setup commitment and end-of-game verification of the opponent's claims.
import { sha256 } from './hash.js';

// The sixteen types in piece-index order, e.g. 'rnbqkbnrpppppppp'.
export const idsString = (ids, color) => Array.from({ length: 16 }, (_, i) => ids[`${color}${i}`]).join('');

// What a player publishes when readying up: binds them to an arrangement without revealing it.
export const commitment = (color, ids, salt) => sha256(`${color}|${idsString(ids, color)}|${salt}`);
