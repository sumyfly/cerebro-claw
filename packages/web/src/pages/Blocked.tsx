/** Blocked — escalations awaiting the human (escalate band, needs-csm status).
 * Reads GET /api/ledger/open. Resolve via POST /api/ledger/:id/resolve {outcome}. */

import { CheckCircleOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Button, Input, Modal, message } from "antd";
import { useMemo, useState } from "react";
import { RelativeTime } from "../components/primitives.js";
import { type LedgerEntry, postJson } from "../lib/api.js";
import { COLOR, shortId } from "../lib/status.js";
import { usePoll } from "../lib/usePoll.js";

function field(payload: Record<string, unknown> | undefined, key: string): string | undefined {
	const v = payload?.[key];
	return typeof v === "string" ? v : undefined;
}

function EscBlock({ label, value, rec }: { label: string; value: string; rec?: boolean }) {
	return (
		<div className={`cc-esc-block${rec ? " rec" : ""}`}>
			<div className="k">{label}</div>
			<div className="v">{value}</div>
		</div>
	);
}

export function Blocked() {
	const [active, setActive] = useState<LedgerEntry | null>(null);
	const [outcome, setOutcome] = useState("");
	const [saving, setSaving] = useState(false);

	const { data, loaded, refresh } = usePoll<LedgerEntry[]>("/api/ledger/open", 5000);
	const items = useMemo(
		() => (data ?? []).filter((e) => e.band === "escalate" && e.status === "needs-csm"),
		[data],
	);

	async function resolve() {
		if (!active) return;
		setSaving(true);
		try {
			await postJson(`/api/ledger/${active.id}/resolve`, {
				outcome: outcome.trim() || "resolved via console",
			});
			message.success(`Escalation #${shortId(active.id)} resolved`);
			setActive(null);
			setOutcome("");
			// Re-fetch open ledger; the AbortController in usePoll guarantees this
			// fresh read wins over any in-flight stale poll (no re-introduce race).
			refresh();
		} catch {
			message.error("Failed to resolve escalation");
		}
		setSaving(false);
	}

	if (loaded && items.length === 0) {
		return (
			<>
				<h1 className="cc-page-title">BLOCKED — AWAITING CSM DECISION</h1>
				<div className="cc-empty">
					<SafetyCertificateOutlined className="glyph" />
					<div className="line">NO ESCALATIONS — ALL CLEAR</div>
					<div className="sub">THE AGENT IS HANDLING THE PORTFOLIO. NOTHING NEEDS YOU.</div>
				</div>
			</>
		);
	}

	return (
		<>
			<h1 className="cc-page-title">
				BLOCKED — AWAITING CSM DECISION{" "}
				<span className="cc-id mono" style={{ color: COLOR.danger }}>
					[{items.length}]
				</span>
			</h1>

			{!loaded ? (
				<div className="cc-loading">QUERYING OPEN LEDGER…</div>
			) : (
				items.map((e) => {
					const situation = field(e.payload, "situation") ?? e.reason;
					const hasSituation = !!situation && situation.trim().length > 0;
					const options = field(e.payload, "options");
					const recommendation = field(e.payload, "recommendation");
					return (
						<div key={e.id} className="cc-esc">
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 12,
								}}
							>
								<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
									<span className="cc-cust" style={{ fontSize: 14 }}>
										{e.customerName ?? e.customerId}
									</span>
									<span className="cc-id mono">#{shortId(e.id)}</span>
								</div>
								<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
									<RelativeTime value={e.createdAt} />
									<Button
										danger
										size="small"
										icon={<CheckCircleOutlined />}
										onClick={() => {
											setActive(e);
											setOutcome("");
										}}
									>
										RESOLVE
									</Button>
								</div>
							</div>

							<EscBlock
								label="SITUATION"
								value={hasSituation ? situation : "(no situation provided)"}
							/>
							{options && <EscBlock label="OPTIONS" value={options} />}
							{recommendation && (
								<EscBlock label="AGENT RECOMMENDATION" value={recommendation} rec />
							)}
						</div>
					);
				})
			)}

			<Modal
				open={active !== null}
				title={active ? `RESOLVE ESCALATION — ${active.customerName ?? active.customerId}` : ""}
				onCancel={() => setActive(null)}
				okText="RECORD OUTCOME"
				confirmLoading={saving}
				onOk={resolve}
				okButtonProps={{ danger: true }}
			>
				<div className="cc-id mono" style={{ marginBottom: 8, fontSize: 11 }}>
					RECORD THE DECISION — THE AGENT WILL BE TOLD THE OUTCOME.
				</div>
				<Input.TextArea
					rows={5}
					value={outcome}
					onChange={(ev) => setOutcome(ev.target.value)}
					placeholder="e.g. Approved 10% discount for 12-mo renewal; CSM to send paperwork."
				/>
			</Modal>
		</>
	);
}
