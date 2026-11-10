type Agent = {
  name?: string | null;
  systemPrompt?: string | null;
};

type AuthzResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

type ImproveBrainDependencies = {
  getAgent: (id: string) => Promise<Agent | undefined>;
  assertCanMutateAgent: (req: any, agent: Agent) => Promise<AuthzResult>;
  isRateLimited: (userId: string) => boolean;
  callClaude: (opts: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }) => Promise<string>;
};

export function makeImproveBrainHandler(deps: ImproveBrainDependencies) {
  return async function improveBrain(req: any, res: any) {
    const agent = await deps.getAgent(req.params.id as string);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const authz = await deps.assertCanMutateAgent(req, agent);
    if (!authz.ok) return res.status(authz.status).json({ error: authz.error });

    const userId = (req.user as any)?.claims?.sub || (req.user as any)?.id || "";
    if (deps.isRateLimited(userId)) {
      return res.status(429).json({ error: "Terlalu sering. Coba lagi dalam 1 jam." });
    }

    const currentPrompt = String(agent.systemPrompt || "").trim();
    if (!currentPrompt) {
      return res.status(400).json({
        error: "Agen ini belum punya system prompt untuk disempurnakan. Gunakan generate-brain.",
      });
    }
    if (currentPrompt.length > 24000) {
      return res.status(400).json({
        error: "System prompt terlalu panjang (>24.000 karakter) untuk disempurnakan otomatis. Edit manual saja.",
      });
    }

    const rawInstruction = (req.body || {}).instruction;
    const instruction =
      typeof rawInstruction === "string" ? rawInstruction.slice(0, 1000).trim() : "";
    const system = `Kamu adalah editor senior "otak" (system prompt) asisten AI di platform Gustafta.
Tugasmu MENYEMPURNAKAN system prompt yang sudah ada: lebih terstruktur, jelas, dan efektif — TANPA mengubah identitas, peran, bahasa, atau perilaku inti asisten.
ATURAN KERAS:
- Pertahankan APA ADANYA setiap blok marker teknis (contoh: "FEDERATION_MODE v2", "SYNTHESIS ORCHESTRATOR", "SCORECARD", blok ALL-CAPS, placeholder {{...}}, dan instruksi orkestrasi sub-agen). Jangan dihapus, jangan diparafrase.
- Pertahankan bahasa asli prompt (jika Indonesia tetap Indonesia).
- Keluarkan HANYA system prompt hasil akhir — tanpa komentar, tanpa penjelasan, tanpa blok kode.`;
    const user = `Nama asisten: ${agent.name || "-"}
${instruction ? `Permintaan khusus admin: ${instruction}\n` : ""}
System prompt saat ini:
---
${currentPrompt}
---
Tulis versi yang disempurnakan.`;

    const prompt = await deps.callClaude({
      system,
      user,
      maxTokens: 8000,
      temperature: 0.4,
    });

    const protectedMarkers = [
      "FEDERATION_MODE v2",
      "SYNTHESIS ORCHESTRATOR",
      "SCORECARD",
    ];
    const lost = protectedMarkers.filter(
      (marker) => currentPrompt.includes(marker) && !prompt.includes(marker),
    );
    if (lost.length > 0) {
      return res.status(422).json({
        error: `Hasil AI menghilangkan marker penting (${lost.join(", ")}). Tidak diterapkan — coba lagi.`,
      });
    }

    return res.json({
      ok: true,
      prompt,
      previous_length: currentPrompt.length,
      new_length: prompt.length,
    });
  };
}