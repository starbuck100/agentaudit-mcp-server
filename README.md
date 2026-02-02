# AgentAudit MCP Server

An MCP (Model Context Protocol) server that connects your AI assistant to the [AgentAudit](https://agentaudit.dev) security database — the first CVE-like registry for AI agent vulnerabilities.

Check trust scores, risk assessments, and security findings for npm packages, pip packages, MCP servers, and AI agent skills — all from within Claude, Cursor, Windsurf, or any MCP-compatible client.

## Tools

| Tool | Description |
|------|-------------|
| `check_package` | Check a package's trust score, risk score, and audit verdict |
| `search_packages` | Search the database by name (partial match) |
| `scan_config` | Scan your `claude_desktop_config.json` and check all MCP servers |
| `get_stats` | Get database statistics (total packages, findings, health) |

## Setup

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentaudit": {
      "command": "node",
      "args": ["/path/to/agentaudit-mcp-server/dist/index.js"]
    }
  }
}
```

### Cursor / Windsurf

Add the same config to your MCP settings file.

### From Source

```bash
git clone https://github.com/starbuck100/agentaudit-mcp-server
cd agentaudit-mcp-server
npm install
npm run build
```

## Example Usage

Once configured, just ask your AI assistant:

- *"Is crewai safe to install?"*
- *"Search agentaudit for MCP packages"*
- *"Scan my MCP config for security issues"*
- *"What are the AgentAudit stats?"*

## Example Output

```
🔴 crewai (pip)
  Trust Score: 0/100
  Risk Score: 100/100
  Verdict: UNSAFE
  Findings: 31 (from 3 audits)
  Source: https://github.com/crewAIInc/crewAI
  Last audited: 2026-02-02
  Details: https://agentaudit.dev/packages/crewai
```

## Database

AgentAudit currently tracks **130+ packages** with **418+ findings** across:
- npm packages
- pip packages  
- MCP servers
- AI agent frameworks & skills

All data is publicly available at [agentaudit.dev](https://agentaudit.dev).

## License

MIT
