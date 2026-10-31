import { describe, it, expect } from 'vitest';
import { chatMessage, isChatMessage, appendChat, MAX_CHAT, MAX_TEXT } from '../src/chat.js';
import { saveChat, loadChat } from '../src/storage.js';

describe('chat', () => {
  it('chatMessage trims, caps length, and rejects empty text', () => {
    expect(chatMessage('  hi  ', 'w', 5)).toEqual({ t: 'chat', text: 'hi', from: 'w', ts: 5 });
    expect(chatMessage('   ', 'w', 5)).toBeNull();
    expect(chatMessage('x'.repeat(MAX_TEXT + 50), 'b', 1).text.length).toBe(MAX_TEXT);
  });
  it('isChatMessage validates shape and sender', () => {
    expect(isChatMessage({ t: 'chat', text: 'yo', from: 'w', ts: 1 }, 'b')).toBe(true);
    expect(isChatMessage({ t: 'chat', text: 'yo', from: 'b', ts: 1 }, 'b')).toBe(false); // claims to be me
    expect(isChatMessage({ t: 'chat', text: '', from: 'b', ts: 1 }, 'b')).toBe(false);
    expect(isChatMessage({ t: 'chat', text: 'x'.repeat(MAX_TEXT + 1), from: 'b', ts: 1 }, 'b')).toBe(false);
    expect(isChatMessage({ t: 'move', text: 'yo', from: 'b', ts: 1 }, 'b')).toBe(false);
    expect(isChatMessage(null, 'b')).toBe(false);
  });
  it('appendChat keeps only the newest MAX_CHAT entries and never mutates', () => {
    const log = [];
    const one = appendChat(log, { text: 'a', from: 'w', ts: 1 });
    expect(log).toEqual([]); expect(one).toEqual([{ text: 'a', from: 'w', ts: 1 }]);
    let big = [];
    for (let i = 0; i < MAX_CHAT + 3; i++) big = appendChat(big, { text: String(i), from: 'w', ts: i });
    expect(big.length).toBe(MAX_CHAT); expect(big[0].text).toBe('3');
  });
  it('saveChat/loadChat round-trip per room and tolerate a broken store', () => {
    const m = new Map();
    const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
    saveChat('r1', [{ text: 'a', from: 'w', ts: 1 }], s);
    expect(loadChat('r1', s)).toEqual([{ text: 'a', from: 'w', ts: 1 }]); expect(loadChat('r2', s)).toEqual([]);
    expect([...m.keys()]).toEqual(['hic:r1:chat']);
    const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    expect(() => saveChat('r', [], broken)).not.toThrow(); expect(loadChat('r', broken)).toEqual([]);
    expect(loadChat('r3', { getItem: () => '{"not":"array"}' })).toEqual([]);
  });
});
