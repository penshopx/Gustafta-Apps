/** Chromium's default (redacted) NetLog supplies worker-entry body bytes that
 * CDP's migrated loadingFinished event omits. Never log or retain raw NetLog. */
export function workerWireTransfers(text: string) {
  const log = JSON.parse(text);
  const names = new Map<number, string>(Object.entries(log.constants.logEventTypes)
    .map(([name, id]) => [Number(id), name]));
  const records = new Map<number, {
    url: string; encoded: number; decoded: number;
    compressed: boolean; complete: boolean; failed: boolean; status: number | null; mime: string;
    responseHeaderBytes?: number;
    http2?: boolean;
  }>();
  for (const event of log.events) {
    const name = names.get(event.type);
    const id = event.source.id;
    const params = event.params ?? {};
    if (name === "URL_REQUEST_START_JOB" && event.phase === 1 && params.url) {
      records.set(id, {
        url: params.url, encoded: 0, decoded: 0,
        compressed: false, complete: false, failed: false, status: null, mime: "",
      });
    }
    const record = records.get(id);
    if (!record) continue;
    // Chromium normalizes even HTTP/2 response status lines to HTTP/1.1 here.
    if (name === "HTTP_TRANSACTION_HTTP2_SEND_REQUEST_HEADERS") record.http2 = true;
    if (name === "HTTP_TRANSACTION_READ_RESPONSE_HEADERS") {
      const headers: string[] = params.headers ?? [];
      if (/^HTTP\/[\d.]+ /.test(headers[0] ?? "")) {
        record.status = Number(headers[0].split(" ")[1]);
      }
      // Service-worker registration can omit CDP responseReceived altogether.
      // HTTP/1 header text can confirm a CDP header-only finish (the caller
      // must check equality, since NetLog can redact values). HTTP/2 displayed
      // headers cannot confirm wire size because they are HPACK-compressed.
      if (!record.http2 && /^HTTP\/1\.[01] /.test(headers[0] ?? "")) {
        record.responseHeaderBytes = Buffer.byteLength(headers.join("\r\n") + "\r\n\r\n");
      }
      for (const header of headers) {
        if (/^content-encoding:\s*(?!identity\b)\S+/i.test(header)) record.compressed = true;
        if (/^content-type:/i.test(header)) record.mime = header.slice(header.indexOf(":") + 1).trim();
      }
    }
    if (name === "URL_REQUEST_JOB_BYTES_READ") record.encoded += params.byte_count ?? 0;
    if (name === "URL_REQUEST_JOB_FILTERED_BYTES_READ") record.decoded += params.byte_count ?? 0;
    if (name === "REQUEST_ALIVE" && event.phase === 2) {
      record.complete = true;
      record.failed = !!params.net_error;
    }
  }
  return [...records.values()].filter((record) => record.complete && !record.failed)
    .map((record) => ({
      url: record.url,
      status: record.status,
      mimeType: record.mime,
      bodyTransferBytes: record.compressed ? record.encoded : record.decoded,
      decodedBodyBytes: record.decoded,
      ...(record.responseHeaderBytes === undefined ? {} : { responseHeaderBytes: record.responseHeaderBytes }),
    }));
}
