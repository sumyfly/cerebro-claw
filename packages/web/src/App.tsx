import { ConfigProvider, theme } from "antd";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/Layout.js";
import { Activity } from "./pages/Activity.js";
import { Customers } from "./pages/Customers.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Extensions } from "./pages/Extensions.js";

export function App() {
	return (
		<ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
			<BrowserRouter>
				<AppLayout>
					<Routes>
						<Route path="/" element={<Dashboard />} />
						<Route path="/customers" element={<Customers />} />
						<Route path="/activity" element={<Activity />} />
						<Route path="/extensions" element={<Extensions />} />
					</Routes>
				</AppLayout>
			</BrowserRouter>
		</ConfigProvider>
	);
}
