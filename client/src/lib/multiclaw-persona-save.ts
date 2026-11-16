import { saveAndVerifyMulticlawConfig } from "./multiclaw-config-save";

export interface MulticlawPersonaPayload {
  greetingMessage: string;
  conversationStarters: string[];
  isEnabled: boolean;
}

export interface SavedMulticlawPersona extends MulticlawPersonaPayload {
  id: string | number;
  slug: string;
  [key: string]: unknown;
}

/** Save through the authenticated API, then confirm using a fresh server read. */
export async function saveAndVerifyMulticlawPersona(
  slug: string,
  payload: MulticlawPersonaPayload,
  request: typeof fetch = fetch,
): Promise<SavedMulticlawPersona> {
  return await saveAndVerifyMulticlawConfig(slug, { ...payload }, request) as SavedMulticlawPersona;
}
