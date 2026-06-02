import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { Button, Card, Empty, List, Space, Tag, Typography } from "antd";
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

	const pending = actions.filter((a) => a.status === "pending");
	const resolved = actions.filter((a) => a.status !== "pending");

	return (
		<>
			<Typography.Title level={4}>
				Pending Actions{pending.length > 0 && ` (${pending.length})`}
			</Typography.Title>

			{pending.length === 0 && resolved.length === 0 && (
				<Empty
					description="No actions yet. The agent will create actions when it detects something that needs your attention."
					style={{ marginTop: 48 }}
				/>
			)}

			{pending.length > 0 && (
				<List
					dataSource={pending}
					renderItem={(item) => (
						<Card size="small" style={{ marginBottom: 12 }}>
							<Space direction="vertical" style={{ width: "100%" }}>
								<Space>
									<Tag>{item.type}</Tag>
									<Tag color={statusColor[item.status]}>{item.status}</Tag>
									<Typography.Text type="secondary">{item.customerId}</Typography.Text>
									<Typography.Text type="secondary">
										{new Date(item.createdAt).toLocaleString()}
									</Typography.Text>
								</Space>
								<Typography.Text>{item.description}</Typography.Text>
								{item.draft && (
									<Card size="small" style={{ background: "#f6ffed", borderColor: "#b7eb8f" }}>
										<Typography.Text type="secondary">Draft:</Typography.Text>
										<br />
										<Typography.Text style={{ whiteSpace: "pre-wrap" }}>
											{item.draft.text}
										</Typography.Text>
									</Card>
								)}
								<Space>
									<Button
										type="primary"
										size="small"
										icon={<CheckOutlined />}
										onClick={() => approve(item.id)}
									>
										Approve & Send
									</Button>
									<Button
										size="small"
										danger
										icon={<CloseOutlined />}
										onClick={() => reject(item.id)}
									>
										Reject
									</Button>
								</Space>
							</Space>
						</Card>
					)}
				/>
			)}

			{resolved.length > 0 && (
				<>
					<Typography.Title level={5} style={{ marginTop: 24 }}>
						Resolved
					</Typography.Title>
					<List
						dataSource={resolved}
						renderItem={(item) => (
							<Card size="small" style={{ marginBottom: 8, opacity: 0.7 }}>
								<Space>
									<Tag>{item.type}</Tag>
									<Tag color={statusColor[item.status]}>{item.status}</Tag>
									<Typography.Text>{item.description}</Typography.Text>
									<Typography.Text type="secondary">{item.customerId}</Typography.Text>
								</Space>
							</Card>
						)}
					/>
				</>
			)}
		</>
	);
}
