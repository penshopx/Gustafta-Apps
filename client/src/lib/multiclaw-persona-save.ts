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

async function readResponseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function responseError(body: Record<string, unknown>, status: number, action: string): Error {
  const message = typeof body.error === "string"
    ? body.error
    : typeof body.message === "string"
      ? body.message
      : `${action} (HTTP ${status}).`;
  return new Error(message);
}

/** Save through the authenticated API, then confirm using a fresh server read. */
export async function saveAndVerifyMulticlawPersona(
  agentId: string | number,
  slug: string,
  payload: MulticlawPersonaPayload,
  request: typeof fetch = fetch,
): Promise<SavedMulticlawPersona> {
  const patch = await request(`/api/agents/${agentId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const patchBody = await readResponseBody(patch);
  if (!patch.ok) throw responseError(patchBody, patch.status, "Server menolak penyimpanan");

  const verify = await request(`/api/multiclaw/agent/${encodeURIComponent(slug)}`, {
    credentials: "include",
    cache: "no-store",
  });
  const saved = await readResponseBody(verify);
  if (!verify.ok) throw responseError(saved, verify.status, "Gagal memeriksa hasil simpan");

  const sameStarters = Array.isArray(saved.conversationStarters)
    && JSON.stringify(saved.conversationStarters) === JSON.stringify(payload.conversationStarters);
  if (
    saved.greetingMessage !== payload.greetingMessage
    || !sameStarters
    || saved.isEnabled !== payload.isEnabled
  ) {
    throw new Error("Data yang dibaca ulang berbeda dari perubahan yang dikirim. Perubahan belum terverifikasi tersimpan.");
  }

  return saved as SavedMulticlawPersona;
}
