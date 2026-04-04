# OmniRoute Manager for Pi

A [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that integrates [OmniRoute](https://github.com/diegosouzapw/OmniRoute) — an AI gateway that routes requests across 44+ LLM providers with automatic fallback, load balancing, and cost optimization.

## What it does

- **Status bar** shows which model actually served each response — e.g. `CheapFix → gemini-2.5-flash-lite (gemini · Google Account)`
- **Combo preview** on model switch — immediately shows the routing order before you send a message
- **Startup warnings** if any provider connections are expired or need re-authentication
- **Combo management** — toggle on/off and switch active model without leaving pi
- **Provider browser** — drill into providers to see accounts, connection health, and available models
- **Model sync** — push all OmniRoute models and combos to pi's Ctrl+P model picker
- **Log review** — analyse call history to find broken models, with replacement suggestions
- **Add custom providers** — register OpenAI-compatible providers not built into OmniRoute

## Install

### Option 1 — curl (quickest)

```bash
mkdir -p ~/.pi/agent/extensions
curl -o ~/.pi/agent/extensions/omniroute-manager.ts \
  https://raw.githubusercontent.com/oscar-haha/omniroute-pi-extension/main/omniroute-manager.ts
```

### Option 2 — npm

```bash
npm install -g omniroute-pi-extension
cp "$(npm root -g)/omniroute-pi-extension/omniroute-manager.ts" \
  ~/.pi/agent/extensions/omniroute-manager.ts
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
        { "id": "CheapFix", "name": "CheapFix" }
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

The extension auto-loads. You'll see `OmniRoute ready — N combos` on startup.

## Commands

| Command | Description |
|---------|-------------|
| `/omni` | Status dashboard — health, active combos, provider issues |
| `/omni toggle` | Interactive combo manager — Space toggles ON/OFF, Enter sets active model, Esc exits |
| `/omni providers` | Browse providers — select one to see accounts and available models |
| `/omni add-provider` | Register an OpenAI-compatible provider not built into OmniRoute |
| `/omni sync` | Sync all OmniRoute models and combos to pi's Ctrl+P picker |
| `/omni log-review` | Analyse call history — flags broken models and suggests replacements |
| `/omni dashboard` | Show OmniRoute web dashboard URL |

### `/omni toggle` keyboard controls

```
↑ / ↓    Navigate combos
Space    Toggle combo ON / OFF
Enter    Set combo as active model immediately
Esc / q  Close
```

The status bar updates to show the combo's routing order as soon as you switch, and then updates again after each response to show which model actually ran.

### `/omni log-review`

Fetches the last 200 call logs and analyses each model in each combo:

```
─── OpenSource [priority] ───
  ✅ groq/llama-3.3-70b-versatile     100% success · avg 380ms
  ⚠️  groq/llama-3.3-70b-versatile    context too large for free tier (8× 413) — works in shorter sessions
  ❌ openrouter/auto                  0/5 success · 403×1, 502×4 → suggest replace
  ⏱  nvidia/deepseek-ai/deepseek-v3.2 100% success · avg 49s (slow)
  ❓ nvidia/moonshotai/kimi-k2.5      (no history)
```

For each broken model (❌) it then prompts you to remove it or pick a replacement from the same provider or others — filtered to exclude models already in the combo.

## How it works

Pi sends requests to OmniRoute, which routes them to the best available provider based on your combo strategy (priority, weighted, round-robin, least-used). After each response, the extension polls OmniRoute's call logs until it finds the entry for that turn, then displays the actual model and account in pi's status bar.

### Combos

Combos are model groups with routing strategies. For example:

```
CheapFix [priority]:
  1. qw/qwen3-coder-flash       ← try first (free, fast)
  2. gemini/gemini-2.5-flash-lite
  3. groq/qwen/qwen3-32b
  4. kr/claude-sonnet-4.5       ← last resort fallback
```

Create and edit combos in the OmniRoute dashboard. Toggle them on/off or switch active model from pi with `/omni toggle`.

### Custom providers

OmniRoute supports 44+ built-in providers. For others (like [OpenAdapter](https://openadapter.in)), use `/omni add-provider` to register any OpenAI-compatible endpoint.

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
