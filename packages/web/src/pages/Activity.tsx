import { Button, Card, List, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

interface PendingAction {
	id: string;
	customerId: string;
	type: string;
	description: string;
	draft?: { text: string; recipientId: string };
	status: string;
	createdAt: string;
}

const statusColor: Record<string, string> = {
	pending: "processing",
	approved: "success",
	rejected: "error",
};

export function Activity() {
	const [actions, setActions] = useState<PendingAction[]>([]);

	useEffect(() => {
		loadActions();
	}, []);

	function loadActions() {
		fetch("/api/actions")
			.then((r) => r.json())
			.then(setActions)
			.catch(console.error);
	}

	async function approve(id: string) {
		await fetch(`/api/actions/${id}/approve`, { method: "POST" });
		loadActions();
	}

	async function reject(id: string) {
		await fetch(`/api/actions/${id}/reject`, { method: "POST" });
		loadActions();
	}

	return (
		<>
			<Typography.Title level={4}>Pending Actions</Typography.Title>
			<List
				dataSource={actions}
				renderItem={(item) => (
					<Card size="small" style={{ marginBottom: 12 }}>
						<Space direction="vertical" style={{ width: "100%" }}>
							<Space>
								<Tag>{item.type}</Tag>
								<Tag color={statusColor[item.status]}>{item.status}</Tag>
								<Typography.Text type="secondary">
									Customer: {item.customerId}
								</Typography.Text>
							</Space>
							<Typography.Text>{item.description}</Typography.Text>
							{item.draft && (
								<Card size="small" style={{ background: "#fafafa" }}>
									<Typography.Text type="secondary">Draft message:</Typography.Text>
									<br />
									{item.draft.text}
								</Card>
							)}
							{item.status === "pending" && (
								<Space>
									<Button type="primary" size="small" onClick={() => approve(item.id)}>
										Approve
									</Button>
									<Button size="small" danger onClick={() => reject(item.id)}>
										Reject
									</Button>
								</Space>
							)}
						</Space>
					</Card>
				)}
				locale={{ emptyText: "No pending actions" }}
			/>
		</>
	);
}
