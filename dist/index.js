#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const API_BASE = "https://www.agentaudit.dev/api";
async function apiFetch(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
        headers: { "Accept": "application/json" },
        redirect: "follow",
        signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
        const text = await res.text();
        // Check if we got HTML (404 page) instead of JSON
        if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
            return null;
        }
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const text = await res.text();
    if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
        return null;
    }
    return JSON.parse(text);
}
async function fetchSkill(name) {
    try {
        const data = await apiFetch(`${API_BASE}/skills/${encodeURIComponent(name)}`);
        if (!data) {
            return { slug: name, display_name: name, trust_score: null, latest_risk_score: null, latest_result: "unknown", total_findings: 0, total_reports: 0, scan_type: "unknown", source_url: null, first_audited_at: null, last_audited_at: null, error: "Package not found in AgentAudit database" };
        }
        return {
            slug: data.slug ?? name,
            display_name: data.display_name ?? name,
            trust_score: data.trust_score ?? null,
            latest_risk_score: data.latest_risk_score ?? null,
            latest_result: data.latest_result ?? "unknown",
            total_findings: data.total_findings ?? 0,
            total_reports: data.total_reports ?? 0,
            scan_type: data.scan_type ?? "unknown",
            source_url: data.source_url ?? null,
            first_audited_at: data.first_audited_at ?? null,
            last_audited_at: data.last_audited_at ?? null,
        };
    }
    catch (e) {
        return { slug: name, display_name: name, trust_score: null, latest_risk_score: null, latest_result: "error", total_findings: 0, total_reports: 0, scan_type: "unknown", source_url: null, first_audited_at: null, last_audited_at: null, error: e.message };
    }
}
function riskEmoji(score) {
    if (score === null)
        return "❓";
    if (score >= 70)
        return "🔴";
    if (score >= 40)
        return "🟡";
    return "🟢";
}
function formatResult(r) {
    const lines = [`${riskEmoji(r.latest_risk_score)} **${r.display_name}** (${r.scan_type})`];
    if (r.error) {
        lines.push(`  ⚠️ ${r.error}`);
    }
    else {
        lines.push(`  Trust Score: ${r.trust_score ?? "N/A"}/100`);
        lines.push(`  Risk Score: ${r.latest_risk_score ?? "N/A"}/100`);
        lines.push(`  Verdict: ${r.latest_result.toUpperCase()}`);
        lines.push(`  Findings: ${r.total_findings} (from ${r.total_reports} audit${r.total_reports !== 1 ? "s" : ""})`);
        if (r.source_url)
            lines.push(`  Source: ${r.source_url}`);
        if (r.last_audited_at)
            lines.push(`  Last audited: ${new Date(r.last_audited_at).toISOString().split("T")[0]}`);
        lines.push(`  Details: https://agentaudit.dev/packages/${r.slug}`);
    }
    return lines.join("\n");
}
// Default MCP config paths per platform
function getDefaultConfigPath() {
    const platform = process.platform;
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (platform === "darwin") {
        return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    }
    if (platform === "win32") {
        return path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json");
    }
    return path.join(home, ".config", "claude", "claude_desktop_config.json");
}
function extractPackagesFromConfig(configPath) {
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    const servers = config.mcpServers ?? config.mcp_servers ?? {};
    const packages = [];
    for (const [key, val] of Object.entries(servers)) {
        const args = val.args ?? [];
        for (const arg of args) {
            if (!arg.startsWith("-") && !arg.startsWith("/") && !arg.startsWith(".") && /^[a-z@]/.test(arg)) {
                if (arg !== "-y" && arg !== "node" && arg !== "npx") {
                    packages.push(arg);
                }
            }
        }
        packages.push(key);
    }
    return [...new Set(packages)];
}
const server = new mcp_js_1.McpServer({
    name: "agentaudit",
    version: "1.1.0",
});
server.tool("check_package", "Check a package's trust score, risk score, and audit verdict on AgentAudit. Works for npm packages, pip packages, MCP servers, and AI agent skills.", { name: zod_1.z.string().describe("Package or skill name (e.g. crewai, mcp-server-fetch, @openai/agents)") }, async ({ name }) => {
    const result = await fetchSkill(name);
    return { content: [{ type: "text", text: formatResult(result) }] };
});
server.tool("scan_config", "Scan your MCP config file (claude_desktop_config.json) and check all referenced servers/packages against AgentAudit", { path: zod_1.z.string().optional().describe("Path to claude_desktop_config.json (auto-detected if omitted)") }, async ({ path: configPath }) => {
    const resolved = configPath ?? getDefaultConfigPath();
    if (!fs.existsSync(resolved)) {
        return { content: [{ type: "text", text: `❌ Config not found: ${resolved}\n\nTry providing the path explicitly.` }] };
    }
    let packages;
    try {
        packages = extractPackagesFromConfig(resolved);
    }
    catch (e) {
        return { content: [{ type: "text", text: `❌ Failed to parse config: ${e.message}` }] };
    }
    if (packages.length === 0) {
        return { content: [{ type: "text", text: "No packages found in config." }] };
    }
    const results = await Promise.all(packages.map(fetchSkill));
    const risky = results.filter(r => !r.error && (r.latest_risk_score ?? 0) >= 40);
    const summary = [
        `🔍 Scanned ${resolved}`,
        `📦 ${results.length} packages checked | ${risky.length} with elevated risk\n`,
    ];
    // Sort by risk score descending
    results.sort((a, b) => (b.latest_risk_score ?? -1) - (a.latest_risk_score ?? -1));
    const output = [...summary, ...results.map(formatResult)];
    return { content: [{ type: "text", text: output.join("\n\n") }] };
});
server.tool("search_packages", "Search the AgentAudit database for packages by name. Returns matching packages with their trust/risk scores.", { query: zod_1.z.string().describe("Search term (partial name match)"), limit: zod_1.z.number().optional().describe("Max results (default 10)") }, async ({ query, limit }) => {
    try {
        const all = await apiFetch(`${API_BASE}/skills`);
        if (!all || !Array.isArray(all)) {
            return { content: [{ type: "text", text: "❌ Failed to fetch package list" }] };
        }
        const q = query.toLowerCase();
        const matches = all.filter((s) => (s.slug ?? "").toLowerCase().includes(q) ||
            (s.display_name ?? "").toLowerCase().includes(q)).slice(0, limit ?? 10);
        if (matches.length === 0) {
            return { content: [{ type: "text", text: `No packages matching "${query}" found in AgentAudit database (${all.length} total packages).` }] };
        }
        const lines = [`🔎 ${matches.length} results for "${query}" (${all.length} total in database)\n`];
        for (const m of matches) {
            lines.push(`${riskEmoji(m.latest_risk_score)} **${m.display_name ?? m.slug}** — Trust: ${m.trust_score ?? "?"}/100, Risk: ${m.latest_risk_score ?? "?"}/100, Verdict: ${(m.latest_result ?? "?").toUpperCase()}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `❌ Search failed: ${e.message}` }] };
    }
});
server.tool("get_stats", "Get AgentAudit database statistics: total packages, findings, health status", {}, async () => {
    try {
        const health = await apiFetch(`${API_BASE}/health`);
        if (!health) {
            return { content: [{ type: "text", text: "❌ AgentAudit API unreachable" }] };
        }
        const lines = [
            "📊 **AgentAudit Stats**",
            `  Status: ${health.status}`,
            `  Total Findings: ${health.db?.findings ?? "?"}`,
            `  Total Packages: ${health.db?.skills ?? "?"}`,
            `  Registered Agents: ${health.db?.agents ?? "?"}`,
            `  Website: https://agentaudit.dev`,
            `  API: https://agentaudit.dev/api/health`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `❌ ${e.message}` }] };
    }
});
server.tool("register", "Register a new agent with AgentAudit to get an API key. Free, instant. Required before submitting reports.", {
    agent_name: zod_1.z.string().describe("Unique name for your agent (e.g. 'my-security-bot')"),
}, async ({ agent_name }) => {
    try {
        const res = await fetch(`${API_BASE}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent_name }),
        });
        const data = await res.json();
        if (!res.ok) {
            return { content: [{ type: "text", text: `❌ Registration failed: ${data.error || res.statusText}` }] };
        }
        const lines = [
            `✅ **Registered: ${data.agent_name}**`,
            `  API Key: \`${data.api_key}\``,
            `  ${data.existing ? "(Already registered — returning existing key)" : "New account created"}`,
            ``,
            `  Save this key! Use it in the submit_report tool or as:`,
            `  Authorization: Bearer ${data.api_key}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `❌ ${e.message}` }] };
    }
});
server.tool("submit_report", "Submit a security audit report to AgentAudit. Requires an API key (get one via the register tool).", {
    api_key: zod_1.z.string().describe("Your AgentAudit API key (from register tool)"),
    package_name: zod_1.z.string().describe("Package/skill slug (e.g. 'phonemizer-fork')"),
    package_type: zod_1.z.enum(["pip", "npm", "skill", "mcp", "other"]).optional().describe("Package type"),
    source_url: zod_1.z.string().optional().describe("Source repository URL"),
    risk_score: zod_1.z.number().min(0).max(100).describe("Risk score 0-100 (0=safe, 100=dangerous)"),
    result: zod_1.z.enum(["pass", "warn", "fail", "error"]).describe("Overall result"),
    max_severity: zod_1.z.enum(["critical", "high", "medium", "low", "info"]).optional().describe("Highest severity found"),
    findings: zod_1.z.array(zod_1.z.object({
        title: zod_1.z.string().describe("Finding title"),
        severity: zod_1.z.enum(["critical", "high", "medium", "low", "info"]).describe("Severity"),
        description: zod_1.z.string().describe("What was found"),
        file_path: zod_1.z.string().optional().describe("Affected file"),
        pattern_id: zod_1.z.string().optional().describe("Pattern identifier"),
        remediation: zod_1.z.string().optional().describe("How to fix"),
    })).optional().describe("List of findings"),
}, async ({ api_key, package_name, package_type, source_url, risk_score, result, max_severity, findings }) => {
    try {
        const body = {
            package_name,
            risk_score,
            result,
            findings_count: findings?.length ?? 0,
        };
        if (package_type)
            body.package_type = package_type;
        if (source_url)
            body.source_url = source_url;
        if (max_severity)
            body.max_severity = max_severity;
        if (findings)
            body.findings = findings;
        const res = await fetch(`${API_BASE}/reports`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${api_key}`,
            },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            return { content: [{ type: "text", text: `❌ Submit failed: ${JSON.stringify(data)}` }] };
        }
        const lines = [
            `✅ **Report submitted for ${package_name}**`,
            `  Report ID: ${data.report_id}`,
            `  Findings created: ${data.findings_created?.length ?? 0}`,
            `  Deduplicated: ${data.findings_deduplicated?.length ?? 0}`,
            `  View: https://agentaudit.dev/packages/${package_name}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `❌ ${e.message}` }] };
    }
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch(console.error);
