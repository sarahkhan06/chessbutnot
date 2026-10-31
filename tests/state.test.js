import { describe, it, expect } from 'vitest';
import { createState, startPlay, pieceAt, applyMove, revealLost, resolveLegal, resolveBluff, applyPenalty, acceptLastMove, occupancy } from '../src/rules/state.js';

const capturePos = () => { let s = applyMove(startPlay(createState()), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); return applyMove(s, 'e4', 'd5'); };

describe('state reducers', () => {
  it('createState places 32 pieces with ids on correct squares', () => {
    const s = createState();
    expect(s.pieces.w0.square).toBe('a1'); expect(s.pieces.w8.square).toBe('a2');
    expect(s.pieces.b7.square).toBe('h8'); expect(s.pieces.b15.square).toBe('h7');
    expect(Object.keys(s.pieces).length).toBe(32);
    expect(s.phase).toBe('setup'); expect(s.stage).toEqual({ w: 'arranging', b: 'arranging' });
  });
  it('applyMove moves, flags moved, flips turn, records challengeable lastMove', () => {
    const s = applyMove(createState(), 'e2', 'e4');
    expect(pieceAt(s, 'e4')).toBe('w12'); expect(pieceAt(s, 'e2')).toBeNull();
    expect(s.pieces.w12.moved).toBe(true); expect(s.turn).toBe('b');
    expect(s.lastMove).toMatchObject({ from: 'e2', to: 'e4', pieceId: 'w12', capturedId: null, challengeable: true, moverMoved: false });
    expect(s.pending).toBeNull();
  });
  it('applyMove onto enemy records a pending capture', () => {
    const s = capturePos();
    expect(s.lost.b).toEqual([{ id: 'b11', type: null, by: 'w12' }]); expect(s.pieces.b11.square).toBeNull();
    expect(s.lastMove.capturedId).toBe('b11'); expect(s.lastMove.capturedMoved).toBe(true);
  });
  it('applyMove rejects moving the wrong color or onto own piece or from empty', () => {
    expect(() => applyMove(createState(), 'e7', 'e5')).toThrow();
    expect(() => applyMove(createState(), 'a1', 'a2')).toThrow();
    expect(() => applyMove(createState(), 'e4', 'e5')).toThrow();
  });
  it('occupancy reports own/enemy/null from a color perspective', () => {
    const occ = occupancy(createState(), 'w');
    expect(occ('a1')).toBe('own'); expect(occ('a8')).toBe('enemy'); expect(occ('a4')).toBeNull();
  });
  it('acceptLastMove ends challengeability', () => {
    expect(acceptLastMove(applyMove(createState(), 'e2', 'e4')).lastMove.challengeable).toBe(false);
  });
  it('revealLost sets the type; king ends the game for the captor', () => {
    const s = revealLost(capturePos(), 'b11', 'k');
    expect(s.lost.b[0].type).toBe('k'); expect(s.phase).toBe('over'); expect(s.winner).toBe('w'); expect(s.reason).toBe('king-captured');
    expect(revealLost(capturePos(), 'b11', 'p').phase).toBe('play');
  });
  it('resolveLegal keeps the piece hidden and ends challengeability', () => {
    const s = resolveLegal(applyMove(createState(), 'b1', 'c3'));
    expect(s.pieces.w1.faceUp).toBeNull(); expect(s.lastMove.challengeable).toBe(false);
  });
  it('resolveBluff removes the bluffer, restores a captured piece hidden, enters penaltyPick', () => {
    const s = resolveBluff(capturePos(), 'n');
    expect(s.pieces.w12.square).toBeNull(); expect(s.lost.w).toEqual([{ id: 'w12', type: 'n', by: null }]);
    expect(s.pieces.b11.square).toBe('d5'); expect(s.pieces.b11.moved).toBe(true); expect(s.lost.b).toEqual([]);
    expect(s.pending).toBe('penaltyPick'); expect(s.turn).toBe('b'); expect(s.lastMove.challengeable).toBe(false);
  });
  it('resolveBluff on a king wins immediately with no penalty pick', () => {
    const s = resolveBluff(applyMove(createState(), 'e1', 'e3'), 'k');
    expect(s.phase).toBe('over'); expect(s.winner).toBe('b'); expect(s.reason).toBe('king-bluffed'); expect(s.pending).toBeNull();
  });
  it('applyPenalty removes and reveals; king ends the game', () => {
    const s = resolveBluff(applyMove(startPlay(createState()), 'e2', 'e5'), 'p');
    const s2 = applyPenalty(s, 'w0', 'r');
    expect(s2.pieces.w0.square).toBeNull(); expect(s2.lost.w).toContainEqual({ id: 'w0', type: 'r', by: null }); expect(s2.pending).toBeNull(); expect(s2.phase).toBe('play');
    const s3 = applyPenalty(s, 'w4', 'k'); expect(s3.winner).toBe('b'); expect(s3.reason).toBe('king-penalty');
  });
  it('reducers never mutate and bump version', () => {
    const a = createState(); const b = applyMove(a, 'e2', 'e4');
    expect(a.pieces.w12.square).toBe('e2'); expect(a.turn).toBe('w'); expect(b.version).toBe(a.version + 1);
  });
});
