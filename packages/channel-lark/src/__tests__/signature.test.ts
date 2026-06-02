import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLarkSignature } from "../lark-bot.js";

function sign(token: string, timestamp: string, nonce: string, body: string): string {
	return createHash("sha256")
		.update(timestamp + nonce + token + body)
		.digest("hex");
}

describe("verifyLarkSignature", () => {
	const token = "verification-token-abc";
	const timestamp = "1716950000";
	const nonce = "nonce-xyz";
	const body = '{"event":"im.message.receive_v1"}';

	it("accepts a valid signature", () => {
		const sig = sign(token, timestamp, nonce, body);
		expect(verifyLarkSignature(token, timestamp, nonce, body, sig)).toBe(true);
	});

	it("rejects a tampered signature", () => {
		const sig = sign(token, timestamp, nonce, body);
		// Flip the last char to one that's guaranteed different
		const lastChar = sig.at(-1)!;
		const replacement = lastChar === "f" ? "0" : "f";
		expect(verifyLarkSignature(token, timestamp, nonce, body, sig.slice(0, -1) + replacement)).toBe(
			false,
		);
	});

	it("rejects when body differs", () => {
		const sig = sign(token, timestamp, nonce, body);
		expect(verifyLarkSignature(token, timestamp, nonce, "tampered", sig)).toBe(false);
	});

	it("rejects when token differs", () => {
		const sig = sign(token, timestamp, nonce, body);
		expect(verifyLarkSignature("wrong-token", timestamp, nonce, body, sig)).toBe(false);
	});

	it("rejects when timestamp differs", () => {
		const sig = sign(token, timestamp, nonce, body);
		expect(verifyLarkSignature(token, "different", nonce, body, sig)).toBe(false);
	});

	it("rejects empty signature", () => {
		expect(verifyLarkSignature(token, timestamp, nonce, body, "")).toBe(false);
	});

	it("does not throw on malformed input", () => {
		expect(() =>
			verifyLarkSignature(token, timestamp, nonce, body, "not-hex-at-all"),
		).not.toThrow();
	});
});
