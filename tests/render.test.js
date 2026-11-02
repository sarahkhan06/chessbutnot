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
