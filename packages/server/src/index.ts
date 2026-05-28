import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, brainLoop, shutdown } = await createApp();

const server = app.listen(config.port, () => {
	console.log(`[server] Cerebro Claw running on port ${config.port}`);
	brainLoop.start();
});

const cleanup = async (signal: string) => {
	console.log(`[server] Received ${signal}, shutting down...`);
	server.close();
	await shutdown();
	process.exit(0);
};

process.on("SIGTERM", () => cleanup("SIGTERM"));
process.on("SIGINT", () => cleanup("SIGINT"));
