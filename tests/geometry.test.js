import { describe, it, expect } from 'vitest';
import { patternMoves, destinations } from '../src/rules/geometry.js';

const occFrom = (map) => (s) => map[s] ?? null;

describe('patternMoves', () => {
  it('rook slides and stops at first blocker, including enemy', () => {
    const occ = occFrom({ a4: 'enemy', e1: 'own' });
    expect(patternMoves('r', 'w', 'a1', occ, true).sort()).toEqual(['a2', 'a3', 'a4', 'b1', 'c1', 'd1'].sort());
  });
  it('bishop, queen, knight, king patterns from d4 on empty board', () => {
    const occ = () => null;
    expect(patternMoves('n', 'w', 'd4', occ, true).length).toBe(8);
    expect(patternMoves('k', 'w', 'd4', occ, true).length).toBe(8);
    expect(patternMoves('b', 'w', 'd4', occ, true).length).toBe(13);
    expect(patternMoves('q', 'w', 'd4', occ, true).length).toBe(27);
  });
  it('white pawn on rank 2 double-steps if unmoved', () => {
    expect(patternMoves('p', 'w', 'e2', () => null, false).sort()).toEqual(['e3', 'e4']);
  });
  it('black pawn on rank 7 double-steps toward rank 5', () => {
    expect(patternMoves('p', 'b', 'e7', () => null, false).sort()).toEqual(['e5', 'e6']);
  });
  it('pawn double step blocked by a piece on either square (Review Focus 3)', () => {
    expect(patternMoves('p', 'w', 'e2', occFrom({ e3: 'own' }), false)).toEqual([]);
    expect(patternMoves('p', 'w', 'e2', occFrom({ e4: 'enemy' }), false)).toEqual(['e3']);
  });
  it('pawn captures diagonally only onto enemy, never forward onto a piece', () => {
    const occ = occFrom({ d5: 'enemy', f5: 'own', e5: 'enemy' });
    expect(patternMoves('p', 'w', 'e4', occ, true)).toEqual(['d5']);
  });
  it('moved pawn or pawn off start ranks has no double step', () => {
    expect(patternMoves('p', 'w', 'e3', () => null, false)).toEqual(['e4']);
    expect(patternMoves('p', 'w', 'e2', () => null, true)).toEqual(['e3']);
  });
});

describe('destinations', () => {
  it('unions all types and labels each square', () => {
    const d = destinations('w', 'e1', () => null, false);
    const at = (s) => d.find((x) => x.to === s)?.types;
    expect(at('e2')).toEqual(['k', 'q', 'r', 'p']);
    expect(at('e3')).toEqual(['q', 'r']);
    expect(at('f3')).toEqual(['n']);
    expect(at('h4')).toEqual(['q', 'b']);
  });
  it('never includes own-occupied squares', () => {
    const occ = occFrom({ e2: 'own', d2: 'own', f2: 'own', d1: 'own', f1: 'own' });
    expect(destinations('w', 'e1', occ, false).map((x) => x.to).sort()).toEqual(['c2', 'd3', 'f3', 'g2']);
  });
});
