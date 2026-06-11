# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Three independent TypeScript workspaces demonstrating MCP (Model Context Protocol) with Keycloak-based RBAC:

- **frontend** — React 19 + Vite 8 + TypeScript UI
- **backend** — Express REST API for products, protected by Keycloak JWTs; Swagger UI at `http://localhost:1234/api-docs`
- **acme-mcp** — Custom MCP server exposing products CRUD to Claude Code; tools are filtered at runtime based on the caller's Keycloak roles

All three depend on Keycloak running locally on port 8080.
Run `keycloak/setup.sh` (or follow `keycloak/setup.md`) to provision the `architects` realm from scratch.

## Commands

### Frontend (`frontend/`)
```bash
pnpm dev        # Dev server with HMR on localhost:5173
pnpm build      # tsc -b && vite build → dist/
pnpm lint       # ESLint
pnpm preview    # Preview production build
```

### Backend (`backend/`)
```bash
pnpm dev        # Run src/index.ts with tsx (watch mode), port 1234
pnpm build      # tsc → dist/
pnpm start      # node dist/index.js
```

### Acme MCP (`acme-mcp/`)
```bash
pnpm dev        # stdio transport (default, used by Claude Code via .mcp.json)
pnpm dev:sse    # SSE transport on port 3001 (for remote MCP clients)
pnpm build      # tsc → dist/
pnpm start      # node dist/index.js (stdio)
pnpm start:sse  # node dist/index.sse.js (SSE)
```

## Architecture

### Auth Flow

Keycloak is the identity provider for both the backend and the MCP server. Realm: `architects`.

- **Backend** validates incoming Bearer JWTs by fetching Keycloak's JWKS endpoint and verifying RS256 signatures. The JWKS is cached for 1 hour (`backend/src/index.ts`).
- **Acme MCP** authenticates to Keycloak using the resource owner password grant to obtain its own token, then forwards it as a Bearer header to the backend (`acme-mcp/src/index.ts`). Tokens are cached and refreshed 10 seconds before expiry.

### Role-Based Tool Filtering in the MCP Server

`acme-mcp` decodes the JWT payload to extract `realm_access.roles` and dynamically filters which tools are advertised (`ListTools`) and which calls are permitted (`CallTool`):

| Role | Permitted tools |
|------|----------------|
| `customer` | `list_products`, `get_product` |
| `editor` | above + `create_product`, `update_product` |
| `admin` | all above + `delete_product` |

This filtering happens twice — once on `ListTools` (so unavailable tools are hidden) and once on `CallTool` (defense in depth).

### MCP Configuration

Copy `.mcp.json.example` to `.mcp.json` in `acme-mcp/` and fill in credentials. The server is launched by Claude Code via stdio:

```json
{
  "mcpServers": {
    "acme-products": {
      "command": "npx",
      "args": ["-y", "tsx", "src/index.ts"],
      "env": {
        "PRODUCTS_API_URL": "http://localhost:1234",
        "KEYCLOAK_URL": "http://localhost:8080",
        "REALM": "architects",
        "CLIENT_ID": "public",
        "ADMIN_USERNAME": "<username>",
        "ADMIN_PASSWORD": "<password>"
      }
    }
  }
}
```

`backend/.mcp.json.example` also shows optional `keycloak` (keycloak-mcp) and `postman` MCP server entries.

### Transport Options (`acme-mcp`)

- `src/index.ts` — stdio transport; used by Claude Code and local tools
- `src/index.sse.ts` — SSE transport (Express on port 3001); for remote MCP clients or browser-based connections; supports per-session Keycloak auth with token refresh
