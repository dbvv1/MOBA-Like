/** Opt-in presentation switch for the lane scene. Unknown or duplicate values keep the reviewed scene. */
export type SceneDressing='baseline'|'forest-lane-v1';
export function parseSceneDressing(search:string):SceneDressing{
  const values=new URLSearchParams(search).getAll('scene');
  return values.length===1&&values[0]==='forest-lane-v1'?'forest-lane-v1':'baseline';
}
