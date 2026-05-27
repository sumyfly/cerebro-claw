import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteStore } from "@cerebro-claw/memory";
import { loadConfig } from "./config.js";

const config = loadConfig();
mkdirSync(dirname(config.dbPath), { recursive: true });
const store = new SqliteStore(config.dbPath);

async function seed() {
	console.log("[seed] Seeding database...");

	// Customer 1: Acme Corp — healthy, active
	await store.upsertProfile({
		id: "acme",
		companyName: "Acme Corp",
		companySize: "200-500",
		plan: "Enterprise",
		contractValue: 120000,
		contacts: [
			{ name: "John Chen", role: "VP Engineering", email: "john@acme.com", isDecisionMaker: true },
			{ name: "Lisa Park", role: "Engineering Manager", email: "lisa@acme.com", isDecisionMaker: false },
		],
		csmOwnerId: "sarah",
		createdAt: new Date("2025-06-15"),
		updatedAt: new Date("2026-05-20"),
	});
	await store.updateState({
		customerId: "acme",
		health: "good",
		openIssues: 1,
		lastContactDate: new Date("2026-05-20"),
		renewalDate: new Date("2026-09-15"),
		usageTrend: "up",
		updatedAt: new Date("2026-05-27"),
	});
	await store.addHistory({ id: "h-acme-1", customerId: "acme", type: "call", summary: "Q1 review — happy with API performance, asked about webhook support", timestamp: new Date("2026-03-10") });
	await store.addHistory({ id: "h-acme-2", customerId: "acme", type: "email", summary: "Sent webhook docs and roadmap timeline", timestamp: new Date("2026-03-12") });
	await store.addHistory({ id: "h-acme-3", customerId: "acme", type: "ticket", summary: "Minor bug in batch export — resolved in 2 days", timestamp: new Date("2026-04-05") });
	await store.addHistory({ id: "h-acme-4", customerId: "acme", type: "call", summary: "QBR prep — expansion discussion, 3 new teams want access", timestamp: new Date("2026-05-20") });
	await store.addInstinct({ id: "i-acme-1", customerId: "acme", content: "John is the real decision maker, not the VP listed on the contract", source: "sarah", createdAt: new Date("2025-08-10") });
	await store.addInstinct({ id: "i-acme-2", customerId: "acme", content: "They value fast response on tickets more than feature velocity", source: "sarah", createdAt: new Date("2026-01-15") });

	// Customer 2: Globex Inc — at risk, usage dropping
	await store.upsertProfile({
		id: "globex",
		companyName: "Globex Inc",
		companySize: "50-200",
		plan: "Growth",
		contractValue: 48000,
		contacts: [
			{ name: "Mike Torres", role: "CTO", email: "mike@globex.io", isDecisionMaker: true },
			{ name: "Amy Walsh", role: "Product Lead", email: "amy@globex.io", isDecisionMaker: false },
		],
		csmOwnerId: "sarah",
		createdAt: new Date("2025-09-01"),
		updatedAt: new Date("2026-05-15"),
	});
	await store.updateState({
		customerId: "globex",
		health: "at-risk",
		openIssues: 3,
		lastContactDate: new Date("2026-04-28"),
		renewalDate: new Date("2026-07-01"),
		usageTrend: "dropping",
		updatedAt: new Date("2026-05-27"),
	});
	await store.addHistory({ id: "h-globex-1", customerId: "globex", type: "call", summary: "Onboarding kickoff — Mike excited about integration", timestamp: new Date("2025-09-10") });
	await store.addHistory({ id: "h-globex-2", customerId: "globex", type: "ticket", summary: "Integration timeout errors — took 5 days to resolve, Mike frustrated", timestamp: new Date("2026-01-20") });
	await store.addHistory({ id: "h-globex-3", customerId: "globex", type: "email", summary: "Mike asked about competitor pricing — replied with value comparison", timestamp: new Date("2026-03-15") });
	await store.addHistory({ id: "h-globex-4", customerId: "globex", type: "event", summary: "Usage dropped 35% month-over-month", timestamp: new Date("2026-05-01") });
	await store.addInstinct({ id: "i-globex-1", customerId: "globex", content: "Mike is evaluating Zendesk as an alternative — price sensitive", source: "sarah", createdAt: new Date("2026-03-16") });
	await store.addInstinct({ id: "i-globex-2", customerId: "globex", content: "Bad onboarding experience still colors their perception — be extra responsive", source: "sarah", createdAt: new Date("2026-02-01") });

	// Customer 3: NovaTech — new, onboarding
	await store.upsertProfile({
		id: "novatech",
		companyName: "NovaTech Solutions",
		companySize: "10-50",
		plan: "Starter",
		contractValue: 12000,
		contacts: [
			{ name: "Sara Kim", role: "CEO", email: "sara@novatech.dev", isDecisionMaker: true },
		],
		csmOwnerId: "sarah",
		createdAt: new Date("2026-05-01"),
		updatedAt: new Date("2026-05-20"),
	});
	await store.updateState({
		customerId: "novatech",
		health: "good",
		openIssues: 0,
		lastContactDate: new Date("2026-05-20"),
		renewalDate: new Date("2027-05-01"),
		usageTrend: "up",
		updatedAt: new Date("2026-05-27"),
	});
	await store.addHistory({ id: "h-nova-1", customerId: "novatech", type: "call", summary: "Sales handoff — Sara is technical, wants API-first approach", timestamp: new Date("2026-05-01") });
	await store.addHistory({ id: "h-nova-2", customerId: "novatech", type: "email", summary: "Sent onboarding guide and API quickstart", timestamp: new Date("2026-05-02") });
	await store.addHistory({ id: "h-nova-3", customerId: "novatech", type: "call", summary: "Week 2 check-in — integration going well, asked about SSO", timestamp: new Date("2026-05-20") });
	await store.addInstinct({ id: "i-nova-1", customerId: "novatech", content: "Small team but high growth potential — Sara mentioned Series A closing soon", source: "sarah", createdAt: new Date("2026-05-01") });

	// Customer 4: Meridian — critical, escalated
	await store.upsertProfile({
		id: "meridian",
		companyName: "Meridian Healthcare",
		companySize: "500+",
		plan: "Enterprise",
		contractValue: 240000,
		contacts: [
			{ name: "Dr. Rachel Green", role: "CIO", email: "rgreen@meridian.health", isDecisionMaker: true },
			{ name: "Tom Bradley", role: "IT Director", email: "tbradley@meridian.health", isDecisionMaker: false },
		],
		csmOwnerId: "sarah",
		createdAt: new Date("2024-11-01"),
		updatedAt: new Date("2026-05-25"),
	});
	await store.updateState({
		customerId: "meridian",
		health: "critical",
		openIssues: 5,
		lastContactDate: new Date("2026-05-25"),
		renewalDate: new Date("2026-06-30"),
		usageTrend: "dropping",
		updatedAt: new Date("2026-05-27"),
	});
	await store.addHistory({ id: "h-mer-1", customerId: "meridian", type: "ticket", summary: "HIPAA compliance concern — data residency question escalated to legal", timestamp: new Date("2026-04-10") });
	await store.addHistory({ id: "h-mer-2", customerId: "meridian", type: "call", summary: "Escalation call with Dr. Green — she's unhappy about compliance response time", timestamp: new Date("2026-04-20") });
	await store.addHistory({ id: "h-mer-3", customerId: "meridian", type: "email", summary: "Sent compliance documentation and SOC2 report", timestamp: new Date("2026-04-22") });
	await store.addHistory({ id: "h-mer-4", customerId: "meridian", type: "call", summary: "Follow-up — Tom says internal team still reviewing, decision by end of May", timestamp: new Date("2026-05-10") });
	await store.addHistory({ id: "h-mer-5", customerId: "meridian", type: "event", summary: "Renewal in 34 days — no renewal confirmation yet", timestamp: new Date("2026-05-25") });
	await store.addInstinct({ id: "i-mer-1", customerId: "meridian", content: "Dr. Green is the blocker — she needs personal reassurance, not just docs", source: "sarah", createdAt: new Date("2026-04-21") });
	await store.addInstinct({ id: "i-mer-2", customerId: "meridian", content: "Tom is an ally — he wants to renew but can't override Dr. Green", source: "sarah", createdAt: new Date("2026-05-10") });

	console.log("[seed] Done — 4 customers seeded");
	store.close();
}

seed().catch((err) => {
	console.error("[seed] Error:", err);
	process.exit(1);
});
