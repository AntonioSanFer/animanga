import { createAuthClient } from "better-auth/react";

// better-auth 1.7 registers genericOAuth providers as regular social providers.
export const authClient = createAuthClient();

export async function signOutAndReload(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    window.location.assign("/");
  }
}
