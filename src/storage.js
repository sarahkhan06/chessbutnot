// Per-browser persistence of a game snapshot, keyed by room and color. Never throws.
const key = (room, color) => `hic:${room}:${color}`;
const store = (s) => s ?? globalThis.localStorage;

export function saveGame(room, color, snapshot, s) {
  try { store(s).setItem(key(room, color), JSON.stringify(snapshot)); } catch { /* storage unavailable */ }
}

export function loadGame(room, color, s) {
  try {
    const raw = store(s).getItem(key(room, color));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearGame(room, color, s) {
  try { store(s).removeItem(key(room, color)); } catch { /* storage unavailable */ }
}

// Chat log for a room, shared by whichever seat this browser holds.
const chatKey = (room) => `hic:${room}:chat`;

export function saveChat(room, log, s) {
  try { store(s).setItem(chatKey(room), JSON.stringify(log)); } catch { /* storage unavailable */ }
}

export function loadChat(room, s) {
  try {
    const v = JSON.parse(store(s).getItem(chatKey(room)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
