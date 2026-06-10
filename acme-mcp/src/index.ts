import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_BASE = process.env.PRODUCTS_API_URL ?? 'http://localhost:1234';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN ?? '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ACCESS_TOKEN) headers['Authorization'] = `Bearer ${ACCESS_TOKEN}`;
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as T;
}

interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  createdAt: string;
  updatedAt: string;
}

const server = new Server(
  { name: 'acme-products', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
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
        properties: {
          id: { type: 'number', description: 'Product ID' },
        },
        required: ['id'],
      },
    },
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
    {
      name: 'delete_product',
      description: 'Delete a product by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Product ID' },
        },
        required: ['id'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'list_products': {
      const products = await apiFetch<Product[]>('/products');
      return {
        content: [{ type: 'text', text: JSON.stringify(products, null, 2) }],
      };
    }

    case 'get_product': {
      const product = await apiFetch<Product>(`/products/${args!.id}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(product, null, 2) }],
      };
    }

    case 'create_product': {
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
