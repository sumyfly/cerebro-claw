import type { TaskRecord } from "@cerebro-claw/shared";

/**
 * Render a single CSM task into a prompt context block the agent reads before
 * choosing a band. Side-effect free — safe to call multiple times per cycle.
 *
 * When the task links to a CSP account (`businessId`), the block points the
 * agent at the csp_* tools so it can pull live account signals itself, keeping
 * the freshest data in the loop without the brain loop pre-fetching it.
 */
export function renderTaskContext(task: TaskRecord): string {
	const lines: string[] = ["# Cerebro task (your queue)"];
	lines.push(`- Task: ${task.title} (id: ${task.id})`);
	if (task.priority) lines.push(`- Priority: ${task.priority}`);
	if (task.dueDate) lines.push(`- Due: ${task.dueDate.toISOString()}`);
	if (task.description) lines.push(`- Detail: ${task.description}`);

	if (task.businessId) {
		const who = task.customerName ? `${task.customerName} ` : "";
		lines.push(
			`- Linked account: ${who}(CSP business id: ${task.businessId}). Pull live detail with csp_get_account / csp_get_health_score / csp_get_engagement / csp_get_notes / csp_get_renewals before deciding.`,
		);
	} else {
		lines.push("- No linked account — this is an account-less task.");
	}
	if (task.renewalId) {
		lines.push(`- Linked renewal: ${task.renewalId} (csp_get_renewal for full detail).`);
	}

	// Closing requirements — what the agent MUST supply to task_complete/task_block.
	const required = (task.requiredFields ?? []).filter((f) => f.required !== false);
	if (required.length > 0) {
		lines.push("", "To close this task you MUST provide these structured fields (custom_fields):");
		for (const f of required) {
			const opts = f.options?.length ? ` — one of: ${f.options.join(", ")}` : "";
			lines.push(`- ${f.name}${f.label ? ` (${f.label})` : ""}${opts}`);
		}
	}
	if (task.activityRequired) {
		lines.push(
			"- This task also REQUIRES a logged CSM activity — pass `activity` (type/subject/...) to task_complete.",
		);
	}

	return lines.join("\n");
}
