export type MulticlawEditableConfig = Record<string, unknown>;

export interface SavedMulticlawConfig {
  id: string | number;
  slug: string;
  [key: string]: unknown;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
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

function sameValue(expectedKey: string, expected: unknown, saved: Record<string, unknown>): boolean {
  const responseKey = expectedKey === "aiModel" ? "model" : expectedKey;
  const actual = saved[responseKey];
  if (Array.isArray(expected)) return JSON.stringify(actual) === JSON.stringify(expected);
  return actual === expected;
}

/** Save MultiClaw configuration and confirm every changed field from a fresh read. */
export async function saveAndVerifyMulticlawConfig(
  slug: string,
  payload: MulticlawEditableConfig,
  request: typeof fetch = fetch,
): Promise<SavedMulticlawConfig> {
  const endpoint = `/api/multiclaw/agent/${encodeURIComponent(slug)}`;
  const patch = await request(endpoint, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const patchBody = await responseBody(patch);
  if (!patch.ok) throw responseError(patchBody, patch.status, "Server menolak penyimpanan");

  const verify = await request(endpoint, {
    credentials: "include",
    cache: "no-store",
  });
  const saved = await responseBody(verify);
  if (!verify.ok) throw responseError(saved, verify.status, "Gagal memeriksa hasil simpan");

  const mismatched = Object.entries(payload)
    .filter(([key, value]) => !sameValue(key, value, saved))
    .map(([key]) => key);
  if (mismatched.length > 0) {
    throw new Error(
      `Perubahan ${mismatched.join(", ")} belum cocok saat dibaca ulang; penyimpanan belum terverifikasi.`,
    );
  }

  return saved as SavedMulticlawConfig;
}
