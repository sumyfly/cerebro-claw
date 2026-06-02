import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

// biome-ignore lint/style/noNonNullAssertion: #root always exists in index.html
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
