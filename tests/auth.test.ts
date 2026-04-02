import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, verifyTelegramAuth, b64url } from '../src/auth';

const SECRET = 'test-secret';

describe('signJwt / verifyJwt', () => {
  it('round-trips valid claims', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signJwt({ sub: '12345', name: 'Alice', exp }, SECRET);
    const claims = await verifyJwt(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('12345');
    expect(claims!.name).toBe('Alice');
  });

  it('returns null for wrong secret', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signJwt({ sub: '12345', name: 'Alice', exp }, SECRET);
    expect(await verifyJwt(token, 'wrong-secret')).toBeNull();
  });

  it('returns null for expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = await signJwt({ sub: '12345', name: 'Alice', exp }, SECRET);
    expect(await verifyJwt(token, SECRET)).toBeNull();
  });

  it('returns null for tampered payload', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signJwt({ sub: '12345', name: 'Alice', exp }, SECRET);
    const parts = token.split('.');
    const tamperedPayload = b64url(JSON.stringify({ sub: '99999', name: 'Eve', exp: 9999999999 }));
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    expect(await verifyJwt(tampered, SECRET)).toBeNull();
  });
});

describe('verifyTelegramAuth', () => {
  // Helper: build a valid Telegram auth payload using the test bot token
  async function makeValidPayload(fields: Record<string, string | number>, botToken: string) {
    const enc = new TextEncoder();
    const checkString = Object.entries(fields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
    const key = await crypto.subtle.importKey(
      'raw', secretKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(checkString));
    const hash = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { ...fields, hash };
  }

  it('accepts a valid payload', async () => {
    const BOT_TOKEN = 'test-bot-token';
    const fields = { id: 123456, first_name: 'Alice', auth_date: Math.floor(Date.now() / 1000) };
    const payload = await makeValidPayload(fields, BOT_TOKEN);
    expect(await verifyTelegramAuth(payload, BOT_TOKEN)).toBe(true);
  });

  it('rejects when hash is missing', async () => {
    const result = await verifyTelegramAuth({ id: 123, auth_date: Date.now() / 1000 }, 'token');
    expect(result).toBe(false);
  });

  it('rejects when auth_date is older than 24 hours', async () => {
    const stale = Math.floor(Date.now() / 1000) - 86401;
    const result = await verifyTelegramAuth({ id: 123, auth_date: stale, hash: 'abc' }, 'token');
    expect(result).toBe(false);
  });
});
