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
	id: string;
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
	let lastSeenLogId = ""; // ID of the most recent call log entry we've already displayed

	// ── Show resolved model in status bar after each response ──

	pi.on("message_end", async (event, ctx) => {
		try {
			const msg = event.message as any;
			if (msg?.role !== "assistant") return;

			// Poll until we see a NEW call log entry (one we haven't shown yet).
			// This avoids any timestamp comparison issues — we simply wait for
			// the log ID to change. Max ~4.5 seconds (15 × 300 ms).
			let log: CallLog | null = null;

			for (let attempt = 0; attempt < 15; attempt++) {
				await new Promise((r) => setTimeout(r, 300));
				const candidate = await getLastCallLog();
				if (!candidate) break;
				if (candidate.id !== lastSeenLogId) {
					log = candidate;
					break;
				}
			}

			if (log) {
				lastSeenLogId = log.id;
				const combo = log.comboName ? `${log.comboName} → ` : "";
				const acct = log.account ? ` · ${log.account}` : "";
				const ok = log.status === 200;
				const suffix = ok ? "" : ` ✗${log.status}`;
				ctx.ui.setStatus("omni", `${combo}${log.model} (${log.provider}${acct})${suffix}`);
			}
		} catch {}
	});

	// ── Show predicted routing when model selection changes ──

	pi.on("model_select", async (event, ctx) => {
		try {
			const modelId = (event.model as any)?.id ?? "";
			if (!modelId) return;

			// Check if the selected model is a combo
			const combos = await listCombos();
			const combo = combos.find((c) => c.name === modelId);

			if (!combo) {
				// Plain model, just show it
				ctx.ui.setStatus("omni", `→ ${modelId}`);
				return;
			}

			// For combos, show the ordered model list so user knows what to expect
			const models = combo.models.map((m) =>
				typeof m === "string" ? m : m.model
			);
			const preview = models.slice(0, 3).join(" › ");
			const more = models.length > 3 ? ` +${models.length - 3}` : "";
			ctx.ui.setStatus("omni", `${combo.name} [${combo.strategy}]: ${preview}${more}`);
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
		description: "OmniRoute: /omni [toggle|providers|add-provider|sync|log-review|dashboard]",
		getArgumentCompletions(prefix: string) {
			return ["toggle", "providers", "add-provider", "sync", "log-review", "dashboard"]
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
					"  /omni toggle          Toggle combos on/off · set active model",
					"  /omni providers       Browse providers & models",
					"  /omni add-provider    Add OpenAI-compatible provider",
					"  /omni sync            Sync models to Ctrl+P picker",
					"  /omni log-review      Analyse call logs · remove broken models",
					"  /omni dashboard       Dashboard URL",
				);

				ctx.ui.notify(lines.join("\n"), "info");
				ctx.ui.setStatus("omni", healthy ? "OmniRoute ✓" : "OmniRoute ✗");
				return;
			}

			// ──────────────── /omni toggle ────────────────

			if (sub === "toggle") {
				const initial = await listCombos();
				if (!initial.length) {
					ctx.ui.notify(`No combos configured.\nCreate combos in the dashboard: ${DASHBOARD_URL}`, "warning");
					return;
				}

				// ANSI helpers (no external imports needed)
				const B  = "\x1b[1m";   // bold
				const DIM = "\x1b[2m";  // dim
				const RST = "\x1b[0m";  // reset
				const GRN = "\x1b[32m"; // green
				const YEL = "\x1b[33m"; // yellow
				const RED = "\x1b[31m"; // red
				const GRY = "\x1b[90m"; // dark grey

				await ctx.ui.custom((tui: any, _theme: any, _kb: any, done: (r: null) => void) => {
					let combos: Combo[] = initial.slice();
					let sel = 0;
					let statusLine = `${GRY}Space toggle · Enter set active · Esc done${RST}`;
					let busy = false;

					const refresh = () => {
						listCombos().then((c) => {
							combos = c;
							tui.requestRender(true);
						}).catch(() => {
							tui.requestRender(true);
						});
					};

					return {
						invalidate() {},

						render(width: number): string[] {
							const liveId = ctx.model?.id ?? "";
							const total = combos.length + 1; // +1 for Done row
							const lines: string[] = [];

							lines.push(statusLine);
							lines.push("");

							combos.forEach((c, i) => {
								const on   = c.isActive !== false;
								const live = c.name === liveId;
								const cur  = i === sel;

								const bullet = on ? `${GRN}✅${RST}` : `${GRY}⬜${RST}`;
								const liveTag = live ? ` ${RED}🔴${RST}` : "";
								const meta = `${GRY}[${c.strategy} · ${c.models.length}]${RST}`;
								const label = `${bullet} ${cur ? B : ""}${c.name}${RST} ${meta}${liveTag}`;

								lines.push(cur ? `  ${YEL}▶${RST} ${label}` : `    ${label}`);
							});

							// Done row
							const doneCur = sel === combos.length;
							lines.push(doneCur ? `  ${YEL}▶${RST} ${DIM}── Done ──${RST}` : `    ${DIM}── Done ──${RST}`);

							lines.push("");
							if (busy) lines.push(`  ${DIM}working…${RST}`);

							return lines;
						},

						handleInput(data: string) {
							if (busy) return;

							const total = combos.length + 1; // +1 for Done row

							// Navigation
							if (data === "\x1b[A" || data === "\x1b[OA") { // up
								sel = (sel - 1 + total) % total;
								tui.requestRender(true);
								return;
							}
							if (data === "\x1b[B" || data === "\x1b[OB") { // down
								sel = (sel + 1) % total;
								tui.requestRender(true);
								return;
							}

							// Escape / q → close
							if (data === "\x1b" || data === "q") {
								done(null);
								return;
							}

							// Done row selected
							if (sel === combos.length) {
								if (data === "\r" || data === "\n" || data === " ") done(null);
								return;
							}

							const combo = combos[sel];
							if (!combo) return;

							// Space → toggle ON/OFF
							if (data === " ") {
								busy = true;
								tui.requestRender(true);
								const newState = combo.isActive === false;
								api(`/api/combos/${combo.id}`, {
									method: "PUT",
									body: JSON.stringify({ isActive: newState }),
								}).then(() => {
									statusLine = `${newState ? GRN + "✅" : GRY + "⬜"}${RST} ${combo.name} ${newState ? "ON" : "OFF"}  ${GRY}· Space toggle · Enter set active · Esc done${RST}`;
									busy = false;
									refresh();
								}).catch((e: any) => {
									statusLine = `${RED}Error:${RST} ${e.message}`;
									busy = false;
									tui.requestRender(true);
								});
								return;
							}

							// Enter → set as active model
							if (data === "\r" || data === "\n") {
								const model = ctx.modelRegistry.getAll().find((m) => m.id === combo.name);
								if (!model) {
									statusLine = `${YEL}⚠${RST} "${combo.name}" not in model list — run /omni sync first`;
									tui.requestRender(true);
									return;
								}
								busy = true;
								tui.requestRender(true);
								(pi.setModel(model) as Promise<boolean>).then((ok) => {
									if (ok) {
										statusLine = `${RED}🔴${RST} Active model → ${B}${combo.name}${RST}  ${GRY}· Space toggle · Enter set active · Esc done${RST}`;
										ctx.ui.setStatus("omni", `🔴 ${combo.name}`);
									} else {
										statusLine = `${RED}Error:${RST} no API key for omni provider`;
									}
									busy = false;
									tui.requestRender(true);
								});
								return;
							}
						},
					};
				});

				// Summary notification after closing
				const final = await listCombos();
				const liveNow = ctx.model?.id ?? "";
				ctx.ui.notify(
					`Combos:\n${final.map((c, i) => comboLine(c, i) + (c.name === liveNow ? " 🔴 active" : "")).join("\n")}`,
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

					// Reload registry immediately — no restart needed
					ctx.modelRegistry.refresh();

					ctx.ui.notify(
						`✅ Synced ${allModels.length} models to Ctrl+P (was ${oldCount})`,
						"info"
					);
				} catch (e: any) {
					ctx.ui.notify(`Sync failed: ${e.message}`, "error");
				}
				return;
			}

			// ──────────────── /omni log-review ────────────────

			if (sub === "log-review" || sub === "logreview") {
				ctx.ui.notify("Fetching call logs…", "info");

				try {
					const [combos, rawLogs] = await Promise.all([
						listCombos(),
						api("/api/usage/call-logs?limit=200"),
					]);

					// Filter to inference calls only
					const logs: any[] = (rawLogs as any[]).filter(
						(l: any) => l.path === "/v1/messages"
					);

					if (!logs.length) {
						ctx.ui.notify("No call log history yet.", "info");
						return;
					}

					// Build per-model stats keyed by "provider/model" as OmniRoute logs them
					interface ModelStats {
						attempts: number;
						successes: number;
						onlyContextErrors: boolean; // all failures are 413 (too large)
						errors: Record<string, number>;
						totalDuration: number;
						errorMessages: string[];
					}
					const stats = new Map<string, ModelStats>();

					for (const log of logs) {
						const key = `${log.provider}/${log.model}`;
						if (!stats.has(key)) {
							stats.set(key, {
								attempts: 0, successes: 0, onlyContextErrors: true,
								errors: {}, totalDuration: 0, errorMessages: [],
							});
						}
						const s = stats.get(key)!;
						s.attempts++;
						s.totalDuration += log.duration ?? 0;
						if (log.status === 200) {
							s.successes++;
							s.onlyContextErrors = false;
						} else {
							const code = String(log.status);
							s.errors[code] = (s.errors[code] ?? 0) + 1;
							const errMsg: string = log.error ?? "";
							// 413 = context too large — model works, session is just too big
							if (log.status !== 413) s.onlyContextErrors = false;
							if (errMsg && !s.errorMessages.find((m) => m === errMsg.slice(0, 80))) {
								s.errorMessages.push(errMsg.slice(0, 80));
							}
						}
					}

					// Match a combo model ID (prefix/model) to a call log stats key.
					// OmniRoute logs use the full provider name (e.g. "kiro"), combos use
					// short prefixes (e.g. "kr"). Match by the model name portion instead.
					const findStats = (modelId: string): ModelStats | undefined => {
						const modelName = modelId.split("/").slice(1).join("/");
						// First try exact prefix match
						for (const [key, s] of stats) {
							const logModelName = key.split("/").slice(1).join("/");
							if (logModelName === modelName) return s;
						}
						// Fallback: partial suffix match (handles nested paths)
						for (const [key, s] of stats) {
							if (key.endsWith(`/${modelName}`) || key === modelName) return s;
						}
						return undefined;
					};

					// Build report per combo
					const lines: string[] = ["═══ OmniRoute Log Review ═══", `(last ${logs.length} inference calls)`, ""];
					const removals: Array<{ comboId: string; comboName: string; modelId: string }> = [];

					for (const combo of combos) {
						lines.push(`─── ${combo.name} [${combo.strategy}] ───`);
						const comboModels = combo.models.map((m) =>
							typeof m === "string" ? m : m.model
						);

						for (const modelId of comboModels) {
							const s = findStats(modelId);

							if (!s) {
								lines.push(`  ❓ ${modelId}  (no history)`);
								continue;
							}

							const rate = Math.round((s.successes / s.attempts) * 100);
							const avgMs = Math.round(s.totalDuration / s.attempts);
							const errSummary = Object.entries(s.errors)
								.map(([code, n]) => `${code}×${n}`)
								.join(", ");

							if (s.successes === 0 && s.onlyContextErrors) {
								// All failures are 413 — model works, context was too large
								lines.push(`  ⚠️  ${modelId}`);
								lines.push(`     context too large for free tier (${s.attempts}× 413) — works in shorter sessions`);
							} else if (s.successes === 0) {
								// Genuinely broken
								lines.push(`  ❌ ${modelId}`);
								lines.push(`     0/${s.attempts} success · ${errSummary}`);
								if (s.errorMessages[0]) lines.push(`     "${s.errorMessages[0]}"`);
								lines.push(`     → suggest remove`);
								removals.push({ comboId: combo.id, comboName: combo.name, modelId });
							} else if (rate < 60) {
								lines.push(`  ⚠️  ${modelId}`);
								lines.push(`     ${s.successes}/${s.attempts} success (${rate}%) · avg ${avgMs}ms · ${errSummary}`);
							} else if (avgMs > 30000) {
								lines.push(`  ⏱  ${modelId}`);
								lines.push(`     ${rate}% success · avg ${Math.round(avgMs / 1000)}s (slow)`);
							} else {
								lines.push(`  ✅ ${modelId}`);
								lines.push(`     ${rate}% success · avg ${avgMs}ms`);
							}
						}

						lines.push("");
					}

					ctx.ui.notify(lines.join("\n"), "info");

					if (removals.length === 0) return;

					// Fetch all available models from OmniRoute once for replacement suggestions
					let availableModels: string[] = [];
					try {
						const data = await api("/v1/models");
						availableModels = (data?.data ?? []).map((m: any) =>
							typeof m === "string" ? m : m.id
						).filter(Boolean);
					} catch {}

					// For each broken model, ask: remove or replace?
					// Track pending edits: comboId → { remove: Set, add: string[] }
					const edits = new Map<string, { id: string; name: string; remove: Set<string>; add: string[] }>();

					for (const r of removals) {
						// Models already in this combo (to avoid suggesting duplicates)
						const currentCombo = combos.find((c) => c.id === r.comboId);
						const alreadyIn = new Set(
							(currentCombo?.models ?? []).map((m) =>
								typeof m === "string" ? m : m.model
							)
						);

						// Suggest models from the same provider prefix
						const brokenPrefix = r.modelId.split("/")[0];
						const suggestions = availableModels.filter(
							(m) => m.startsWith(`${brokenPrefix}/`) && !alreadyIn.has(m) && m !== r.modelId
						).slice(0, 8);

						// Also offer models from other providers as alternatives
						const otherSuggestions = availableModels.filter(
							(m) => !m.startsWith(`${brokenPrefix}/`) && !alreadyIn.has(m)
						).slice(0, 6);

						const options = [
							`❌ Remove (no replacement)`,
							...(suggestions.length ? ["── Same provider ──", ...suggestions.map((m) => `→ ${m}`)] : []),
							...(otherSuggestions.length ? ["── Other providers ──", ...otherSuggestions.map((m) => `→ ${m}`)] : []),
							"⏭ Skip (keep as-is)",
						];

						const choice = await ctx.ui.select(
							`[${r.comboName}] ${r.modelId} — remove or replace?`,
							options
						);

						if (!choice || choice === "⏭ Skip (keep as-is)" || choice.startsWith("──")) continue;

						if (!edits.has(r.comboId)) {
							edits.set(r.comboId, { id: r.comboId, name: r.comboName, remove: new Set(), add: [] });
						}
						const edit = edits.get(r.comboId)!;
						edit.remove.add(r.modelId);

						if (choice.startsWith("→ ")) {
							edit.add.push(choice.slice(2));
						}
						// "Remove" → remove only, no add
					}

					if (edits.size === 0) return;

					// Apply all edits
					const allCombos = await listCombos();
					const results: string[] = [];

					for (const { id, name, remove, add } of edits.values()) {
						const combo = allCombos.find((c) => c.id === id);
						if (!combo) continue;

						const kept = combo.models
							.map((m) => (typeof m === "string" ? m : m.model))
							.filter((m) => !remove.has(m));
						const updated = [...kept, ...add];

						try {
							await api(`/api/combos/${id}`, {
								method: "PUT",
								body: JSON.stringify({ models: updated }),
							});
							const removedList = [...remove].join(", ");
							const addedList = add.length ? ` · added ${add.join(", ")}` : "";
							results.push(`✅ ${name}: removed ${removedList}${addedList}`);
						} catch (e: any) {
							results.push(`❌ ${name}: ${e.message}`);
						}
					}

					ctx.ui.notify(results.join("\n"), "info");
				} catch (e: any) {
					ctx.ui.notify(`Log review failed: ${e.message}`, "error");
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
				`Unknown: /omni ${sub}\n\nAvailable: toggle, providers, add-provider, sync, log-review, dashboard`,
				"warning"
			);
		},
	});
}
