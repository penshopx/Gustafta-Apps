---
name: Claude brain builder scope
description: Anthropic/Claude is ONLY for building/improving agent system prompts, never daily chat
---
Pembagian yang dikonfirmasi pengguna: Claude dipakai untuk "otak aplikasi" — menyusun dan memperbaiki instruksi/system prompt agen. Chat harian dapat memakai GPT (OpenAI), DeepSeek, model melalui NVIDIA, atau Gemini; Claude bukan model chat harian.

Untuk pilihan model chat harian yang baru diterapkan: jika provider pilihan
gagal, berhenti dan tampilkan kegagalan; jangan pindah provider otomatis.
Konfigurasi agen lama tidak dimigrasikan otomatis.

**Why:** pengguna memilih secara eksplisit “Berhenti dan tampilkan kegagalan”,
agar kegagalan tidak diam-diam memicu biaya di provider lain.

**How to apply:** bedakan opt-in baru dari routing lama; jangan mengartikan
aturan chat ini sebagai perintah menghapus fallback Claude brain builder
yang sudah disepakati secara terpisah. Pilihan chat bukan batas biaya
embedding, alat, atau analisis Workroom.

**Why:** cost control (Claude premium, one-time design work vs per-message chat) + no behavior change for existing customer-facing chat.

**How to apply:**
- Helper: `server/lib/anthropic.ts` (raw fetch, no SDK — avoids esbuild ESM allowlist issue). Model env-overridable via ANTHROPIC_MODEL, default claude-sonnet-4-5.
- Endpoints: POST /api/agents/generate-brain (new agents, isAuthenticated) and POST /api/agents/:id/improve-brain (preview-only, assertCanMutateAgent; save still via PATCH). Improve prompt MUST preserve marker blocks (FEDERATION_MODE v2, SYNTHESIS ORCHESTRATOR, SCORECARD).
- Existing agents are improved one-by-one with admin preview/approval — never bulk-automatic (sold clones must not shift behavior). User confirmed (Aug 2026): default usage = NEW chatbots only; existing chatbots stay as-is unless admin explicitly uses the improve button.
- Key status: stored ANTHROPIC_API_KEY is INVALID (user pasted strings "given by an agent"; valid key = sk-ant-api03-, needs console.anthropic.com credits). Per explicit user request, callClaude falls back to Claude via OpenRouter (existing OPENROUTER_API_KEY, model anthropic/claude-sonnet-4.5) when the Anthropic key is missing or 401/403 — this fallback is intentional, don't "fix" it away; re-test direct Anthropic when user supplies a real key.
