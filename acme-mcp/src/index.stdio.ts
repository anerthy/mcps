import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// --- CONFIGURACIÓN DE ENTORNO ---
const API_BASE = process.env.PRODUCTS_API_URL ?? 'http://localhost:1234';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.REALM ?? 'master';
const CLIENT_ID = process.env.CLIENT_ID ?? 'acme-mcp-client';
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin';
let cachedAccessToken = '';
let tokenExpiryTime = 0;

interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  createdAt: string;
  updatedAt: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

// --- CAPA DEL GUARDIÁN: Rotación de Tokens de Keycloak ---
async function getValidAccessToken(): Promise<string> {
  const currentTime = Math.floor(Date.now() / 1000);

  if (cachedAccessToken && currentTime < tokenExpiryTime - 10) {
    return cachedAccessToken;
  }

  try {
    const tokenEndpoint = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', CLIENT_ID);
    params.append('username', ADMIN_USERNAME);
    params.append('password', ADMIN_PASSWORD);
    if (CLIENT_SECRET) params.append('client_secret', CLIENT_SECRET);

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Keycloak rechazó la autenticación: ${response.status} - ${errorBody}`,
      );
    }

    const data: TokenResponse = await response.json();

    cachedAccessToken = data.access_token;
    tokenExpiryTime = currentTime + data.expires_in;

    return cachedAccessToken;
  } catch (error) {
    console.error('Error crítico autenticando en Keycloak:', error);
    throw error;
  }
}

function getRealmRoles(token: string): string[] {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=');
    const payload = Buffer.from(base64, 'base64').toString('utf-8');
    const decoded = JSON.parse(payload) as {
      realm_access?: { roles: string[] };
    };
    return decoded?.realm_access?.roles ?? [];
  } catch (error) {
    console.error('Error decodificando token:', error);
    return [];
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = await getValidAccessToken();
  headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as T;
}

const server = new Server(
  { name: 'acme-products', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// --- 1. FILTRADO DINÁMICO DE HERRAMIENTAS ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const token = await getValidAccessToken();
  const roles = getRealmRoles(token);

  const isAdmin = roles.includes('admin');
  const isEditor = roles.includes('editor');
  const isCustomer = roles.includes('customer');

  const tools = [];

  if (isAdmin || isEditor || isCustomer) {
    tools.push(
      {
        name: 'list_products',
        description: 'List all products',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_product',
        description: 'Get a product by ID',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'number', description: 'Product ID' } },
          required: ['id'],
        },
      },
    );
  }

  if (isAdmin || isEditor) {
    tools.push(
      {
        name: 'create_product',
        description: 'Create a new product',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Product name' },
            description: { type: 'string', description: 'Product description' },
            price: { type: 'number', description: 'Product price' },
          },
          required: ['name', 'price'],
        },
      },
      {
        name: 'update_product',
        description: 'Update an existing product',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Product ID' },
            name: { type: 'string', description: 'Product name' },
            description: { type: 'string', description: 'Product description' },
            price: { type: 'number', description: 'Product price' },
          },
          required: ['id'],
        },
      },
    );
  }

  if (isAdmin) {
    tools.push({
      name: 'delete_product',
      description: 'Delete a product by ID',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number', description: 'Product ID' } },
        required: ['id'],
      },
    });
  }

  return { tools };
});

// --- 2. EVALUACIÓN DE ROLES EN TIEMPO DE EJECUCIÓN ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const token = await getValidAccessToken();
  const roles = getRealmRoles(token);

  const isAdmin = roles.includes('admin');
  const isEditor = roles.includes('editor');
  const isCustomer = roles.includes('customer');

  switch (name) {
    case 'list_products': {
      if (!isAdmin && !isEditor && !isCustomer)
        throw new Error('403 Forbidden');
      const products = await apiFetch<Product[]>('/products');
      return {
        content: [{ type: 'text', text: JSON.stringify(products, null, 2) }],
      };
    }

    case 'get_product': {
      if (!isAdmin && !isEditor && !isCustomer)
        throw new Error('403 Forbidden');
      const product = await apiFetch<Product>(`/products/${args!.id}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(product, null, 2) }],
      };
    }

    case 'create_product': {
      if (!isAdmin && !isEditor)
        throw new Error('403 Forbidden: Rol de edición requerido');
      const body: Record<string, unknown> = {
        name: args!.name,
        price: args!.price,
      };
      if (args!.description != null) body.description = args!.description;
      const product = await apiFetch<Product>('/products', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(product, null, 2) }],
      };
    }

    case 'update_product': {
      if (!isAdmin && !isEditor)
        throw new Error('403 Forbidden: Rol de edición requerido');
      const body: Record<string, unknown> = {};
      if (args!.name != null) body.name = args!.name;
      if (args!.description != null) body.description = args!.description;
      if (args!.price != null) body.price = args!.price;
      const product = await apiFetch<Product>(`/products/${args!.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(product, null, 2) }],
      };
    }

    case 'delete_product': {
      if (!isAdmin)
        throw new Error(
          '403 Forbidden: Se requieren privilegios de Administrador',
        );
      await apiFetch<void>(`/products/${args!.id}`, { method: 'DELETE' });
      return {
        content: [{ type: 'text', text: 'Product deleted successfully' }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Acme Products MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
