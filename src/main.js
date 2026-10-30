import { Chess } from 'chess.js';

const GLYPH = { p:'♙', n:'♘', b:'♗', r:'♖', q:'♕', k:'♔' };
let game, selected, legal, mirror, lastMove, captured, pending;

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const name = (c) => (c === 'w' ? 'White' : 'Black');

function init() {
  game = new Chess();
  selected = null; legal = []; mirror = false; lastMove = null; pending = false;
  captured = { w: [], b: [] }; // pieces lost by each colour (revealed)
  $('over').classList.add('hidden');
  render();
  showPass();
}

function showPass() {
  $('pass-title').textContent = `${name(game.turn())} to move`;
  $('pass').classList.remove('hidden');
  pending = true;
}

function render() {
  const turn = game.turn();
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
        c.className = 'card ' + (own || mirror ? (own ? 'own' : 'rev' + (piece.color === 'b' ? ' b' : '')) : 'foe');
        if (own || mirror) c.textContent = GLYPH[piece.type];
        el.appendChild(c);
      }
      el.onclick = () => click(sqName);
      boardEl.appendChild(el);
    }
  }
  const check = game.inCheck() ? ' — check!' : '';
  $('status').textContent = `${name(turn)} to move${check}`;
  const fill = (id, color) => {
    const t = $(id); t.innerHTML = '';
    captured[color].forEach((p) => { const s = document.createElement('span'); s.textContent = GLYPH[p]; if (color === 'b') s.className = 'b'; t.appendChild(s); });
  };
  // top = what the opponent has lost, bottom = what I have lost
  fill('cap-top', turn === 'w' ? 'b' : 'w');
  fill('cap-bottom', turn);
}

function click(sq) {
  if (pending || game.isGameOver()) return;
  const piece = game.get(sq);
  if (selected && legal.includes(sq)) return move(selected, sq);
  if (piece && piece.color === game.turn()) {
    selected = sq;
    legal = game.moves({ square: sq, verbose: true }).map((m) => m.to);
  } else { selected = null; legal = []; }
  render();
}

function move(from, to) {
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
  showPass();
}

$('pass-btn').onclick = () => { $('pass').classList.add('hidden'); pending = false; render(); };
$('over-btn').onclick = init;
$('new').onclick = init;
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

init();
