import type { SimCommand } from './types.js';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const point = (value: unknown) => object(value) && keys(value, ['x', 'z']) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.z === 'number' && Number.isFinite(value.z);

/** Only gameplay inputs cross the envelope: never accept overrides of mana/cooldown/state. */
export function validFrameCommand(value: unknown): value is SimCommand {
  if (!object(value) || !id(value.heroId)) return false;
  switch (value.type) {
    case 'stop': return keys(value, ['type', 'heroId']);
    case 'move': case 'attackMove': return keys(value, ['type', 'heroId', 'point']) && point(value.point);
    case 'attack': return keys(value, ['type', 'heroId', 'targetId']) && id(value.targetId);
    case 'buyItem': return keys(value, ['type', 'heroId', 'itemId']) && typeof value.itemId === 'string';
    case 'cast': return keys(value, ['type', 'heroId', 'slot', 'targetId', 'direction', 'point']) && typeof value.slot === 'string' && ['Q', 'W', 'E', 'R'].includes(value.slot) && (value.targetId === null || id(value.targetId)) && (value.direction === null || point(value.direction)) && (value.point === null || point(value.point));
    default: return false;
  }
}
