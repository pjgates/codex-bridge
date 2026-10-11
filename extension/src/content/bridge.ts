import {
    COMMAND_EVENT,
    OBSERVATION_EVENT,
    parseObservation,
    type Observation,
    type PageCommand,
} from "../shared/protocol.js";
import { decodeDetail, encodeDetail } from "../shared/wire.js";

export function listenForObservations(
    callback: (observation: Observation) => void,
): () => void {
    const listener = (event: Event): void => {
        const parsed = parseObservation(decodeDetail((event as CustomEvent<unknown>).detail));
        if (parsed) callback(parsed);
    };
    window.addEventListener(OBSERVATION_EVENT, listener);
    return () => window.removeEventListener(OBSERVATION_EVENT, listener);
}

export function sendPageCommand(command: PageCommand): void {
    window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: encodeDetail(command) }));
}
