import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, ".models-cache.json");
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Note: The Gemini CLI extension system handles the API_KEY injection 
 * via the settings in gemini-extension.json. It will be available in 
 * process.env.OPENROUTER_API_KEY.
 */
const API_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY) {
  console.error("Error: OPENROUTER_API_KEY environment variable is missing.");
  console.error("Please run 'gemini extension configure openrouter-mcp' or set the variable.");
  process.exit(1);
}

interface OpenRouterModel {
  id: string;
  name: string;
}

interface OpenRouterResponse {
  data?: OpenRouterModel[];
  choices?: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
    code?: number;
  };
}

// Persistent cache helper
function getCachedModels(): OpenRouterModel[] | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const stats = fs.statSync(CACHE_FILE);
      const now = Date.now();
      if (now - stats.mtimeMs < CACHE_TTL) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
      }
    }
  } catch (error) {
    console.error("Cache read error:", error);
  }
  return null;
}

function setCachedModels(models: OpenRouterModel[]) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(models));
  } catch (error) {
    console.error("Cache write error:", error);
  }
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

async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s safety rail

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "HTTP-Referer": "https://geminicli.com",
        "X-Title": "Gemini CLI OpenRouter Extension",
        ...options.headers,
      },
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") || "10";
      throw new Error(`Rate limited by OpenRouter. Please wait ${retryAfter} seconds.`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tool definitions
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_models",
        description: "List available models from OpenRouter",
        inputSchema: {
          type: "object",
          properties: {
            free: {
              type: "boolean",
              description: "Filter only free models",
            },
            query: {
              type: "string",
              description: "Filter models by name or ID",
            },
          },
        },
      },
      {
        name: "prompt",
        description: "Send a prompt to an OpenRouter model",
        inputSchema: {
          type: "object",
          properties: {
            modelId: {
              type: "string",
              description: "The ID of the model (e.g., 'google/gemini-2.0-flash-exp:free')",
            },
            prompt: {
              type: "string",
              description: "The prompt message to send",
            },
          },
          required: ["modelId", "prompt"],
        },
      },
    ],
  };
});

/**
 * Tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "list_models") {
      let models = getCachedModels();

      if (!models) {
        const response = await fetchWithRetry("https://openrouter.ai/api/v1/models");
        
        if (!response.ok) {
          throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
        }

        const json = await response.json() as OpenRouterResponse;
        models = json.data || [];
        setCachedModels(models);
      }

      let filteredModels = [...models];

      if (args?.free) {
        filteredModels = filteredModels.filter((m) => m.id.endsWith(":free"));
      }
      if (args?.query) {
        const queryLowerCase = String(args.query).toLowerCase();
        filteredModels = filteredModels.filter((m) => 
          m.id.toLowerCase().includes(queryLowerCase) || m.name.toLowerCase().includes(queryLowerCase)
        );
      }

      // Format as readable table for CLI
      const table = filteredModels
        .map((m) => `${m.id.padEnd(50)} | ${m.name}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: table || "No models found matching criteria.",
          },
        ],
      };
    }

    if (name === "prompt") {
      const { modelId, prompt } = args as { modelId: string; prompt: string };

      if (!modelId || !prompt) {
        throw new Error("Missing modelId or prompt");
      }

      const response = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        let message = `HTTP error ${response.status}`;
        try {
          const errorJson = await response.json() as OpenRouterResponse;
          message = errorJson.error?.message || message;
        } catch {
          // Fallback if not JSON
        }
        throw new Error(`OpenRouter API Error: ${message}`);
      }

      const json = await response.json() as OpenRouterResponse;
      
      if (!json.choices?.[0]?.message?.content) {
        throw new Error("Invalid response from OpenRouter: Missing content");
      }

      return {
        content: [
          {
            type: "text",
            text: json.choices[0].message.content,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
});

/**
 * Start server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenRouter MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
