// Run as a GM Script macro, exclusively in the user-designated Testing Scene.
if (!game.user.isGM || canvas.scene?.name !== "Testing Scene") throw new Error("Open Testing Scene as GM first.");
const scene = canvas.scene;
const ensureLevel = async (id, name, bottom, top) => scene.levels.get(id) ?? (await scene.createEmbeddedDocuments("Level", [{_id:id,name,elevation:{bottom,top}}], {keepId:true}))[0];
const upper = await ensureLevel("codexTestUpper01", "Codex test upper", 100000, 100020);
const lower = await ensureLevel("codexTestLower01", "Codex test lower", 99980, 100000);
const x = canvas.dimensions.sceneRect.x + 100, y = canvas.dimensions.sceneRect.y + 100;
for (const [id,name,width,elevation,level] of [["codexTestFloor01","Codex test edge",300,100000,upper.id],["codexTestFloor02","Codex test landing",800,99980,lower.id]]) {
    if (!scene.regions.has(id)) await scene.createEmbeddedDocuments("Region", [{_id:id,name,levels:[level],shapes:[{type:"rectangle",x,y,width,height:300}],behaviors:[{type:"codex-foundry.setElevation",system:{elevation}}]}], {keepId:true});
}
await scene.view({level:upper.id});
let token = scene.tokens.get("codexTestToken01");
if (!token) token=(await scene.createEmbeddedDocuments("Token",[{_id:"codexTestToken01",name:"Codex pause probe",x:x+50,y:y+100,elevation:100000,level:upper.id,width:1,height:1,texture:{src:"icons/svg/mystery-man.svg"}}],{keepId:true}))[0];
if (token.movement.user.isSelf) token.stopMovement();
await token.move([{x:x+50,y:y+100,elevation:100000,level:upper.id,action:"displace"}],{animate:false,codexMovementPlanned:true});
void token.move([{x:x+550,y:y+100,elevation:100000,level:upper.id,action:"walk"}],{animate:false});
await new Promise(resolve=>setTimeout(resolve,1200));
const result={core:game.version,system:game.system.version,scene:scene.name,state:token.movement.state,pending:token.movement.pending?.waypoints.length,position:{x:token.x,y:token.y,elevation:token.elevation,level:token.level},expected:"paused before edge, upper level, no descent"};
if (token.movement.user.isSelf) token.stopMovement();
await foundry.applications.api.DialogV2.wait({window:{title:"Codex movement probe"},content:`<pre>${foundry.utils.escapeHTML(JSON.stringify(result,null,2))}</pre>`,buttons:[{action:"close",label:"Close"}]});
