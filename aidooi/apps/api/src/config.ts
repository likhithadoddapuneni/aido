import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Runtime connection: the non-owner `aidooi_app` role, subject to row-level security. */
  DATABASE_URL: z.string().url().optional(),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Only the mock exists until a provider is chosen (docs/adrs.md ADR-027). */
  PAYMENT_GATEWAY: z.enum(['mock']).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),
  /**
   * The mock gateway accepts well-known test tokens, so with it live anyone could place an order for
   * free. Production refuses to start with it unless this is set — only ever for a staging environment
   * with no real stock or money behind it.
   */
  ALLOW_MOCK_PAYMENTS: bool.default(false),
  /** Demo machines only: print OTP codes in the API log so a tester can sign in without an SMS provider. */
  DEMO_REVEAL_OTP: bool.default(false),
  EXPOSE_DOCS: bool.default(false),
  /** Oldest mobile app build the API will talk to; older builds receive 426. */
  MIN_APP_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('0.0.0'),
  /** Largest catalogue import accepted in one file. */
  IMPORT_MAX_ROWS: z.coerce.number().int().min(1).max(20000).default(2000),
  /** Ceiling on money-moving requests (checkout, pay) per client per minute. */
  RATE_LIMIT_MONEY_PER_MIN: z.coerce.number().int().min(1).default(20),
  /** Base URL images are served from (CDN in front of object storage). */
  MEDIA_BASE_URL: z.string().url().default('https://media.aidooi.example'),
  RELEASE: z.string().default('dev'),
  /** Ed25519 private key (PKCS#8 PEM; `\n` escapes allowed) that signs access tokens. */
  JWT_PRIVATE_KEY_PEM: z.string().optional(),
  JWT_KEY_ID: z.string().min(1).default('k1'),
  JWT_ISSUER: z.string().default('https://api.aidooi.example'),
  JWT_AUDIENCE: z.string().default('aidooi-api'),
  /** Root secret for OTP/credential hashing and encrypting TOTP seeds (HKDF-derived per purpose). */
  AUTH_SECRET: z.string().min(32).optional(),
  /** Signs viewing QR passes (HMAC-SHA256). Rotating it invalidates outstanding passes. */
  VIEWING_PASS_SECRET: z.string().min(32).optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
});

export type Config = z.infer<typeof Env>;

/** Parse and validate the environment once at start-up. A bad config must stop the process, not limp. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (!c.DATABASE_URL)
      throw new Error('Invalid configuration: DATABASE_URL is required in production');
    if (!c.PAYMENT_WEBHOOK_SECRET)
      throw new Error('Invalid configuration: PAYMENT_WEBHOOK_SECRET is required in production');
    if (!c.JWT_PRIVATE_KEY_PEM)
      throw new Error('Invalid configuration: JWT_PRIVATE_KEY_PEM is required in production');
    if (!c.AUTH_SECRET)
      throw new Error('Invalid configuration: AUTH_SECRET is required in production');
    if (!c.VIEWING_PASS_SECRET)
      throw new Error('Invalid configuration: VIEWING_PASS_SECRET is required in production');
    if (c.CORS_ORIGINS.includes('*'))
      throw new Error('Invalid configuration: wildcard CORS is not allowed in production');
    if (c.DEMO_REVEAL_OTP)
      throw new Error(
        'Invalid configuration: DEMO_REVEAL_OTP prints sign-in codes and must never run in production',
      );
    if (c.PAYMENT_GATEWAY === 'mock' && !c.ALLOW_MOCK_PAYMENTS) {
      throw new Error(
        'Invalid configuration: PAYMENT_GATEWAY=mock would let anyone order for free. ' +
          'Configure a real payment provider, or set ALLOW_MOCK_PAYMENTS=true for a staging environment only.',
      );
    }
  }
  return c;
}
