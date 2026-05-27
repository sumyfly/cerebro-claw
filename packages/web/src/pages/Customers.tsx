import { Card, Descriptions, List, Table, Tag, Typography, Input, Button, Space, Modal, Form, Timeline, Tabs } from "antd";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

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

const typeColor: Record<string, string> = {
	call: "blue",
	email: "cyan",
	ticket: "orange",
	message: "green",
	event: "purple",
	decision: "gold",
};

export function Customers() {
	const [customers, setCustomers] = useState<CustomerSummary[]>([]);
	const [selected, setSelected] = useState<CustomerDetail | null>(null);
	const [chatInput, setChatInput] = useState("");
	const [chatReply, setChatReply] = useState("");
	const [chatLoading, setChatLoading] = useState(false);
	const [addModalOpen, setAddModalOpen] = useState(false);
	const [form] = Form.useForm();
	const [searchParams, setSearchParams] = useSearchParams();

	useEffect(() => {
		loadCustomers();
	}, []);

	useEffect(() => {
		const id = searchParams.get("id");
		if (id) selectCustomer(id);
	}, [searchParams]);

	function loadCustomers() {
		fetch("/api/customers")
			.then((r) => r.json())
			.then(setCustomers)
			.catch(console.error);
	}

	function selectCustomer(id: string) {
		setSearchParams({ id });
		fetch(`/api/customers/${id}`)
			.then((r) => r.json())
			.then(setSelected)
			.catch(console.error);
	}

	async function sendChat() {
		if (!chatInput.trim()) return;
		setChatLoading(true);
		setChatReply("");
		try {
			const res = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: chatInput, customerId: selected?.profile.id }),
			});
			const data = await res.json();
			setChatReply(data.text);
		} catch (err) {
			setChatReply("Error: Could not reach the agent. Is ANTHROPIC_API_KEY set?");
		}
		setChatInput("");
		setChatLoading(false);
	}

	async function addCustomer() {
		const values = await form.validateFields();
		const body = {
			id: values.companyName.toLowerCase().replace(/\s+/g, "-"),
			companyName: values.companyName,
			plan: values.plan,
			contractValue: values.contractValue ? Number(values.contractValue) : undefined,
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
		{
			title: "Company",
			dataIndex: ["profile", "companyName"],
			key: "name",
			render: (name: string, r: CustomerSummary) => (
				<a onClick={() => selectCustomer(r.profile.id)}>{name}</a>
			),
		},
		{ title: "Plan", dataIndex: ["profile", "plan"], key: "plan" },
		{
			title: "Health",
			key: "health",
			render: (_: unknown, r: CustomerSummary) => {
				const h = r.state?.health ?? "unknown";
				return <Tag color={healthColor[h] ?? "default"}>{h}</Tag>;
			},
		},
	];

	return (
		<>
			<Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
				<Typography.Title level={4} style={{ margin: 0 }}>
					Customers
				</Typography.Title>
				<Button type="primary" onClick={() => setAddModalOpen(true)}>
					Add Customer
				</Button>
			</Space>

			<Row gutter={16}>
				<Col span={8}>
					<Table
						dataSource={customers}
						columns={columns}
						rowKey={(r) => r.profile.id}
						pagination={false}
						size="small"
						onRow={(r) => ({
							onClick: () => selectCustomer(r.profile.id),
							style: {
								cursor: "pointer",
								background: selected?.profile.id === r.profile.id ? "#e6f4ff" : undefined,
							},
						})}
					/>
				</Col>
				<Col span={16}>
					{selected ? (
						<Space direction="vertical" style={{ width: "100%" }} size="middle">
							<Card title={selected.profile.companyName} size="small">
								<Descriptions column={2} size="small">
									<Descriptions.Item label="Plan">{selected.profile.plan ?? "-"}</Descriptions.Item>
									<Descriptions.Item label="Health">
										<Tag color={healthColor[selected.state?.health ?? ""] ?? "default"}>
											{selected.state?.health ?? "unknown"}
										</Tag>
									</Descriptions.Item>
									<Descriptions.Item label="Contract">
										{selected.profile.contractValue
											? `$${selected.profile.contractValue.toLocaleString()}/yr`
											: "-"}
									</Descriptions.Item>
									<Descriptions.Item label="Open Issues">
										{selected.state?.openIssues ?? 0}
									</Descriptions.Item>
									<Descriptions.Item label="Usage Trend">
										{selected.state?.usageTrend ?? "-"}
									</Descriptions.Item>
									<Descriptions.Item label="Renewal">
										{selected.state?.renewalDate
											? new Date(selected.state.renewalDate).toLocaleDateString()
											: "-"}
									</Descriptions.Item>
									<Descriptions.Item label="Contacts" span={2}>
										{selected.profile.contacts.length > 0
											? selected.profile.contacts.map((c) => (
													<Tag key={c.name}>
														{c.name} ({c.role}){c.isDecisionMaker ? " *" : ""}
													</Tag>
												))
											: "-"}
									</Descriptions.Item>
								</Descriptions>
							</Card>

							<Tabs
								size="small"
								items={[
									{
										key: "history",
										label: `History (${selected.history.length})`,
										children: (
											<Timeline
												items={selected.history.map((h) => ({
													color: typeColor[h.type] ?? "gray",
													children: (
														<>
															<Tag color={typeColor[h.type]}>{h.type}</Tag>
															{h.summary}
															<br />
															<Typography.Text type="secondary" style={{ fontSize: 12 }}>
																{new Date(h.timestamp).toLocaleDateString()}
															</Typography.Text>
														</>
													),
												}))}
											/>
										),
									},
									{
										key: "instincts",
										label: `Instinct Notes (${selected.instincts.length})`,
										children: (
											<List
												dataSource={selected.instincts}
												renderItem={(item) => (
													<List.Item>
														<List.Item.Meta
															description={
																<>
																	{item.content}
																	<br />
																	<Typography.Text type="secondary" style={{ fontSize: 12 }}>
																		{new Date(item.createdAt).toLocaleDateString()}
																	</Typography.Text>
																</>
															}
														/>
													</List.Item>
												)}
												locale={{ emptyText: "No instinct notes yet" }}
											/>
										),
									},
								]}
							/>

							<Card title="Ask the Agent" size="small">
								<Space.Compact style={{ width: "100%" }}>
									<Input
										value={chatInput}
										onChange={(e) => setChatInput(e.target.value)}
										onPressEnter={sendChat}
										placeholder={`Ask about ${selected.profile.companyName}...`}
										disabled={chatLoading}
									/>
									<Button type="primary" onClick={sendChat} loading={chatLoading}>
										Send
									</Button>
								</Space.Compact>
								{chatReply && (
									<Card
										size="small"
										style={{ marginTop: 12, background: "#fafafa", whiteSpace: "pre-wrap" }}
									>
										{chatReply}
									</Card>
								)}
							</Card>
						</Space>
					) : (
						<Card>
							<Typography.Text type="secondary">
								Select a customer from the list to view details.
							</Typography.Text>
						</Card>
					)}
				</Col>
			</Row>

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
						<Input placeholder="e.g. Enterprise, Growth, Starter" />
					</Form.Item>
					<Form.Item name="contractValue" label="Contract Value ($/yr)">
						<Input type="number" placeholder="e.g. 50000" />
					</Form.Item>
				</Form>
			</Modal>
		</>
	);
}

function Row({ gutter, children }: { gutter: number; children: React.ReactNode }) {
	return <div style={{ display: "flex", gap: gutter }}>{children}</div>;
}

function Col({ span, children }: { span: number; children: React.ReactNode }) {
	return <div style={{ flex: `0 0 ${(span / 24) * 100}%`, maxWidth: `${(span / 24) * 100}%` }}>{children}</div>;
}
