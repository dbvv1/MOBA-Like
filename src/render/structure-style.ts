export const STRUCTURE_STYLES=['baseline','stonework-v1'] as const;
export type StructureStyle=typeof STRUCTURE_STYLES[number];
/** Explicit art-only switch. No effect on simulation, dimensions or navigation. */
export function parseStructureStyle(search:string):StructureStyle{
  const values=new URLSearchParams(search).getAll('structures');
  if(values.length>1)throw new Error('Duplicate structures parameter');
  const value=values[0]??'baseline';
  if(!STRUCTURE_STYLES.includes(value as StructureStyle))throw new Error(`Unknown structures '${value}'`);
  return value as StructureStyle;
}
