import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { db } from "./db";
import { BASE_URL, loadSecret, TRUSTED_ORIGINS } from "./config";
import type { AiO } from "../shared/types";

const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {
};

export const AUTH_PROVIDERS: AiO[] = [];

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
  AUTH_PROVIDERS.push({ id: "github", label: "GitHub" });
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
  AUTH_PROVIDERS.push({ id: "google", label: "Google" });
}

const OIDC_ISSUER = (process.env.OIDC_ISSUER || "").replace(/\/$/, "");
const OIDC_DISCOVERY = process.env.OIDC_DISCOVERY_URL || (OIDC_ISSUER ? `${OIDC_ISSUER}/.well-known/openid-configuration` : "");

const plugins = [];
if (OIDC_DISCOVERY && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET) {
  plugins.push(
    genericOAuth({
      config: [
        {
          providerId: "oidc",
          clientId: process.env.OIDC_CLIENT_ID,
          clientSecret: process.env.OIDC_CLIENT_SECRET,
          discoveryUrl: OIDC_DISCOVERY,
          scopes: ["openid", "email", "profile"],
        },
      ],
    }),
  );
  AUTH_PROVIDERS.push({ id: "oidc", label: process.env.OIDC_NAME || "SSO (OIDC)" });
}

export const passwordAuthEnabled = process.env.AUTH_PASSWORD_ENABLED === "1";

export const auth = betterAuth({
  appName: "AniManga",
  baseURL: BASE_URL,
  basePath: "/api/auth",
  secret: loadSecret(),
  database: db,
  trustedOrigins: TRUSTED_ORIGINS,
  socialProviders,
  plugins,
  emailAndPassword: passwordAuthEnabled ? { enabled: true } : undefined,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    useSecureCookies: BASE_URL.startsWith("https://"),
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  onAPIError: {
    errorURL: "/",
  },
});

export function callbackUrl(provider: string): string {
  return `${BASE_URL}/api/auth/callback/${provider}`;
}

export { TRUSTED_ORIGINS };
