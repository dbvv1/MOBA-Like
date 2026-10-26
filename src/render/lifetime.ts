/** Register resources immediately so failed initialization uses the same cleanup path. */
export function createLifetime(){
  const pending:Array<()=>void>=[];let disposed=false;
  return{
    defer(release:()=>void){if(disposed){release();throw new Error('Lifetime already disposed');}pending.push(release);},
    dispose():unknown[]{if(disposed)return[];disposed=true;const errors:unknown[]=[];while(pending.length){try{pending.pop()!();}catch(error){errors.push(error);}}return errors;},
  };
}
