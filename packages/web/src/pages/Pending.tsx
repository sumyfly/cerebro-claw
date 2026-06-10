/** Pending — notify-then-act sends still inside their pause window. The CSM's
 * cancel valve: every entry shows who it reaches, why, and when it dispatches.
 * Reads GET /api/actions/pending. Cancel via POST /api/actions/:id/cancel. */

import { FieldTimeOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Input, Modal, message } from "antd";
import { useEffect, useState } from "react";
import { RelativeTime } from "../components/primitives.js";
import { type LedgerEntry, postJson } from "../lib/api.js";
import { COLOR, shortId } from "../lib/status.js";
import { usePoll } from "../lib/usePoll.js";

function field(payload: Record<string, unknown> | undefined, key: string): string | undefined {
	const v = payload?.[key];
	return typeof v === "string" ? v : undefined;
}

/** "2h 14m" countdown to dispatch; "DUE" once the window has elapsed. */
function Countdown({ until }: { until?: string }) {
	const [, tick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => tick((n) => n + 1), 30_000);
		return () => clearInterval(t);
	}, []);
	if (!until) return null;
	const ms = new Date(until).getTime() - Date.now();
	if (ms <= 0) {
		return (
			<span className="cc-id mono" style={{ color: COLOR.danger }}>
				DUE — DISPATCHING
			</span>
		);
	}
	// Round up to whole minutes FIRST, then split — splitting before rounding
	// can yield "1h 60m" when the sub-hour remainder rounds up to a full hour.
	const totalMinutes = Math.ceil(ms / 60_000);
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return (
		<span className="cc-id mono" style={{ color: "#d29922" }}>
			SENDS IN {h > 0 ? `${h}h ` : ""}
			{m}m
		</span>
	);
}

export function Pending() {
	const [active, setActive] = useState<LedgerEntry | null>(null);
	const [reason, setReason] = useState("");
	const [saving, setSaving] = useState(false);

	const { data, loaded, refresh } = usePoll<LedgerEntry[]>("/api/actions/pending", 5000);
	const items = data ?? [];

	async function cancel() {
		if (!active) return;
		setSaving(true);
		try {
			await postJson(`/api/actions/${active.id}/cancel`, {
				reason: reason.trim() || "cancelled via console",
			});
			message.success(`Send #${shortId(active.id)} cancelled — it will never dispatch`);
			setActive(null);
			setReason("");
			refresh();
		} catch {
			message.error("Failed to cancel — it may have already dispatched");
			refresh();
		}
		setSaving(false);
	}

	if (loaded && items.length === 0) {
		return (
			<>
				<h1 className="cc-page-title">PENDING — SENDS IN THE PAUSE WINDOW</h1>
				<div className="cc-empty">
					<FieldTimeOutlined className="glyph" />
					<div className="line">NO PENDING SENDS</div>
					<div className="sub">NOTHING IS WAITING ON THE PAUSE WINDOW.</div>
				</div>
			</>
		);
	}

	return (
		<>
			<h1 className="cc-page-title">
				PENDING — SENDS IN THE PAUSE WINDOW{" "}
				<span className="cc-id mono" style={{ color: "#d29922" }}>
					[{items.length}]
				</span>
			</h1>

			{!loaded ? (
				<div className="cc-loading">QUERYING PENDING SENDS…</div>
			) : (
				items.map((e) => {
					const recipient = field(e.payload, "recipient");
					const text = field(e.payload, "text");
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
									{recipient && <span className="cc-id mono">→ {recipient}</span>}
								</div>
								<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
									<Countdown until={e.executeAt} />
									<RelativeTime value={e.createdAt} />
									<Button
										danger
										size="small"
										icon={<StopOutlined />}
										onClick={() => {
											setActive(e);
											setReason("");
										}}
									>
										CANCEL
									</Button>
								</div>
							</div>

							<div className="cc-esc-block">
								<div className="k">WHY</div>
								<div className="v">{e.reason}</div>
							</div>
							{text && (
								<div className="cc-esc-block">
									<div className="k">MESSAGE</div>
									<div className="v">{text}</div>
								</div>
							)}
						</div>
					);
				})
			)}

			<Modal
				open={active !== null}
				title={active ? `CANCEL SEND — ${active.customerName ?? active.customerId}` : ""}
				onCancel={() => setActive(null)}
				okText="CANCEL THE SEND"
				confirmLoading={saving}
				onOk={cancel}
				okButtonProps={{ danger: true }}
			>
				<div className="cc-id mono" style={{ marginBottom: 8, fontSize: 11 }}>
					THE CUSTOMER MESSAGE WILL NEVER DISPATCH. TELL THE AGENT WHY.
				</div>
				<Input.TextArea
					rows={4}
					value={reason}
					onChange={(ev) => setReason(ev.target.value)}
					placeholder="e.g. I'm seeing this customer Friday — I'll raise it in person."
				/>
			</Modal>
		</>
	);
}
