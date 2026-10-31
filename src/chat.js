// In-game chat: pure helpers. Messages ride the same peer connection as moves.
export const MAX_CHAT = 200;   // entries kept per room
export const MAX_TEXT = 300;   // characters per message

export function chatMessage(text, from, ts = Date.now()) {
  const clean = String(text ?? '').trim().slice(0, MAX_TEXT);
  return clean ? { t: 'chat', text: clean, from, ts } : null;
}

// Valid when it comes from the opponent (never claims to be us).
export function isChatMessage(msg, me) {
  return !!msg && typeof msg === 'object' && msg.t === 'chat'
    && typeof msg.text === 'string' && msg.text.trim().length > 0 && msg.text.length <= MAX_TEXT
    && (msg.from === 'w' || msg.from === 'b') && msg.from !== me
    && typeof msg.ts === 'number';
}

export function appendChat(log, entry) {
  const next = [...log, { text: entry.text, from: entry.from, ts: entry.ts }];
  return next.length > MAX_CHAT ? next.slice(next.length - MAX_CHAT) : next;
}
