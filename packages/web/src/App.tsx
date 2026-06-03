import { ConfigProvider, theme } from "antd";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/Layout.js";
import { Blocked } from "./pages/Blocked.js";
import { Pipeline } from "./pages/Pipeline.js";
import { Settings } from "./pages/Settings.js";
import { Skills } from "./pages/Skills.js";
import "./theme.css";

export function App() {
	return (
		<ConfigProvider
			theme={{
				algorithm: theme.darkAlgorithm,
				token: {
					colorBgBase: "#0a0e14",
					colorBgContainer: "#10151f",
					colorBorder: "#1c2430",
					colorPrimary: "#2dd4bf",
					colorText: "#c6d0dd",
					colorTextSecondary: "#6b7787",
					borderRadius: 4,
					fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
				},
			}}
		>
			<BrowserRouter>
				<Routes>
					<Route element={<AppLayout />}>
						<Route path="/" element={<Pipeline />} />
						<Route path="/blocked" element={<Blocked />} />
						<Route path="/skills" element={<Skills />} />
						<Route path="/settings" element={<Settings />} />
					</Route>
				</Routes>
			</BrowserRouter>
		</ConfigProvider>
	);
}
