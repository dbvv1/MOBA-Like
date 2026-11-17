/** Only the promoted HTML entry supplies a visual default. Explicit requests,
 * including invalid/duplicate ones, are preserved for the existing strict parser. */
export function entryLightingSearch(search:string,entryDefault:string|undefined,materialDefault?:string,sceneDefault?:string):string {
  const query=new URLSearchParams(search);
  if(!query.has('lighting')&&entryDefault==='forest-light-v1')query.set('lighting','forest-light-v1');
  if(!query.has('materials')&&materialDefault==='quiet-family-v1')query.set('materials','quiet-family-v1');
  if(!query.has('scene')&&sceneDefault==='forest-lane-v1')query.set('scene','forest-lane-v1');
  return query.toString();
}
