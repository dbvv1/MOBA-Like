/** Only the promoted HTML entry supplies a visual default. Explicit requests,
 * including invalid/duplicate ones, are preserved for the existing strict parser. */
export function entryLightingSearch(search:string,entryDefault:string|undefined):string {
  const query=new URLSearchParams(search);
  if(!query.has('lighting')&&entryDefault==='forest-light-v1')query.set('lighting','forest-light-v1');
  return query.toString();
}
