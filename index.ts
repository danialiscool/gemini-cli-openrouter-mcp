import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";

const API_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY) {
  console.error("Error: OPENROUTER_API_KEY not found in .env or environment");
  process.exit(1);
}

const server = new Server(
  {
    name: "openrouter-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_models",
        description: "List available models from OpenRouter",
        inputSchema: {
          type: "object",
          properties: {
            free: { type: "boolean", description: "Filter only free models" },
            query: { type: "string", description: "Filter models by name or ID" },
          },
        },
      },
      {
        name: "prompt",
        description: "Send a prompt to an OpenRouter model",
        inputSchema: {
          type: "object",
          properties: {
            modelId: { type: "string", description: "Model ID (e.g., google/gemini-2.0-flash-exp:free)" },
            prompt: { type: "string", description: "The prompt message" },
          },
          required: ["modelId", "prompt"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "list_models") {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      const json: any = await response.json();
      let models = json.data || [];
      if (args?.free) models = models.filter((m: any) => m.id.endsWith(":free"));
      if (args?.query) {
        const q = String(args.query).toLowerCase();
        models = models.filter((m: any) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
      }
      return { content: [{ type: "text", text: JSON.stringify(models.map((m: any) => ({ id: m.id, name: m.name })), null, 2) }] };
    }
    if (name === "prompt") {
      const { modelId, prompt } = args as { modelId: string; prompt: string };
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: prompt }] }),
      });
      const json: any = await response.json();
      if (json.error) throw new Error(json.error.message);
      return { content: [{ type: "text", text: json.choices[0].message.content }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("OpenRouter MCP server running");
