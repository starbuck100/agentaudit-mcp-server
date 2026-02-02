#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

const API_BASE = "https://www.agentaudit.dev/api";

interface SkillResult {
  slug: string;
  display_name: string;
  trust_score: number | null;
  latest_risk_score: number | null;
  latest_result: string;
  total_findings: number;
  total_reports: number;
  scan_type: string;
  source_url: string | null;
  first_audited_at: string | null;
  last_audited_at: string | null;
  error?: string;
}

async function apiFetch(url: string): Promise<any> {
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

async function fetchSkill(name: string): Promise<SkillResult> {
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
  } catch (e: any) {
    return { slug: name, display_name: name, trust_score: null, latest_risk_score: null, latest_result: "error", total_findings: 0, total_reports: 0, scan_type: "unknown", source_url: null, first_audited_at: null, last_audited_at: null, error: e.message };
  }
}

function riskEmoji(score: number | null): string {
  if (score === null) return "❓";
  if (score >= 70) return "🔴";
  if (score >= 40) return "🟡";
  return "🟢";
}

function formatResult(r: SkillResult): string {
  const lines: string[] = [`${riskEmoji(r.latest_risk_score)} **${r.display_name}** (${r.scan_type})`];
  if (r.error) {
    lines.push(`  ⚠️ ${r.error}`);
  } else {
    lines.push(`  Trust Score: ${r.trust_score ?? "N/A"}/100`);
    lines.push(`  Risk Score: ${r.latest_risk_score ?? "N/A"}/100`);
    lines.push(`  Verdict: ${r.latest_result.toUpperCase()}`);
    lines.push(`  Findings: ${r.total_findings} (from ${r.total_reports} audit${r.total_reports !== 1 ? "s" : ""})`);
    if (r.source_url) lines.push(`  Source: ${r.source_url}`);
    if (r.last_audited_at) lines.push(`  Last audited: ${new Date(r.last_audited_at).toISOString().split("T")[0]}`);
    lines.push(`  Details: https://agentaudit.dev/packages/${r.slug}`);
  }
  return lines.join("\n");
}

// Default MCP config paths per platform
function getDefaultConfigPath(): string {
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

function extractPackagesFromConfig(configPath: string): string[] {
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw);
  const servers = config.mcpServers ?? config.mcp_servers ?? {};
  const packages: string[] = [];
  for (const [key, val] of Object.entries(servers) as [string, any][]) {
    const args: string[] = val.args ?? [];
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

const server = new McpServer({
  name: "agentaudit",
  version: "1.1.0",
});

server.tool(
  "check_package",
  "Check a package's trust score, risk score, and audit verdict on AgentAudit. Works for npm packages, pip packages, MCP servers, and AI agent skills.",
  { name: z.string().describe("Package or skill name (e.g. crewai, mcp-server-fetch, @openai/agents)") },
  async ({ name }) => {
    const result = await fetchSkill(name);
    return { content: [{ type: "text" as const, text: formatResult(result) }] };
  }
);

server.tool(
  "scan_config",
  "Scan your MCP config file (claude_desktop_config.json) and check all referenced servers/packages against AgentAudit",
  { path: z.string().optional().describe("Path to claude_desktop_config.json (auto-detected if omitted)") },
  async ({ path: configPath }) => {
    const resolved = configPath ?? getDefaultConfigPath();
    if (!fs.existsSync(resolved)) {
      return { content: [{ type: "text" as const, text: `❌ Config not found: ${resolved}\n\nTry providing the path explicitly.` }] };
    }
    let packages: string[];
    try {
      packages = extractPackagesFromConfig(resolved);
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `❌ Failed to parse config: ${e.message}` }] };
    }
    if (packages.length === 0) {
      return { content: [{ type: "text" as const, text: "No packages found in config." }] };
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
    return { content: [{ type: "text" as const, text: output.join("\n\n") }] };
  }
);

server.tool(
  "search_packages",
  "Search the AgentAudit database for packages by name. Returns matching packages with their trust/risk scores.",
  { query: z.string().describe("Search term (partial name match)"), limit: z.number().optional().describe("Max results (default 10)") },
  async ({ query, limit }) => {
    try {
      const all = await apiFetch(`${API_BASE}/skills`);
      if (!all || !Array.isArray(all)) {
        return { content: [{ type: "text" as const, text: "❌ Failed to fetch package list" }] };
      }
      const q = query.toLowerCase();
      const matches = all.filter((s: any) =>
        (s.slug ?? "").toLowerCase().includes(q) ||
        (s.display_name ?? "").toLowerCase().includes(q)
      ).slice(0, limit ?? 10);

      if (matches.length === 0) {
        return { content: [{ type: "text" as const, text: `No packages matching "${query}" found in AgentAudit database (${all.length} total packages).` }] };
      }
      const lines = [`🔎 ${matches.length} results for "${query}" (${all.length} total in database)\n`];
      for (const m of matches) {
        lines.push(`${riskEmoji(m.latest_risk_score)} **${m.display_name ?? m.slug}** — Trust: ${m.trust_score ?? "?"}/100, Risk: ${m.latest_risk_score ?? "?"}/100, Verdict: ${(m.latest_result ?? "?").toUpperCase()}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `❌ Search failed: ${e.message}` }] };
    }
  }
);

server.tool(
  "get_stats",
  "Get AgentAudit database statistics: total packages, findings, health status",
  {},
  async () => {
    try {
      const health = await apiFetch(`${API_BASE}/health`);
      if (!health) {
        return { content: [{ type: "text" as const, text: "❌ AgentAudit API unreachable" }] };
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
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `❌ ${e.message}` }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
