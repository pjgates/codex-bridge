import { expect, it } from "vitest";
import { selectedObservers } from "../../../src/canvas/sensory/observers.js";
import { definition, owner, token } from "./fixtures.js";
it("combines only selected owners and retains each token's rank and geometry", () => {
    const selected = [token("Token.a", { rank: 2 }), token("Token.b", { rank: 1, x: 300, elevation: 20, levelId: "upper" }),
        token("Token.observer", { owns: false, rank: 3 })];
    selected[1].getListenerPosition = () => ({ x: 320, y: 10, elevation: 22 });
    const views = selectedObservers(selected, owner, () => definition());
    expect(views.map(view => view.tokenUuid)).toEqual(["Token.a", "Token.b"]);
    expect(views[1].applications[0].rank).toBe(1);
    expect(views[1].position).toEqual({ x: 300, y: 0, elevation: 20, levelId: "upper" });
    expect(views[1].listener).toEqual({ x: 320, y: 10, elevation: 22, levelId: "upper" });
    expect(selectedObservers([], owner, () => definition())).toEqual([]);
});
