/**
 * OmniRoute Manager — Pi Coding Agent Extension
 *
 * Manages OmniRoute (https://github.com/diegosouzapw/OmniRoute) from within
 * pi (https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).
 *
 * Features:
 *   - Status bar shows which model actually served each response (via call logs)
 *   - Warns on startup if any provider connections need re-authentication
 *   - /omni commands for managing combos, providers, and model sync
 *
 * Commands:
 *   /omni                  — Status dashboard: health, combos, provider issues
 *   /omni toggle           — Toggle combos on/off interactively
 *   /omni providers        — Browse providers → drill into models
 *   /omni add-provider     — Add an OpenAI-compatible provider not built into OmniRoute
 *   /omni sync             — Sync all OmniRoute models to pi's Ctrl+P picker
 *   /omni dashboard        — Show OmniRoute web dashboard URL
 *
 * Installation:
 *   1. Copy this file to ~/.pi/agent/extensions/omniroute-manager.ts
 *   2. Ensure OmniRoute is running (default: http://localhost:20128)
 *   3. Configure pi to use OmniRoute as a provider in ~/.pi/agent/models.json:
 *      {
 *        "providers": {
 *          "omni": {
 *            "baseUrl": "http://localhost:20128",
 *            "api": "anthropic-messages",
 *            "apiKey": "YOUR_OMNIROUTE_API_KEY",
 *            "models": [...]
 *          }
 *        }
 *      }
 *   4. Start pi — the extension auto-loads and shows OmniRoute status.
 *
 * Configuration (environment variables, all optional):
 *   OMNIROUTE_URL       — OmniRoute API URL (default: http://127.0.0.1:20128)
 *   OMNIROUTE_DASHBOARD — Dashboard URL shown to user (default: http://localhost:20128)
 *
 * License: MIT
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const OMNI_URL = process.env.OMNIROUTE_URL || "http://127.0.0.1:20128";
const DASHBOARD_URL = process.env.OMNIROUTE_DASHBOARD || "http://localhost:20128";

// ────────────────────────── helpers ──────────────────────────

function modelsJsonPath(): string {
	return process.env.PI_HOME
		? `${process.env.PI_HOME}/models.json`
		: `${process.env.HOME}/.pi/agent/models.json`;
}

function getApiKey(): string {
	try {
		const fs = require("fs");
		const data = JSON.parse(fs.readFileSync(modelsJsonPath(), "utf8"));
		return data?.providers?.omni?.apiKey || "";
	} catch {
		return "";
	}
}

function auth(): Record<string, string> {
	const key = getApiKey();
	return key
		? { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
		: { "Content-Type": "application/json" };
}

async function api(path: string, opts?: RequestInit): Promise<any> {
	const res = await fetch(`${OMNI_URL}${path}`, {
		...opts,
		headers: { ...auth(), ...(opts?.headers || {}) },
		signal: AbortSignal.timeout(10000),
	});
	if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
	return res.json();
}

// ────────────────────────── health ──────────────────────────

async function checkOmniRouteHealth(): Promise<boolean> {
	try {
		const res = await fetch(`${OMNI_URL}/v1/models`, { signal: AbortSignal.timeout(3000) });
		return res.ok;
	} catch {
		return false;
	}
}

// ────────────────────────── combos ──────────────────────────

interface Combo {
	id: string;
	name: string;
	models: (string | { model: string; weight: number })[];
	strategy: string;
	isActive?: boolean;
}

async function listCombos(): Promise<Combo[]> {
	try {
		const data = await api("/api/combos");
		return data?.combos || data || [];
	} catch {
		return [];
	}
}

function comboLine(c: Combo, idx: number): string {
	const on = c.isActive !== false;
	const flag = on ? "✅" : "⬜";
	const count = c.models.length;
	return `${flag} ${idx + 1}. ${c.name}  [${c.strategy}, ${count} model${count !== 1 ? "s" : ""}]`;
}

// ────────────────────────── providers & connections ──────────────────────────

interface Connection {
	id: string;
	provider: string;
	authType: string;
	name: string;
	isActive: boolean;
	testStatus?: string;
	lastError?: string;
	errorCode?: string;
	providerSpecificData?: { prefix?: string; nodeName?: string; baseUrl?: string };
}

interface ProviderNode {
	id: string;
	type: string;
	name: string;
	prefix: string;
	baseUrl: string;
}

interface ProviderGroup {
	displayName: string;
	prefix: string;
	connections: Connection[];
	nodeId?: string;
}

async function listConnections(): Promise<Connection[]> {
	try {
		const data = await api("/api/providers");
		return data?.connections || [];
	} catch {
		return [];
	}
}

async function listProviderNodes(): Promise<ProviderNode[]> {
	try {
		const data = await api("/api/provider-nodes");
		return data?.nodes || [];
	} catch {
		return [];
	}
}

async function getProviderModels(connectionId: string): Promise<string[]> {
	try {
		const data = await api(`/api/providers/${connectionId}/models`);
		const models = data?.models || [];
		return models.map((m: any) => (typeof m === "string" ? m : m.id || m.name || String(m)));
	} catch {
		return [];
	}
}

function getDisconnectedProviders(connections: Connection[]): Connection[] {
	return connections.filter(
		(c) =>
			c.isActive &&
			(c.testStatus === "error" ||
				c.testStatus === "expired" ||
				c.errorCode === "refresh_failed" ||
				(c.lastError && c.lastError.includes("refresh failed")))
	);
}

function groupProviders(connections: Connection[], nodes: ProviderNode[]): ProviderGroup[] {
	const groups = new Map<string, ProviderGroup>();
	const nodeMap = new Map<string, ProviderNode>();
	for (const n of nodes) nodeMap.set(n.id, n);

	for (const c of connections) {
		const psd = c.providerSpecificData || {};
		let displayName = psd.nodeName || c.provider;
		let prefix = psd.prefix || "";

		if (!psd.nodeName) {
			displayName = c.provider.charAt(0).toUpperCase() + c.provider.slice(1);
		}

		const key = displayName;
		if (!groups.has(key)) {
			groups.set(key, { displayName, prefix, connections: [], nodeId: undefined });
		}
		const g = groups.get(key)!;
		g.connections.push(c);

		if (c.provider.startsWith("openai-compatible-") || c.provider.startsWith("anthropic-compatible-")) {
			const node = nodeMap.get(c.provider);
			if (node) {
				g.prefix = node.prefix;
				g.nodeId = node.id;
			}
		}
	}

	return Array.from(groups.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ────────────────────────── call log (resolved model tracking) ──────────────────────────

interface CallLog {
	model: string;
	provider: string;
	account: string;
	comboName?: string;
	status: number;
}

async function getLastCallLog(): Promise<CallLog | null> {
	try {
		const logs: CallLog[] = await api("/api/usage/call-logs?limit=1");
		return logs?.[0] || null;
	} catch {
		return null;
	}
}

// ────────────────────────── model sync ──────────────────────────

async function getAllModelsFromOmniRoute(): Promise<{ id: string; name: string }[]> {
	const results: { id: string; name: string }[] = [];

	// Models from built-in providers
	try {
		const data = await api("/v1/models");
		const models = data?.data || [];
		for (const m of models) {
			const id = typeof m === "string" ? m : m.id;
			if (id) results.push({ id, name: humanName(id) });
		}
	} catch {}

	// Models from custom provider nodes (OpenAI-compatible, etc.)
	try {
		const [connections, nodes] = await Promise.all([listConnections(), listProviderNodes()]);
		for (const node of nodes) {
			const nodeConns = connections.filter((c) => c.provider === node.id && c.isActive);
			for (const conn of nodeConns) {
				const models = await getProviderModels(conn.id);
				for (const modelId of models) {
					const prefixedId = `${node.prefix}/${modelId}`;
					if (!results.find((r) => r.id === prefixedId)) {
						results.push({ id: prefixedId, name: humanName(prefixedId) });
					}
				}
			}
		}
	} catch {}

	// Combos as selectable models
	try {
		const combos = await listCombos();
		for (const c of combos) {
			if (!results.find((r) => r.id === c.name)) {
				results.push({ id: c.name, name: c.name });
			}
		}
	} catch {}

	return results.sort((a, b) => a.name.localeCompare(b.name));
}

function humanName(id: string): string {
	const parts = id.split("/");
	const provider = parts.length > 1 ? parts[0] : "";
	const model = parts.length > 1 ? parts.slice(1).join("/") : parts[0];

	let name = model
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());

	if (provider && name.toLowerCase().startsWith(provider.toLowerCase())) {
		name = name.slice(provider.length).trim();
		if (!name) name = model;
		name = name.charAt(0).toUpperCase() + name.slice(1);
	}

	return name;
}

// ════════════════════════════════════════════════════════════
// Extension entry point
// ════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
	let healthInterval: ReturnType<typeof setInterval> | undefined;

	// ── Show resolved model in status bar after each response ──

	pi.on("message_end", async (event, ctx) => {
		try {
			const msg = event.message as any;
			if (msg?.role !== "assistant") return;

			// Brief delay for OmniRoute to write the call log entry
			await new Promise((r) => setTimeout(r, 200));

			const log = await getLastCallLog();
			if (log) {
				const combo = log.comboName ? `${log.comboName} → ` : "";
				const acct = log.account ? ` · ${log.account}` : "";
				const ok = log.status === 200;
				const suffix = ok ? "" : ` ✗${log.status}`;
				ctx.ui.setStatus("omni", `${combo}${log.model} (${log.provider}${acct})${suffix}`);
			}
		} catch {}
	});

	// ── Startup: health check + disconnected provider warnings ──

	pi.on("session_start", async (_event, ctx) => {
		const healthy = await checkOmniRouteHealth();
		ctx.ui.setStatus("omni", healthy ? "OmniRoute ✓" : "OmniRoute ✗");

		if (healthy) {
			const [combos, conns] = await Promise.all([listCombos(), listConnections()]);
			const active = combos.filter((c) => c.isActive !== false).length;
			const disconnected = getDisconnectedProviders(conns);

			ctx.ui.notify(`OmniRoute ready — ${combos.length} combos (${active} active)`, "info");

			if (disconnected.length > 0) {
				const names = disconnected
					.map((c) => {
						const psd = c.providerSpecificData || {};
						return `  ❌ ${psd.nodeName || c.provider}: ${c.name} — ${c.lastError || c.errorCode || "disconnected"}`;
					})
					.join("\n");
				ctx.ui.notify(
					`⚠️ ${disconnected.length} provider(s) need re-authentication:\n${names}\n\nOpen ${DASHBOARD_URL} → Providers to re-connect.`,
					"warning"
				);
			}
		} else {
			ctx.ui.notify(`OmniRoute not responding at ${OMNI_URL}`, "warning");
		}

		// Periodic health check — only update status if OmniRoute goes down
		// (avoids overwriting the resolved model display)
		healthInterval = setInterval(async () => {
			const h = await checkOmniRouteHealth();
			if (!h) ctx.ui.setStatus("omni", "OmniRoute ✗");
		}, 60_000);
	});

	pi.on("session_shutdown", async () => {
		if (healthInterval) clearInterval(healthInterval);
	});

	// ── /omni command ──

	pi.registerCommand("omni", {
		description: "OmniRoute: /omni [toggle|providers|add-provider|sync|dashboard]",
		getArgumentCompletions(prefix: string) {
			return ["toggle", "providers", "add-provider", "sync", "dashboard"]
				.filter((s) => s.startsWith(prefix))
				.map((s) => ({ value: s, label: s }));
		},
		async handler(args, ctx) {
			const parts = args.trim().split(/\s+/);
			const sub = parts[0]?.toLowerCase() || "";

			// ──────────────── /omni (status dashboard) ────────────────

			if (!sub) {
				const [healthy, combos, conns] = await Promise.all([
					checkOmniRouteHealth(),
					listCombos(),
					listConnections(),
				]);

				const active = combos.filter((c) => c.isActive !== false).length;
				const activeConns = conns.filter((c) => c.isActive).length;
				const disconnected = getDisconnectedProviders(conns);

				const lines = [
					"═══ OmniRoute Status ═══",
					"",
					`  OmniRoute: ${healthy ? "✅ healthy" : "❌ DOWN"} (${OMNI_URL})`,
					"",
					"─── Combos ───",
					"",
					...combos.map((c, i) => "  " + comboLine(c, i)),
					...(combos.length === 0 ? ["  (none — create in dashboard)"] : []),
					"",
					"─── Providers ───",
					"",
					`  ${activeConns}/${conns.length} connections active`,
				];

				if (disconnected.length > 0) {
					lines.push("");
					lines.push("  ⚠️  Needs re-auth:");
					for (const c of disconnected) {
						const psd = c.providerSpecificData || {};
						lines.push(`    ❌ ${psd.nodeName || c.provider}: ${c.name}`);
					}
					lines.push(`    → Open ${DASHBOARD_URL} → Providers`);
				}

				lines.push(
					"",
					"─── Commands ───",
					"",
					"  /omni toggle          Toggle combos on/off",
					"  /omni providers       Browse providers & models",
					"  /omni add-provider    Add OpenAI-compatible provider",
					"  /omni sync            Sync models to Ctrl+P picker",
					"  /omni dashboard       Dashboard URL",
				);

				ctx.ui.notify(lines.join("\n"), "info");
				ctx.ui.setStatus("omni", healthy ? "OmniRoute ✓" : "OmniRoute ✗");
				return;
			}

			// ──────────────── /omni toggle ────────────────

			if (sub === "toggle") {
				const combos = await listCombos();
				if (!combos.length) {
					ctx.ui.notify(`No combos configured.\nCreate combos in the dashboard: ${DASHBOARD_URL}`, "warning");
					return;
				}

				// Determine which model is currently active
				const currentModel = ctx.model;
				const currentModelId = (currentModel as any)?.id ?? "";

				let keepGoing = true;
				while (keepGoing) {
					const current = await listCombos();
					const options = current.map((c) => {
						const on = c.isActive !== false;
						const live = c.name === currentModelId ? " 🔴 LIVE" : "";
						return `${on ? "✅ ON " : "⬜ OFF"} ${c.name} [${c.strategy}, ${c.models.length} models]${live}`;
					});
					options.push("── Done ──");

					const choice = await ctx.ui.select(
						"Select a combo (toggle on/off or set as active model):",
						options
					);
					if (!choice || choice === "── Done ──") {
						keepGoing = false;
						continue;
					}

					const idx = options.indexOf(choice);
					if (idx < 0 || idx >= current.length) continue;

					const combo = current[idx];
					const on = combo.isActive !== false;

					const action = await ctx.ui.select(
						`${combo.name} — what do you want to do?`,
						[
							on ? "⬜ Turn OFF" : "✅ Turn ON",
							"🔴 Set as active model (use for next message)",
							"← Back",
						]
					);

					if (!action || action === "← Back") continue;

					if (action.startsWith("⬜") || action.startsWith("✅")) {
						const newState = !on;
						try {
							await api(`/api/combos/${combo.id}`, {
								method: "PUT",
								body: JSON.stringify({ isActive: newState }),
							});
							ctx.ui.notify(`${combo.name}: ${newState ? "✅ ON" : "⬜ OFF"}`, "info");
						} catch (e: any) {
							ctx.ui.notify(`Failed to toggle ${combo.name}: ${e.message}`, "error");
						}
					} else if (action.startsWith("🔴")) {
						const model = ctx.modelRegistry.find("omni", combo.name);
						if (!model) {
							ctx.ui.notify(
								`"${combo.name}" not found in Ctrl+P model list.\nRun /omni sync first to add all combos.`,
								"warning"
							);
							continue;
						}
						const ok = await pi.setModel(model);
						if (ok) {
							ctx.ui.notify(`🔴 Now using: ${combo.name}`, "info");
							ctx.ui.setStatus("omni", `🔴 ${combo.name}`);
						} else {
							ctx.ui.notify(`Couldn't switch to ${combo.name} — no API key configured for the omni provider.`, "error");
						}
					}
				}

				const final = await listCombos();
				const liveNow = (ctx.model as any)?.id ?? "";
				ctx.ui.notify(
					`Current combos:\n${final.map((c, i) => {
						const live = c.name === liveNow ? " 🔴 LIVE" : "";
						return comboLine(c, i) + live;
					}).join("\n")}`,
					"info"
				);
				return;
			}

			// ──────────────── /omni providers ────────────────

			if (sub === "providers") {
				const [conns, nodes] = await Promise.all([listConnections(), listProviderNodes()]);
				const groups = groupProviders(conns, nodes);

				const providerOptions = groups.map((g) => {
					const activeCount = g.connections.filter((c) => c.isActive).length;
					const totalCount = g.connections.length;
					const prefixStr = g.prefix ? ` (${g.prefix}/)` : "";
					const hasErrors = g.connections.some(
						(c) => c.testStatus === "error" || c.testStatus === "expired"
					);
					const statusEmoji = hasErrors ? "❌" : activeCount === totalCount ? "✅" : activeCount > 0 ? "⚠️" : "⬜";
					return `${statusEmoji} ${g.displayName}${prefixStr}  [${activeCount}/${totalCount} active]`;
				});
				providerOptions.push("── Back ──");

				let browsing = true;
				while (browsing) {
					const choice = await ctx.ui.select("Select a provider to see details:", providerOptions);
					if (!choice || choice === "── Back ──") {
						browsing = false;
						continue;
					}

					const idx = providerOptions.indexOf(choice);
					if (idx < 0 || idx >= groups.length) continue;

					const group = groups[idx];
					const lines = [
						`═══ ${group.displayName} ═══`,
						"",
						"─── Accounts ───",
					];

					for (const c of group.connections) {
						const status =
							c.testStatus === "active" ? "✅" :
							c.testStatus === "unknown" ? "⚪" :
							c.testStatus === "error" || c.testStatus === "expired" ? "❌" : "⚠️";
						lines.push(`  ${status} ${c.name} [${c.authType}] ${c.isActive ? "active" : "disabled"}`);
						if (c.lastError) {
							lines.push(`     └─ ${c.lastError}`);
							if (c.authType === "oauth" || c.errorCode === "refresh_failed") {
								lines.push(`     └─ Re-authenticate at ${DASHBOARD_URL} → Providers`);
							}
						}
					}

					const activeConn = group.connections.find((c) => c.isActive);
					if (activeConn) {
						lines.push("");
						lines.push("─── Models ───");
						const models = await getProviderModels(activeConn.id);
						if (models.length > 0) {
							const prefix = group.prefix || group.displayName.toLowerCase();
							lines.push(`  ${models.length} models (use as ${prefix}/<name>)`);
							lines.push("");
							const maxShow = 30;
							for (let i = 0; i < Math.min(models.length, maxShow); i++) {
								lines.push(`  • ${prefix}/${models[i]}`);
							}
							if (models.length > maxShow) {
								lines.push(`  ... and ${models.length - maxShow} more`);
							}
						} else {
							lines.push("  (models listed via /v1/models — run /omni sync to add to Ctrl+P)");
						}
					}

					if (group.nodeId) {
						const node = nodes.find((n) => n.id === group.nodeId);
						if (node) {
							lines.push("");
							lines.push("─── Node Config ───");
							lines.push(`  Base URL: ${node.baseUrl}`);
							lines.push(`  Prefix:   ${node.prefix}/`);
							lines.push(`  Type:     ${node.type}`);
						}
					}

					lines.push("");
					lines.push(`Full management: ${DASHBOARD_URL} → Providers`);
					ctx.ui.notify(lines.join("\n"), "info");
				}
				return;
			}

			// ──────────────── /omni add-provider ────────────────

			if (sub === "add-provider") {
				ctx.ui.notify(
					"This adds an OpenAI-compatible provider that isn't built into OmniRoute.\n" +
					"For built-in providers (Gemini, Groq, etc.), use the dashboard instead.",
					"info"
				);

				const name = await ctx.ui.input("Provider name", "e.g. OpenAdapter, Together, Fireworks");
				if (!name) return;

				const prefix = await ctx.ui.input(
					"Short prefix (used as prefix/model-name)",
					"e.g. oa, tog, fw"
				);
				if (!prefix) return;

				const baseUrl = await ctx.ui.input(
					"Base URL (OpenAI-compatible /v1 endpoint)",
					"e.g. https://api.openadapter.in/v1"
				);
				if (!baseUrl) return;

				const apiKey = await ctx.ui.input("API key", "sk-...");
				if (!apiKey) return;

				try {
					const nodeRes = await api("/api/provider-nodes", {
						method: "POST",
						body: JSON.stringify({
							name,
							prefix,
							apiType: "chat",
							baseUrl,
							type: "openai-compatible",
						}),
					});
					const nodeId = nodeRes?.node?.id;
					if (!nodeId) throw new Error("No node ID returned");

					await api("/api/providers", {
						method: "POST",
						body: JSON.stringify({
							provider: nodeId,
							apiKey,
							name: `${name} API Key`,
						}),
					});

					ctx.ui.notify(
						`✅ Added: ${name} (${prefix}/)\nModels available as ${prefix}/<model-name>\n\nRun /omni sync to add models to Ctrl+P`,
						"info"
					);
				} catch (e: any) {
					ctx.ui.notify(`Failed: ${e.message}`, "error");
				}
				return;
			}

			// ──────────────── /omni sync ────────────────

			if (sub === "sync") {
				ctx.ui.notify("Syncing models from OmniRoute to Ctrl+P picker...", "info");

				try {
					const allModels = await getAllModelsFromOmniRoute();
					const fs = require("fs");
					const path = modelsJsonPath();
					const config = JSON.parse(fs.readFileSync(path, "utf8"));

					if (!config.providers?.omni) {
						ctx.ui.notify(
							"No 'omni' provider found in models.json.\n" +
							"Add one first — see the extension header docs for the format.",
							"error"
						);
						return;
					}

					const oldCount = config.providers.omni.models?.length || 0;
					config.providers.omni.models = allModels;
					fs.writeFileSync(path, JSON.stringify(config, null, 2));

					ctx.ui.notify(
						`✅ Synced ${allModels.length} models to Ctrl+P (was ${oldCount})\n\nRestart pi or start a new session to pick up changes.`,
						"info"
					);
				} catch (e: any) {
					ctx.ui.notify(`Sync failed: ${e.message}`, "error");
				}
				return;
			}

			// ──────────────── /omni dashboard ────────────────

			if (sub === "dashboard" || sub === "dash") {
				ctx.ui.notify(
					[
						`OmniRoute Dashboard: ${DASHBOARD_URL}`,
						"",
						"Open in your browser for:",
						"  • Create/edit combos with model reordering",
						"  • Provider OAuth re-authentication",
						"  • Add built-in provider accounts",
						"  • Model analytics & request metrics",
						"  • Request logs & debugging",
					].join("\n"),
					"info"
				);
				return;
			}

			// ──────────────── Unknown ────────────────

			ctx.ui.notify(
				`Unknown: /omni ${sub}\n\nAvailable: toggle, providers, add-provider, sync, dashboard`,
				"warning"
			);
		},
	});
}
