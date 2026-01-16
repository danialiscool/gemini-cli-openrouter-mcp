# OpenRouter Gemini CLI Extension

Interact with 200+ AI models via OpenRouter directly from your Gemini CLI. This extension is built following the Gemini CLI "Gold Standard" for reliability, performance, and security.

## Features

- **Standardized Manifest**: Fully compatible with the Gemini CLI extension system.
- **Resilient Networking**: Built-in 30s timeouts and 429 (Rate Limit) awareness.
- **Persistent Caching**: Model lists are cached locally to reduce API overhead.
- **CLI-Optimized Output**: Formatted tabular views for model exploration.
- **Secure Secret Handling**: Leverages Gemini CLI's native keychain integration.

## Installation

You can install this extension directly via the Gemini CLI:

```bash
gemini extension install https://github.com/danialiscool/gemini-cli-openrouter-mcp.git
```

The CLI will prompt you for your `OPENROUTER_API_KEY` during installation and store it securely.

## Tools

### `list_models`
Lists available models on OpenRouter with filtering.
- `free` (boolean): Filter for free-to-use models.
- `query` (string): Search models by name or ID.

**Example:**
```bash
/openrouter-mcp:list_models free=true query="llama"
```

### `prompt`
Sends a prompt to a specific OpenRouter model.
- `modelId` (string): The full ID of the model (e.g., `meta-llama/llama-3.1-405b-instruct:free`).
- `prompt` (string): The message to send.

**Example:**
```bash
/openrouter-mcp:prompt modelId="openai/o1-preview" prompt="Solve this complex equation..."
```

## Best Practices

1. **Cost Awareness**: Always prefer `:free` models for simple tasks.
2. **Model Selection**: For deep reasoning or code review, use high-capacity models like `meta-llama/llama-3.1-405b-instruct` or `qwen/qwen3-coder`.
3. **Caching**: The model list is cached for 5 minutes. If you need fresh results, wait for the TTL to expire or reinstall the extension.

## Manual Configuration

To update your API key later:
```bash
gemini extension configure openrouter-mcp
```

## Development

Requires Node.js and TypeScript (`ts-node`).

```bash

npm install

# Run server via stdio

npx ts-node --esm openrouter-mcp.ts

```
