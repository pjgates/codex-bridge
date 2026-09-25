import type { Degree } from "./checks.js";
export function climbDistance(speed:number,degree:Degree):number {
    if(degree<2) return 0;
    return Math.max(1,Math.floor(speed/20))*5+(degree===3?5:0);
}
export function climbProgress(input:{rise:number;speed:number;degree:Degree;handsFree:number;climbSpeed:number;stable?:boolean;quickClimb?:boolean;combatClimber?:boolean}):{distance:number;fall:boolean;prone:boolean} {
    if(!input.climbSpeed && input.handsFree<(input.combatClimber?1:2)) return {distance:0,fall:false,prone:false};
    if(input.degree===0) return {distance:0,fall:!input.stable,prone:!!input.stable};
    let maximum=input.climbSpeed>0 && input.degree>=2 ? input.climbSpeed+(input.degree===3?5:0) : climbDistance(input.speed,input.degree);
    if(input.quickClimb && input.degree>=2) maximum=Math.min(input.speed,maximum+(input.degree===3?10:5));
    return {distance:Math.min(Math.abs(input.rise),maximum),fall:false,prone:false};
}
