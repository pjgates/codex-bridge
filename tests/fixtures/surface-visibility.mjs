// Explicit GM test fixture. Import this from the disposable test deployment only.
const SCENE='ICGvusDt5doJCahX', MODULE='codex-foundry';
export async function setupSurfaceVisibility() {
  if(!game.user.isGM || canvas.scene.id!==SCENE)throw Error('View Testing Scene as GM.');
  const scene=canvas.scene, macro=game.macros.get('eqW02Qtvt4Ml31gl');
  if(macro.getFlag(MODULE,'visibilityFixture'))throw Error('Restore the existing fixture before creating another.');
  const snapshot={scene:scene.id,tokenVision:scene.tokenVision,levels:[],regions:[],tiles:[],tokens:[],walls:[]};
  await macro.setFlag(MODULE,'visibilityFixture',snapshot);
  const remember=async(type,values,key)=>{
    const docs=await scene.createEmbeddedDocuments(type,values);snapshot[key].push(...docs.map(d=>d.id));
    await macro.setFlag(MODULE,'visibilityFixture',snapshot);return docs;
  };
  const levels=await remember('Level',[{name:'Surface test lower',elevation:{bottom:0,top:10}},{name:'Surface test upper',elevation:{bottom:10,top:20}}],'levels');
  const [lower,upper]=levels;
  await lower.update({'visibility.levels':[upper.id]});await upper.update({'visibility.levels':[lower.id]});
  const shapes=[{type:'rectangle',x:1100,y:900,width:400,height:300}];
  await remember('Region',[{name:'Surface test deck',shapes,levels:[upper.id],elevation:{bottom:10,top:10},behaviors:[
    {type:'codex-foundry.setElevation',system:{elevation:10}},
    {type:'codex-foundry.surfaceGeometry',system:{extent:'finite',underside:7.5,blocksSight:false,blocksLight:false}}]},
    {name:'Surface test native plane',shapes,levels:[],elevation:{bottom:10,top:10},behaviors:[{type:'defineSurface',system:{placement:'bottom',move:false,sight:false,light:false,sound:true,occlusion:false,exposure:false,culling:false}}]}],'regions');
  const texture=src=>({src:`modules/codex-foundry/test-surfaces/${src}.svg`,anchorX:0,anchorY:0});
  await remember('Tile',[{x:1000,y:800,width:800,height:500,elevation:0,levels:[lower.id],texture:texture('lower'),occlusion:{modes:[],alpha:0}},
    {x:1100,y:900,width:400,height:300,elevation:10,levels:levels.map(l=>l.id),texture:texture('deck'),occlusion:{modes:[],alpha:0}}],'tiles');
  await remember('Token',[
    {name:'Upper visible target',x:1350,y:1000,elevation:10,level:upper.id,texture:{src:'icons/svg/mystery-man.svg'}},
    {name:'Below visible target',x:1350,y:1100,elevation:0,level:lower.id,texture:{src:'icons/svg/mystery-man.svg'}},
    {name:'Behind wall target',x:1700,y:1000,elevation:10,level:upper.id,texture:{src:'icons/svg/mystery-man.svg'}},
    {name:'Hidden negative control',x:1250,y:1000,elevation:10,level:upper.id,hidden:true,texture:{src:'icons/svg/mystery-man.svg'}}],'tokens');
  await remember('Wall',[{c:[1600,800,1600,1300],levels:[],move:20,sight:20,light:20,sound:20}],'walls');
  await scene.update({tokenVision:true});
  const bob=scene.tokens.get('codexTestToken01');bob.stopMovement();
  await bob.move([{x:1150,y:1000,elevation:0,level:lower.id,action:'displace'}],{codexMovementPlanned:true,constrainOptions:{ignoreWalls:true,ignoreCost:true}});
  await bob.update({'sight.enabled':true,'sight.range':100});
  await scene.view({level:lower.id});bob.object.control();await canvas.animatePan({x:1400,y:1050,scale:1});
  return snapshot;
}
export async function setSurfaceCandidate(opaque=false) {
  const scene=game.scenes.get(SCENE),saved=game.macros.get('eqW02Qtvt4Ml31gl').getFlag(MODULE,'visibilityFixture');
  await scene.regions.get(saved.regions[1]).behaviors.contents[0].update({'system.occlusion':true,'system.sight':opaque,'system.light':opaque});
  await scene.tiles.get(saved.tiles[1]).update({'occlusion.modes':[CONST.OCCLUSION_MODES.SURFACE],'occlusion.alpha':0});
}
