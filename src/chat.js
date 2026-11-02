// In-game chat: pure helpers. Messages ride the same peer connection as moves.
export const MAX_CHAT = 200;   // entries kept per room
export const MAX_TEXT = 300;   // characters per message

export function chatMessage(text, from, ts = Date.now()) {
  const clean = String(text ?? '').trim().slice(0, MAX_TEXT);
  return clean ? { t: 'chat', text: clean, from, ts } : null;
}

// Valid when it comes from the opponent's seat (never claims to be us). Seats, not colours: colours swap on rematch.
export function isChatMessage(msg, mySeat) {
  return !!msg && typeof msg === 'object' && msg.t === 'chat'
    && typeof msg.text === 'string' && msg.text.trim().length > 0 && msg.text.length <= MAX_TEXT
    && (msg.from === 'host' || msg.from === 'guest') && msg.from !== mySeat
    && typeof msg.ts === 'number';
}

// Logs saved before seats existed carry colours; every such game was generation 0, where host was White.
export const isMine = (m, mySeat) => m.from === mySeat || (m.from === 'w' && mySeat === 'host') || (m.from === 'b' && mySeat === 'guest');

export function appendChat(log, entry) {
  const next = [...log, { text: entry.text, from: entry.from, ts: entry.ts }];
  return next.length > MAX_CHAT ? next.slice(next.length - MAX_CHAT) : next;
}
