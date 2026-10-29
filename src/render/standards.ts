/** Explicit opt-in on the candidate entry only; never inferred from saved state. */
export type Standards='baseline'|'tower-standards';
export function parseStandards(search:string):Standards{
 const values=new URLSearchParams(search).getAll('standards');
 if(values.length>1)throw new Error('Duplicate standards parameter');
 const value=values[0]??'baseline';
 if(value!=='baseline'&&value!=='tower-standards')throw new Error('Unknown standards parameter');
 return value;
}
