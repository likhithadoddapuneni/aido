import { base32Decode, hotp, stepAt } from '../../src/modules/auth/totp.ts';
import {
  inviteOpsUser,
  inviteSellerUser,
  acceptInvite,
  confirmMfa,
} from '../../src/modules/auth/staff.ts';
import { runAsSystem } from '../../src/context.ts';
import type { Harness } from './harness.ts';

let ipCounter = 0;
/** Each test uses its own client address so per-IP rate limits never couple tests together. */
export const nextIp = (): string =>
  `10.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}.7`;

/** Response bodies are asserted field by field in tests; a precise type per call would add nothing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
  ip?: string;
}

export async function call(
  h: Harness,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  o: CallOptions = {},
) {
  const res = await h.app.inject({
    method,
    url,
    headers: { 'x-forwarded-for': o.ip ?? nextIp(), ...o.headers },
    ...(o.body !== undefined ? { payload: o.body as object } : {}),
  });
  const text = res.body;
  return {
    status: res.statusCode,
    json: (text ? JSON.parse(text) : null) as Json,
    headers: res.headers,
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
export const guestAuth = (token: string) => ({ authorization: `Guest ${token}` });

let phoneCounter = 0;
export const nextPhone = (): string => `+97150${String(1_000_000 + ++phoneCounter)}`;

/** The current valid code for a TOTP seed, at the harness clock. */
export const totpNow = (h: Harness, seed: string, stepOffset = 0): string =>
  hotp(base32Decode(seed), stepAt(h.clock.now()) + stepOffset);

/** Move to the next 30-second TOTP step (codes are single use). */
export const nextStep = (h: Harness) => h.clock.advanceHours(30 / 3600);

export interface SignedIn {
  phone: string;
  customerId: string;
  accessToken: string;
  refreshToken: string;
}

/** Full phone sign-in through the public API. */
export async function signInBuyer(
  h: Harness,
  extra: { guestToken?: string } = {},
): Promise<SignedIn> {
  const phone = nextPhone();
  const ip = nextIp();
  await call(h, 'POST', '/v1/auth/otp/request', { body: { phone }, ip });
  const res = await call(h, 'POST', '/v1/auth/otp/verify', {
    body: { phone, code: h.otp.last(phone), policyVersion: '2026-01', ...extra },
    ip,
  });
  if (res.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(res.json)}`);
  return {
    phone,
    customerId: res.json.customer.id,
    accessToken: res.json.accessToken,
    refreshToken: res.json.refreshToken,
  };
}

export interface Staff {
  kind: 'seller' | 'ops';
  email: string;
  password: string;
  seed: string;
  userId: string;
  partnerId: string | null;
  accessToken: string;
  refreshToken: string;
}

let staffCounter = 0;
export const PASSWORD = 'correct horse battery staple';

/** Invite → accept → enrol MFA → confirm, exactly as a new staff member would. */
export async function onboardStaff(
  h: Harness,
  kind: 'seller' | 'ops',
  opts: { partnerId?: string; role?: string } = {},
): Promise<Staff> {
  const email = `${kind}${++staffCounter}@staff.test`;
  const deps = { clock: h.ctx.clock, ids: h.ctx.ids };
  const partnerId = opts.partnerId ?? [...(h.seeded?.partners.values() ?? [])][0] ?? null;
  const invitation = await runAsSystem(h.ctx, (trx) =>
    kind === 'seller'
      ? inviteSellerUser(trx, deps, {
          partnerId: partnerId as string,
          email,
          fullName: 'Staff Member',
          role: (opts.role ?? 'seller_owner') as 'seller_owner',
        })
      : inviteOpsUser(trx, deps, {
          email,
          fullName: 'Ops Member',
          role: (opts.role ?? 'ops_admin') as 'ops_admin',
        }),
  );
  await acceptInvite(h.ctx, { token: invitation.inviteToken, password: PASSWORD });
  const enrol = await call(h, 'POST', '/v1/auth/staff/mfa/enroll', {
    body: { email, password: PASSWORD },
  });
  if (enrol.status !== 200) throw new Error(`enrol failed: ${JSON.stringify(enrol.json)}`);
  const seed = enrol.json.seed as string;
  const session = await confirmMfa(h.ctx, {
    email,
    password: PASSWORD,
    totpCode: totpNow(h, seed),
  });
  nextStep(h);
  return {
    kind,
    email,
    password: PASSWORD,
    seed,
    userId: invitation.userId,
    partnerId: kind === 'seller' ? partnerId : null,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}
