import {describe,it,expect} from 'vitest';
import {skillDescription} from '../../src/ui/skill-description.js';

describe('catalog targeting tooltip',()=>{
  it('distinguishes all target types without assigning semantic art to input slots',()=>{
    expect(skillDescription('Sample','enemyUnit',[])).toContain('left-click an enemy');
    expect(skillDescription('Sample','direction',[])).toContain('Direction:');
    expect(skillDescription('Sample','point',[])).toContain('Ground target:');
    expect(skillDescription('Sample','self',[])).toContain('casts immediately');
  });
  it('shows actual state reasons rather than treating control art as locked',()=>{
    expect(skillDescription('Binding','point',['cooldown','mana'])).toContain('State: cooldown, mana');
    expect(skillDescription('Binding','point',['match ended'])).not.toContain('ready to aim');
    expect(skillDescription('Binding','point',[])).toContain('Range and target rules still apply');
  });
});
