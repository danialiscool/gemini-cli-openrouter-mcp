# OpenRouter Extension

This extension provides tools to interact with models hosted on OpenRouter. It is particularly useful for accessing specific models not available in the local environment or for comparing outputs across different architectures.

## Tools

### `list_models`
Lists available models on OpenRouter. 
- Use `free: true` to find models that don't require credits.
- Use `query: "name"` to search for specific model families (e.g., "llama", "deepseek").

### `prompt`
Sends a prompt to a specific model.
- Requires a `modelId` (e.g., `meta-llama/llama-3.1-405b-instruct:free`).
- Useful for specialized reasoning tasks or when the user explicitly requests a different model.

## Best Practices
- **Cost Awareness**: Always prefer `:free` models unless high-reasoning or specific capabilities of a paid model are required.
- **Model Selection**: If a task requires deep logic (like code review), suggest `meta-llama/llama-3.1-405b-instruct:free` or `qwen/qwen3-coder:free`.
- **Caching**: The `list_models` tool has built-in caching for 5 minutes.
