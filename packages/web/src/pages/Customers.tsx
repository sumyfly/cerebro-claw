import { Card, Descriptions, List, Table, Tag, Typography, Input, Button, Space, Modal, Form } from "antd";
import { useEffect, useState } from "react";

interface CustomerDetail {
	profile: {
		id: string;
		companyName: string;
		companySize?: string;
		plan?: string;
		contractValue?: number;
		contacts: { name: string; role: string; email?: string; isDecisionMaker: boolean }[];
		csmOwnerId: string;
	};
	state: {
		health: string;
		openIssues: number;
		usageTrend: string;
		lastContactDate: string;
		renewalDate?: string;
	} | null;
	history: { id: string; type: string; summary: string; timestamp: string }[];
	instincts: { id: string; content: string; createdAt: string }[];
}

interface CustomerSummary {
	profile: { id: string; companyName: string; plan?: string };
	state: { health: string; openIssues: number; usageTrend: string } | null;
}

const healthColor: Record<string, string> = {
	good: "green",
	"at-risk": "orange",
	critical: "red",
};

export function Customers() {
	const [customers, setCustomers] = useState<CustomerSummary[]>([]);
	const [selected, setSelected] = useState<CustomerDetail | null>(null);
	const [chatInput, setChatInput] = useState("");
	const [chatReply, setChatReply] = useState("");
	const [addModalOpen, setAddModalOpen] = useState(false);
	const [form] = Form.useForm();

	useEffect(() => {
		loadCustomers();
	}, []);

	function loadCustomers() {
		fetch("/api/customers")
			.then((r) => r.json())
			.then(setCustomers)
			.catch(console.error);
	}

	function selectCustomer(id: string) {
		fetch(`/api/customers/${id}`)
			.then((r) => r.json())
			.then(setSelected)
			.catch(console.error);
	}

	async function sendChat() {
		if (!chatInput.trim()) return;
		const res = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: chatInput, customerId: selected?.profile.id }),
		});
		const data = await res.json();
		setChatReply(data.text);
		setChatInput("");
	}

	async function addCustomer() {
		const values = await form.validateFields();
		const body = {
			id: values.companyName.toLowerCase().replace(/\s+/g, "-"),
			companyName: values.companyName,
			plan: values.plan,
			contacts: [],
			csmOwnerId: "default-csm",
		};
		await fetch("/api/customers", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		form.resetFields();
		setAddModalOpen(false);
		loadCustomers();
	}

	const columns = [
		{ title: "Company", dataIndex: ["profile", "companyName"], key: "name" },
		{ title: "Plan", dataIndex: ["profile", "plan"], key: "plan" },
		{
			title: "Health",
			key: "health",
			render: (_: unknown, r: CustomerSummary) => {
				const h = r.state?.health ?? "unknown";
				return <Tag color={healthColor[h] ?? "default"}>{h}</Tag>;
			},
		},
		{
			title: "Action",
			key: "action",
			render: (_: unknown, r: CustomerSummary) => (
				<a onClick={() => selectCustomer(r.profile.id)}>View</a>
			),
		},
	];

	return (
		<>
			<Space style={{ marginBottom: 16 }}>
				<Typography.Title level={4} style={{ margin: 0 }}>
					Customers
				</Typography.Title>
				<Button type="primary" onClick={() => setAddModalOpen(true)}>
					Add Customer
				</Button>
			</Space>

			<Table
				dataSource={customers}
				columns={columns}
				rowKey={(r) => r.profile.id}
				pagination={false}
				size="small"
				style={{ marginBottom: 24 }}
			/>

			{selected && (
				<>
					<Card title={selected.profile.companyName} style={{ marginBottom: 16 }}>
						<Descriptions column={2} size="small">
							<Descriptions.Item label="Plan">{selected.profile.plan ?? "-"}</Descriptions.Item>
							<Descriptions.Item label="Health">
								<Tag color={healthColor[selected.state?.health ?? ""] ?? "default"}>
									{selected.state?.health ?? "unknown"}
								</Tag>
							</Descriptions.Item>
							<Descriptions.Item label="Open Issues">
								{selected.state?.openIssues ?? 0}
							</Descriptions.Item>
							<Descriptions.Item label="Usage Trend">
								{selected.state?.usageTrend ?? "-"}
							</Descriptions.Item>
							<Descriptions.Item label="Renewal">
								{selected.state?.renewalDate ?? "-"}
							</Descriptions.Item>
							<Descriptions.Item label="CSM">
								{selected.profile.csmOwnerId}
							</Descriptions.Item>
						</Descriptions>
					</Card>

					<Card title="History" size="small" style={{ marginBottom: 16 }}>
						<List
							dataSource={selected.history}
							renderItem={(item) => (
								<List.Item>
									<Tag>{item.type}</Tag> {item.summary}
								</List.Item>
							)}
							locale={{ emptyText: "No history yet" }}
						/>
					</Card>

					<Card title="CSM Instinct Notes" size="small" style={{ marginBottom: 16 }}>
						<List
							dataSource={selected.instincts}
							renderItem={(item) => <List.Item>{item.content}</List.Item>}
							locale={{ emptyText: "No instinct notes yet" }}
						/>
					</Card>

					<Card title="Ask the Agent" size="small">
						<Space.Compact style={{ width: "100%" }}>
							<Input
								value={chatInput}
								onChange={(e) => setChatInput(e.target.value)}
								onPressEnter={sendChat}
								placeholder={`Ask about ${selected.profile.companyName}...`}
							/>
							<Button type="primary" onClick={sendChat}>
								Send
							</Button>
						</Space.Compact>
						{chatReply && (
							<Card size="small" style={{ marginTop: 12, background: "#fafafa" }}>
								{chatReply}
							</Card>
						)}
					</Card>
				</>
			)}

			<Modal
				title="Add Customer"
				open={addModalOpen}
				onOk={addCustomer}
				onCancel={() => setAddModalOpen(false)}
			>
				<Form form={form} layout="vertical">
					<Form.Item name="companyName" label="Company Name" rules={[{ required: true }]}>
						<Input />
					</Form.Item>
					<Form.Item name="plan" label="Plan">
						<Input />
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}
