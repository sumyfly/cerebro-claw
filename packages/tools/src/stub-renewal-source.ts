import type { RenewalRecord, RenewalSource } from "@cerebro-claw/shared";

export interface StubRenewalSourceOptions {
	/** Seed renewals. Defaults to a single upcoming at-risk renewal. */
	renewals?: RenewalRecord[];
}

/**
 * In-memory RenewalSource for dev/tests — mirrors StubTaskSource. listOpen
 * returns the seeded renewals; getContext fetches one by id.
 */
export class StubRenewalSource implements RenewalSource {
	label = "stub-renewals";
	private renewals: RenewalRecord[];

	constructor(opts: StubRenewalSourceOptions = {}) {
		this.renewals = opts.renewals ?? [
			{
				id: "00000000-0000-0000-0000-000000000001",
				businessId: "biz-stub-1",
				customerName: "StubCafé",
				status: "in-progress",
				daysToRenewal: 16,
				arr: 2811,
				atRisk: true,
			},
		];
	}

	async listOpen(): Promise<RenewalRecord[]> {
		return this.renewals;
	}

	async getContext(id: string): Promise<RenewalRecord | null> {
		return this.renewals.find((r) => r.id === id) ?? null;
	}
}
