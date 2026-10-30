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
