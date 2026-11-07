/** One existing Camera + Q/W trial, not a new public switch or fourth entry.
 * Default, partial/ambiguous queries and quiet standards keep shipped behavior. */
export function isCombatTrial(search:string,candidateEntry=false):boolean{
  const query=new URLSearchParams(search);
  const exactly=(name:string,value:string)=>{
    const values=query.getAll(name);return values.length===1&&values[0]===value;
  };
  return candidateEntry&&exactly('commands','buffer-v1')&&exactly('audio','critical-v1')&&
    exactly('camera','hold-follow-v1')&&exactly('lighting','forest-light-v1')&&
    (!query.has('materials')||exactly('materials','baseline'));
}
