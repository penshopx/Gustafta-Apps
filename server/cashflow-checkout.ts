import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { createCanonicalOrder } from "./order-api";
import { getCashflowPackageDefinitions } from "./seed-cashflow-packages";
import { packageRegistry } from "@shared/schema";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "rate_limited",
    message: "Terlalu banyak percobaan checkout. Coba lagi sebentar.",
  },
});

function parseBuyer(body: any):
  | { ok: true; buyer: { name: string; email: string; phone: string } }
  | { ok: false; message: string } {
  const buyer = body?.buyer;
  const name = typeof buyer?.name === "string" ? buyer.name.trim() : "";
  const email = typeof buyer?.email === "string" ? buyer.email.trim().toLowerCase() : "";
  const phone = typeof buyer?.phone === "string" ? buyer.phone.trim() : "";
  if (!name || name.length > 120) {
    return { ok: false, message: "Nama lengkap wajib diisi." };
  }
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return { ok: false, message: "Email pembeli tidak valid." };
  }
  if (phone && (phone.length > 30 || !/^[+\d\s()-]+$/.test(phone))) {
    return { ok: false, message: "Nomor WhatsApp tidak valid." };
  }
  return { ok: true, buyer: { name, email, phone } };
}

export function registerCashflowCheckoutRoutes(app: Express): void {
  app.post(
    "/api/cashflow-pbj/checkout",
    checkoutLimiter,
    async (req: Request, res: Response) => {
      try {
        const packageKey =
          typeof req.body?.package_key === "string" ? req.body.package_key.trim() : "";
        const definition = getCashflowPackageDefinitions().find(
          (candidate) => candidate.key === packageKey,
        );
        if (!definition) {
          return res.status(400).json({
            error: "invalid_package",
            message: "Pilihan paket CASHFLOW-PBJ tidak valid.",
          });
        }
        const buyer = parseBuyer(req.body);
        if (!buyer.ok) {
          return res.status(400).json({
            error: "invalid_buyer",
            message: buyer.message,
          });
        }
        const [pkg] = await db
          .select({ version: packageRegistry.version })
          .from(packageRegistry)
          .where(eq(packageRegistry.packageId, definition.packageId))
          .limit(1);
        if (!pkg) {
          return res.status(503).json({
            error: "package_not_ready",
            message: "Paket sedang disiapkan. Silakan coba lagi sebentar.",
          });
        }
        const result = await createCanonicalOrder({
          packageId: definition.packageId,
          packageVersion: pkg.version,
          buyer: buyer.buyer,
          requireScalev: true,
        });
        return res.status(result.status).json(result.payload);
      } catch (error) {
        console.error("[cashflow-checkout] unexpected_error:", (error as Error).message);
        return res.status(500).json({
          error: "internal_error",
          message: "Checkout belum dapat dibuat. Silakan coba lagi.",
        });
      }
    },
  );
}