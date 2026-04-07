# OmniRoute Manager for Pi

A [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that integrates [OmniRoute](https://github.com/diegosouzapw/OmniRoute) — an AI gateway that routes requests across 44+ LLM providers with automatic fallback, load balancing, and cost optimization.

## What it does

- **Auto-start** — automatically launches OmniRoute when pi starts if the server isn't running
- **Status bar** shows which model actually served each response — e.g. `CheapFix → gemini-2.5-flash (gemini · Google Account)`
- **Combo preview** on model switch — immediately shows the routing order before you send a message
- **Startup warnings** if any provider connections are expired or need re-authentication
- **Combo management** — edit models, create, and delete combos from within pi
- **Provider browser** — drill into providers to see accounts, connection health, and available models
- **Model sync** — push all OmniRoute models and combos to pi's Ctrl+P model picker
- **Health diagnostics** — call log analysis, config diagnostics, and auto-fix

## Install

### Option 1 — curl (quickest)

```bash
mkdir -p ~/.pi/agent/extensions
curl -o ~/.pi/agent/extensions/omniroute.ts \
  https://raw.githubusercontent.com/oscar-haha/omniroute-pi-extension/main/extensions/omniroute-manager.ts
```

### Option 2 — npm

```bash
npm install -g omniroute-pi-extension
cp "$(npm root -g)/omniroute-pi-extension/extensions/omniroute-manager.ts" \
  ~/.pi/agent/extensions/omniroute.ts
```

### Configure pi to use OmniRoute as a provider

Add an `omni` provider to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "omni": {
      "baseUrl": "http://localhost:20128",
      "api": "anthropic-messages",
      "apiKey": "YOUR_OMNIROUTE_API_KEY",
      "models": [
        { "id": "RoundRobin", "name": "RoundRobin" }
      ]
    }
  }
}
```

Find your OmniRoute API key in the OmniRoute dashboard under Settings → API Keys.

Then run `/omni sync` inside pi to populate the full model list automatically.

### Start pi

```bash
pi
```

The extension auto-loads. If OmniRoute isn't running, the extension will start it automatically. You'll see `OmniRoute ready — N combos` on startup.

## Commands

| Command | Description |
|---------|-------------|
| `/omni` | Status dashboard — health, active combos, provider issues |
| `/omni combos` | Manage combos — edit models, create, delete |
| `/omni providers` | Browse providers, models & add new ones |
| `/omni health` | Call log analysis + config diagnostics & auto-fix |
| `/omni sync` | Sync all OmniRoute models and combos to pi's Ctrl+P picker |
| `/omni setup-key` | Create an OmniRoute API key and save it to models.json |
| `/omni dashboard` | Show OmniRoute web dashboard URL |

## How it works

Pi sends requests to OmniRoute, which routes them to the best available provider based on your combo strategy (priority, weighted, round-robin, least-used, etc.). After each response, the extension polls OmniRoute's call logs until it finds the entry for that turn, then displays the actual model and account in pi's status bar.

### Auto-start

On session start, the extension checks if OmniRoute is healthy. If not:
- If OmniRoute is installed, it spawns it as a background process and waits up to 15s for it to come up
- If OmniRoute is not installed, it shows install instructions (`npm install -g omniroute`)

### Combos

Combos are model groups with routing strategies. For example:

```
RoundRobin [round-robin]:
  gemini-2.5-flash › gpt-5.4 › claude-sonnet-4.5 › gemini-3-flash
```

Create and edit combos in the OmniRoute dashboard or with `/omni combos`.

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
