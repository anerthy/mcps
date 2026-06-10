import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';

// --- CONFIGURACIÓN DE ENTORNO ---
const PORT = Number(process.env.PORT) || 3001;
const API_BASE = process.env.PRODUCTS_API_URL ?? 'http://localhost:1234';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.REALM;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? '';

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
  refresh_token?: string;
}

interface SessionAuth {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
}

// --- AUTENTICACIÓN CONTRA KEYCLOAK ---

async function passwordGrant(
  username: string,
  password: string,
): Promise<SessionAuth> {
  const tokenEndpoint = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', CLIENT_ID!);
  params.append('username', username);
  params.append('password', password);
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

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    tokenExpiry: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

async function refreshTokenGrant(refreshToken: string): Promise<SessionAuth> {
  const tokenEndpoint = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('client_id', CLIENT_ID!);
  params.append('refresh_token', refreshToken);
  if (CLIENT_SECRET) params.append('client_secret', CLIENT_SECRET);

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Keycloak rechazó la renovación: ${response.status} - ${errorBody}`,
    );
  }

  const data: TokenResponse = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    tokenExpiry: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

// --- UTILIDADES ---

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

async function apiFetch<T>(
  path: string,
  getToken: () => Promise<string>,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = await getToken();
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

// --- FACTORÍA DE SERVIDOR POR SESIÓN ---

function createServer(auth: SessionAuth) {
  async function getToken(): Promise<string> {
    const currentTime = Math.floor(Date.now() / 1000);

    if (auth.accessToken && currentTime < auth.tokenExpiry - 10) {
      return auth.accessToken;
    }

    const refreshed = await refreshTokenGrant(auth.refreshToken);
    auth.accessToken = refreshed.accessToken;
    auth.refreshToken = refreshed.refreshToken;
    auth.tokenExpiry = refreshed.tokenExpiry;

    return auth.accessToken;
  }

  const server = new Server(
    { name: 'acme-products', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const token = await getToken();
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
              description: {
                type: 'string',
                description: 'Product description',
              },
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
              description: {
                type: 'string',
                description: 'Product description',
              },
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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const token = await getToken();
    const roles = getRealmRoles(token);

    const isAdmin = roles.includes('admin');
    const isEditor = roles.includes('editor');
    const isCustomer = roles.includes('customer');

    switch (name) {
      case 'list_products': {
        if (!isAdmin && !isEditor && !isCustomer)
          throw new Error('403 Forbidden');
        const products = await apiFetch<Product[]>('/products', getToken);
        return {
          content: [{ type: 'text', text: JSON.stringify(products, null, 2) }],
        };
      }

      case 'get_product': {
        if (!isAdmin && !isEditor && !isCustomer)
          throw new Error('403 Forbidden');
        const product = await apiFetch<Product>(
          `/products/${args!.id}`,
          getToken,
        );
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
        const product = await apiFetch<Product>('/products', getToken, {
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
        const product = await apiFetch<Product>(
          `/products/${args!.id}`,
          getToken,
          { method: 'PUT', body: JSON.stringify(body) },
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(product, null, 2) }],
        };
      }

      case 'delete_product': {
        if (!isAdmin)
          throw new Error(
            '403 Forbidden: Se requieren privilegios de Administrador',
          );
        await apiFetch<void>(`/products/${args!.id}`, getToken, {
          method: 'DELETE',
        });
        return {
          content: [{ type: 'text', text: 'Product deleted successfully' }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

// --- TRANSPORTE SSE ---
const app = express();
const transports: Record<string, SSEServerTransport> = {};

app.get('/sse', async (req, res) => {
  try {
    const username = req.query.username as string;
    const password = req.query.password as string;

    if (!username || !password) {
      res.status(400).send('Missing username or password query parameters');
      return;
    }

    const auth = await passwordGrant(username, password);
    const server = createServer(auth);

    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;

    transport.onclose = () => {
      delete transports[sessionId];
    };

    await server.connect(transport);
  } catch (error) {
    console.error('Error estableciendo SSE stream:', error);
    if (!res.headersSent) {
      res.status(401).send('Authentication failed');
    }
  }
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  if (!sessionId) {
    res.status(400).send('Missing sessionId parameter');
    return;
  }

  const transport = transports[sessionId];
  if (!transport) {
    res.status(404).send('Session not found');
    return;
  }

  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('Error handling request:', error);
    if (!res.headersSent) {
      res.status(500).send('Error handling request');
    }
  }
});

app.listen(PORT, () => {
  console.log(
    `Acme Products MCP (SSE) running on http://localhost:${PORT}/sse`,
  );
});

process.on('SIGINT', () => {
  for (const sessionId in transports) {
    transports[sessionId].close();
    delete transports[sessionId];
  }
  process.exit(0);
});
