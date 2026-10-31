import { describe, it, expect } from 'vitest';
import { standardIdentity, swapIdentity, promote, transform, isLastMoveLegal, legalDestinations, occupancyBefore } from '../src/rules/identity.js';
import { createState, startPlay, applyMove } from '../src/rules/state.js';

const S = () => startPlay(createState());

describe('identity', () => {
  it('standardIdentity and swapIdentity', () => {
    const w = standardIdentity('w'); expect(w.w4).toBe('k'); expect(w.w8).toBe('p'); expect(Object.keys(w).length).toBe(16);
    const s = swapIdentity(w, 'w4', 'w8'); expect(s.w4).toBe('p'); expect(s.w8).toBe('k'); expect(w.w4).toBe('k');
  });
  it('promote only pawns on the far rank', () => {
    const w = standardIdentity('w');
    expect(promote(w, 'w8', 'a8', 'w').w8).toBe('q'); expect(promote(w, 'w8', 'a7', 'w').w8).toBe('p'); expect(promote(w, 'w0', 'a8', 'w').w0).toBe('r');
    expect(promote(standardIdentity('b'), 'b8', 'a1', 'b').b8).toBe('q');
  });
  it('transform: pawn takes captured non-pawn identity; queen stays queen (Review Focus 4)', () => {
    const w = standardIdentity('w');
    expect(transform(w, 'w8', 'r').w8).toBe('r'); expect(transform(w, 'w8', 'p').w8).toBe('p'); expect(transform(w, 'w0', 'q').w0).toBe('r');
    expect(transform(promote(w, 'w8', 'a8', 'w'), 'w8', 'r').w8).toBe('q');
  });
  it('occupancyBefore treats from as empty and a captured square as enemy', () => {
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
    const occ = occupancyBefore(s);
    expect(occ('e4')).toBeNull(); expect(occ('d5')).toBe('enemy'); expect(occ('d2')).toBe('own'); expect(occ('e7')).toBe('enemy');
  });
  it('isLastMoveLegal uses the true identity and pre-move occupancy', () => {
    const w = standardIdentity('w');
    expect(isLastMoveLegal(applyMove(S(), 'b1', 'c3'), w)).toBe(true);
    expect(isLastMoveLegal(applyMove(S(), 'a1', 'a3'), w)).toBe(false);
    expect(isLastMoveLegal(applyMove(S(), 'e2', 'e4'), w)).toBe(true);
    expect(isLastMoveLegal(applyMove(S(), 'e2', 'e4'), swapIdentity(w, 'w12', 'w1'))).toBe(false);
  });
  it('isLastMoveLegal treats a captured square as enemy for pawn diagonals', () => {
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
    expect(isLastMoveLegal(s, standardIdentity('w'))).toBe(true);
  });
  it('isLastMoveLegal for black uses black pawn direction and moved flag', () => {
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'e7', 'e5');
    expect(isLastMoveLegal(s, standardIdentity('b'))).toBe(true);
    s = applyMove(s, 'd2', 'd3'); s = applyMove(s, 'e5', 'e3');
    expect(isLastMoveLegal(s, standardIdentity('b'))).toBe(false);
  });
  it('legalDestinations marks bluff squares', () => {
    const d = legalDestinations(S(), standardIdentity('w'), 'b1');
    expect(d.find((x) => x.to === 'c3').legal).toBe(true);
    expect(d.find((x) => x.to === 'b3')).toBeUndefined();
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'a7', 'a6');
    const d2 = legalDestinations(s, standardIdentity('w'), 'e4');
    expect(d2.find((x) => x.to === 'e5').legal).toBe(true); expect(d2.find((x) => x.to === 'e6').legal).toBe(false);
  });
});
