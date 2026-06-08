/**
 * Verifier — the critic that gates high-stakes actions before they commit.
 *
 * The agent decides on an action; the verifier independently checks that the
 * action actually follows from its justification (and signals/situation when
 * available) before it reaches the customer or the CSM. This is the third gate,
 * distinct from the override gate (policy floor) and the pause window (human
 * cancel). Pluggable, like every seam: default is an adversarial LLM critic;
 * can be rule-based or disabled.
 */

export interface VerificationInput {
	/** The band being attempted (e.g. "notify-then-act", "escalate"). */
	band: string;
	customerId: string;
	customerName?: string;
	/** One-line description of the action. */
	summary: string;
	/** The agent's stated justification. */
	reason: string;
	/** Perceived signals, when the caller has them (absent for chat-fired actions). */
	signals?: string;
	/** The open situation/storyline, when available. */
	situation?: string;
	/** Action payload (e.g. the customer message text, escalation options). */
	payload?: Record<string, unknown>;
}

export interface VerificationResult {
	/** True = the action may proceed; false = block it. */
	pass: boolean;
	/** Human-readable explanation (recorded on a blocked action). */
	reason: string;
	/** Optional advice — a band the verifier thinks fits better. Advisory only; never auto-applied. */
	suggestedBand?: string;
}

export interface Verifier {
	verify(input: VerificationInput): Promise<VerificationResult>;
}
