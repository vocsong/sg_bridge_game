import type { Env } from './types';
import { verifyTelegramAuth, signJwt, verifyJwt } from './auth';
import { upsertUser, getUser, updateDisplayName, getLeaderboard } from './db';

export { GameRoom } from './game-room';

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

async function getAuthClaims(
  request: Request,
  secret: string,
): Promise<{ sub: string; name: string; exp: number } | null> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyJwt(auth.slice(7), secret);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Public bot username for the Telegram Login Widget
    if (url.pathname === '/api/config' && request.method === 'GET') {
      return Response.json({ botUsername: env.TELEGRAM_BOT_USERNAME });
    }

    // Telegram Login Widget callback → verify, upsert user, return JWT
    if (url.pathname === '/api/auth/telegram' && request.method === 'POST') {
      const body = await request.json<Record<string, string | number>>();
      const valid = await verifyTelegramAuth(body, env.TELEGRAM_BOT_TOKEN);
      if (!valid) return Response.json({ error: 'Invalid Telegram auth' }, { status: 401 });

      const telegramId = Number(body.id);
      const firstName = String(body.first_name ?? '');
      const lastName = body.last_name ? ` ${body.last_name}` : '';
      const displayName = (firstName + lastName).trim() || String(body.username ?? telegramId);

      await upsertUser(env.DB, telegramId, displayName);

      const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
      const token = await signJwt({ sub: String(telegramId), name: displayName, exp }, env.JWT_SECRET);
      return Response.json({ token, displayName });
    }

    // Get authenticated user's profile
    if (url.pathname === '/api/me' && request.method === 'GET') {
      const claims = await getAuthClaims(request, env.JWT_SECRET);
      if (!claims) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const user = await getUser(env.DB, Number(claims.sub));
      if (!user) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json({ telegramId: user.telegram_id, displayName: user.display_name });
    }

    // Update authenticated user's display name
    if (url.pathname === '/api/me' && request.method === 'PATCH') {
      const claims = await getAuthClaims(request, env.JWT_SECRET);
      if (!claims) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const body = await request.json<{ displayName?: string }>();
      const name = body.displayName?.trim();
      if (!name) return Response.json({ error: 'displayName required' }, { status: 400 });
      await updateDisplayName(env.DB, Number(claims.sub), name);
      return new Response(null, { status: 204 });
    }

    // Get leaderboard (optionally with authenticated user's rank)
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      const claims = await getAuthClaims(request, env.JWT_SECRET).catch(() => null);
      const telegramId = claims ? Number(claims.sub) : undefined;
      const data = await getLeaderboard(env.DB, telegramId);
      return Response.json(data);
    }

    if (url.pathname === '/api/create' && request.method === 'POST') {
      const roomCode = generateRoomCode();
      const stub = env.GAME_ROOM.getByName(roomCode);
      await stub.fetch(
        new Request('https://internal/create', {
          method: 'POST',
          body: JSON.stringify({ roomCode }),
        }),
      );
      return Response.json({ roomCode });
    }

    if (url.pathname === '/api/ws') {
      const roomCode = url.searchParams.get('room');
      if (!roomCode) return new Response('Missing room code', { status: 400 });

      // If a JWT token is present and valid, override playerId with the stable tg_ id
      const token = url.searchParams.get('token');
      let forwardRequest = request;
      if (token) {
        const claims = await verifyJwt(token, env.JWT_SECRET);
        if (claims) {
          const newUrl = new URL(request.url);
          newUrl.searchParams.set('playerId', `tg_${claims.sub}`);
          newUrl.searchParams.delete('token'); // don't forward the token to the DO
          forwardRequest = new Request(newUrl.toString(), request);
        }
      }

      const stub = env.GAME_ROOM.getByName(roomCode);
      return stub.fetch(forwardRequest);
    }

    return new Response(null, { status: 404 });
  },
};
