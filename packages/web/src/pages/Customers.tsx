import {
	Button,
	Card,
	Descriptions,
	Form,
	Input,
	List,
	Modal,
	Space,
	Table,
	Tabs,
	Tag,
	Timeline,
	Typography,
} from "antd";
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
		csmLarkUserId?: string;
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
	const [chatHistory, setChatHistory] = useState<{ role: string; text: string }[]>([]);
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
		setChatHistory([]);
		setChatInput("");
		fetch(`/api/customers/${id}`)
			.then((r) => r.json())
			.then(setSelected)
			.catch(console.error);
	}

	async function sendChat() {
		if (!chatInput.trim()) return;
		const userMsg = chatInput;
		setChatInput("");
		setChatHistory((h) => [...h, { role: "user", text: userMsg }]);
		setChatLoading(true);
		try {
			const res = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: userMsg, customerId: selected?.profile.id }),
			});
			const data = await res.json();
			setChatHistory((h) => [...h, { role: "assistant", text: data.text }]);
		} catch {
			setChatHistory((h) => [
				...h,
				{
					role: "assistant",
					text: "Error: Could not reach the agent. Is Claude Code installed and logged in?",
				},
			]);
		}
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
			csmOwnerId: values.csmOwnerId || "default-csm",
			csmLarkUserId: values.csmLarkUserId || undefined,
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
				// biome-ignore lint/a11y/useValidAnchor: antd table cell click-to-select, not a navigation link
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
									<Descriptions.Item label="CSM" span={2}>
										<Typography.Text strong>{selected.profile.csmOwnerId}</Typography.Text>
										{selected.profile.csmLarkUserId ? (
											<Typography.Text type="secondary" style={{ marginLeft: 8 }}>
												(Lark: {selected.profile.csmLarkUserId.slice(0, 16)}…)
											</Typography.Text>
										) : (
											<Typography.Text type="warning" style={{ marginLeft: 8 }}>
												— no Lark ID set; alerts won't reach this CSM in Lark
											</Typography.Text>
										)}
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

							<Card
								title="Ask the Agent"
								size="small"
								extra={
									chatHistory.length > 0 ? (
										<Button size="small" onClick={() => setChatHistory([])}>
											Clear
										</Button>
									) : null
								}
							>
								<div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 12 }}>
									{chatHistory.map((msg, i) => (
										<div
											// biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log, index is stable
											key={i}
											style={{
												padding: "8px 12px",
												marginBottom: 8,
												borderRadius: 8,
												background: msg.role === "user" ? "#e6f4ff" : "#f6ffed",
												textAlign: msg.role === "user" ? "right" : "left",
												whiteSpace: "pre-wrap",
											}}
										>
											<Typography.Text type="secondary" style={{ fontSize: 11 }}>
												{msg.role === "user" ? "You" : "Agent"}
											</Typography.Text>
											<br />
											{msg.text}
										</div>
									))}
									{chatLoading && (
										<div style={{ padding: "8px 12px", color: "#8c8c8c" }}>
											Agent is thinking...
										</div>
									)}
								</div>
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
					<Form.Item name="csmOwnerId" label="CSM Owner">
						<Input placeholder="e.g. sarah" />
					</Form.Item>
					<Form.Item
						name="csmLarkUserId"
						label="CSM Lark User ID"
						tooltip="Optional. Lark open_id for the CSM. Without this, alerts and approval cards won't reach this customer's owner in Lark."
					>
						<Input placeholder="e.g. ou_abcd1234…" />
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
	return (
		<div style={{ flex: `0 0 ${(span / 24) * 100}%`, maxWidth: `${(span / 24) * 100}%` }}>
			{children}
		</div>
	);
}
