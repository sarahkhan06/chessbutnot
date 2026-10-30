import { Chess } from 'chess.js';
import Peer from 'peerjs';

const GLYPH = { p:'♙', n:'♘', b:'♗', r:'♖', q:'♕', k:'♔' };
let game, selected, legal, mirror, lastMove, captured, pending;
let me = null, conn = null, peer = null, ready = true, gone = false;
const view = () => me || game.turn();

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const name = (c) => (c === 'w' ? 'White' : 'Black');

function init() {
  game = new Chess();
  selected = null; legal = []; mirror = false; lastMove = null; pending = false;
  captured = { w: [], b: [] }; // pieces lost by each colour (revealed)
  $('over').classList.add('hidden');
  render();
  $("pass").classList.add("hidden");
}

function showPass() {
  $('pass-title').textContent = `${name(game.turn())} to move`;
  $('pass').classList.remove('hidden');
  pending = true;
}

function render() {
  const turn = view();
  // Board is oriented toward the player to move
  const files = turn === 'w' ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
  const ranks = turn === 'w' ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0]; // index 0 = rank 8 row for white view
  boardEl.innerHTML = '';
  const b = game.board();
  for (let ri = 0; ri < 8; ri++) {
    for (let fi = 0; fi < 8; fi++) {
      const r = ranks[ri], f = files[fi];
      const sqName = 'abcdefgh'[f] + (8 - r);
      const piece = b[r][f];
      const el = document.createElement('div');
      el.className = 'sq' + ((r + f) % 2 ? ' dk' : '');
      if (lastMove && (lastMove.from === sqName || lastMove.to === sqName)) el.classList.add('last');
      if (sqName === selected) el.classList.add('sel');
      if (legal.includes(sqName)) el.classList.add('mv');
      if (piece) {
        const c = document.createElement('div');
        const own = piece.color === turn;
        c.className = 'card ' + (own || (mirror && !me) ? (own ? 'own' : 'rev' + (piece.color === 'b' ? ' b' : '')) : 'foe');
        if (own || (mirror && !me)) c.textContent = GLYPH[piece.type];
        el.appendChild(c);
      }
      el.onclick = () => click(sqName);
      boardEl.appendChild(el);
    }
  }
  const check = game.inCheck() ? ' — check!' : '';
  const t = game.turn();
  $('status').textContent = me
    ? (gone ? 'Opponent disconnected' : !ready ? 'Waiting for your friend to join…' : `You are ${name(me)} — ${t === me ? 'your move' : `waiting for ${name(t)}`}${check}`)
    : `${name(t)} to move${check}`;
  $('undo').style.display = $('mirror').style.display = me ? 'none' : '';
  const fill = (id, color) => {
    const t = $(id); t.innerHTML = '';
    captured[color].forEach((p) => { const s = document.createElement('span'); s.textContent = GLYPH[p]; if (color === 'b') s.className = 'b'; t.appendChild(s); });
  };
  // top = what the opponent has lost, bottom = what I have lost
  fill('cap-top', turn === 'w' ? 'b' : 'w');
  fill('cap-bottom', turn);
}

function click(sq) {
  if (pending || !ready || game.isGameOver()) return;
  if (me && game.turn() !== me) return;
  const piece = game.get(sq);
  if (selected && legal.includes(sq)) return move(selected, sq);
  if (piece && piece.color === game.turn()) {
    selected = sq;
    legal = game.moves({ square: sq, verbose: true }).map((m) => m.to);
  } else { selected = null; legal = []; }
  render();
}

function move(from, to, remote = false) {
  if (me && !remote && conn) conn.send({ t: 'move', from, to });
  const piece = game.get(from);
  const promo = piece.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined;
  const m = game.move({ from, to, promotion: promo });
  if (m.captured) captured[m.color === 'w' ? 'b' : 'w'].push(m.captured);
  lastMove = { from, to };
  selected = null; legal = [];
  if (game.isGameOver()) {
    render();
    let t = 'Draw';
    if (game.isCheckmate()) t = `Checkmate — ${name(m.color)} wins`;
    else if (game.isStalemate()) t = 'Stalemate';
    $('over-title').textContent = t;
    $('over').classList.remove('hidden');
    return;
  }
  render();
  if (!me) showPass();
}

$('pass-btn').onclick = () => { $('pass').classList.add('hidden'); pending = false; render(); };
const restart = () => { if (me && conn) conn.send({ t: 'new' }); init(); };
$('over-btn').onclick = restart;
$('new').onclick = restart;
$('mirror').onclick = () => { mirror = !mirror; render(); };
$('undo').onclick = () => {
  const m = game.undo();
  if (!m) return;
  if (m.captured) captured[m.color === 'w' ? 'b' : 'w'].pop();
  const h = game.history({ verbose: true });
  lastMove = h.length ? h[h.length - 1] : null;
  selected = null; legal = [];
  render(); showPass();
};

// ---- online (peer-to-peer via PeerJS) ----
function wire(c) {
  conn = c;
  c.on('open', () => { ready = true; gone = false; render(); });
  c.on('data', (d) => {
    if (d.t === 'move' && game.turn() !== me) move(d.from, d.to, true);
    else if (d.t === 'new') init();
  });
  c.on('close', () => { gone = true; render(); });
}
function host() {
  const code = Math.random().toString(36).slice(2, 7);
  me = 'w'; ready = false; $('status').textContent = 'Setting up…';
  peer = new Peer('bc-' + code);
  peer.on('open', () => {
    $('link').value = `${location.origin}${location.pathname}?room=${code}`;
    $('invite').classList.remove('hidden');
    $('online').style.display = 'none';
    init();
  });
  peer.on('connection', wire);
  peer.on('error', (e) => { $('status').textContent = 'Connection error: ' + e.type; });
}
function join(code) {
  me = 'b'; ready = false;
  peer = new Peer();
  peer.on('open', () => wire(peer.connect('bc-' + code, { reliable: true })));
  peer.on('error', (e) => { $('status').textContent = 'Could not join: ' + e.type; });
  $('online').style.display = 'none';
}
$('online').onclick = host;
$('copy').onclick = () => { $('link').select(); navigator.clipboard?.writeText($('link').value); $('copy').textContent = 'Copied!'; };

const room = new URLSearchParams(location.search).get('room');
if (room) join(room);
init();
