/** Failed or departed captures also release resources arriving after awaits. */
export class CaptureLifetime {
  private releases:Array<()=>void>=[];
  cancelled=false;
  own<T>(value:T,release:(value:T)=>void):T {if(this.cancelled){release(value);throw new Error('Capture cancelled');}this.releases.push(()=>release(value));return value;}
  assertActive(){if(this.cancelled)throw new Error('Capture cancelled');}
  dispose():unknown[]{if(this.cancelled)return [];this.cancelled=true;const errors:unknown[]=[];for(const release of this.releases.splice(0).reverse())try{release();}catch(error){errors.push(error);}return errors;}
}
