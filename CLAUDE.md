# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Three independent workspaces demonstrating MCP (Model Context Protocol) usage in daily development:
- **frontend** — React 19 + Vite 8 + TypeScript starter
- **keycloak** — MCP server wrapping Keycloak's admin API for Claude Code
- **harness-sdd** — Python Notes CLI built following Uncle Bob's SDD/TDD pipeline with 6 specialized AI agents

## Commands

### Frontend (`frontend/`)
```bash
pnpm dev        # Dev server with HMR on localhost:5173
pnpm build      # tsc -b && vite build → dist/
pnpm lint       # ESLint
pnpm preview    # Preview production build
```

### Keycloak MCP (`keycloak/`)
```bash
pnpm dev        # Run src/index.ts with tsx (watch mode)
pnpm build      # tsc → dist/
pnpm start      # node dist/index.js
```

The MCP server itself is launched via `npx -y keycloak-mcp` (configured in `.mcp.json`), not via the package scripts. To activate the Keycloak MCP in Claude Code, open the `keycloak/` directory — its `.claude/settings.local.json` enables the server automatically.

### Harness-SDD (`harness-sdd/`) — Python stdlib only
```bash
python -m src.cli <command>          # Run CLI (add, list, show, delete, search, edit, recent, count, since)
python -m unittest discover          # Run all tests
python tools/mutate.py src/<file>.py # Mutation testing on a single source file
./init.sh                            # Verify environment and all acceptance criteria
```

`NOTES_FILE` env var overrides the default `.notes.json` storage path.

## Architecture

### Keycloak MCP Integration

The `.mcp.json` in `keycloak/` configures a spawned subprocess:
```json
{ "mcpServers": { "keycloak": { "command": "npx", "args": ["-y", "keycloak-mcp"],
  "env": { "KEYCLOAK_URL": "http://localhost:8080", "KEYCLOAK_ADMIN": "admin", "KEYCLOAK_ADMIN_PASSWORD": "admin" } } } }
```
Keycloak must be running locally on port 8080 before using the MCP server. There is no docker-compose — start Keycloak separately.

### Harness-SDD: Three-Layer Architecture

Strict layer order with no cross-layer skips:

| Layer | File | Responsibility |
|-------|------|----------------|
| Storage | `src/storage.py` | Atomic JSON read/write via temp file + `os.replace()` |
| Domain | `src/notes.py` | `Note` frozen dataclass, id generation, custom exceptions |
| CLI | `src/cli.py` | `argparse` command dispatch, stdout output, stderr errors |

No external dependencies — stdlib only. `Note` is immutable (`frozen=True`). Storage writes are atomic (temp file first, then replace — never partial).

### Harness-SDD: Agent Pipeline

`harness-sdd/CLAUDE.md` auto-loads the `craftsman_lead` role. Six agents in `.claude/agents/` implement Uncle Bob's pipeline:

```
pending → spec_partner (conversation) → gherkin_author (feature files)
→ [human approval gate] → tdd_craftsman (Red/Green/Refactor) → judge (review) → mutation_tester → done
```

`feature_list.json` is the single source of truth for feature state. Features #9–11 (`export`, `stats`, `clear`) are pending. `.claude/settings.json` auto-runs tests after every file edit.

## MCP Configuration Pattern

The `keycloak/` workspace shows how to expose a tool as an MCP server for Claude Code:
1. Add `.mcp.json` at the workspace root with server spawn config
2. Enable it in `.claude/settings.local.json` via `"enabledMcpjsonServers"`
3. Credentials and URLs go in the `env` block of `.mcp.json` (not hardcoded in source)
