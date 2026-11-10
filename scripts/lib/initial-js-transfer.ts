import { load } from "cheerio";

export type AssetGroup = "localInitial" | "localRuntime" | "thirdParty";

export interface JsTransfer {
  url: string;
  requestedUrl: string;
  resourceType: string;
  mimeType: string;
  status: number | null;
  transferBytes: number;
  decodedBodyBytes: number;
  encodedBodyBytes?: number;
  /** Header evidence at responseReceived, before worker body/session migration. */
  responseHeaderBytes?: number;
  complete: boolean;
  fromCache: boolean;
  error: string | null;
  transferSource?: "cdp-loading-finished" | "cdp-headers-plus-chromium-netlog-body";
}

/** Resolve against the served document, including <base>, not the local build. */
export function initialScriptUrls(html: string, documentUrl: string): Set<string> {
  const $ = load(html);
  const baseHref = $("base[href]").first().attr("href");
  const base = baseHref ? new URL(baseHref, documentUrl).href : documentUrl;
  const refs = new Set<string>();
  $("script[src], link[rel~='modulepreload'][href], link[rel~='preload'][as='script'][href]").each((_, element) => {
    const ref = $(element).attr(element.tagName === "script" ? "src" : "href");
    if (ref) {
      const url = new URL(ref, base);
      url.hash = "";
      refs.add(url.href);
    }
  });
  return refs;
}

export function isJavaScript(asset: Pick<JsTransfer, "resourceType" | "mimeType" | "url">): boolean {
  return asset.resourceType === "Script" ||
    /(?:javascript|ecmascript)/i.test(asset.mimeType) ||
    /\.(?:[cm]?js)$/i.test(new URL(asset.url).pathname);
}

export function transferReport(assets: JsTransfer[], html: string, documentUrl: string) {
  const initial = initialScriptUrls(html, documentUrl);
  const origin = new URL(documentUrl).origin;
  const groups: Record<AssetGroup, { requests: number; transferBytes: number; decodedBodyBytes: number }> = {
    localInitial: { requests: 0, transferBytes: 0, decodedBodyBytes: 0 },
    localRuntime: { requests: 0, transferBytes: 0, decodedBodyBytes: 0 },
    thirdParty: { requests: 0, transferBytes: 0, decodedBodyBytes: 0 },
  };
  const scripts = assets.filter((asset) => /^https?:/.test(asset.url) && isJavaScript(asset)).map((asset) => {
    const group: AssetGroup = new URL(asset.url).origin !== origin ? "thirdParty" :
      initial.has(asset.requestedUrl) || initial.has(asset.url) ? "localInitial" : "localRuntime";
    groups[group].requests++;
    groups[group].transferBytes += asset.transferBytes;
    groups[group].decodedBodyBytes += asset.decodedBodyBytes;
    return { ...asset, group };
  });
  return {
    groups,
    total: {
      requests: scripts.length,
      transferBytes: scripts.reduce((sum, asset) => sum + asset.transferBytes, 0),
      decodedBodyBytes: scripts.reduce((sum, asset) => sum + asset.decodedBodyBytes, 0),
    },
    assets: scripts.sort((a, b) => b.transferBytes - a.transferBytes),
  };
}
