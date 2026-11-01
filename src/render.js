// DOM rendering. Reads a Game and a small ui object; never mutates game state.
import { pieceAt, startSquare } from './rules/state.js';
import { FILES } from './rules/geometry.js';

export const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
export const name = (c) => (c === 'w' ? 'White' : 'Black');
const other = (c) => (c === 'w' ? 'b' : 'w');
const $ = (id) => document.getElementById(id);

// Human label for a history entry; i is its index (ply number).
export function historyLabel(e, i) {
  if (!e || e.kind === 'start') return 'Start';
  if (e.kind === 'move') return `${e.from}${e.capture ? '×' : '–'}${e.to}`;
  if (e.kind === 'legal') return 'Challenged: legal — piece stays hidden';
  if (e.kind === 'bluff') return `Bluff caught: ${GLYPH[e.type]} removed`;
  if (e.kind === 'penalty') return `Penalty: ${GLYPH[e.type]} taken on ${e.to}`;
  return '';
}

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
  const pickMode = play && pub.pending === 'penaltyPick' && pub.picker === v;
  const editable = setup && pub.stage[v] === 'arranging';
  const reveal = ui.mirror && !online && play;

  // Rewind: show the board as it was after history entry ui.viewPly instead of the live position.
  const hist = pub.history || [];
  // Game over: show both starting arrangements, every card face-up, until toggled back.
  const showingStart = pub.phase === 'over' && !!ui.showStart;
  const setups = showingStart ? game.startingSetup() : null;
  const viewing = !showingStart && ui.viewPly != null && ui.viewPly < hist.length - 1;
  const entry = viewing ? hist[ui.viewPly] : null;
  const bySquare = {};
  if (showingStart) for (const id in pub.pieces) bySquare[startSquare(id)] = id;
  else if (entry) for (const id in entry.board) bySquare[entry.board[id]] = id;
  const at = (s) => (showingStart || viewing ? bySquare[s] ?? null : pieceAt(pub, s));
  const faceUpOf = (id) => (viewing ? entry.faceUp?.[id] ?? null : pub.pieces[id].faceUp);
  const hl = showingStart ? null : viewing ? entry : pub.lastMove;

  const board = $('board');
  board.innerHTML = '';
  board.classList.toggle('review', viewing);
  for (let ri = 0; ri < 8; ri++) {
    for (let fi = 0; fi < 8; fi++) {
      const rank = flip ? ri + 1 : 8 - ri;
      const file = flip ? 7 - fi : fi;
      const sqName = FILES[file] + rank;
      const el = document.createElement('div');
      el.className = 'sq' + ((file + rank) % 2 ? ' dk' : '');
      el.dataset.sq = sqName;
      if (hl && (hl.from === sqName || hl.to === sqName)) el.classList.add('last');
      if (!viewing && sqName === ui.selected) el.classList.add('sel');
      if (!viewing && destMap.has(sqName)) el.classList.add(destMap.get(sqName) ? 'mv' : 'bluff');
      const id = at(sqName);
      if (id) el.classList.add('occ');
      if (ri === 7) { const c = document.createElement('span'); c.className = 'coord file'; c.textContent = FILES[file]; el.appendChild(c); }
      if (fi === 0) { const c = document.createElement('span'); c.className = 'coord rank'; c.textContent = rank; el.appendChild(c); }
      if (!viewing && editable && id && pub.pieces[id].color === v) el.classList.add('edit');
      if (id) {
        const p = pub.pieces[id];
        const own = p.color === v;
        const fu = showingStart ? null : faceUpOf(id);
        const c = document.createElement('div');
        if (showingStart) {
          const t = setups[p.color]?.[id];
          c.className = 'card start ' + p.color;
          c.textContent = t ? GLYPH[t] : '?';
          el.appendChild(c);
          el.onclick = () => onClick(sqName);
          board.appendChild(el);
          continue;
        }
        c.className = 'card ' + (own ? 'own' : 'foe');
        if (own) c.textContent = GLYPH[game.priv[v][id]];
        else if (fu) c.textContent = GLYPH[fu];
        else if (reveal) { c.textContent = GLYPH[game.priv[p.color][id]]; c.classList.add('rev'); }
        if (fu) c.classList.add('exposed');
        if (!viewing && pickMode && !own) el.classList.add('pickable');
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
      s.className = color === v ? 'own' : 'foe';
      if (e.type) s.textContent = GLYPH[e.type]; else { s.textContent = '?'; s.classList.add('pending'); }
      t.appendChild(s);
    }
  };
  // Captured pieces sit next to the player who took them (your lost pieces appear by the opponent).
  tray('cap-top', v);
  tray('cap-bottom', other(v));

  $('setup').classList.toggle('hidden', !setup);
  if (setup) {
    const s = pub.stage[v];
    $('pill').textContent = s === 'arranging' ? 'Rearranging' : s === 'done' ? 'Locked in' : 'Ready — waiting for opponent…';
    $('done').style.display = $('skip').style.display = s === 'arranging' ? '' : 'none';
    $('ready').style.display = s === 'done' ? '' : 'none';
    $('setup-hint').textContent = s === 'arranging' ? 'Tap two of your pieces to swap them — any piece, either row — or keep the standard layout.'
      : s === 'done' ? 'Your setup is locked. Ready up when you are.' : 'Game starts when both players are ready.';
  }

  let status;
  if (game.lostState) status = 'Your saved game for this room was lost on this device. Start a new game.';
  else if (setup) status = online ? `You are ${name(v)}` : `${name(v)}'s setup`;
  else if (play) {
    if (pub.pending === 'penaltyPick' && pub.picker === v) status = pub.picker === pub.turn ? 'Challenge succeeded — pick a piece to remove' : 'Wrong challenge — pick one of their pieces to remove';
    else if (pub.pending === 'penaltyPick') status = `${name(pub.picker)} is picking a penalty…`;
    else if (pub.pending === 'awaitVerdict') status = 'Waiting for verdict…';
    else if (pub.pending === 'awaitRemoved') status = 'Waiting…';
    else if (online) {
      const theirs = pub.turn !== me;
      status = `You are ${name(me)} — ${theirs ? `waiting for ${name(pub.turn)}` : 'your move'}`;
      if (theirs && pub.lastMove?.challengeable && pub.lastMove.moverMoved) status += ' (they may challenge)';
    } else status = `${name(pub.turn)} to move`;
  } else status = overTitle(pub) + (showingStart ? ' — starting setups revealed' : '');
  $('status').textContent = status;

  const conn = $('conn');
  if (online && ui.connection) {
    conn.textContent = connText(ui.connection);
    conn.className = 'conn ' + ui.connection.status;
  } else conn.className = 'conn hidden';

  const ch = $('challenge');
  // The opponent's piece just made its first move: always honest, so the button is shown disabled with the reason.
  const debut = game.canAct() && !!pub.lastMove?.challengeable && !pub.lastMove.moverMoved;
  ch.classList.toggle('hidden', (!game.canChallenge() && !debut) || game.lostState);
  ch.disabled = debut;
  ch.textContent = debut ? 'First move — always honest' : ui.confirmChallenge ? 'Challenge — sure?' : 'Challenge last move';
  if (ui.confirmChallenge) ch.dataset.confirm = '1'; else delete ch.dataset.confirm;
  $('mirror').style.display = !online && play ? '' : 'none';
  $('online').style.display = online ? 'none' : '';
  $('bluff-hint').classList.toggle('hidden', !ui.showBluffHint);

  const rp = $('replay');
  rp.classList.toggle('hidden', !(play || pub.phase === 'over') || hist.length < 2 || showingStart);
  rp.classList.toggle('reviewing', viewing);
  const last = hist[hist.length - 1];
  const label = historyLabel(last);
  $('rw-label').textContent = viewing ? `Before: ${label}` : last?.kind === 'move' ? `Last move: ${label}` : label;
  $('rw-prev').textContent = viewing ? '▶' : '◀';
  $('rw-prev').title = viewing ? 'Back to the current position' : 'Show the position before the last move';

  const over = $('over');
  over.classList.toggle('hidden', pub.phase !== 'over');
  if (pub.phase === 'over') {
    $('over-title').textContent = overTitle(pub);
    $('over-toggle').textContent = showingStart ? 'Show final position' : 'Show starting setups';
    const missing = showingStart && (!setups.w || !setups.b);
    $('over-note').textContent = showingStart ? (missing ? 'Waiting for the other player’s starting setup…' : 'Showing how each side arranged its pieces before move one.') : '';
  }
}
