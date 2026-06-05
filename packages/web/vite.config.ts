import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		host: "0.0.0.0", // listen on all interfaces so the dev server is reachable over the LAN / frp tunnel
		allowedHosts: true, // accept any Host header (LAN IP, frp domain, etc.)
		proxy: {
			"/api": "http://localhost:5100",
		},
	},
	build: {
		// antd alone is ~900KB; raise the warning so the build output isn't noisy.
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			output: {
				manualChunks: {
					react: ["react", "react-dom", "react-router-dom"],
					antd: ["antd", "@ant-design/icons"],
				},
			},
		},
	},
});
