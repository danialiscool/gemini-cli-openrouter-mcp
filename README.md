# Gemini CLI OpenRouter MCP

A standalone Model Context Protocol (MCP) server for OpenRouter integration.

## Installation

1. Clone this repository to your machine.
2. Run `npm install`.
3. Create a `.env` file and add your `OPENROUTER_API_KEY`.
4. Add the server to your Gemini CLI configuration (`.gemini/settings.json`):

```json
{
  "mcpServers": {
    "openrouter": {
      "command": "npx",
      "args": [
        "ts-node",
        "--esm",
        "path/to/repo/index.ts"
      ]
    }
  }
}
```

## Tools
- `list_models`: Retrieve and filter models.
- `prompt`: Interact with any OpenRouter model.
