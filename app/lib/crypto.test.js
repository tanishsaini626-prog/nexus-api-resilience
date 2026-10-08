import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncryptionEnabled } from "./crypto.js";

// A fixed 32-byte key (64 hex chars) so tests are deterministic. Real
// deployments generate a random one — see NEXUS_ENCRYPTION_KEY in .env.local.
const TEST_KEY_HEX = "a".repeat(64);
const OTHER_KEY_HEX = "b".repeat(64);

describe("crypto.js - AES-256-GCM provider key encryption", () => {
  let originalKey;

  beforeEach(() => {
    originalKey = process.env.NEXUS_ENCRYPTION_KEY;
    process.env.NEXUS_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.NEXUS_ENCRYPTION_KEY;
    else process.env.NEXUS_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips a provider key through encrypt -> decrypt", () => {
    const plaintext = "sk-proj-abcdef1234567890";
    const stored = encryptSecret(plaintext);

    expect(stored).not.toBe(plaintext);
    expect(decryptSecret(stored)).toBe(plaintext);
  });

  it("stores ciphertext with the versioned prefix and never leaks the plaintext", () => {
    const plaintext = "AIzaSySuperSecretGeminiKey";
    const stored = encryptSecret(plaintext);

    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain(plaintext);
    expect(stored).not.toContain(plaintext.slice(-4)); // not even the tail
  });

  it("produces different ciphertext each time (fresh random IV)", () => {
    const plaintext = "sk-same-key-twice";

    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it("throws when the ciphertext is tampered with (GCM auth tag check)", () => {
    const stored = encryptSecret("sk-tamper-me");
    const prefix = "enc:v1:";
    const payload = stored.slice(prefix.length);

    // Flip one character in the base64 payload.
    const flipped = payload[0] === "A" ? "B" : "A";
    const tampered = prefix + flipped + payload.slice(1);

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws when decrypting with a different key", () => {
    const stored = encryptSecret("sk-wrong-key-test");

    process.env.NEXUS_ENCRYPTION_KEY = OTHER_KEY_HEX;
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("passes legacy plaintext through unchanged (rows written before encryption)", () => {
    expect(decryptSecret("sk-legacy-plaintext-row")).toBe("sk-legacy-plaintext-row");
    expect(decryptSecret("AIza-legacy")).toBe("AIza-legacy");
  });

  it("falls back to plaintext storage when no key is configured", () => {
    delete process.env.NEXUS_ENCRYPTION_KEY;

    expect(isEncryptionEnabled()).toBe(false);
    expect(encryptSecret("sk-unencrypted")).toBe("sk-unencrypted");

    // A value that IS encrypted cannot be read without the key — it must fail
    // loudly rather than silently returning the ciphertext as if it were a key.
    expect(() => decryptSecret("enc:v1:AQEBAQEBAQEBAQEBAQEBAQEBAQEB")).toThrow(/NEXUS_ENCRYPTION_KEY/);
  });

  it("rejects a malformed encryption key instead of silently using it", () => {
    process.env.NEXUS_ENCRYPTION_KEY = "tooshort";

    expect(() => encryptSecret("sk-anything")).toThrow(/64 hex/);
  });

  it("reports encryption as enabled when a key is configured", () => {
    expect(isEncryptionEnabled()).toBe(true);
  });
});
