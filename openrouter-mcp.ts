import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, ".models-cache.json");
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Input Validation
const MAX_PROMPT_LENGTH = 15000;
function validateInput(modelId: string, prompt: string) {
  if (!modelId || typeof modelId !== "string" || modelId.length > 255) {
    throw new Error("Invalid or missing modelId");
  }
  if (!prompt || typeof prompt !== "string" || prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt must be a string between 1 and ${MAX_PROMPT_LENGTH} characters`);
  }
}

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
async function getCachedModels(): Promise<OpenRouterModel[] | null> {
  try {
    const stats = await fs.stat(CACHE_FILE);
    const now = Date.now();
    if (now - stats.mtimeMs < CACHE_TTL) {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    // If file doesn't exist, ignore. If corrupted, delete it.
    if ((error as any).code !== "ENOENT") {
      console.error("Cache read error (possibly corrupted):", error);
      try { await fs.unlink(CACHE_FILE); } catch {}
    }
  }
  return null;
}

async function setCachedModels(models: OpenRouterModel[]) {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(models));
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

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
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

      // Retry on 5xx errors
      if (response.status >= 500 && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return response;
    } catch (error: any) {
      if (attempt === retries || error.name === "AbortError" || response?.status === 429) {
        throw error;
      }
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Fetch failed after retries");
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
            forceRefresh: {
              type: "boolean",
              description: "Bypass cache and fetch fresh model list",
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
      let models = args?.forceRefresh ? null : await getCachedModels();

      if (!models) {
        const response = await fetchWithRetry("https://openrouter.ai/api/v1/models");
        
        if (!response.ok) {
          throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
        }

        const json = await response.json() as OpenRouterResponse;
        models = json.data || [];
        await setCachedModels(models);
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

      // Format as Markdown table for CLI
      const header = "| Model ID | Tier | Name |\n| :--- | :--- | :--- |";
      const rows = filteredModels
        .map((m) => {
          const tier = m.id.endsWith(":free") ? "Free" : "Paid";
          return `| \`${m.id}\` | ${tier} | ${m.name} |`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: filteredModels.length > 0 ? `${header}\n${rows}` : "No models found matching criteria.",
          },
        ],
      };
    }

    if (name === "prompt") {
      const { modelId, prompt } = args as { modelId: string; prompt: string };
      validateInput(modelId, prompt);

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
