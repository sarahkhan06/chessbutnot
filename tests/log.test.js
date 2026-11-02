import { describe, it, expect } from 'vitest';
import { createState, startPlay, applyMove, resolveLegal, resolveBluff, revealLost, applyPenalty, resignGame, agreeDraw, offerDraw, declineDraw } from '../src/rules/state.js';
const S = () => startPlay(createState());

describe('full event log', () => {
  it('starts empty and records every public event with public data only', () => {
    expect(createState().log).toEqual([]);
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
    expect(s.log).toEqual([
      { k: 'move', from: 'e2', to: 'e4', pieceId: 'w12', capturedId: null, moverMoved: false, capturedMoved: null },
      { k: 'move', from: 'd7', to: 'd5', pieceId: 'b11', capturedId: null, moverMoved: false, capturedMoved: null },
      { k: 'move', from: 'e4', to: 'd5', pieceId: 'w12', capturedId: 'b11', moverMoved: true, capturedMoved: true },
    ]);
    expect(revealLost(s, 'b11', 'p').log.at(-1)).toEqual({ k: 'captured', id: 'b11', type: 'p', by: 'w12' });
    expect(resolveLegal(s).log.at(-1)).toEqual({ k: 'legal' });
    const bluff = resolveBluff(s, 'p'); expect(bluff.log.at(-1)).toEqual({ k: 'bluff', pieceId: 'w12', type: 'p' });
    expect(applyPenalty(bluff, 'w0', 'r').log.at(-1)).toEqual({ k: 'penalty', id: 'w0', type: 'r' });
  });
  it('is never truncated like history', () => {
    let s = S(); for (const [f, t] of [['e2','e4'],['a7','a6'],['e4','e5'],['a6','a5']]) s = applyMove(s, f, t);
    expect(s.history.length).toBe(2); expect(s.log.length).toBe(4);
  });
});

describe('resign and draw', () => {
  it('resignGame ends the game for the other side and logs it', () => {
    const s = resignGame(S(), 'w');
    expect(s).toMatchObject({ phase: 'over', winner: 'b', reason: 'resigned', pending: null, drawOffer: null });
    expect(s.log.at(-1)).toEqual({ k: 'resign', color: 'w' }); expect(s.version).toBe(2);
  });
  it('agreeDraw ends with no winner', () => {
    const s = agreeDraw(offerDraw(S(), 'w'));
    expect(s).toMatchObject({ phase: 'over', winner: null, reason: 'draw', drawOffer: null }); expect(s.log.at(-1)).toEqual({ k: 'draw' });
  });
  it('offer, decline and any play event clear the offer', () => {
    const o = offerDraw(S(), 'b'); expect(o.drawOffer).toBe('b'); expect(o.version).toBe(2);
    expect(declineDraw(o).drawOffer).toBeNull();
    expect(applyMove(o, 'e2', 'e4').drawOffer).toBeNull();
    const m = applyMove(applyMove(applyMove(S(), 'e2', 'e4'), 'a7', 'a6'), 'e4', 'e6');
    expect(resolveLegal(offerDraw(m, 'w')).drawOffer).toBeNull();
    expect(resolveBluff(offerDraw(m, 'w'), 'p').drawOffer).toBeNull();
    expect(applyPenalty(offerDraw(m, 'w'), 'w0', 'r').drawOffer).toBeNull();
  });
});
