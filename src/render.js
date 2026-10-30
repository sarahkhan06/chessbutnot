// DOM rendering. Reads a Game and a small ui object; never mutates game state.
import { pieceAt } from './rules/state.js';
import { FILES } from './rules/geometry.js';

export const GLYPH = { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' };
export const name = (c) => (c === 'w' ? 'White' : 'Black');
const other = (c) => (c === 'w' ? 'b' : 'w');
const $ = (id) => document.getElementById(id);

export function overTitle(pub) {
  const loser = other(pub.winner);
  if (pub.reason === 'king-captured') return `${name(pub.winner)} captured the king`;
  if (pub.reason === 'king-penalty') return `${name(loser)}'s king was taken as a penalty`;
  if (pub.reason === 'king-bluffed') return `${name(loser)}'s king was caught bluffing`;
  return `${name(pub.winner)} wins`;
}

function connText(connection) {
  if (!connection) return '';
  const { status, detail } = connection;
  if (status === 'connected') return 'Connected';
  if (status === 'connecting') return detail === 'waiting' ? 'Waiting for your friend to join…' : 'Connecting…';
  if (status === 'disconnected') return detail === 'host offline' ? 'Host not reachable yet — retrying…' : 'Opponent disconnected — waiting for them to come back…';
  if (status === 'error') return detail === 'room taken' ? 'That room code is taken. Start a new game.' : `Connection failed (${detail}). Your networks may block direct connections.`;
  return '';
}

export function render(game, ui, onClick) {
  const pub = game.pub;
  const v = game.viewer();
  const me = game.me;
  const online = !!me;
  const setup = pub.phase === 'setup';
  const play = pub.phase === 'play';
  const flip = v === 'b';
  const destMap = new Map((ui.dests || []).map((d) => [d.to, d.legal]));
  const pickMode = play && pub.pending === 'penaltyPick' && pub.turn === v;
  const editable = setup && pub.stage[v] === 'arranging';
  const reveal = ui.mirror && !online && play;

  const board = $('board');
  board.innerHTML = '';
  for (let ri = 0; ri < 8; ri++) {
    for (let fi = 0; fi < 8; fi++) {
      const rank = flip ? ri + 1 : 8 - ri;
      const file = flip ? 7 - fi : fi;
      const sqName = FILES[file] + rank;
      const el = document.createElement('div');
      el.className = 'sq' + ((file + rank) % 2 ? ' dk' : '');
      if (pub.lastMove && (pub.lastMove.from === sqName || pub.lastMove.to === sqName)) el.classList.add('last');
      if (sqName === ui.selected) el.classList.add('sel');
      if (destMap.has(sqName)) el.classList.add(destMap.get(sqName) ? 'mv' : 'bluff');
      const id = pieceAt(pub, sqName);
      if (editable && id && pub.pieces[id].color === v) el.classList.add('edit');
      if (id) {
        const p = pub.pieces[id];
        const own = p.color === v;
        const c = document.createElement('div');
        c.className = 'card ' + (own ? 'own' : 'foe');
        if (own) c.textContent = GLYPH[game.priv[v][id]];
        else if (p.faceUp) c.textContent = GLYPH[p.faceUp];
        else if (reveal) { c.textContent = GLYPH[game.priv[p.color][id]]; c.classList.add('rev'); }
        if (p.faceUp) c.classList.add('exposed');
        if (pickMode && !own) el.classList.add('pickable');
        el.appendChild(c);
      }
      el.onclick = () => onClick(sqName);
      board.appendChild(el);
    }
  }

  const tray = (elId, color) => {
    const t = $(elId); t.innerHTML = '';
    for (const e of pub.lost[color]) {
      const s = document.createElement('span');
      if (e.type) s.textContent = GLYPH[e.type]; else { s.textContent = '?'; s.className = 'pending'; }
      if (color === 'b') s.classList.add('b');
      t.appendChild(s);
    }
  };
  tray('cap-top', other(v));
  tray('cap-bottom', v);

  $('setup').classList.toggle('hidden', !setup);
  if (setup) {
    const s = pub.stage[v];
    $('pill').textContent = s === 'arranging' ? 'Rearranging' : s === 'done' ? 'Locked in' : 'Ready — waiting for opponent…';
    $('done').style.display = s === 'arranging' ? '' : 'none';
    $('ready').style.display = s === 'done' ? '' : 'none';
    $('setup-hint').textContent = s === 'arranging' ? 'Tap two of your pieces to swap them — any piece, either row.'
      : s === 'done' ? 'Your setup is locked. Ready up when you are.' : 'Game starts when both players are ready.';
  }

  let status;
  if (setup) status = online ? `You are ${name(v)}` : `${name(v)}'s setup`;
  else if (play) {
    if (pub.pending === 'penaltyPick' && pub.turn === v) status = 'Challenge succeeded — pick a piece to remove';
    else if (pub.pending === 'penaltyPick') status = `${name(pub.turn)} is picking a penalty…`;
    else if (pub.pending === 'awaitVerdict') status = 'Waiting for verdict…';
    else if (pub.pending === 'awaitRemoved') status = 'Waiting…';
    else if (online) {
      const theirs = pub.turn !== me;
      status = `You are ${name(me)} — ${theirs ? `waiting for ${name(pub.turn)}` : 'your move'}`;
      if (theirs && pub.lastMove?.challengeable) status += ' (they may challenge)';
    } else status = `${name(pub.turn)} to move`;
  } else status = overTitle(pub);
  $('status').textContent = status;

  const conn = $('conn');
  if (online && ui.connection) {
    conn.textContent = connText(ui.connection);
    conn.className = 'conn ' + ui.connection.status;
  } else conn.className = 'conn hidden';

  const ch = $('challenge');
  ch.classList.toggle('hidden', !game.canChallenge());
  ch.textContent = ui.confirmChallenge ? 'Challenge — sure?' : 'Challenge last move';
  if (ui.confirmChallenge) ch.dataset.confirm = '1'; else delete ch.dataset.confirm;
  $('mirror').style.display = !online && play ? '' : 'none';
  $('online').style.display = online ? 'none' : '';
  $('bluff-hint').classList.toggle('hidden', !ui.showBluffHint);

  const over = $('over');
  over.classList.toggle('hidden', pub.phase !== 'over');
  if (pub.phase === 'over') $('over-title').textContent = overTitle(pub);
}
