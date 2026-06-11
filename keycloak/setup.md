# Keycloak Setup — realm `architects`

This document defines the complete Keycloak configuration required to run the project.
An AI agent with bash access (and optionally the `keycloak` MCP server) can read this file
and execute each section to provision a fresh Keycloak instance.

---

## Configuration Spec

### Realm
| Field | Value |
|-------|-------|
| Name | `architects` |
| Enabled | `true` |
| Registration | disabled |

### Client
| Field | Value |
|-------|-------|
| Client ID | `public` |
| Type | Public (no secret) |
| Direct Access Grants | enabled (password grant used by `acme-mcp`) |
| Standard Flow | disabled |

### Realm Roles
| Role | Who gets it | Permitted operations |
|------|-------------|----------------------|
| `customer` | read-only users | `list_products`, `get_product` |
| `editor` | editors | above + `create_product`, `update_product` |
| `admin` | administrators | all above + `delete_product` |

> Roles are read from `realm_access.roles` in the JWT — they must be **realm roles**, not client roles.

### Test Users
| Username | Password | Realm Role |
|----------|----------|------------|
| `admin_user` | `Admin1234!` | `admin` |
| `editor_user` | `Editor1234!` | `editor` |
| `customer_user` | `Customer1234!` | `customer` |

---

## Setup Script

Run `keycloak/setup.sh` (below) with Keycloak listening on `http://localhost:8080`.
The script is idempotent for the realm and roles — re-running it will skip already-existing
resources (Keycloak returns 409, which is ignored).

```bash
#!/usr/bin/env bash
# keycloak/setup.sh — full realm bootstrap for the architects project
set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
REALM="architects"

# ── helpers ──────────────────────────────────────────────────────────────────

kc_post() {
  # $1 = path, $2 = body; ignores 409 Conflict (already exists)
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "$KEYCLOAK_URL$1" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$2")
  if [[ "$status" != "2"* && "$status" != "409" ]]; then
    echo "ERROR: POST $1 returned $status" >&2
    exit 1
  fi
}

kc_get() {
  curl -s "$KEYCLOAK_URL$1" -H "Authorization: Bearer $TOKEN"
}

extract() {
  # extract first occurrence of a JSON key
  grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

# ── 1. Admin token ────────────────────────────────────────────────────────────

echo "→ Obtaining admin token..."
TOKEN=$(curl -s -X POST \
  "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=admin-cli&username=$ADMIN_USER&password=$ADMIN_PASS" \
  | extract access_token)

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: could not obtain admin token. Is Keycloak running on $KEYCLOAK_URL?" >&2
  exit 1
fi
echo "   Token obtained."

# ── 2. Realm ──────────────────────────────────────────────────────────────────

echo "→ Creating realm '$REALM'..."
kc_post "/admin/realms" \
  '{"realm":"architects","enabled":true,"registrationAllowed":false,"resetPasswordAllowed":false}'
echo "   Done."

# ── 3. Client ─────────────────────────────────────────────────────────────────

echo "→ Creating client 'public'..."
kc_post "/admin/realms/$REALM/clients" \
  '{
    "clientId": "public",
    "enabled": true,
    "publicClient": true,
    "directAccessGrantsEnabled": true,
    "standardFlowEnabled": false,
    "implicitFlowEnabled": false,
    "serviceAccountsEnabled": false
  }'
echo "   Done."

# ── 4. Realm roles ────────────────────────────────────────────────────────────

for ROLE in customer editor admin; do
  echo "→ Creating realm role '$ROLE'..."
  kc_post "/admin/realms/$REALM/roles" "{\"name\":\"$ROLE\"}"
  echo "   Done."
done

# ── 5. Users + passwords + role assignments ───────────────────────────────────

create_user() {
  local USERNAME=$1
  local PASSWORD=$2
  local ROLE=$3

  echo "→ Creating user '$USERNAME' (role: $ROLE)..."

  # Create user with credential inline
  kc_post "/admin/realms/$REALM/users" \
    "{
      \"username\": \"$USERNAME\",
      \"enabled\": true,
      \"emailVerified\": true,
      \"credentials\": [{
        \"type\": \"password\",
        \"value\": \"$PASSWORD\",
        \"temporary\": false
      }]
    }"

  # Resolve user ID
  local USER_ID
  USER_ID=$(kc_get "/admin/realms/$REALM/users?username=$USERNAME" | extract id)
  if [[ -z "$USER_ID" ]]; then
    echo "ERROR: could not resolve ID for user '$USERNAME'" >&2
    exit 1
  fi

  # Resolve role object (id + name required by the API)
  local ROLE_JSON
  ROLE_JSON=$(kc_get "/admin/realms/$REALM/roles/$ROLE")

  # Assign realm role
  curl -s -o /dev/null -X POST \
    "$KEYCLOAK_URL/admin/realms/$REALM/users/$USER_ID/role-mappings/realm" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "[$ROLE_JSON]"

  echo "   User '$USERNAME' created and assigned role '$ROLE'."
}

create_user "admin_user"    "Admin1234!"    "admin"
create_user "editor_user"   "Editor1234!"   "editor"
create_user "customer_user" "Customer1234!" "customer"

# ── 6. Summary ────────────────────────────────────────────────────────────────

echo ""
echo "✓ Keycloak setup complete."
echo ""
echo "  Realm:   architects"
echo "  Client:  public  (public, direct-access-grants)"
echo "  Roles:   admin · editor · customer"
echo "  Users:   admin_user / editor_user / customer_user"
echo ""
echo "  Update acme-mcp/.mcp.json → ADMIN_USERNAME / ADMIN_PASSWORD"
echo "  with the user you want the MCP server to impersonate."
```

---

## MCP Agent Execution Instructions

When running this setup via an AI agent with the `keycloak` MCP server active:

1. **Steps 1–4 (realm, client, roles) cannot be done with keycloak-mcp** — that package
   does not expose realm/client/role creation. Execute `keycloak/setup.sh` via bash for those.

2. **Step 5 (users)** — keycloak-mcp's `create-user` tool can create users, but it cannot
   set passwords or assign realm roles. Use the script for a complete one-shot setup.

3. **After setup**, use `list-realms` and `list-users` (realm: `architects`) to verify.

### `.mcp.json` values to update after setup

In `acme-mcp/.mcp.json`, set the user whose role the MCP server will run as:

```json
"ADMIN_USERNAME": "admin_user",
"ADMIN_PASSWORD": "Admin1234!"
```

Swap to `editor_user` / `customer_user` to test the role-based tool filtering.

---

## Verify Token & Roles

```bash
# Request a token for a test user and decode the realm_access.roles claim
TOKEN=$(curl -s -X POST \
  "http://localhost:8080/realms/architects/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=public&username=admin_user&password=Admin1234!" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# Decode payload (requires base64 + python/node/jq)
echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | grep realm_access
```
