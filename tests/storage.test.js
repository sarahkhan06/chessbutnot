import { describe, it, expect } from 'vitest';
import { saveGame, loadGame, clearGame } from '../src/storage.js';

describe('storage', () => {
  it('save/load/clear round-trip and survive a broken store', () => {
    const store = new Map();
    const s = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    saveGame('abc', 'w', { x: 1 }, s); expect(loadGame('abc', 'w', s)).toEqual({ x: 1 }); expect(loadGame('abc', 'b', s)).toBeNull();
    expect([...store.keys()]).toEqual(['hic:abc:w']);
    clearGame('abc', 'w', s); expect(loadGame('abc', 'w', s)).toBeNull();
    const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    expect(() => saveGame('a', 'w', {}, broken)).not.toThrow(); expect(loadGame('a', 'w', broken)).toBeNull(); expect(() => clearGame('a', 'w', broken)).not.toThrow();
  });
  it('loadGame returns null for corrupt JSON', () => {
    const s = { getItem: () => '{not json', setItem() {}, removeItem() {} };
    expect(loadGame('abc', 'w', s)).toBeNull();
  });
});
