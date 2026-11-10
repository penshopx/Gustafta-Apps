import { DEFAULT_LICENSE_PRICE } from "@shared/premium-classes";

// Biaya lisensi berdasarkan jumlah anggota tim (sub-agents + 1 orchestrator).
export function calcStorePrice(agenticSubAgents: unknown): number {
  const subCount = Array.isArray(agenticSubAgents) ? agenticSubAgents.length : 0;
  const total = subCount + 1;

  if (total >= 7) return 1_299_000;
  if (total >= 4) return 799_000;
  if (total >= 2) return 499_000;
  return DEFAULT_LICENSE_PRICE;
}