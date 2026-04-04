# OmniRoute Manager for Pi

A [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that integrates [OmniRoute](https://github.com/diegosouzapw/OmniRoute) — an AI gateway that routes requests across 44+ LLM providers with automatic fallback, load balancing, and cost optimization.

## What it does

- **Status bar** shows which model actually served each response (e.g. `CheapFix → gemini-2.5-flash-lite (gemini)`)
- **Startup warnings** if any provider connections are expired or need re-authentication
- **Combo management** — toggle model groups on/off without leaving pi
- **Provider browser** — drill into providers to see accounts, connection health, and available models
- **Model sync** — push all OmniRoute models to pi's Ctrl+P model picker
- **Add custom providers** — register OpenAI-compatible providers not built into OmniRoute

## Install

### 1. Copy the extension

```bash
mkdir -p ~/.pi/agent/extensions
curl -o ~/.pi/agent/extensions/omniroute-manager.ts \
  https://raw.githubusercontent.com/oscarandrea/omniroute-pi-extension/main/omniroute-manager.ts
```

### 2. Configure pi to use OmniRoute as a provider

Add an `omni` provider to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "omni": {
      "baseUrl": "http://localhost:20128",
      "api": "anthropic-messages",
      "apiKey": "YOUR_OMNIROUTE_API_KEY",
      "models": [
        { "id": "CheapFix", "name": "CheapFix" },
        { "id": "gemini/gemini-2.5-flash", "name": "Gemini 2.5 Flash" }
      ]
    }
  }
}
```

Find your OmniRoute API key in the OmniRoute dashboard (http://localhost:20128) under Settings > API Keys.

### 3. Start pi

```bash
pi
```

The extension auto-loads. You should see `OmniRoute ready` on startup.

## Commands

| Command | Description |
|---------|-------------|
| `/omni` | Status dashboard — health, combos, provider issues |
| `/omni toggle` | Toggle combos on/off interactively (loop until done) |
| `/omni providers` | Browse providers — select one to see accounts and models |
| `/omni add-provider` | Add an OpenAI-compatible provider not built into OmniRoute |
| `/omni sync` | Sync all OmniRoute models to pi's Ctrl+P model picker |
| `/omni dashboard` | Show OmniRoute web dashboard URL |

## How it works

Pi sends requests to OmniRoute, which routes them to the best available provider based on your combo configuration (priority, weighted, round-robin, etc.). After each response, the extension queries OmniRoute's call logs to display which model actually served the request in pi's status bar.

### Combos

Combos are model groups with routing strategies. For example, a "CheapFix" combo might try free models first, falling back to paid ones:

```
CheapFix [priority]:
  1. qw/qwen3-coder-flash
  2. gemini/gemini-2.5-flash-lite
  3. groq/qwen/qwen3-32b
  4. openrouter/auto
```

Create and edit combos in the OmniRoute dashboard. Toggle them on/off from pi with `/omni toggle`.

### Custom providers

OmniRoute supports 44+ built-in providers. For providers not included (like [OpenAdapter](https://openadapter.in)), use `/omni add-provider` to register any OpenAI-compatible endpoint.

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `OMNIROUTE_URL` | `http://127.0.0.1:20128` | OmniRoute API URL |
| `OMNIROUTE_DASHBOARD` | `http://localhost:20128` | Dashboard URL shown in messages |

## Requirements

- [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) v0.60.0+
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute) v2.9.0+ running locally or on your network

## License

MIT
