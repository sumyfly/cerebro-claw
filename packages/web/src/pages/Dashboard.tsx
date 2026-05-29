import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography, Badge, message } from "antd";
import {
	ArrowUpOutlined,
	ArrowDownOutlined,
	MinusOutlined,
	WarningOutlined,
	ThunderboltOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface Customer {
	profile: {
		id: string;
		companyName: string;
		plan?: string;
		contractValue?: number;
	};
	state: {
		health: string;
		openIssues: number;
		usageTrend: string;
		lastContactDate: string;
		renewalDate?: string;
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

interface DigestCounters {
	headline: string;
	counts: {
		windowHours: number;
		acts: number;
		notifies: { inFlight: number; executed: number; cancelled: number; failed: number };
		escalations: { needsCsm: number; resolved: number };
		preps: number;
	};
}

const healthColor: Record<string, string> = {
	good: "green",
	"at-risk": "orange",
	critical: "red",
};

const trendIcon: Record<string, React.ReactNode> = {
	up: <ArrowUpOutlined style={{ color: "#52c41a" }} />,
	dropping: <ArrowDownOutlined style={{ color: "#ff4d4f" }} />,
	flat: <MinusOutlined style={{ color: "#8c8c8c" }} />,
};

function daysUntil(dateStr?: string): number | null {
	if (!dateStr) return null;
	const diff = new Date(dateStr).getTime() - Date.now();
	return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function daysSince(dateStr?: string): number | null {
	if (!dateStr) return null;
	const diff = Date.now() - new Date(dateStr).getTime();
	return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function Dashboard() {
	const [customers, setCustomers] = useState<Customer[]>([]);
	const [actions, setActions] = useState<PendingAction[]>([]);
	const [digest, setDigest] = useState<string | null>(null);
	const [digestLoading, setDigestLoading] = useState(false);
	const [counters, setCounters] = useState<DigestCounters | null>(null);
	const navigate = useNavigate();

	async function runDigest() {
		setDigestLoading(true);
		setDigest(null);
		try {
			const res = await fetch("/api/digest", { method: "POST" });
			const data = await res.json();
			if (res.ok) {
				setDigest(data.text);
			} else {
				message.error(data.error ?? "Digest failed");
			}
		} catch (err) {
			message.error("Failed to reach server");
		}
		setDigestLoading(false);
	}

	useEffect(() => {
		fetch("/api/customers")
			.then((r) => r.json())
			.then(setCustomers)
			.catch(console.error);
		fetch("/api/actions")
			.then((r) => r.json())
			.then(setActions)
			.catch(console.error);
		fetch("/api/digest/counters")
			.then((r) => r.json())
			.then(setCounters)
			.catch(console.error);
	}, []);

	const atRisk = customers.filter((c) => c.state?.health === "at-risk").length;
	const critical = customers.filter((c) => c.state?.health === "critical").length;
	const pending = actions.filter((a) => a.status === "pending").length;
	const totalArr = customers.reduce((sum, c) => sum + (c.profile.contractValue ?? 0), 0);

	const columns = [
		{
			title: "Company",
			key: "name",
			render: (_: unknown, r: Customer) => (
				<a onClick={() => navigate(`/customers?id=${r.profile.id}`)}>
					<strong>{r.profile.companyName}</strong>
				</a>
			),
		},
		{ title: "Plan", dataIndex: ["profile", "plan"], key: "plan" },
		{
			title: "Health",
			key: "health",
			render: (_: unknown, r: Customer) => {
				const h = r.state?.health ?? "unknown";
				return <Tag color={healthColor[h] ?? "default"}>{h}</Tag>;
			},
			sorter: (a: Customer, b: Customer) => {
				const order = { critical: 0, "at-risk": 1, good: 2 };
				return (order[a.state?.health as keyof typeof order] ?? 3) -
					(order[b.state?.health as keyof typeof order] ?? 3);
			},
		},
		{
			title: "Issues",
			key: "issues",
			render: (_: unknown, r: Customer) => {
				const n = r.state?.openIssues ?? 0;
				return n > 0 ? <Badge count={n} /> : <span style={{ color: "#8c8c8c" }}>0</span>;
			},
			sorter: (a: Customer, b: Customer) =>
				(b.state?.openIssues ?? 0) - (a.state?.openIssues ?? 0),
		},
		{
			title: "Usage",
			key: "usage",
			render: (_: unknown, r: Customer) => {
				const t = r.state?.usageTrend ?? "flat";
				return <>{trendIcon[t] ?? null} {t}</>;
			},
		},
		{
			title: "Last Contact",
			key: "lastContact",
			render: (_: unknown, r: Customer) => {
				const days = daysSince(r.state?.lastContactDate);
				if (days === null) return "-";
				if (days > 14) return <span style={{ color: "#ff4d4f" }}>{days}d ago</span>;
				if (days > 7) return <span style={{ color: "#faad14" }}>{days}d ago</span>;
				return <span>{days}d ago</span>;
			},
		},
		{
			title: "Renewal",
			key: "renewal",
			render: (_: unknown, r: Customer) => {
				const days = daysUntil(r.state?.renewalDate);
				if (days === null) return "-";
				if (days < 30) return <span style={{ color: "#ff4d4f" }}><WarningOutlined /> {days}d</span>;
				if (days < 60) return <span style={{ color: "#faad14" }}>{days}d</span>;
				return <span>{days}d</span>;
			},
			sorter: (a: Customer, b: Customer) =>
				(daysUntil(a.state?.renewalDate) ?? 999) - (daysUntil(b.state?.renewalDate) ?? 999),
		},
	];

	return (
		<>
			<Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
				<Typography.Title level={4} style={{ margin: 0 }}>
					Dashboard
				</Typography.Title>
				<Button
					type="primary"
					icon={<ThunderboltOutlined />}
					loading={digestLoading}
					onClick={runDigest}
				>
					Run Daily Digest
				</Button>
			</Space>

			{counters && (
				<Card style={{ marginBottom: 16, background: "#fafafa" }}>
					<Typography.Title level={5} style={{ margin: 0 }}>
						{counters.headline}
					</Typography.Title>
					<Row gutter={16} style={{ marginTop: 16 }}>
						<Col span={6}>
							<Statistic title="Acts (24h)" value={counters.counts.acts} />
						</Col>
						<Col span={6}>
							<Statistic
								title="Notifies in-flight"
								value={counters.counts.notifies.inFlight}
								valueStyle={counters.counts.notifies.inFlight > 0 ? { color: "#1677ff" } : undefined}
							/>
						</Col>
						<Col span={6}>
							<Statistic
								title="Escalations need you"
								value={counters.counts.escalations.needsCsm}
								valueStyle={counters.counts.escalations.needsCsm > 0 ? { color: "#ff4d4f" } : undefined}
								prefix={counters.counts.escalations.needsCsm > 0 ? <WarningOutlined /> : undefined}
							/>
						</Col>
						<Col span={6}>
							<Statistic title="Preps shipped" value={counters.counts.preps} />
						</Col>
					</Row>
				</Card>
			)}

			{digest && (
				<Card
					size="small"
					title="Daily Digest"
					style={{ marginBottom: 24 }}
					extra={
						<Button size="small" onClick={() => setDigest(null)}>
							Dismiss
						</Button>
					}
				>
					<Typography.Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>
						{digest}
					</Typography.Paragraph>
				</Card>
			)}

			<Row gutter={16} style={{ marginBottom: 24 }}>
				<Col span={6}>
					<Card>
						<Statistic title="Total Customers" value={customers.length} />
					</Card>
				</Col>
				<Col span={6}>
					<Card>
						<Statistic
							title="At Risk"
							value={atRisk}
							valueStyle={atRisk > 0 ? { color: "#faad14" } : undefined}
						/>
					</Card>
				</Col>
				<Col span={6}>
					<Card>
						<Statistic
							title="Critical"
							value={critical}
							valueStyle={critical > 0 ? { color: "#ff4d4f" } : undefined}
							prefix={critical > 0 ? <WarningOutlined /> : undefined}
						/>
					</Card>
				</Col>
				<Col span={6}>
					<Card>
						<Statistic title="Pending Actions" value={pending} />
					</Card>
				</Col>
			</Row>
			<Card title="Customers" extra={<Typography.Text type="secondary">Total ARR: ${totalArr.toLocaleString()}</Typography.Text>}>
				<Table
					dataSource={customers}
					columns={columns}
					rowKey={(r) => r.profile.id}
					pagination={false}
					size="small"
					defaultSortOrder="ascend"
				/>
			</Card>
		</>
	);
}
