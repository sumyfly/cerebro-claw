import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { printStartupBanner, runStartupChecks } from "./startup.js";

const config = loadConfig();
printStartupBanner(runStartupChecks(config));

const { app, brainLoop, dispatcher, shutdown } = await createApp();

const server = app.listen(config.port, () => {
	console.log(`[server] Cerebro Claw running on http://localhost:${config.port}`);
	brainLoop.start();
	dispatcher.start();
});

const cleanup = async (signal: string) => {
	console.log(`[server] Received ${signal}, shutting down...`);
	server.close();
	await shutdown();
	process.exit(0);
};

process.on("SIGTERM", () => cleanup("SIGTERM"));
process.on("SIGINT", () => cleanup("SIGINT"));
