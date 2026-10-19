import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "./auth";
import { db, findAppUser, upsertAppUser } from "./db";
import type { AppUser } from "../shared/types";

export type AppEnv = {
  Variables: {
    session: typeof auth.$Infer.Session;
    appUser: AppUser;
  };
};

export async function getSession(c: Context) {
  return auth.api.getSession({ headers: c.req.raw.headers });
}

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Not signed in" }, 401);
  c.set("session", session);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Not signed in" }, 401);
  const email = session.user.email?.trim().toLowerCase();
  if (!email) return c.json({ error: "Your identity provider did not return an email address." }, 403);

  const appUser = upsertAppUser(email, session.user.name || null);
  if (appUser.status !== "active") {
    return c.json({ error: "Access pending", status: appUser.status }, 403);
  }
  c.set("session", session);
  c.set("appUser", appUser);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: "Not signed in" }, 401);
  const email = session.user.email?.trim().toLowerCase();
  if (!email) return c.json({ error: "Your identity provider did not return an email address." }, 403);
  const appUser = upsertAppUser(email, session.user.name || null);
  if (appUser.status !== "active" || appUser.role !== "admin") {
    return c.json({ error: "Admin only" }, 403);
  }
  c.set("session", session);
  c.set("appUser", appUser);
  await next();
});

export function countActiveAdmins(): number {
  return (db.query("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin' AND status = 'active'").get() as { n: number }).n;
}

export { findAppUser };
