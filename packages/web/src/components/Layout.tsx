import { Layout, Menu } from "antd";
import {
	DashboardOutlined,
	TeamOutlined,
	BellOutlined,
	ApiOutlined,
} from "@ant-design/icons";
import { useNavigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const { Header, Sider, Content } = Layout;

const menuItems = [
	{ key: "/", icon: <DashboardOutlined />, label: "Dashboard" },
	{ key: "/customers", icon: <TeamOutlined />, label: "Customers" },
	{ key: "/activity", icon: <BellOutlined />, label: "Activity" },
	{ key: "/extensions", icon: <ApiOutlined />, label: "Extensions" },
];

export function AppLayout({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const location = useLocation();

	return (
		<Layout style={{ minHeight: "100vh" }}>
			<Sider theme="light" width={220}>
				<div
					style={{
						height: 64,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontWeight: 700,
						fontSize: 18,
					}}
				>
					Cerebro Claw
				</div>
				<Menu
					mode="inline"
					selectedKeys={[location.pathname]}
					items={menuItems}
					onClick={({ key }) => navigate(key)}
				/>
			</Sider>
			<Layout>
				<Header
					style={{
						background: "#fff",
						padding: "0 24px",
						display: "flex",
						alignItems: "center",
						borderBottom: "1px solid #f0f0f0",
					}}
				>
					<h3 style={{ margin: 0 }}>CSM AI Colleague</h3>
				</Header>
				<Content style={{ margin: 24 }}>{children}</Content>
			</Layout>
		</Layout>
	);
}
