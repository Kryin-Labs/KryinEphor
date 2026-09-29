import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "server_info",
  title: "Server info",
  description: "Return basic information about the EduNex MCP server (name, version, current server time).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => {
    const info = {
      name: "EduNex MCP",
      version: "0.1.0",
      description: "Agent integrations for the EduNex school management platform.",
      serverTime: new Date().toISOString(),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      structuredContent: info,
    };
  },
});
