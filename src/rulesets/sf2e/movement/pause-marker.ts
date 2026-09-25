import {prepareTransition, type MovementToken, type Waypoint} from "./transitions.js";
import {forcedIntent, forcedMovementHeld} from "./forced.js";
import {MODULE_ID} from "../../../constants.js";

interface Ruler {
    token:{document:MovementToken;layer:PIXI.Container};visible:boolean;
    refresh(data:{plannedMovement:Record<string,{foundPath:Waypoint[]}>}):void;
    clear():void;destroy():void;_onVisibleChange():void;
}
/** A display-only marker: never insert a checkpoint into the user's actual proposed route. */
export function activatePauseMarker():void {
    const prototype=(CONFIG.Token.rulerClass as unknown as {prototype:Ruler}).prototype;
    const markers=new WeakMap<Ruler,PIXI.Graphics>();
    const refresh=prototype.refresh,clear=prototype.clear,destroy=prototype.destroy,visibility=prototype._onVisibleChange;
    prototype.refresh=function(data) {
        refresh.call(this,data);
        markers.get(this)?.clear();
        const path=data.plannedMovement[game.user!.id]?.foundPath;
        if(!game.settings!.get(MODULE_ID,"enableCustomRules") || !this.visible || !path || path.length<2)return;
        const plan=prepareTransition(this.token.document,{id:"preview",origin:path[0],passed:{waypoints:path.slice(1)},pending:{waypoints:[]}},forcedIntent(forcedMovementHeld()));
        if(!plan.transition)return;
        let marker=markers.get(this);
        if(!marker) {marker=this.token.layer.addChild(new PIXI.Graphics());markers.set(this,marker);}
        const point=this.token.document.getMovementOrigin(plan.transition.safe),scale=1/canvas!.stage!.scale.x;
        marker.visible=this.visible;
        marker.position.set(point.x,point.y);marker.scale.set(scale);
        marker.lineStyle(2,0x18151f).beginFill(0xffbf47).drawCircle(0,0,9).endFill();
        marker.lineStyle(3,0x18151f).moveTo(-3,-4).lineTo(-3,4).moveTo(3,-4).lineTo(3,4);
    };
    prototype._onVisibleChange=function() {visibility.call(this);const marker=markers.get(this);if(marker)marker.visible=this.visible;};
    prototype.clear=function() {markers.get(this)?.clear();clear.call(this);};
    prototype.destroy=function() {markers.get(this)?.destroy();markers.delete(this);destroy.call(this);};
}
