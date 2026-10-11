import { afterEach, describe, expect, it, vi } from "vitest";
import { observeRenderedChecks, parseRenderedCheck } from "../../src/content/dom-fallback.js";
import type { Observation } from "../../src/shared/protocol.js";

function card(messageId: string, total = "27", degree = "success"): HTMLLIElement {
    const element = document.createElement("li");
    element.className = "chat-message";
    element.dataset.messageId = messageId;
    element.innerHTML = `
        <div class="message-content">
            <span class="dice-total">${total}</span>
            <span class="degree-of-success ${degree}">Label</span>
        </div>
    `;
    return element;
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("PF2e 8.5 DOM fallback", () => {
    it("captures a visible total and degree as unassigned evidence", () => {
        const element = document.createElement("li");
        element.dataset.messageId = "message-1";
        element.innerHTML = `
            <div class="message-content">
                <span class="dice-total">27</span>
                <span class="degree-of-success success">Success</span>
            </div>
        `;
        expect(parseRenderedCheck(element)).toMatchObject({
            type: "unassigned-check",
            payload: { messageId: "message-1", total: 27, outcome: "success" },
        });
    });

    it.each([
        `<span class="dice-total">NaN</span>`,
        `<span class="dice-total">27</span><span class="degree-of-success">Unknown</span>`,
        `<span class="dice-total">27.5</span><span class="degree-of-success success">S</span>`,
        `<span class="dice-total">1e3</span><span class="degree-of-success success">S</span>`,
        `<span class="dice-total">0x1A</span><span class="degree-of-success success">S</span>`,
        `<span class="dice-total"></span><span class="degree-of-success success">S</span>`,
        `<span class="dice-total">99999999999999999999</span><span class="degree-of-success success">S</span>`,
    ])("rejects unsupported card %#", (html) => {
        const element = document.createElement("li");
        element.dataset.messageId = "message-1";
        element.innerHTML = html;
        expect(parseRenderedCheck(element)).toBeNull();
    });

    it("rejects cards without a message id", () => {
        const element = card("");
        delete element.dataset.messageId;
        expect(parseRenderedCheck(element)).toBeNull();
    });

    it.each([
        ["critical-success", "criticalSuccess"],
        ["critical-failure", "criticalFailure"],
        ["failure", "failure"],
    ])("maps degree class %s", (className, outcome) => {
        expect(parseRenderedCheck(card("m", "-3", className))).toMatchObject({
            payload: { total: -3, outcome },
        });
    });

    it("reads text without executing card markup", () => {
        const element = document.createElement("li");
        element.dataset.messageId = "message-1";
        element.innerHTML = `
            <span class="dice-total">27</span>
            <span class="degree-of-success success">Success</span>
            <img src="invalid" onerror="window.bad = true">
        `;
        expect(parseRenderedCheck(element)).toMatchObject({
            type: "unassigned-check",
            payload: { total: 27, outcome: "success" },
        });
        expect((window as Window & { bad?: boolean }).bad).toBeUndefined();
    });

    it("emits existing and newly added cards once each", async () => {
        const log = document.createElement("ol");
        log.append(card("m1"));
        document.body.append(log);
        const emitted: Observation[] = [];
        const stop = observeRenderedChecks(document.body, (observation) => emitted.push(observation));
        expect(emitted.map((entry) => entry.eventId)).toEqual(["dom:m1"]);

        log.append(card("m2"));
        const wrapper = document.createElement("div");
        wrapper.append(card("m3"), card("m1"));
        log.append(wrapper);
        await settle();
        expect(emitted.map((entry) => entry.eventId)).toEqual(["dom:m1", "dom:m2", "dom:m3"]);

        stop();
        stop();
        log.append(card("m4"));
        await settle();
        expect(emitted).toHaveLength(3);
    });

    it("bounds remembered message ids to the most recent 2,000", async () => {
        const log = document.createElement("ol");
        for (let index = 0; index <= 2_000; index += 1) log.append(card(`m${index}`));
        document.body.append(log);
        const emit = vi.fn();
        const stop = observeRenderedChecks(document.body, emit);
        expect(emit).toHaveBeenCalledTimes(2_001);

        log.append(card("m2000"));
        await settle();
        expect(emit).toHaveBeenCalledTimes(2_001);
        log.append(card("m0"));
        await settle();
        expect(emit).toHaveBeenCalledTimes(2_002);
        stop();
    });
});
