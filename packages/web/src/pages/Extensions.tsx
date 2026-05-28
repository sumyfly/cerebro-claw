import { Card, Col, List, Row, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

interface ExtensionInfo {
	loaded: string[];
	channels: string[];
	tools: { name: string; description: string }[];
}

interface Diagnostics {
	[key: string]: { ok: boolean; detail?: string };
}

export function Extensions() {
	const [info, setInfo] = useState<ExtensionInfo | null>(null);
	const [diag, setDiag] = useState<Diagnostics | null>(null);

	useEffect(() => {
		fetch("/api/extensions").then((r) => r.json()).then(setInfo).catch(console.error);
		fetch("/api/diagnostics").then((r) => r.json()).then(setDiag).catch(console.error);
	}, []);

	if (!info) return <Typography.Text>Loading…</Typography.Text>;

	return (
		<>
			<Typography.Title level={4}>Extensions & Diagnostics</Typography.Title>

			<Row gutter={16} style={{ marginBottom: 24 }}>
				<Col span={8}>
					<Card title="Loaded Extensions">
						<List
							size="small"
							dataSource={info.loaded}
							renderItem={(id) => <List.Item><Tag color="blue">{id}</Tag></List.Item>}
						/>
					</Card>
				</Col>
				<Col span={8}>
					<Card title="Channels">
						<List
							size="small"
							dataSource={info.channels}
							renderItem={(type) => <List.Item><Tag color="green">{type}</Tag></List.Item>}
							locale={{ emptyText: "No channels registered" }}
						/>
					</Card>
				</Col>
				<Col span={8}>
					<Card title="Diagnostics">
						{diag ? (
							<List
								size="small"
								dataSource={Object.entries(diag)}
								renderItem={([name, { ok, detail }]) => (
									<List.Item>
										<Tag color={ok ? "success" : "error"}>{ok ? "✓" : "✗"}</Tag>
										<strong>{name}</strong>
										<Typography.Text type="secondary" style={{ marginLeft: 8 }}>
											{detail}
										</Typography.Text>
									</List.Item>
								)}
							/>
						) : (
							<Typography.Text>Loading…</Typography.Text>
						)}
					</Card>
				</Col>
			</Row>

			<Card title={`Agent Tools (${info.tools.length})`}>
				<Table
					dataSource={info.tools}
					rowKey="name"
					pagination={false}
					size="small"
					columns={[
						{
							title: "Tool",
							dataIndex: "name",
							width: 200,
							render: (n) => <Tag color="purple">{n}</Tag>,
						},
						{ title: "Description", dataIndex: "description" },
					]}
				/>
			</Card>
		</>
	);
}
