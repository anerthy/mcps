import express, { Request, Response, NextFunction } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';

interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  createdAt: string;
  updatedAt: string;
}

interface AuthUser {
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const app = express();
const PORT = 1234;

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'architects';
const JWKS_URI = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`;

let jwksCache: {
  keys: Map<string, crypto.KeyObject>;
  expiresAt: number;
} | null = null;

async function getPublicKey(kid: string): Promise<crypto.KeyObject> {
  if (!jwksCache || Date.now() > jwksCache.expiresAt) {
    const res = await fetch(JWKS_URI);
    if (!res.ok) {
      throw new Error(`Failed to fetch JWKS: ${res.status}`);
    }
    const { keys } = (await res.json()) as {
      keys: {
        kid?: string;
        kty: string;
        use?: string;
        [key: string]: unknown;
      }[];
    };
    const map = new Map<string, crypto.KeyObject>();
    for (const jwk of keys) {
      if (jwk.use === 'sig' || !jwk.use) {
        try {
          const key = crypto.createPublicKey({
            key: jwk as any,
            format: 'jwk',
          });
          if (jwk.kid) map.set(jwk.kid, key);
        } catch {
          /* skip invalid keys */
        }
      }
    }
    jwksCache = { keys: map, expiresAt: Date.now() + 3_600_000 };
  }
  const key = jwksCache.keys.get(kid);
  if (!key) throw new Error('No matching JWK found for token kid');
  return key;
}

async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error:
        'Missing or invalid Authorization header. Expected: Bearer <token>',
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.decode(token, { complete: true }) as {
      header: { kid: string };
      payload: JwtPayload & { realm_access?: { roles: string[] } };
    } | null;
    if (!decoded || !decoded.header?.kid) {
      res.status(401).json({ error: 'Invalid token: missing kid' });
      return;
    }

    const publicKey = await getPublicKey(decoded.header.kid);
    const payload = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
    }) as JwtPayload & { realm_access?: { roles: string[] } };

    const roles = payload.realm_access?.roles ?? [];
    req.user = { roles };
    next();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid or expired token';
    res.status(401).json({ error: message });
  }
}

function authorize(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const hasRole = allowedRoles.some((role) => req.user!.roles.includes(role));
    if (!hasRole) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

app.use(express.json());

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Products API',
      version: '1.0.0',
      description: 'Simple CRUD API for products',
    },
    servers: [{ url: `http://localhost:${PORT}` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [__filename],
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const products: Product[] = [];
let nextId = 1;

/**
 * @openapi
 * /products:
 *   get:
 *     summary: List all products
 *     responses:
 *       200:
 *         description: Array of products
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 */
app.get(
  '/products',
  authenticate,
  authorize('admin', 'customer', 'editor'),
  (_req: Request, res: Response) => {
    res.json(products);
  },
);

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     summary: Get a product by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Product found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       404:
 *         description: Product not found
 */
app.get(
  '/products/:id',
  authenticate,
  authorize('admin', 'customer', 'editor'),
  (req: Request, res: Response) => {
    const product = products.find((p) => p.id === Number(req.params.id));
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(product);
  },
);

/**
 * @openapi
 * /products:
 *   post:
 *     summary: Create a new product
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateProduct'
 *     responses:
 *       201:
 *         description: Product created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       400:
 *         description: Validation error
 */
app.post(
  '/products',
  authenticate,
  authorize('admin', 'editor'),
  (req: Request, res: Response) => {
    const { name, description, price } = req.body;
    if (!name || price == null) {
      res.status(400).json({ error: 'name and price are required' });
      return;
    }
    const now = new Date().toISOString();
    const product: Product = {
      id: nextId++,
      name,
      description: description ?? '',
      price,
      createdAt: now,
      updatedAt: now,
    };
    products.push(product);
    res.status(201).json(product);
  },
);

/**
 * @openapi
 * /products/{id}:
 *   put:
 *     summary: Update an existing product
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProduct'
 *     responses:
 *       200:
 *         description: Product updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       404:
 *         description: Product not found
 */
app.put(
  '/products/:id',
  authenticate,
  authorize('admin', 'editor'),
  (req: Request, res: Response) => {
    const product = products.find((p) => p.id === Number(req.params.id));
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    const { name, description, price } = req.body;
    if (name != null) product.name = name;
    if (description != null) product.description = description;
    if (price != null) product.price = price;
    product.updatedAt = new Date().toISOString();
    res.json(product);
  },
);

/**
 * @openapi
 * /products/{id}:
 *   delete:
 *     summary: Delete a product by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Product deleted
 *       404:
 *         description: Product not found
 */
app.delete(
  '/products/:id',
  authenticate,
  authorize('admin'),
  (req: Request, res: Response) => {
    const idx = products.findIndex((p) => p.id === Number(req.params.id));
    if (idx === -1) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    products.splice(idx, 1);
    res.status(204).send();
  },
);

/**
 * @openapi
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         price:
 *           type: number
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     CreateProduct:
 *       type: object
 *       required:
 *         - name
 *         - price
 *       properties:
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         price:
 *           type: number
 *     UpdateProduct:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         price:
 *           type: number
 */

app.listen(PORT, () => {
  console.log(`Products API running on http://localhost:${PORT}`);
  console.log(`Swagger UI at http://localhost:${PORT}/api-docs`);
});
