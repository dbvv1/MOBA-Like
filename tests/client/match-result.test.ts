import {describe,expect,it} from 'vitest';
import {getContent} from '../../src/content/catalog.js';
import {battleMessage,matchResult} from '../../src/ui/battle-state.js';
import {makeSim} from '../helpers.js';

// Terminal fields from the ordinary UI match captured on 2026-10-27.
const recordedDefeat={status:'redWin',winner:1,endReason:'blueBaseDestroyed'} as const;

describe('player-facing match outcomes',()=>{
  it('explains the captured blue defeat and the same outcome from the red player perspective',()=>{
    expect(matchResult(recordedDefeat,0)).toEqual({label:'DEFEAT',hint:'Your Heartwood was destroyed. Restart to play again.',announcement:'DEFEAT. Your Heartwood was destroyed.'});
    expect(matchResult(recordedDefeat,1)).toEqual({label:'VICTORY',hint:'The enemy Heartwood was destroyed. Restart to play again.',announcement:'VICTORY. The enemy Heartwood was destroyed.'});
  });

  it('also explains red defeat without assuming the player is blue',()=>{
    const outcome={status:'blueWin',winner:0,endReason:'redBaseDestroyed'} as const;
    expect(matchResult(outcome,1)).toEqual({label:'DEFEAT',hint:'Your Heartwood was destroyed. Restart to play again.',announcement:'DEFEAT. Your Heartwood was destroyed.'});
    expect(matchResult(outcome,0)).toEqual({label:'VICTORY',hint:'The enemy Heartwood was destroyed. Restart to play again.',announcement:'VICTORY. The enemy Heartwood was destroyed.'});
  });

  it('does not invent a winner for a time limit or a draw for mutual destruction',()=>{
    const timeout={status:'timeout',winner:null,endReason:'maxMatchSeconds'} as const;
    for(const team of [0,1] as const){
      expect(matchResult(timeout,team)).toEqual({label:'TIME LIMIT',hint:'No winner was decided before the time limit. Restart to play again.',announcement:'TIME LIMIT. No winner was decided before the time limit.'});
    }
    // Existing simulation rules award the blue team this outcome.
    const mutual={status:'blueWin',winner:0,endReason:'mutualBaseDestruction'} as const;
    expect(matchResult(mutual,0)).toEqual({label:'VICTORY',hint:'Both Heartwoods were destroyed. Restart to play again.',announcement:'VICTORY. Both Heartwoods were destroyed.'});
    expect(matchResult(mutual,1)).toEqual({label:'DEFEAT',hint:'Both Heartwoods were destroyed. Restart to play again.',announcement:'DEFEAT. Both Heartwoods were destroyed.'});
  });

  it('uses safe prose for an unrecognized reason rather than exposing its token',()=>{
    expect(matchResult({...recordedDefeat,endReason:'futureInternalReason'},0)).toEqual({label:'DEFEAT',hint:'The enemy team won. Restart to play again.',announcement:'DEFEAT. The enemy team won.'});
    expect(matchResult({status:'timeout',winner:null,endReason:'futureInternalReason'},1)).toEqual({label:'TIME LIMIT',hint:'No winner was declared. Restart to play again.',announcement:'TIME LIMIT. No winner was declared.'});
  });

  it('prioritizes the result over combat/death hints and returns to normal hints on restart',async()=>{
    const sim=await makeSim(10,1),running=sim.snapshot(),player=running.heroes[0]!;
    const ended={...running,...recordedDefeat,tick:9305,timeSeconds:310.1666666666667};
    const before=JSON.stringify(ended);
    expect(battleMessage(ended,{...player,alive:false,stunned:true},getContent(10))).toEqual({
      tone:'end',label:'DEFEAT',hint:'Your Heartwood was destroyed. Restart to play again.',
    });
    expect(JSON.stringify(ended)).toBe(before);
    expect(matchResult(running,player.team)).toBeNull();
    expect(battleMessage(running,player,getContent(10)).label).toBe('ADVANCE WITH YOUR WAVE');
  });
});
