import { readFile } from 'node:fs/promises';
import { createDetourNavigation } from '../src/sim/navigation.js';
import type { DetourNavigation } from '../src/sim/navigation.js';
import { Simulation } from '../src/sim/simulation.js';
import type { Entity, HeroEntity, SimCommand, StructureEntity } from '../src/sim/types.js';
import type { ContentVersion, Vec2 } from '../src/content/types.js';

let navigationPromise: Promise<DetourNavigation> | null = null;

export function testNavigation(): Promise<DetourNavigation> {
  navigationPromise ??= readFile(new URL('../src/sim/nav/lane.navmesh', import.meta.url)).then(
    (data) => createDetourNavigation(data),
  );
  return navigationPromise;
}

export async function makeSim(
  contentVersion: ContentVersion = 1,
  seed = 1,
  options: { maxMatchSeconds?: number; blueHero?: string; redHero?: string } = {},
): Promise<Simulation> {
  const navigation = await testNavigation();
  return new Simulation({
    seed,
    contentVersion,
    navigation,
    heroIdsByTeam: [
      [options.blueHero ?? (contentVersion === 2 ? 'veyra' : 'veyra')],
      [options.redHero ?? (contentVersion === 2 ? 'veyra' : 'veyra')],
    ],
    ...(options.maxMatchSeconds !== undefined ? { maxMatchSeconds: options.maxMatchSeconds } : {}),
  });
}

export function hero(sim: Simulation, team: 0 | 1, slot = 0): HeroEntity {
  const entity = sim.getHero(team, slot);
  if (!entity) {
    throw new Error(`missing hero team ${team} slot ${slot}`);
  }
  return entity;
}

export function structure(sim: Simulation, id: string): StructureEntity {
  const entity = sim.state.entities.find(
    (candidate): candidate is StructureEntity =>
      candidate.kind === 'structure' && candidate.definitionId === id,
  );
  if (!entity) {
    throw new Error(`missing structure ${id}`);
  }
  return entity;
}

export function entity(sim: Simulation, id: number): Entity {
  const found = sim.getEntityById(id);
  if (!found) {
    throw new Error(`missing entity ${id}`);
  }
  return found;
}

export function place(entityToPlace: Entity, point: Vec2): void {
  entityToPlace.position = { x: point.x, z: point.z };
  entityToPlace.path = [];
  entityToPlace.pathIndex = 0;
  entityToPlace.moveGoal = null;
  entityToPlace.targetId = null;
  if (entityToPlace.kind === 'hero') {
    entityToPlace.cast = null;
  }
}

export function stepMany(sim: Simulation, ticks: number, commands: readonly SimCommand[] = []): void {
  for (let i = 0; i < ticks; i += 1) {
    sim.step(commands);
  }
}

export function perform(sim: Simulation, command: SimCommand) {
  const [result] = sim.step([command]);
  if (!result) {
    throw new Error('simulation returned no command result');
  }
  return result;
}

export function killGuardStructures(sim: Simulation, team: 0 | 1): void {
  const prefix = team === 0 ? 'blue' : 'red';
  for (const id of [`${prefix}-outer-tower`, `${prefix}-inner-tower`, `${prefix}-barracks`]) {
    const guard = structure(sim, id);
    guard.alive = false;
    guard.hp = 0;
  }
}
