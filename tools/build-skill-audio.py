#!/usr/bin/env python3
"""Rebuild the bounded Q/W release family from the shipped CC0 cloth sample.
No random input, model, network, or manual waveform edits. Run from repo root.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets/audio/battle'
OUT = ROOT / 'outputs/skill-audio'
RATE = 48000

def save(path, samples):
    with wave.open(str(path), 'wb') as wav:
        wav.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        wav.writeframes(array.array('h', [round(max(-1, min(1, x))*32767) for x in samples]).tobytes())

def make(source, kind):
    if kind not in ('q', 'w') or not source or not all(math.isfinite(x) for x in source):
        raise ValueError('Expected a finite non-empty source and q/w recipe.')
    # Shared source, two distinct temporal/spectral silhouettes. Both signal
    # release only: neither contains an impact transient or success chime.
    duration = .18 if kind == 'q' else .31
    low = 0.0
    data = []
    for i in range(round(duration*RATE)):
        t = i/RATE
        src_i = min(len(source)-1, int(i*(1.2 if kind == 'q' else .8)))
        x = source[src_i] if i*(1.2 if kind == 'q' else .8)<len(source) else 0
        low += (.16 if kind == 'q' else .045)*(x-low)
        if kind == 'q':
            envelope = min(1, t/.003)*math.exp(-t/0.052)*min(1, (duration-t)/.025)
            signal = .85*(x-low)+.15*math.sin(2*math.pi*(920*t-900*t*t))
        else:
            envelope = min(1, t/.014)*math.exp(-t/.12)*min(1, (duration-t)/.04)
            signal = .6*low+.26*math.sin(2*math.pi*(260*t+110*t*t))+.1*math.sin(2*math.pi*390*t)
        data.append(signal*envelope)
    # Equal energy target, bounded peaks: not a loudness/listening acceptance.
    rms = math.sqrt(sum(x*x for x in data)/len(data))
    scale = min(.10/max(rms, 1e-9), .55/max(max(abs(x) for x in data), 1e-9))
    return [x*scale for x in data]

def main():
    expected = 'ddb93a3671233f95da0e0b10367f082f7eb42fa6caaddcf776410aa8833c747d'
    if hashlib.sha256((ASSETS/'cast.ogg').read_bytes()).hexdigest() != expected:
        raise ValueError('The accepted CC0 source changed; review it before rebuilding.')
    OUT.mkdir(parents=True, exist_ok=True)
    raw = subprocess.check_output(['ffmpeg','-v','error','-i',str(ASSETS/'cast.ogg'),'-f','s16le','-ac','1','-ar',str(RATE),'-'])
    source = [x/32768 for x in array.array('h', raw)]
    rows = []
    sounds = {}
    for kind in ('q','w'):
        data = make(source, kind)
        sounds[kind] = data
        wav = OUT/f'skill-{kind}.wav'
        save(wav, data)
        ogg = ASSETS/f'skill-{kind}.ogg'
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-c:a','libvorbis','-q:a','5','-map_metadata','-1',str(ogg)],check=True)
        rows.append({'sample':ogg.name,'durationSeconds':len(data)/RATE,'peak':max(abs(x) for x in data),'rms':math.sqrt(sum(x*x for x in data)/len(data)),'sha256':hashlib.sha256(ogg.read_bytes()).hexdigest()})
    # Same 25 ms production scheduler gap in both comparison excerpts; silence
    # separates excerpts, not individual Q/W events. Playback master gain .32.
    def pair(a,b):
        offset = round(.025*RATE)
        result = [0.0]*max(len(a), offset+len(b))
        for data,start in ((a,0),(b,offset)):
            for i,x in enumerate(data):
                # Match the runtime's final 40 ms linear release at unit distance.
                gain = min(1, (len(data)-i)/(RATE*.04))
                result[i+start] += x*.32*gain
        return result
    old = pair(source[:round(.6*RATE)], source[:round(.6*RATE)])
    new = pair(sounds['q'], sounds['w'])
    save(OUT/'before-qw.wav', old)
    save(OUT/'after-qw.wav', new)
    save(OUT/'comparison-before-after.wav', old+[0.0]*RATE+new)
    report={'sourceSha256':hashlib.sha256((ASSETS/'cast.ogg').read_bytes()).hexdigest(),'sampleRate':RATE,'samples':rows,'scope':'offline generated samples; no real-time, listening, browser, or perceived quality acceptance'}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__': main()
