import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {Simulation} from '../../src/sim/simulation.js';
import {createControls} from '../../src/input/controls.js';
import type {GameWorld} from '../../src/render/world.js';
import type {Aim} from '../../src/input/commands.js';
import type {CommandResult, PresentationEvent, SimCommand, Snapshot} from '../../src/sim/types.js';
import {stableStringify} from '../../src/sim/hash.js';
import {hero,makeSim,place} from '../helpers.js';

/**
 * Continuous evidence for the v12 "one next command" buffer, driven through the
 * production Controls DOM handlers (keydown + pointerdown) into the real
 * Simulation on the baked Detour lane. Setup mutates only the match fixture
 * (positions, regen, a lethally low HP); no private simulation state or cast
 * result is edited, and every release asserted below comes from an applied
 * SimCommand whose CommandResult was recorded.
 *
 * The three layers stay distinct in the trace:
 *   input    - DOM key/click the player produced (Controls event handler ran)
 *   accepted - CommandResult.accepted/queued from Simulation.step
 *   release  - castStarted/castResolved/castCancelled presentation events
 * A click that produced no command (aim mode, Escape) never claims acceptance;
 * an accepted queued command does not claim a release until the queue is consumed.
 */

type InputMark =
  | {kind: 'key'; key: string}
  | {kind: 'click'; button: 0 | 2; aim: Aim};

type QueuedState = {
  readonly tick: number;
  readonly inputs: readonly InputMark[];
  readonly commands: readonly SimCommand[];
  readonly directCommands: readonly SimCommand[];
  readonly results: readonly CommandResult[];
  readonly events: readonly PresentationEvent[];
  readonly mana: number;
  readonly cooldowns: Readonly<Record<string, number>>;
  readonly position: {x: number; z: number};
  readonly targetId: number | null;
  readonly castSlot: string | null;
  readonly basicAttack: {id: number; targetId: number; startedTick: number; commitTick: number; windupTicks: number} | null;
  readonly queuedCommand: SimCommand | null;
  readonly alive: boolean;
  readonly hp: number;
  readonly hash: string;
  readonly projection: unknown;
};

type Harness = ReturnType<typeof createInputHarness>;

function createInputHarness(sim: Simulation) {
  const windowTarget = new EventTarget();
  vi.stubGlobal('window', windowTarget);
  const canvas = Object.assign(new EventTarget(), {focus: vi.fn()});
  const pending: SimCommand[] = [];
  let marks: InputMark[] = [];
  let aim: Aim = {point: null, entityId: null};
  const world = {
    canvas,
    setTargeting: vi.fn(),
    aim: () => structuredClone(aim),
    setPointer: vi.fn(),
    leavePointer: vi.fn(),
  } as unknown as GameWorld;
  const controls = createControls(
    world,
    sim.catalog,
    () => {
      const snapshot = sim.snapshot();
      return {snapshot, hero: snapshot.heroes.find(candidate => candidate.team === 0)!};
    },
    command => {
      pending.push(structuredClone(command));
    },
    () => {},
    () => {},
  );
  function key(value: string) {
    const event = new Event('keydown');
    Object.assign(event, {key: value});
    windowTarget.dispatchEvent(event);
    marks.push({kind: 'key', key: value});
  }
  function click(button: 0 | 2) {
    const event = new Event('pointerdown');
    Object.assign(event, {button, clientX: 1, clientY: 1});
    canvas.dispatchEvent(event);
    marks.push({kind: 'click', button, aim: structuredClone(aim)});
  }
  return {
    controls,
    targeting: world.setTargeting,
    pending,
    key,
    click,
    aimPoint(point: {x: number; z: number}) {
      aim = {point, entityId: null};
    },
    aimEntity(entityId: number) {
      aim = {point: null, entityId};
    },
    takeCommands: () => pending.splice(0, pending.length),
    takeMarks: () => {
      const taken = marks;
      marks = [];
      return taken;
    },
    dispose() {
      controls.dispose();
      vi.unstubAllGlobals();
    },
  };
}

function gameplayView(snapshot: Snapshot) {
  return {
    tick: snapshot.tick,
    status: snapshot.status,
    winner: snapshot.winner,
    heroes: snapshot.heroes.map(h => ({
      id: h.id,
      team: h.team,
      position: h.position,
      facing: h.facing,
      hp: h.hp,
      mana: h.mana,
      shield: h.shield,
      alive: h.alive,
      level: h.level,
      xp: h.xp,
      gold: h.gold,
      cooldowns: h.cooldowns,
      castSlot: h.castSlot,
      basicAttack: h.basicAttack,
      targetId: h.targetId,
      moveGoal: h.moveGoal,
    })),
    entities: snapshot.entities.map(entity => ({
      id: entity.id,
      team: entity.team,
      kind: entity.kind,
      name: entity.name,
      position: entity.position,
      radius: entity.radius,
      hp: entity.hp,
      alive: entity.alive,
      invulnerable: entity.invulnerable,
    })),
    projectiles: snapshot.projectiles.map(projectile => ({
      id: projectile.id,
      team: projectile.team,
      abilityId: projectile.abilityId,
      position: projectile.position,
      direction: projectile.direction,
      basicAttack: projectile.basicAttack,
    })),
    zones: snapshot.zones.map(zone => ({id: zone.id, abilityId: zone.abilityId, position: zone.position, expiresTick: zone.expiresTick})),
    delayedAreas: snapshot.delayedAreas.map(area => ({id: area.id, abilityId: area.abilityId, position: area.position, triggerTick: area.triggerTick})),
    stats: snapshot.stats,
    diagnostics: snapshot.diagnostics,
  };
}

function recordTick(sim: Simulation, inputs: readonly InputMark[], commands: readonly SimCommand[], directCommands: readonly SimCommand[], results: readonly CommandResult[]): QueuedState {
  const snapshot = sim.snapshot();
  const player = sim.getHero(0)!;
  return {
    tick: sim.state.tick,
    inputs: structuredClone(inputs),
    commands: structuredClone(commands),
    directCommands: structuredClone(directCommands),
    results: structuredClone(results),
    events: structuredClone(snapshot.events),
    mana: player.mana,
    cooldowns: {...player.cooldowns},
    position: {...player.position},
    targetId: player.targetId,
    castSlot: player.cast?.slot ?? null,
    basicAttack: player.basicAttack ? {...player.basicAttack} : null,
    queuedCommand: player.queuedCommand ? structuredClone(player.queuedCommand) : null,
    alive: player.alive,
    hp: player.hp,
    hash: sim.finalHash(),
    projection: gameplayView(snapshot),
  };
}

function createRun(sim: Simulation, harness: Harness) {
  const records: QueuedState[] = [];
  function advance(direct: readonly SimCommand[] = []) {
    const commands = [...harness.takeCommands(), ...direct];
    const inputs = harness.takeMarks();
    const results = sim.step(commands);
    records.push(recordTick(sim, inputs, commands, direct, results));
    return results;
  }
  function advanceUntil(predicate: () => boolean, maxTicks: number, label: string) {
    for (let i = 0; i < maxTicks; i++) {
      advance();
      if (predicate()) return;
    }
    throw new Error(`condition not reached in ${maxTicks} ticks: ${label}`);
  }
  return {records, advance, advanceUntil};
}

type AbilityCastEvent = Extract<PresentationEvent, {castId: number; slot: 'Q' | 'W' | 'E' | 'R'}>;

function abilityEvents(records: readonly QueuedState[], type: 'castStarted' | 'castResolved' | 'castCancelled'): AbilityCastEvent[] {
  return records.flatMap(record => record.events.filter(event =>
    event.type === type && (event as {slot?: unknown}).slot !== null && typeof (event as {slot?: unknown}).slot === 'string',
  )) as AbilityCastEvent[];
}

function basicAttackCancellations(records: readonly QueuedState[]) {
  return records.flatMap(record => record.events.filter(event =>
    event.type === 'castCancelled' && (event as {action?: string}).action === 'basicAttack',
  ));
}

function castIdOf(event: PresentationEvent): number | null {
  return (event as {castId?: number}).castId ?? null;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** Minimal band the Simulation needs: seed/config, fixture setup, and one entry per non-empty command tick. */
function commandBand(records: readonly QueuedState[], fixture: string) {
  return {
    seed: 1,
    contentVersion: 12,
    heroesPerTeam: 1,
    heroIdsByTeam: [['veyra'], ['veyra']],
    tickRate: 30,
    fixture,
    commands: records
      .filter(record => record.commands.length > 0)
      .map(record => ({tick: record.tick, commands: record.commands})),
  };
}

function fullTrace(records: readonly QueuedState[]) {
  return records.map(record => ({
    tick: record.tick,
    inputs: record.inputs,
    commands: record.commands,
    directCommands: record.directCommands,
    results: record.results.map(result => ({accepted: result.accepted, queued: result.queued ?? false, reason: result.reason})),
    events: record.events.map(event => ({...event})),
    state: {
      mana: record.mana,
      cooldowns: record.cooldowns,
      position: record.position,
      targetId: record.targetId,
      castSlot: record.castSlot,
      basicAttack: record.basicAttack,
      queuedCommand: record.queuedCommand,
      alive: record.alive,
      hp: record.hp,
    },
    hash: record.hash,
  }));
}

/** Per-tick evidence digest: every tick with player input, a command, a cast event or a life/queue change. */
function traceDigest(records: readonly QueuedState[]) {
  const digest: unknown[] = [];
  let previousAlive: boolean | null = null;
  let previousQueue: string | null = null;
  for (const record of records) {
    const queue = record.queuedCommand ? `${record.queuedCommand.type}:${'slot' in record.queuedCommand ? record.queuedCommand.slot : ''}` : null;
    const interesting = record.inputs.length > 0 || record.commands.length > 0 || record.events.length > 0 ||
      record.alive !== previousAlive || queue !== previousQueue;
    previousAlive = record.alive;
    previousQueue = queue;
    if (!interesting) continue;
    digest.push({
      tick: record.tick,
      inputs: record.inputs.map(input => input.kind === 'key' ? `key:${input.key}` : `click:${input.button}:${input.aim.entityId ?? `${input.aim.point?.x},${input.aim.point?.z}`}`),
      commands: record.commands.map(command => ({...command})),
      directCommands: record.directCommands.map(command => ({...command})),
      results: record.results.map(result => ({accepted: result.accepted, queued: result.queued ?? false, reason: result.reason})),
      events: record.events.map(event => ({...event})),
      queuedCommand: record.queuedCommand,
      basicAttack: record.basicAttack,
      castSlot: record.castSlot,
      alive: record.alive,
      mana: Math.round(record.mana * 1000) / 1000,
      cooldowns: record.cooldowns,
      position: {x: Math.round(record.position.x * 1000) / 1000, z: Math.round(record.position.z * 1000) / 1000},
      targetId: record.targetId,
      hash: record.hash,
    });
  }
  return digest;
}

/**
 * Replays the same recorded commands into a brand-new Simulation and checks:
 * - every tick's authoritative gameplay hash is identical;
 * - snapshots sampled every 1, 2 and 5 ticks do not change gameplay (same final
 *   hash and the same gameplay projection at every sampled tick);
 * - the CommandResults stay identical, so acceptance is reproducible too.
 */
async function verifyReplay(records: readonly QueuedState[], setup: (sim: Simulation) => void, fixture: string) {
  expect(records.length).toBeGreaterThan(0);
  const band = commandBand(records, fixture);
  const bandSha = sha256(band);
  const traceSha = sha256(fullTrace(records));
  console.log(`[queued-skills] ticks=${records.length} commandBandSha256=${bandSha} fullTraceSha256=${traceSha}`);
  console.log(`[queued-skills] band=${stableStringify(band)}`);
  console.log(`[queued-skills] digest=${stableStringify(traceDigest(records))}`);

  for (const cadence of [1, 2, 5]) {
    const sim = await makeSim(12, 1);
    setup(sim);
    const samples: {tick: number; projection: unknown}[] = [];
    for (const record of records) {
      const results = sim.step(record.commands);
      expect(sim.state.tick).toBe(record.tick);
      expect(sim.finalHash()).toBe(record.hash);
      expect(results.map(result => ({accepted: result.accepted, queued: result.queued ?? false, reason: result.reason})))
        .toEqual(record.results.map(result => ({accepted: result.accepted, queued: result.queued ?? false, reason: result.reason})));
      if (sim.state.tick % cadence === 0) {
        const snapshot = sim.snapshot();
        expect(snapshot.events).toEqual(record.events);
        samples.push({tick: sim.state.tick, projection: gameplayView(snapshot)});
      }
    }
    expect(sim.finalHash()).toBe(records[records.length - 1]!.hash);
    for (const sample of samples) {
      const primary = records.find(record => record.tick === sample.tick)!;
      expect(sample.projection).toEqual(primary.projection);
    }
  }
  return {bandSha, traceSha};
}

function gameStart(sim: Simulation) {
  const blue = hero(sim, 0);
  const red = hero(sim, 1);
  place(blue, {x: 0, z: 0});
  place(red, {x: 5, z: 0});
  blue.stats.hpRegen = red.stats.hpRegen = 0;
  return {blue, red};
}

describe('v12 queued skills through real Controls input', () => {
  it('Q then W during a Veyra basic-attack windup are accepted and replaced, then Stop clears both without any release', async () => {
    const sim = await makeSim(12, 1);
    const {blue, red} = gameStart(sim);
    const setup = (target: Simulation) => { gameStart(target); };
    const fixture = 'veyra blue (0,0) vs veyra red (5,0), hpRegen 0';
    const harness = createInputHarness(sim);
    try {
      const run = createRun(sim, harness);
      harness.aimEntity(red.id);
      harness.click(2);
      run.advance();
      expect(blue.basicAttack).toBeDefined();
      const attackId = blue.basicAttack!.id;

      harness.aimPoint({x: blue.position.x + 4, z: 0});
      harness.key('q');
      harness.click(0);
      const qTick = run.advance();
      expect(qTick[0]).toMatchObject({accepted: true, queued: true, reason: null});

      harness.aimPoint({x: blue.position.x, z: 4});
      harness.key('w');
      harness.click(0);
      const wTick = run.advance();
      expect(wTick[0]).toMatchObject({accepted: true, queued: true, reason: null});
      expect(blue.queuedCommand).toMatchObject({type: 'cast', slot: 'W'});

      harness.key('s');
      const stopTick = run.advance();
      expect(stopTick[0]).toMatchObject({accepted: true, reason: null});
      expect(blue.queuedCommand).toBeUndefined();
      expect(blue.basicAttack).toBeUndefined();
      expect(stopTick[0]!.command).toEqual({type: 'stop', heroId: blue.id});

      run.advanceUntil(() => sim.state.tick >= 30, 30, 'post-stop drain');

      const started = abilityEvents(run.records, 'castStarted');
      const resolved = abilityEvents(run.records, 'castResolved');
      const cancelled = basicAttackCancellations(run.records);
      expect(started.filter(event => event.slot === 'Q' || event.slot === 'W')).toHaveLength(0);
      expect(resolved.filter(event => event.slot === 'Q' || event.slot === 'W')).toHaveLength(0);
      expect(cancelled).toEqual([expect.objectContaining({castId: attackId, reason: 'stop'})]);
      expect(blue.cooldowns.Q).toBe(0);
      expect(blue.cooldowns.W).toBe(0);
      expect(sim.state.stats.abilities['veyra.q']?.casts ?? 0).toBe(0);
      expect(sim.state.stats.abilities['veyra.w']?.casts ?? 0).toBe(0);

      await verifyReplay(run.records, setup, fixture);
    } finally {
      harness.dispose();
    }
  });

  it('cancelling W aim with Escape produces no command, and a following Q click is accepted and releases', async () => {
    const sim = await makeSim(12, 1);
    const {blue, red} = gameStart(sim);
    const setup = (target: Simulation) => { gameStart(target); };
    const fixture = 'veyra blue (0,0) vs veyra red (5,0), hpRegen 0';
    const harness = createInputHarness(sim);
    try {
      const run = createRun(sim, harness);
      harness.key('w');
      const aimTick = run.advance();
      expect(aimTick).toHaveLength(0);
      expect(blue.cooldowns.W).toBe(0);

      expect(harness.targeting).toHaveBeenLastCalledWith('W');
      harness.aimPoint({x: blue.position.x + 4, z: 0});
      harness.key('Escape');
      expect(harness.targeting).toHaveBeenLastCalledWith(null);
      harness.click(0);
      const cancelTick = run.advance();
      expect(cancelTick).toHaveLength(0);
      expect(blue.cooldowns.W).toBe(0);

      harness.aimPoint({x: red.position.x, z: red.position.z});
      harness.key('q');
      harness.click(0);
      const qTick = run.advance();
      expect(qTick[0]).toMatchObject({accepted: true, reason: null});
      expect(blue.cast?.slot).toBe('Q');

      const started = abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'Q');
      expect(started).toHaveLength(1);
      const castId = started[0]!.castId;
      run.advanceUntil(() => run.records.some(record => record.events.some(event => event.type === 'castResolved' && castIdOf(event) === castId)), 15, 'Q resolve');
      const resolved = run.records.flatMap(record => record.events.filter(event => event.type === 'castResolved' && castIdOf(event) === castId));
      expect(resolved).toHaveLength(1);
      expect(abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'W')).toHaveLength(0);
      expect(abilityEvents(run.records, 'castResolved').filter(event => event.slot === 'W')).toHaveLength(0);
      expect(blue.cooldowns.W).toBe(0);
      expect(blue.cooldowns.Q).toBeGreaterThan(0);

      await verifyReplay(run.records, setup, fixture);
    } finally {
      harness.dispose();
    }
  });

  it('two same-slot Q inputs during the windup consume once and release exactly one Q', async () => {
    const sim = await makeSim(12, 1);
    const {blue, red} = gameStart(sim);
    const setup = (target: Simulation) => { gameStart(target); };
    const fixture = 'veyra blue (0,0) vs veyra red (5,0), hpRegen 0';
    const harness = createInputHarness(sim);
    try {
      const run = createRun(sim, harness);
      harness.aimEntity(red.id);
      harness.click(2);
      run.advance();
      expect(blue.basicAttack).toBeDefined();

      harness.aimPoint({x: blue.position.x + 4, z: 0});
      harness.key('q');
      harness.click(0);
      expect(run.advance()[0]).toMatchObject({accepted: true, queued: true});
      harness.key('q');
      harness.click(0);
      expect(run.advance()[0]).toMatchObject({accepted: true, queued: true});
      expect(blue.queuedCommand).toMatchObject({type: 'cast', slot: 'Q'});

      const commitTick = blue.basicAttack!.commitTick;
      run.advanceUntil(() => sim.state.tick >= commitTick + 10, 30, 'single Q resolve');
      const qStarted = abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'Q');
      const qResolved = abilityEvents(run.records, 'castResolved').filter(event => event.slot === 'Q');
      expect(qStarted).toHaveLength(1);
      expect(qResolved).toHaveLength(1);
      expect(qStarted[0]!.tick).toBe(commitTick);
      expect(sim.state.stats.abilities['veyra.q']?.casts).toBe(1);
      expect(blue.cooldowns.Q).toBeGreaterThan(0);

      await verifyReplay(run.records, setup, fixture);
    } finally {
      harness.dispose();
    }
  });

  it('a different-slot W during the windup replaces the queued Q, and only W releases', async () => {
    const sim = await makeSim(12, 1);
    const {blue, red} = gameStart(sim);
    const setup = (target: Simulation) => { gameStart(target); };
    const fixture = 'veyra blue (0,0) vs veyra red (5,0), hpRegen 0';
    const harness = createInputHarness(sim);
    try {
      const run = createRun(sim, harness);
      harness.aimEntity(red.id);
      harness.click(2);
      run.advance();
      expect(blue.basicAttack).toBeDefined();

      harness.aimPoint({x: blue.position.x + 4, z: 0});
      harness.key('q');
      harness.click(0);
      expect(run.advance()[0]).toMatchObject({accepted: true, queued: true});
      harness.aimPoint({x: blue.position.x, z: 4});
      harness.key('w');
      harness.click(0);
      expect(run.advance()[0]).toMatchObject({accepted: true, queued: true});
      expect(blue.queuedCommand).toMatchObject({type: 'cast', slot: 'W'});

      const commitTick = blue.basicAttack!.commitTick;
      run.advanceUntil(() => sim.state.tick >= commitTick + 5, 30, 'W release');
      const qEvents = (['castStarted', 'castResolved', 'castCancelled'] as const)
        .flatMap(type => abilityEvents(run.records, type))
        .filter(event => event.slot === 'Q');
      const wStarted = abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'W');
      const wResolved = abilityEvents(run.records, 'castResolved').filter(event => event.slot === 'W');
      expect(qEvents).toHaveLength(0);
      expect(wStarted).toHaveLength(1);
      expect(wResolved).toHaveLength(1);
      expect(wStarted[0]!.tick).toBe(commitTick);
      expect(blue.cooldowns.Q).toBe(0);
      expect(blue.cooldowns.W).toBeGreaterThan(0);
      expect(sim.state.stats.abilities['veyra.w']?.casts).toBe(1);

      await verifyReplay(run.records, setup, fixture);
    } finally {
      harness.dispose();
    }
  });

  it('one continuous input band: cancelled windup, aim cancel, then Q release with W queued during its windup', async () => {
    const sim = await makeSim(12, 1);
    const {blue, red} = gameStart(sim);
    const setup = (target: Simulation) => { gameStart(target); };
    const fixture = 'veyra blue (0,0) vs veyra red (5,0), hpRegen 0';
    const harness = createInputHarness(sim);
    try {
      const run = createRun(sim, harness);
      harness.aimEntity(red.id);
      harness.click(2);
      run.advance();
      expect(blue.basicAttack).toBeDefined();
      const attackId = blue.basicAttack!.id;

      harness.aimPoint({x: blue.position.x + 4, z: 0});
      harness.key('q');
      harness.click(0);
      expect(run.advance()[0]).toMatchObject({accepted: true, queued: true});
      harness.aimPoint({x: blue.position.x, z: 4});
      harness.key('w');
      harness.click(0);
      expect(run.advance()[0]).toMatchObject({accepted: true, queued: true});
      harness.key('s');
      const stopTick = run.advance();
      expect(stopTick[0]).toMatchObject({accepted: true, reason: null});
      expect(blue.basicAttack).toBeUndefined();
      expect(blue.queuedCommand).toBeUndefined();
      expect(stopTick[0]!.command).toEqual({type: 'stop', heroId: blue.id});
      expect(abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'Q' || event.slot === 'W')).toHaveLength(0);

      // Aim cancel produces no command; the next Q is accepted immediately.
      harness.key('w');
      expect(run.advance()).toHaveLength(0);
      expect(harness.targeting).toHaveBeenLastCalledWith('W');
      harness.aimPoint({x: blue.position.x + 4, z: 0});
      harness.key('Escape');
      expect(harness.targeting).toHaveBeenLastCalledWith(null);
      harness.click(0);
      expect(run.advance()).toHaveLength(0);
      harness.aimPoint({x: blue.position.x + 4, z: 0});
      harness.key('q');
      harness.click(0);
      const qTick = run.advance();
      expect(qTick[0]).toMatchObject({accepted: true, reason: null});
      expect(blue.cast?.slot).toBe('Q');

      // W entered during the Q windup is accepted and starts on the Q release tick.
      harness.aimPoint({x: blue.position.x, z: 4});
      harness.key('w');
      harness.click(0);
      const queuedWTick = run.advance();
      expect(queuedWTick[0]).toMatchObject({accepted: true, queued: true});
      expect(blue.queuedCommand).toMatchObject({type: 'cast', slot: 'W'});

      run.advanceUntil(() => blue.cooldowns.W > 0, 10, 'queued W release');
      const qStarted = abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'Q');
      const wStarted = abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'W');
      const qResolved = abilityEvents(run.records, 'castResolved').filter(event => event.slot === 'Q');
      const wResolved = abilityEvents(run.records, 'castResolved').filter(event => event.slot === 'W');
      expect(qStarted).toHaveLength(1);
      expect(qResolved).toHaveLength(1);
      expect(wStarted).toHaveLength(1);
      expect(wResolved).toHaveLength(1);
      expect(wStarted[0]!.tick).toBe(qResolved[0]!.tick);
      expect(blue.cooldowns.Q).toBeGreaterThan(0);
      expect(blue.cooldowns.W).toBeGreaterThan(0);
      expect(sim.state.stats.abilities['veyra.q']?.casts).toBe(1);
      expect(sim.state.stats.abilities['veyra.w']?.casts).toBe(1);
      expect(basicAttackCancellations(run.records)).toEqual([
        expect.objectContaining({castId: attackId, reason: 'stop'}),
      ]);

      await verifyReplay(run.records, setup, fixture);
    } finally {
      harness.dispose();
    }
  });

  it('death before the windup completes discards the queued Q, and a new Q after respawn is accepted and releases', async () => {
    const sim = await makeSim(12, 1);
    const {blue, red} = gameStart(sim);
    place(red, {x: 1, z: 0});
    blue.hp = 1;
    const setup = (target: Simulation) => {
      const {blue: stagedBlue, red: stagedRed} = gameStart(target);
      place(stagedRed, {x: 1, z: 0});
      stagedBlue.hp = 1;
    };
    const fixture = 'veyra blue (0,0) hp=1 vs veyra red (1,0), hpRegen 0';
    const harness = createInputHarness(sim);
    try {
      const run = createRun(sim, harness);
      // The opponent's real basic attack provides the lethal damage; HP was only
      // staged low so it can land inside the player's 7-tick windup.
      run.advance([{type: 'attack', heroId: red.id, targetId: blue.id}]);
      run.advance();
      run.advance();
      harness.aimEntity(red.id);
      harness.click(2);
      run.advance();
      expect(blue.basicAttack).toBeDefined();
      const commitTick = blue.basicAttack!.commitTick;

      harness.aimPoint({x: blue.position.x + 4, z: 0});
      harness.key('q');
      harness.click(0);
      expect(run.advance()[0]).toMatchObject({accepted: true, queued: true});
      expect(blue.queuedCommand).toMatchObject({type: 'cast', slot: 'Q'});

      run.advanceUntil(() => !blue.alive, 20, 'death before windup commit');
      expect(sim.state.tick).toBeLessThan(commitTick);
      expect(blue.queuedCommand).toBeUndefined();
      expect(blue.basicAttack).toBeUndefined();
      const deathTick = sim.state.tick;
      const deadEvents = run.records[run.records.length - 1]!.events;
      expect(deadEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({type: 'castCancelled', action: 'basicAttack', reason: 'dead'}),
      ]));
      expect(abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'Q')).toHaveLength(0);
      expect(sim.state.stats.abilities['veyra.q']?.casts ?? 0).toBe(0);

      run.advanceUntil(() => blue.alive, 260, 'respawn');
      expect(sim.state.tick).toBeGreaterThan(deathTick);
      const respawnTick = sim.state.tick;
      expect(blue.cast).toBeNull();
      expect(blue.queuedCommand).toBeUndefined();

      harness.aimPoint({x: blue.position.x + 4, z: blue.position.z});
      harness.key('q');
      harness.click(0);
      const afterRespawn = run.advance();
      expect(afterRespawn[0]).toMatchObject({accepted: true, reason: null});
      expect(blue.cast?.slot).toBe('Q');
      const started = abilityEvents(run.records, 'castStarted').filter(event => event.slot === 'Q');
      expect(started).toHaveLength(1);
      expect(started[0]!.tick).toBeGreaterThan(respawnTick);
      const castId = started[0]!.castId;
      run.advanceUntil(() => run.records.some(record => record.events.some(event => event.type === 'castResolved' && castIdOf(event) === castId)), 15, 'post-respawn Q resolve');
      expect(run.records.flatMap(record => record.events.filter(event => event.type === 'castResolved' && castIdOf(event) === castId))).toHaveLength(1);
      expect(sim.state.stats.abilities['veyra.q']?.casts).toBe(1);
      expect(blue.cooldowns.Q).toBeGreaterThan(0);

      await verifyReplay(run.records, setup, fixture);
    } finally {
      harness.dispose();
    }
  });
});
