"use server";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";

// Creates the Session + first run; idempotent on (env, chatId).
export const startChatSession = chat.createStartSessionAction("playtest-chat");

// Pure mint — the transport calls this on 401/403 to refresh. Secrets stay
// server-side; the browser only ever sees session-scoped public tokens.
export async function mintChatAccessToken(chatId: string) {
  return auth.createPublicToken({
    scopes: { read: { sessions: chatId }, write: { sessions: chatId } },
    expirationTime: "1h",
  });
}
