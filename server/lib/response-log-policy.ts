const AI_ASSIST_ROUTE = "/api/v1/ai/assist";
const RS_CONNECTIONS_ROUTE = "/api/ruang-simpan/app-connections";

function normalizePath(path: string): string {
  const withoutTrailingSlashes = path.replace(/\/+$/, "");
  return (withoutTrailingSlashes || "/").toLowerCase();
}

/**
 * Express route matching tidak case-sensitive secara default dan menerima
 * trailing slash. Gunakan identitas route bila tersedia, plus normalisasi path,
 * agar semua bentuk URL endpoint AI tetap bebas dari capture body generik.
 */
export function isSensitiveAiAssistRequest(path: string, routePath?: unknown): boolean {
  return routePath === AI_ASSIST_ROUTE || normalizePath(path) === AI_ASSIST_ROUTE;
}

export function shouldCaptureApiResponse(
  path: string,
  routePath: unknown,
  nodeEnv: string | undefined,
): boolean {
  // Connection creation and rotation return one-time bearer credentials.
  // Never log these bodies, even in development or under route URL variants.
  const isConnectionPath = (value: string) => {
    const normalized = normalizePath(value);
    return normalized === RS_CONNECTIONS_ROUTE || normalized.startsWith(`${RS_CONNECTIONS_ROUTE}/`);
  };
  const sensitiveConnection = isConnectionPath(path) ||
    (typeof routePath === "string" && isConnectionPath(routePath));
  return nodeEnv !== "production" && !isSensitiveAiAssistRequest(path, routePath) && !sensitiveConnection;
}