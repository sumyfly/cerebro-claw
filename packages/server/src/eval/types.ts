import type { ActionBand } from "@cerebro-claw/shared";

/** What the agent should have decided for a scenario. "none" = no action. */
export type ExpectedBand = ActionBand | "none";

export interface ScenarioOverride {
	/** e.g. "escalate everything for this account" */
	rule: string;
	forcesBand?: ActionBand;
}

export interface Scenario {
	id: string;
	description: string;
	/** Fixture map served by MockCspTransport, keyed by exact CSP path. */
	csp: Record<string, unknown>;
	memory?: {
		instincts?: string[];
		overrides?: ScenarioOverride[];
	};
	expect: {
		band: ExpectedBand;
		tool?: string;
		overrideHonored?: boolean;
	};
}

export interface ScenarioResult {
	id: string;
	pass: boolean;
	expectedBand: ExpectedBand;
	actualBand: ExpectedBand;
	failures: string[];
}
