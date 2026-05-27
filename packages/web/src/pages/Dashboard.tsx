import { Card, Col, Row, Statistic, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

interface Customer {
	profile: {
		id: string;
		companyName: string;
		plan?: string;
	};
	state: {
		health: string;
		openIssues: number;
		usageTrend: string;
		lastContactDate: string;
	} | null;
}

interface PendingAction {
	id: string;
	customerId: string;
	type: string;
	description: string;
	status: string;
	createdAt: string;
}

const healthColor: Record<string, string> = {
	good: "green",
	"at-risk": "orange",
	critical: "red",
};

export function Dashboard() {
	const [customers, setCustomers] = useState<Customer[]>([]);
	const [actions, setActions] = useState<PendingAction[]>([]);

	useEffect(() => {
		fetch("/api/customers")
			.then((r) => r.json())
			.then(setCustomers)
			.catch(console.error);
		fetch("/api/actions")
			.then((r) => r.json())
			.then(setActions)
			.catch(console.error);
	}, []);

	const atRisk = customers.filter((c) => c.state?.health === "at-risk").length;
	const critical = customers.filter((c) => c.state?.health === "critical").length;
	const pending = actions.filter((a) => a.status === "pending").length;

	const columns = [
		{ title: "Company", dataIndex: ["profile", "companyName"], key: "name" },
		{ title: "Plan", dataIndex: ["profile", "plan"], key: "plan" },
		{
			title: "Health",
			key: "health",
			render: (_: unknown, record: Customer) => {
				const h = record.state?.health ?? "unknown";
				return <Tag color={healthColor[h] ?? "default"}>{h}</Tag>;
			},
		},
		{
			title: "Open Issues",
			key: "issues",
			render: (_: unknown, record: Customer) => record.state?.openIssues ?? 0,
		},
		{
			title: "Usage",
			key: "usage",
			render: (_: unknown, record: Customer) => record.state?.usageTrend ?? "-",
		},
	];

	return (
		<>
			<Typography.Title level={4}>Dashboard</Typography.Title>
			<Row gutter={16} style={{ marginBottom: 24 }}>
				<Col span={6}>
					<Card>
						<Statistic title="Total Customers" value={customers.length} />
					</Card>
				</Col>
				<Col span={6}>
					<Card>
						<Statistic title="At Risk" value={atRisk} valueStyle={{ color: "#faad14" }} />
					</Card>
				</Col>
				<Col span={6}>
					<Card>
						<Statistic title="Critical" value={critical} valueStyle={{ color: "#ff4d4f" }} />
					</Card>
				</Col>
				<Col span={6}>
					<Card>
						<Statistic title="Pending Actions" value={pending} />
					</Card>
				</Col>
			</Row>
			<Card title="Customers">
				<Table
					dataSource={customers}
					columns={columns}
					rowKey={(r) => r.profile.id}
					pagination={false}
					size="small"
				/>
			</Card>
		</>
	);
}
