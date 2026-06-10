import type { Verifier } from "@cerebro-claw/shared";

/** A verifier that always passes — the "verification disabled" path, and a test/dev default. */
export function createNoopVerifier(): Verifier {
	return {
		async verify() {
			return { pass: true, reason: "verification disabled" };
		},
	};
}
