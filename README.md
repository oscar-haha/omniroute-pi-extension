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
- **Live usage limits** — query provider APIs directly for real-time quota and rate limit data
- **Health diagnostics** — call log analysis, config diagnostics, and auto-fix

## Install

```bash
pi install git:github.com/oscar-haha/omniroute-pi-extension
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
| `/omni limits` | Live usage quotas — queries provider APIs directly |
| `/omni sync` | Sync all OmniRoute models and combos to pi's Ctrl+P picker |
| `/omni setup-key` | Create an OmniRoute API key and save it to models.json |
| `/omni dashboard` | Show OmniRoute web dashboard URL |

### `/omni limits`

Fetches live quota data directly from each provider's API (bypasses OmniRoute's cache):

```
─── antigravity/oscar@yulife (Free) ───
  gemini-3-pro-high: [████████░░░░░░░░░░░░] 60% left — resets 2026-04-12 09:55
  gemini-3-pro-low: [████████░░░░░░░░░░░░] 60% left — resets 2026-04-12 09:55
  + 13 more model(s) at 100%

─── codex/oscarharry@gmail.com (free) ───
  ❌ session: EXHAUSTED — resets 2026-04-12 08:39
  code_review: [░░░░░░░░░░░░░░░░░░░░] 100% left — resets 2026-04-15

─── kiro/OH@gm kiro (KIRO FREE) ───
  credit (0/50): [░░░░░░░░░░░░░░░░░░░░] 100% left — resets 2026-04-28
```

Supported providers: Antigravity (Google), Codex (OpenAI), Kiro (AWS), Kimi Coding. Gemini API-key accounts and Alibaba don't expose usage APIs.

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
