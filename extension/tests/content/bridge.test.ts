import { afterEach, describe, expect, it, vi } from "vitest";
import { listenForObservations, sendPageCommand } from "../../src/content/bridge.js";
import { COMMAND_EVENT, OBSERVATION_EVENT, type Observation } from "../../src/shared/protocol.js";

const observation: Observation = {
    protocol: 1,
    eventId: "target-1",
    timestamp: 1,
    type: "target",
    payload: { tokenUuid: "Scene.s.Token.t" },
};

const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});

function dispatch(detail: unknown): void {
    window.dispatchEvent(new CustomEvent(OBSERVATION_EVENT, { detail }));
}

describe("content bridge", () => {
    it("delivers only valid string-encoded observations", () => {
        const callback = vi.fn();
        cleanups.push(listenForObservations(callback));
        dispatch(observation);
        dispatch("{broken");
        dispatch(JSON.stringify({ ...observation, protocol: 2 }));
        dispatch(JSON.stringify(observation));
        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith(observation);
    });

    it("stops delivering after unsubscribe", () => {
        const callback = vi.fn();
        const stop = listenForObservations(callback);
        stop();
        dispatch(JSON.stringify(observation));
        expect(callback).not.toHaveBeenCalled();
    });

    it("sends page commands as JSON string details", () => {
        const received: unknown[] = [];
        const listener = (event: Event): void => {
            received.push((event as CustomEvent<unknown>).detail);
        };
        window.addEventListener(COMMAND_EVENT, listener);
        cleanups.push(() => window.removeEventListener(COMMAND_EVENT, listener));
        sendPageCommand({ protocol: 1, type: "teardown", payload: {} });
        expect(received).toEqual([JSON.stringify({ protocol: 1, type: "teardown", payload: {} })]);
    });
});
