// Read-only inventory of referenced CPU resources, not a GPU/heap estimate.
export function resourceInventory({roots = [], clips = []} = {}) {
  const nodes=new Set(),geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set(),bones=new Set(),buffers=new Set(),arrays=new Set(),animations=new Set();
  function array(value){if(!ArrayBuffer.isView(value))return;arrays.add(value);buffers.add(value.buffer);}
  function attribute(value){array(value?.isInterleavedBufferAttribute?value.data.array:value?.array);}
  for(const root of roots)root.traverse(node=>{
    if(nodes.has(node))return;nodes.add(node);
    if(node.geometry&&!geometries.has(node.geometry)){
      const geometry=node.geometry;geometries.add(geometry);attribute(geometry.index);
      for(const value of Object.values(geometry.attributes))attribute(value);
      for(const values of Object.values(geometry.morphAttributes))for(const value of values)attribute(value);
    }
    if(node.skeleton&&!skeletons.has(node.skeleton)){
      skeletons.add(node.skeleton);array(node.skeleton.boneMatrices);
      for(const bone of node.skeleton.bones)bones.add(bone);
    }
    for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){
      materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  for(const clip of clips){if(animations.has(clip))continue;animations.add(clip);for(const track of clip.tracks){array(track.times);array(track.values);}}
  return {nodes:nodes.size,geometries:geometries.size,materials:materials.size,textures:textures.size,skeletons:skeletons.size,bones:bones.size,clips:animations.size,
    typedArrayViews:arrays.size,typedArrayViewBytes:[...arrays].reduce((sum,value)=>sum+value.byteLength,0),
    backingBuffers:buffers.size,typedArrayBackingBytes:[...buffers].reduce((sum,value)=>sum+value.byteLength,0)};
}

// No invented device budget: the caller supplies its explicit limits.
export function assertResourceBudget(inventory,limits){
  if(!limits||typeof limits!=='object'||Array.isArray(limits)||!Object.keys(limits).length)throw new Error('Explicit resource limits required');
  for(const [key,limit] of Object.entries(limits)){
    if(!Object.hasOwn(inventory,key)||!Number.isSafeInteger(inventory[key])||inventory[key]<0)throw new Error(`Unknown or invalid resource metric: ${key}`);
    if(!Number.isSafeInteger(limit)||limit<0)throw new Error(`Invalid resource limit: ${key}`);
    if(inventory[key]>limit)throw new Error(`Resource budget exceeded: ${key} ${inventory[key]} > ${limit}`);
  }
  return inventory;
}
