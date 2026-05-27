export interface ToolDefinition {
	name: string;
	description: string;
	parameters: ToolParameters;
	execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolParameters {
	type: "object";
	properties: Record<string, ToolParameterProperty>;
	required?: string[];
}

export interface ToolParameterProperty {
	type: "string" | "number" | "boolean" | "array" | "object";
	description: string;
	enum?: string[];
}

export interface ToolResult {
	content: string;
	success: boolean;
	details?: Record<string, unknown>;
}
