import { Game, seatOf } from './game.js';
import { connect } from './net.js';
import { saveGame, loadGame, clearGame, saveChat, loadChat } from './storage.js';
import { chatMessage, isChatMessage, appendChat, isMine } from './chat.js';
import { render, name } from './render.js';
import { pieceAt } from './rules/state.js';

const $ = (id) => document.getElementById(id);

let game, net = null, room = null, seat = null, confirmTimer = null; // seat: 'host' | 'guest' | null (hot-seat)
const online = () => seat !== null;
const ui = { selected: null, dests: [], connection: null, confirm: null, showBluffHint: false, passing: false, viewPly: null, showStart: false, overSeen: false };
let chat = [];

// ---- rendering and persistence ----
function draw() { render(game, ui, click); }
function onChange() {
  ui.viewPly = null; // any new event snaps the view back to live
  // When a game ends, open on the starting arrangements; the toggle flips back to the final position.
  if (game.pub.phase === 'over') { if (!ui.overSeen) { ui.overSeen = true; ui.showStart = true; } }
  else { ui.overSeen = false; ui.showStart = false; }
  if (room && seat) saveGame(room, seat, game.snapshot());
  draw();
}
function clearSelection() { ui.selected = null; ui.dests = []; }

// ---- hot-seat hand-over ----
function showPass(title) {
  $('pass-title').textContent = title || `${name(game.pub.turn)} to move`;
  $('pass').classList.remove('hidden');
  ui.passing = true;
}
$('pass-btn').onclick = () => { $('pass').classList.add('hidden'); ui.passing = false; draw(); };

// ---- board clicks ----
function click(sq) {
  if (ui.passing || game.lostState) return;
  if (ui.viewPly !== null) { ui.viewPly = null; clearSelection(); return draw(); }
  const pub = game.pub, v = game.viewer();
  const id = pieceAt(pub, sq);
  const own = id && pub.pieces[id].color === v;

  if (pub.phase === 'setup') {
    if (pub.stage[v] !== 'arranging' || !own) { clearSelection(); return draw(); }
    if (!ui.selected) ui.selected = sq;
    else if (ui.selected === sq) ui.selected = null;
    else { const a = ui.selected; ui.selected = null; game.swap(v, a, sq); }
    return draw();
  }
  if (pub.phase !== 'play') return;

  if (pub.pending === 'penaltyPick') {
    if (pub.picker === v && id && !own) {
      game.pickPenalty(id);
      if (!online() && game.pub.phase === 'play' && game.pub.turn !== v) showPass();
    }
    return;
  }
  if (pub.pending) return;

  if (ui.selected && ui.dests.some((d) => d.to === sq)) {
    const from = ui.selected;
    clearSelection();
    ui.confirm = null;
    game.move(from, sq);
    if (!online() && game.pub.phase === 'play') showPass();
    return;
  }
  if (own && pub.turn === v) {
    ui.selected = sq;
    ui.dests = game.destinations(sq);
    if (ui.dests.some((d) => !d.legal)) hintBluffOnce();
  } else clearSelection();
  draw();
}

function hintBluffOnce() {
  try {
    if (localStorage.getItem('hic:hintBluff')) return;
    localStorage.setItem('hic:hintBluff', '1');
  } catch { /* ignore */ }
  ui.showBluffHint = true;
  setTimeout(() => { ui.showBluffHint = false; draw(); }, 8000);
}

// ---- setup buttons ----
$('done').onclick = () => { clearSelection(); game.lockIn(game.viewer()); };
// Hot-seat: after a side readies up, hand the screen over (or start White's first turn).
function afterReady(v) {
  if (!online()) {
    if (game.pub.phase === 'play') showPass('White to move');
    else if (v === 'w') showPass('Black: arrange your pieces');
  }
}
$('ready').onclick = () => { const v = game.viewer(); game.readyUp(v); afterReady(v); };
$('skip').onclick = () => { clearSelection(); const v = game.viewer(); game.useStandard(v); afterReady(v); };

// ---- challenge (two taps) ----
$('challenge').onclick = () => {
  clearTimeout(confirmTimer);
  if (ui.confirm !== 'challenge') {
    ui.confirm = 'challenge';
    draw();
    confirmTimer = setTimeout(() => { ui.confirm = null; draw(); }, 4000);
    return;
  }
  ui.confirm = null;
  clearSelection();
  const challenger = game.viewer();
  game.challenge();
  // Hot-seat: a wrong challenge hands the screen to the mover to pick a penalty.
  if (!online() && game.pub.pending === 'penaltyPick' && game.pub.picker !== challenger) showPass(`${name(game.pub.picker)}: your move was honest — pick a penalty`);
};

// ---- previous position toggle ----
function togglePrevious() {
  const h = game.pub.history;
  if (h.length < 2) return;
  ui.viewPly = ui.viewPly === null ? h.length - 2 : null;
  clearSelection();
  draw();
}
$('rw-prev').onclick = togglePrevious;
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || $('replay').classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft' && ui.viewPly === null) togglePrevious();
  else if (e.key === 'ArrowRight' && ui.viewPly !== null) togglePrevious();
});

// ---- misc buttons ----
const restart = () => {
  clearSelection(); ui.confirm = null;
  if (room && seat) clearGame(room, seat);
  game.newGame();
};
$('new').onclick = restart;
$('over-toggle').onclick = () => { ui.showStart = !ui.showStart; draw(); };
$('over-btn').onclick = restart;
$('copy').onclick = () => { $('link').select(); navigator.clipboard?.writeText($('link').value); $('copy').textContent = 'Copied!'; };

// ---- chat (online only) ----
function drawChat() {
  const log = $('chat-log');
  log.innerHTML = '';
  for (const m of chat) {
    const el = document.createElement('div');
    el.className = 'msg ' + (isMine(m, seat) ? 'me' : 'them');
    el.textContent = m.text;
    el.title = new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    log.appendChild(el);
  }
  log.scrollTop = log.scrollHeight;
}
function addChat(m) { chat = appendChat(chat, m); if (room) saveChat(room, chat); drawChat(); }
$('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const m = chatMessage($('chat-input').value, seat);
  if (!m || !online()) return;
  $('chat-input').value = '';
  send(m);
  addChat(m);
};

// ---- online ----
const send = (m) => { net?.send(m); };
function onStatus(status, detail) { ui.connection = { status, detail }; draw(); }
function onOpen() { send(game.helloMessage()); }
function resendOutstanding() { const o = game.outstanding(); if (o) send(o); }
function onMessage(m) {
  if (m.t === 'hello') { const sync = game.onHello(m); if (sync) send(sync); resendOutstanding(); game.shareSetup(true); }
  else if (m.t === 'sync') { game.syncFrom(m.pub); resendOutstanding(); game.shareSetup(true); }
  else if (m.t === 'chat') { if (isChatMessage(m, seat)) addChat(m); }
  else game.receive(m);
}

const SEATS = ['host', 'guest'], LEGACY = ['w', 'b'];
function goOnline(s, code, snapshot) {
  room = code; seat = s;
  try {
    game = snapshot ? Game.restore(snapshot, { send, onChange }) : new Game({ seat, send, onChange });
  } catch {
    for (const k of [...SEATS, ...LEGACY]) clearGame(code, k);
    game = new Game({ seat, send, onChange });
  }
  history.replaceState(null, '', `${location.pathname}?room=${code}`);
  chat = loadChat(code); $('chat').classList.remove('hidden'); drawChat();
  if (seat === 'host') {
    $('link').value = `${location.origin}${location.pathname}?room=${code}`;
    $('invite').classList.remove('hidden');
  }
  net = connect({ room: code, host: seat === 'host', onMessage, onStatus, onOpen });
  window.__hic = { get game() { return game; }, get net() { return net; } };
  onChange();
}

$('online').onclick = () => goOnline('host', Math.random().toString(36).slice(2, 7));

// ---- boot ----
const code = new URLSearchParams(location.search).get('room');
if (code) {
  // Saves are keyed by seat; older builds keyed them by colour, so read those too and retire them.
  const candidates = [...SEATS, ...LEGACY].map((k) => loadGame(code, k)).filter(Game.isSnapshot);
  // Prefer the most advanced save if this browser somehow holds both seats.
  const saved = candidates.sort((a, b) => (b.pub.gen - a.pub.gen) || (b.pub.version - a.pub.version))[0];
  for (const k of LEGACY) clearGame(code, k);
  if (!saved) for (const k of SEATS) clearGame(code, k);
  if (saved) goOnline(seatOf(saved), code, saved);
  else goOnline('guest', code);
} else {
  game = new Game({ onChange });
  draw();
}
