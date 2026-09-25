// Explicit disposable Testing Scene integration. Never imported by module startup.
export async function importSurfaceFixture(){
 const s=game.scenes.get('ICGvusDt5doJCahX'),m=game.macros.get('eqW02Qtvt4Ml31gl'),ns='codex-foundry';
 if(!game.user.isGM)throw Error('GM required');
 if(m.getFlag(ns,'surfaceExportFixture'))throw Error('Restore the prior export fixture first');
 const saved={width:s.width,height:s.height,padding:s.padding,grid:s.toObject().grid,levels:[],regions:[],walls:[],tiles:[],tokens:[]};
 await m.setFlag(ns,'surfaceExportFixture',saved);
 const {readZip}=await import('/modules/map-workshop-importer/scripts/unzip.js');
 const {prepareScene,withRegionProvider,regionProvider}=await import('/modules/map-workshop-importer/scripts/import-scene.js?surface7');
 const entries=readZip(new Uint8Array(await(await fetch('/modules/codex-foundry/test-surfaces/generated/surface-test.zip')).arrayBuffer()));
 const {scene}=prepareScene(entries),data=withRegionProvider(scene,regionProvider(scene,game.modules.get(ns).active,CONFIG.RegionBehavior.dataModels));
 const ids=new Map(data.levels.map(l=>[l._id,foundry.utils.randomID()]));
 for(const l of data.levels){l._id=ids.get(l._id);l.visibility.levels=l.visibility.levels.map(id=>ids.get(id));}
 for(const d of [...data.regions,...data.walls,...data.tiles])d.levels=d.levels.map(id=>ids.get(id));
 const create=async(type,documents,key)=>{const created=await s.createEmbeddedDocuments(type,documents,{keepId:true});saved[key].push(...created.map(d=>d.id));await m.setFlag(ns,'surfaceExportFixture',saved);return created;};
 const dx=1100,dy=1000,d=s.dimensions;
 for(const l of data.levels)Object.assign(l.textures,{scaleX:data.width/s.width,scaleY:data.height/s.height,
  offsetX:dx+data.width/2-(d.sceneX+s.width/2),offsetY:dy+data.height/2-(d.sceneY+s.height/2)});
 for(const r of data.regions)for(const shape of r.shapes)shape.points=shape.points.map((v,i)=>v+(i%2?dy:dx));
 for(const w of data.walls)w.c=w.c.map((v,i)=>v+(i%2?dy:dx));
 for(const t of data.tiles){t.x+=dx;t.y+=dy;}saved.offset={x:dx,y:dy};
 const levels=await create('Level',data.levels,'levels');
 await create('Region',data.regions,'regions');await create('Wall',data.walls,'walls');await create('Tile',data.tiles,'tiles');
 await create('Token',[{name:'Export upper target',x:dx+310,y:dy+110,width:0.5,height:0.5,elevation:10,level:levels[1].id,texture:{src:'icons/svg/mystery-man.svg'}},
  {name:'Export hidden target',x:dx+290,y:dy+95,width:0.5,height:0.5,elevation:10,level:levels[1].id,hidden:true,texture:{src:'icons/svg/mystery-man.svg'}}],'tokens');
 const dataBob=s.tokens.get('codexTestToken01').toObject();delete dataBob._id;
 Object.assign(dataBob,{name:'Bob export test',x:dx+280,y:dy+105,width:0.5,height:0.5,elevation:-20,level:levels[0].id,_movementHistory:[]});
 Object.assign(dataBob.sight,{enabled:true,range:100});
 const [bob]=await create('Token',[dataBob],'tokens');
 await s.view({level:levels[0].id});bob.object.control();await canvas.animatePan({x:dx+250,y:dy+115,scale:2});
 return saved;
}
