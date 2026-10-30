import { Chess } from 'chess.js';
import Peer from 'peerjs';

const GLYPH = { p:'♙', n:'♘', b:'♗', r:'♖', q:'♕', k:'♔' };
const STD = ['r','n','b','q','k','b','n','r'];
let game = new Chess();
let selected, legal, mirror, lastMove, captured, pending, phase, arr, stage, setupColor;
let me = null, conn = null, peer = null, ready = true, gone = false;

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const name = (c) => (c === 'w' ? 'White' : 'Black');
const active = () => me || (phase === 'setup' ? setupColor : game.turn());
const fen = () => `${arr.b.join('')}/pppppppp/8/8/8/8/PPPPPPPP/${arr.w.join('').toUpperCase()} w - - 0 1`;
const backRank = (c) => (c === 'w' ? '1' : '8');

function init() {
  arr = { w: [...STD], b: [...STD] };
  stage = { w: 'arranging', b: 'arranging' };
  setupColor = 'w'; phase = 'setup';
  selected = null; legal = []; mirror = false; lastMove = null; pending = false;
  captured = { w: [], b: [] };
  $('over').classList.add('hidden');
  $('pass').classList.add('hidden');
  render();
}

function showPass(title) {
  $('pass-title').textContent = title || `${name(game.turn())} to move`;
  $('pass').classList.remove('hidden');
  pending = true;
}

function render() {
  if (phase === 'setup') game.load(fen());
  const v = active();
  const flip = v === 'b';
  const idx = flip ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  boardEl.innerHTML = '';
  const b = game.board();
  const reveal = mirror && !me && phase === 'play';
  for (let ri = 0; ri < 8; ri++) {
    for (let fi = 0; fi < 8; fi++) {
      const r = idx[ri], f = idx[fi];
      const sqName = 'abcdefgh'[f] + (8 - r);
      const piece = b[r][f];
      const el = document.createElement('div');
      el.className = 'sq' + ((r + f) % 2 ? ' dk' : '');
      if (lastMove && (lastMove.from === sqName || lastMove.to === sqName)) el.classList.add('last');
      if (sqName === selected) el.classList.add('sel');
      if (legal.includes(sqName)) el.classList.add('mv');
      if (phase === 'setup' && stage[v] === 'arranging' && sqName[1] === backRank(v)) el.classList.add('edit');
      if (piece) {
        const c = document.createElement('div');
        const own = piece.color === v;
        c.className = 'card ' + (own ? 'own' : reveal ? 'rev' + (piece.color === 'b' ? ' b' : '') : 'foe');
        if (own || reveal) c.textContent = GLYPH[piece.type];
        el.appendChild(c);
      }
      el.onclick = () => click(sqName);
      boardEl.appendChild(el);
    }
  }
  const setup = phase === 'setup';
  $('setup').classList.toggle('hidden', !setup);
  $('undo').style.display = $('mirror').style.display = me || setup ? 'none' : '';
  const conNote = me && !ready ? (me === 'w' ? 'Waiting for your friend to join… ' : 'Connecting… ') : '';
  if (setup) {
    const s = stage[v];
    $('pill').textContent = s === 'arranging' ? 'Rearranging' : s === 'done' ? 'Locked in' : 'Ready — waiting for opponent…';
    $('done').style.display = s === 'arranging' ? '' : 'none';
    $('ready').style.display = s === 'done' ? '' : 'none';
    $('setup-hint').textContent = s === 'arranging' ? 'Tap two of your back-row pieces to swap them. Pawns stay put.'
      : s === 'done' ? 'Your setup is locked. Ready up when you are.' : 'Game starts when both players are ready.';
    $('status').textContent = conNote + (me ? `You are ${name(v)}` : `${name(v)}'s setup`);
  } else {
    const t = game.turn();
    const check = game.inCheck() ? ' — check!' : '';
    $('status').textContent = me
      ? (gone ? 'Opponent disconnected' : `You are ${name(me)} — ${t === me ? 'your move' : `waiting for ${name(t)}`}${check}`)
      : `${name(t)} to move${check}`;
  }
  const fill = (id, color) => {
    const t = $(id); t.innerHTML = '';
    captured[color].forEach((p) => { const s = document.createElement('span'); s.textContent = GLYPH[p]; if (color === 'b') s.className = 'b'; t.appendChild(s); });
  };
  fill('cap-top', v === 'w' ? 'b' : 'w');
  fill('cap-bottom', v);
}

function click(sq) {
  if (pending) return;
  if (phase === 'setup') return setupClick(sq);
  if (!ready || game.isGameOver()) return;
  if (me && game.turn() !== me) return;
  const piece = game.get(sq);
  if (selected && legal.includes(sq)) return move(selected, sq);
  if (piece && piece.color === game.turn()) {
    selected = sq;
    legal = game.moves({ square: sq, verbose: true }).map((m) => m.to);
  } else { selected = null; legal = []; }
  render();
}

function setupClick(sq) {
  const v = active();
  if (stage[v] !== 'arranging' || sq[1] !== backRank(v)) return;
  if (!selected) selected = sq;
  else if (selected === sq) selected = null;
  else {
    const i = 'abcdefgh'.indexOf(selected[0]), j = 'abcdefgh'.indexOf(sq[0]);
    [arr[v][i], arr[v][j]] = [arr[v][j], arr[v][i]];
    selected = null;
  }
  render();
}

function sendReady() {
  if (me && conn && conn.open) conn.send({ t: 'ready', arr: arr[me] });
}
function tryStart() {
  if (stage.w === 'ready' && stage.b === 'ready') startGame();
}
function startGame() {
  phase = 'play';
  game = new Chess(fen());
  mirror = false; lastMove = null; selected = null; legal = [];
  captured = { w: [], b: [] };
  render();
  if (!me) showPass('White to move');
}

$('done').onclick = () => { const v = active(); stage[v] = 'done'; selected = null; render(); };
$('ready').onclick = () => {
  const v = active();
  stage[v] = 'ready';
  if (me) { sendReady(); render(); tryStart(); }
  else if (v === 'w') { setupColor = 'b'; render(); showPass('Black: rearrange your pieces'); }
  else { tryStart(); }
};

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
const restart = () => { if (me && conn && conn.open) conn.send({ t: 'new' }); init(); };
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
  c.on('open', () => { ready = true; gone = false; if (me && stage[me] === 'ready') sendReady(); render(); });
  c.on('data', (d) => {
    if (d.t === 'move' && phase === 'play' && game.turn() !== me) move(d.from, d.to, true);
    else if (d.t === 'ready' && phase === 'setup' && Array.isArray(d.arr) && [...d.arr].sort().join('') === 'bbknnqrr') {
      const o = me === 'w' ? 'b' : 'w';
      arr[o] = [...d.arr]; stage[o] = 'ready';
      render(); tryStart();
    } else if (d.t === 'new') init();
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
