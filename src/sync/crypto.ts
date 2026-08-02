import type { EncryptedBlob, SyncPayload } from "./payload-types.js";

const PBKDF2_ITERATIONS = 210_000;

function toBase64(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptPayload(payload: SyncPayload, passphrase: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource }, key,
        new TextEncoder().encode(JSON.stringify(payload)));
    const blob: EncryptedBlob = { v: 1, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
    return JSON.stringify(blob);
}

export async function decryptPayload(blobJson: string, passphrase: string): Promise<SyncPayload> {
    const blob = JSON.parse(blobJson) as EncryptedBlob;
    if (blob.v !== 1) throw new Error(`Unsupported payload blob version: ${String(blob.v)}`);
    const key = await deriveKey(passphrase, fromBase64(blob.salt));
    let plaintext: ArrayBuffer;
    try {
        plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: fromBase64(blob.iv) as BufferSource }, key,
            fromBase64(blob.data) as BufferSource);
    } catch {
        throw new Error("Decryption failed — wrong passphrase or corrupted payload.");
    }
    return JSON.parse(new TextDecoder().decode(plaintext)) as SyncPayload;
}
