// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';

describe('player-facing entries keep development controls out of the menu',()=>{
  it('keeps recovery notices actionable without pointing to hidden diagnostics',()=>{
    const client=readFileSync('src/client.ts','utf8');
    expect(client).not.toContain('Details in Runtime diagnostics.');
    expect(client).not.toContain('Trial renderer unavailable');
    expect(client).toContain('Enhanced rendering unavailable: default rendering restored.');
    expect(client).toContain('3D unavailable: Canvas2D recovery is active.');
  });
  for(const entry of ['index.html','candidate.html'])it(entry,()=>{
    const page=new DOMParser().parseFromString(readFileSync(entry,'utf8'),'text/html');
    expect(page.querySelector('nav[aria-label="Game versions"]')).toBeNull();
    expect(page.querySelector('a[href*="candidate"],a[href*="legacy"]')).toBeNull();
    const diagnostics=page.getElementById('diagnostics')!;
    expect(diagnostics.hidden).toBe(true);
    // Keep the machine-readable receipt and controls/help available unchanged.
    expect(JSON.parse(diagnostics.querySelector('#debug-state')!.textContent!)).toEqual({ready:false,phase:'loading'});
    expect(page.querySelector('#controls-help')).not.toBeNull();
    expect(page.querySelector('#keyboard-settings')).not.toBeNull();
    expect(page.querySelector('script[src="/src/client.ts"]')).not.toBeNull();
  });
});
