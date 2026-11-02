// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { render } from '../src/render.js';

export function mountPage() {
  const html = readFileSync(process.cwd() + '/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  document.documentElement.innerHTML = html;
}
export const hotseat = () => { const g = new Game(); g.readyUp('w'); g.readyUp('b'); return g; };
export const ui = () => ({ selected: null, dests: [], connection: null, confirm: null, showBluffHint: false, passing: false, viewPly: null, showStart: false, overSeen: false });

describe('render', () => {
  beforeEach(mountPage);
  it('shows the viewer’s glyphs normally', () => {
    const g = hotseat(); render(g, ui(), () => {});
    expect(document.querySelector('[data-sq="e1"] .card').textContent).toBe('♚');
    expect(document.querySelector('[data-sq="e8"] .card').textContent).toBe('');
  });
  it('hides every glyph and highlight while the hand-over screen is up', () => {
    const g = hotseat(); g.move('e2', 'e4'); // viewer is now black; black's cards would be face-up
    const u = ui(); u.passing = true; u.selected = 'e7'; u.dests = [{ to: 'e5', legal: true }];
    render(g, u, () => {});
    for (const c of document.querySelectorAll('.card')) { expect(c.textContent).toBe(''); expect(c.classList.contains('foe')).toBe(true); }
    expect(document.querySelectorAll('.sq.sel, .sq.mv, .sq.bluff, .sq.edit, .sq.pickable').length).toBe(0);
  });
  it('has no Mirror button', () => { expect(document.getElementById('mirror')).toBeNull(); });
});

describe('resign, draw and verification UI', () => {
  beforeEach(mountPage);
  const online = () => { const w = new Game({ me: 'w' }); const b = new Game({ me: 'b', send: (m) => w.receive(m) }); w.send = (m) => b.receive(m); w.readyUp('w'); b.readyUp('b'); return { w, b }; };
  it('hot-seat shows Resign and Agree draw during play only', () => {
    const g = new Game(); render(g, ui(), () => {});
    expect(document.getElementById('resign').style.display).toBe('none');
    const h = hotseat(); render(h, ui(), () => {});
    expect(document.getElementById('resign').style.display).toBe(''); expect(document.getElementById('draw').textContent).toBe('Agree draw');
  });
  it('online: the draw banner appears for the receiver and the offerer is told to wait', () => {
    const { w, b } = online(); w.offerDraw();
    render(b, ui(), () => {}); expect(document.getElementById('draw-banner').classList.contains('hidden')).toBe(false);
    render(w, ui(), () => {}); expect(document.getElementById('draw-banner').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('status').textContent).toMatch(/draw/i);
  });
  it('the over panel shows the verification result', () => {
    const { w, b } = online(); w.resign();
    render(b, ui(), () => {}); expect(document.getElementById('over-verify').textContent).toBe('Opponent’s game verified');
  });
});

describe('how to play sheet', () => {
  beforeEach(mountPage);
  it('is a dialog with the six rule sections and an opener in the title bar', () => {
    const d = document.getElementById('help');
    expect(d.tagName).toBe('DIALOG');
    expect([...d.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Setup', 'Moving', 'Pawns', 'Capturing', 'Challenging', 'Winning']);
    expect(document.querySelector('.titlebar #help-btn')).not.toBeNull(); expect(document.getElementById('help-close')).not.toBeNull();
  });
});
