import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, brainLoop } = createApp();

app.listen(config.port, () => {
	console.log(`[server] Cerebro Claw running on port ${config.port}`);
	brainLoop.start();
});
