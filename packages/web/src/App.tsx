import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConfigProvider, theme } from "antd";
import { AppLayout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Customers } from "./pages/Customers.js";
import { Activity } from "./pages/Activity.js";

export function App() {
	return (
		<ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
			<BrowserRouter>
				<AppLayout>
					<Routes>
						<Route path="/" element={<Dashboard />} />
						<Route path="/customers" element={<Customers />} />
						<Route path="/activity" element={<Activity />} />
					</Routes>
				</AppLayout>
			</BrowserRouter>
		</ConfigProvider>
	);
}
