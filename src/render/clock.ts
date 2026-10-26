/** Fixed-step scheduler; a suspended tab pauses rather than simulating a surprise backlog. */
export class FixedClock {
  private accumulator=0;
  constructor(readonly stepSeconds:number,readonly maxFrameSeconds=.25){
    if(!Number.isFinite(stepSeconds)||stepSeconds<=0)throw new Error('Invalid fixed step');
  }
  advance(seconds:number,step:()=>void):number {
    if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid frame delta');
    this.accumulator+=Math.min(seconds,this.maxFrameSeconds);
    while(this.accumulator+1e-12>=this.stepSeconds){step();this.accumulator=Math.max(0,this.accumulator-this.stepSeconds);}
    return this.accumulator/this.stepSeconds;
  }
  reset():void{this.accumulator=0;}
}
