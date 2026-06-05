import type { FastifyReply, FastifyRequest } from "fastify";
import { OAuth2Client } from "google-auth-library";
import {
  ALLOWED_EMAIL_DOMAIN,
  AUTH_ENABLED,
  GOOGLE_CLIENT_ID,
} from "./config.ts";

export interface AuthUser {
  email: string;
  name?: string;
  picture?: string;
}

const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function domainAllowed(email: string): boolean {
  if (!ALLOWED_EMAIL_DOMAIN) return true;
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`);
}

// Short-lived cache so we don't re-verify the same token on every request.
const tokenCache = new Map<string, { user: AuthUser; exp: number }>();

export async function verifyToken(token: string): Promise<AuthUser> {
  if (!client) throw new Error("auth not configured");
  const cached = tokenCache.get(token);
  if (cached && cached.exp > Date.now()) return cached.user;

  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error("token has no email");
  if (payload.email_verified === false) throw new Error("email not verified");
  if (!domainAllowed(payload.email)) {
    throw new Error(
      ALLOWED_EMAIL_DOMAIN
        ? `only @${ALLOWED_EMAIL_DOMAIN} accounts are allowed`
        : "email not allowed",
    );
  }
  const user: AuthUser = {
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
  const exp = payload.exp ? payload.exp * 1000 : Date.now() + 5 * 60_000;
  tokenCache.set(token, { user, exp });
  return user;
}

export function getUser(req: FastifyRequest): AuthUser | null {
  return (req as FastifyRequest & { user?: AuthUser }).user ?? null;
}

function extractBearer(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (!h) return null;
  const raw = Array.isArray(h) ? h[0] : h;
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : null;
}

const OPEN_EXACT = new Set(["/api/health", "/api/auth/config"]);
const OPEN_PREFIXES = ["/api/screenshots/", "/api/logs/"];

export async function authPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!AUTH_ENABLED) return; // open mode until a client id is configured
  const url = req.url.split("?")[0];
  if (!url.startsWith("/api/")) return; // only gate the JSON API
  if (OPEN_EXACT.has(url)) return;
  if (OPEN_PREFIXES.some((p) => url.startsWith(p))) return;

  const token = extractBearer(req);
  if (!token) {
    reply.code(401).send({ error: "authentication required" });
    return;
  }
  try {
    const user = await verifyToken(token);
    (req as FastifyRequest & { user?: AuthUser }).user = user;
  } catch (err) {
    reply.code(401).send({ error: `auth failed: ${(err as Error).message}` });
  }
}
