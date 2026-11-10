/**
 * patch-lexskripsi-notion-agent.ts
 * AGENT-NOTION — Sub-agent LexSkripsi sekaligus agent mandiri
 * Fungsi: chatbot interaktif yang bisa baca/tulis Notion workspace mahasiswa
 * — Simpan catatan bimbingan
 * — Buat struktur database skripsi
 * — Update status kemajuan bab
 * — Cari & retrieve halaman Notion
 */

import { db } from "./db";
import { agents as agentsTable, toolboxes, knowledgeBases, series } from "../shared/schema";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { LEX_NOTION_SLUG, selectLexSkripsiTargets } from "./lexskripsi-patch-targets";
import { inspectNotionPatchState } from "./lexskripsi-notion-patch-state";

const log = (msg: string) =>
  console.log(`${new Date().toLocaleTimeString()} [express] ${msg}`);

const PATCH_MARKER = "LEXSKRIPSI-NOTION-AGENT-v1";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT AGENT-NOTION
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_NOTION = `Kamu adalah AGENT-NOTION — asisten manajemen workspace skripsi berbasis Notion.

## IDENTITAS & PERAN
Kamu adalah anggota tim LexSkripsi yang bertanggung jawab atas organisasi dokumen dan knowledge management di Notion. Kamu bukan hanya "pengambil data" — kamu adalah manajer workspace skripsi yang proaktif membantu mahasiswa menjaga catatan tetap terstruktur, progress termonitor, dan semua dokumen mudah ditemukan.

## KEMAMPUAN UTAMA
Kamu bisa melakukan tindakan Notion berikut secara interaktif:

### 1. BACA & CARI
- Cari halaman atau database Notion berdasarkan kata kunci
- Tampilkan daftar halaman yang tersedia di workspace
- Baca isi halaman Notion spesifik
- Temukan catatan bimbingan lama berdasarkan topik

### 2. TULIS & BUAT
- Buat halaman baru di Notion (catatan bimbingan, draft bab, ringkasan diskusi)
- Buat database skripsi dengan struktur kolom yang tepat
- Update status kemajuan per bab
- Simpan ringkasan sesi diskusi LexSkripsi ke Notion

### 3. STRUKTUR DATABASE SKRIPSI
Kamu bisa membantu membuat dan mengelola database skripsi standar dengan kolom:
- Bab/Sub-bab (title)
- Status: [ ] Belum mulai / [ ] Draft / [x] Selesai / [ ] Revisi
- Catatan Dosen (text)
- Tanggal Target (date)
- Referensi Utama (text)
- Link Drive/Dokumen (URL)

## CARA KERJA

### SAAT DIMINTA MELAKUKAN AKSI NOTION:
1. Konfirmasi aksi dengan mahasiswa (apa yang akan dibuat/diubah)
2. Eksekusi via endpoint /api/notion/*
3. Berikan konfirmasi + link langsung ke halaman yang dibuat/diupdate
4. Tawaran langkah berikutnya

### SAAT DIMINTA MENCARI/MEMBACA:
1. Cari dengan kata kunci yang relevan
2. Tampilkan hasil dalam format yang mudah dipilih
3. Baca konten jika diminta
4. Sarankan apa yang bisa dilakukan dengan konten tersebut

## FORMAT OUTPUT

### Untuk hasil pencarian:
📋 **Hasil Pencarian: "[kata kunci]"**
| # | Judul | Terakhir Diubah |
|---|---|---|
| 1 | [judul] | [tanggal] |

### Untuk konfirmasi aksi:
**Yang akan saya buat di Notion:**
- Judul: [judul halaman]
- Lokasi: [parent page / workspace root]
- Isi: [ringkasan singkat]

Lanjut? (ya / ubah dulu)

### Untuk template catatan bimbingan:
**📝 Catatan Bimbingan LexSkripsi**
Tanggal: [tanggal]
Sesi: [topik utama]
─────────────────────
**Pertanyaan & Pembahasan:**
[isi diskusi]

**Kesimpulan & Poin Kunci:**
[poin-poin]

**PR & Langkah Selanjutnya:**
- [ ] [action item 1]
- [ ] [action item 2]

**Link Notion:** [url]

## BATASAN
- Kamu hanya bisa mengakses Notion workspace yang sudah dihubungkan oleh pengguna
- Kamu tidak bisa menghapus halaman (untuk keamanan data)
- Untuk perubahan besar pada konten yang sudah ada, selalu minta konfirmasi
- Tidak bisa membaca file attachment di dalam Notion (hanya teks)

## INTEGRASI DENGAN LEXSKRIPSI
Kamu adalah sub-agent LexSkripsi. Ketika Orchestrator mendispatch ke kamu, biasanya karena:
- Mahasiswa ingin menyimpan hasil diskusi ke Notion
- Mahasiswa ingin mengecek progress bab di database Notion mereka
- Mahasiswa ingin membuat struktur workspace skripsi baru
- Mahasiswa ingin mencari catatan bimbingan lama

Setelah selesai, selalu akhiri dengan: "Catatan sudah tersimpan di Notion. Ada yang mau dilanjutkan — diskusi bab selanjutnya atau mau saya buat reminder deadline di Notion juga?"

## PRINSIP KERJA
✓ Proaktif — jangan tunggu instruksi detail, ambil inisiatif yang masuk akal
✓ Konfirmasi dulu sebelum menulis — selalu tanya sebelum membuat/mengubah
✓ Informatif — selalu berikan link langsung ke halaman yang dibuat
✓ Ringkas — tidak perlu menjelaskan teknis API, fokus ke hasil yang berguna
✓ Terstruktur — gunakan format yang konsisten untuk setiap jenis output`;

// ─────────────────────────────────────────────────────────────────────────────
// GREETING MESSAGE
// ─────────────────────────────────────────────────────────────────────────────
const GREETING_NOTION = `Halo! Saya AGENT-NOTION — asisten workspace skripsi di Notion.

Saya bisa membantu kamu:
📋 **Cari & baca** halaman atau catatan yang sudah ada di Notion kamu
📝 **Simpan** ringkasan diskusi bimbingan ke halaman Notion baru
🗂️ **Buat struktur** database skripsi (tracker bab, daftar referensi, catatan revisi)
✅ **Update** status kemajuan per bab di database Notion

Mau mulai dari mana? Ceritakan apa yang ingin kamu kelola di Notion.`;

// ─────────────────────────────────────────────────────────────────────────────
// KB ENTRIES
// ─────────────────────────────────────────────────────────────────────────────

const KB_PANDUAN_NOTION_SKRIPSI = `# Panduan Workspace Skripsi di Notion — Template & Struktur yang Disarankan

## MENGAPA NOTION UNTUK SKRIPSI?

Notion adalah alat manajemen knowledge yang ideal untuk skripsi karena:
✓ Satu tempat untuk semua — outline, draft, referensi, catatan bimbingan, jadwal
✓ Bisa diakses dari mana saja (laptop, HP)
✓ Mendukung rich text, tabel, checklist, database
✓ Bisa dibagikan ke dosen pembimbing (view-only) untuk transparansi progress

---

## STRUKTUR WORKSPACE SKRIPSI YANG DISARANKAN

### Hierarki Halaman:
📁 SKRIPSI — [Nama Mahasiswa] [NIM]
├── 📋 Dashboard Progress
├── 📝 Draft Bab
│   ├── Bab I — Pendahuluan
│   ├── Bab II — Tinjauan Pustaka
│   ├── Bab III — Metode Penelitian
│   ├── Bab IV — Hasil & Pembahasan
│   └── Bab V — Kesimpulan & Saran
├── 🗄️ Database Referensi
├── 🗒️ Catatan Bimbingan
│   ├── Catatan Bimbingan [Tanggal 1]
│   ├── Catatan Bimbingan [Tanggal 2]
│   └── ...
├── 📅 Timeline & Deadline
└── 🔗 Link Penting (repositori, jurnal, regulasi)

---

## DATABASE TRACKER PROGRESS BAB

Buat database Notion dengan kolom berikut:
| Kolom | Tipe | Deskripsi |
|---|---|---|
| Bab/Sub-bab | Title | Nama bab atau sub-bab |
| Status | Select | Belum Mulai / Draft / Revisi / Final |
| Target Selesai | Date | Deadline per bab |
| Catatan Dosen | Text | Masukan/koreksi dari dosen |
| Referensi Utama | Text | Buku/artikel kunci yang digunakan |
| Jumlah Halaman | Number | Halaman yang sudah ditulis |
| % Selesai | Number | Estimasi persentase penyelesaian |

### Status yang Disarankan:
- 🔴 Belum Mulai
- 🟡 Draft (sedang ditulis)
- 🟠 Revisi (ada koreksi dosen)
- 🟢 Final (sudah disetujui dosen)

---

## TEMPLATE CATATAN BIMBINGAN

Buat satu halaman per sesi bimbingan dengan format:

---
**📅 Tanggal:** [DD/MM/YYYY]
**⏰ Durasi:** [X jam]
**📍 Lokasi/Media:** [Tatap muka / Zoom / WA]
**📋 Topik Utama:** [Bab/isu yang didiskusikan]

---

### 🗣️ Masukan Dosen
- [Masukan/koreksi poin 1]
- [Masukan/koreksi poin 2]

### 📌 Keputusan & Kesimpulan
- [Keputusan penting dari diskusi]

### ✅ PR & Action Items
- [ ] [Tugas 1 — deadline: DD/MM]
- [ ] [Tugas 2 — deadline: DD/MM]

### 🗒️ Catatan Tambahan
[Catatan bebas — hal-hal yang perlu diingat]

---

## DATABASE REFERENSI

Buat database untuk mengelola semua referensi skripsi:
| Kolom | Tipe | Deskripsi |
|---|---|---|
| Judul | Title | Judul buku/artikel |
| Penulis | Text | Nama penulis |
| Tahun | Number | Tahun terbit |
| Jenis | Select | Buku / Artikel Jurnal / Regulasi / Putusan / Website |
| Digunakan di | Multi-select | Bab I / Bab II / Bab III / Bab IV / Bab V |
| Kutipan Kunci | Text | Quote paling penting dari sumber ini |
| Link/DOI | URL | Link ke sumber digital |
| Sudah Dibaca | Checkbox | Tanda sudah dibaca sepenuhnya |

---

## TIPS PENGGUNAAN NOTION UNTUK SKRIPSI

### 1. Update rutin setelah setiap sesi bimbingan
Langsung buka Notion setelah bimbingan dan catat semua masukan dosen — memori masih segar.

### 2. Gunakan linked database
Hubungkan database referensi ke masing-masing bab agar mudah tahu referensi mana dipakai di mana.

### 3. Share ke dosen (opsional)
Beberapa dosen menghargai transparansi — kamu bisa share halaman Dashboard Progress (view-only) ke dosen pembimbing agar mereka bisa memantau.

### 4. Backup berkala
Notion punya export ke PDF/HTML. Export skripsi draft setiap minggu sebagai backup.

### 5. Sinkronkan dengan LexSkripsi
Setelah diskusi di LexSkripsi, minta AGENT-NOTION untuk langsung simpan ringkasan ke Notion — tidak perlu copy-paste manual.`;

const KB_NOTION_API_COMMANDS = `# Panduan Perintah AGENT-NOTION — Cara Meminta & Apa yang Bisa Dilakukan

## PERINTAH YANG BISA KAMU BERIKAN KE AGENT-NOTION

### MENCARI & MEMBACA
| Perintah | Apa yang terjadi |
|---|---|
| "Cari halaman tentang Bab III di Notion" | Agent mencari semua halaman yang mengandung "Bab III" |
| "Tampilkan semua halaman di Notion" | Agent menampilkan daftar halaman yang tersedia |
| "Baca halaman catatan bimbingan terakhir" | Agent membaca dan menampilkan isi halaman |
| "Cari referensi PMH di Notion" | Agent mencari halaman yang berkaitan dengan PMH |

### MEMBUAT HALAMAN BARU
| Perintah | Apa yang terjadi |
|---|---|
| "Simpan catatan diskusi tadi ke Notion" | Agent membuat halaman catatan bimbingan baru |
| "Buat halaman draft Bab IV di Notion" | Agent membuat halaman kosong dengan template bab |
| "Buat database tracker progress bab" | Agent membuat database dengan kolom standar |
| "Buat halaman ringkasan regulasi MBDK" | Agent membuat halaman dengan judul yang diminta |

### UPDATE & SINKRONISASI
| Perintah | Apa yang terjadi |
|---|---|
| "Update status Bab I jadi Final" | Agent mengupdate status di database tracker |
| "Tambahkan catatan ke halaman Bab III" | Agent menambahkan konten ke halaman yang ada |
| "Simpan argumen PMH ini ke Notion" | Agent menyimpan teks yang diberikan ke Notion |

---

## CARA PENGGUNAAN TERBAIK

### Setelah sesi diskusi dengan LexSkripsi:
1. Katakan: "AGENT-NOTION, simpan ringkasan diskusi tadi ke Notion"
2. Agent akan minta konfirmasi judul dan lokasi
3. Konfirmasi → Agent membuat halaman + berikan link langsung
4. Kamu bisa langsung buka di Notion

### Saat mau mulai dari nol:
1. Katakan: "Buatkan struktur workspace skripsi di Notion untuk saya"
2. Agent akan tanya nama dan NIM untuk judul
3. Konfirmasi → Agent membuat hierarki halaman lengkap
4. Kamu dapat link ke halaman utama dan semua sub-halaman

### Untuk tracking progress:
1. Katakan: "Cek progress bab skripsi saya di Notion"
2. Agent cari database tracker di Notion
3. Tampilkan status semua bab dalam format tabel
4. Tawari untuk update status bab tertentu

---

## FORMAT OUTPUT STANDAR AGENT-NOTION

### Hasil pencarian:
\`\`\`
📋 Hasil Pencarian: "[kata kunci]" — X halaman ditemukan

1. [Judul Halaman 1] — diubah [tanggal]
2. [Judul Halaman 2] — diubah [tanggal]
3. ...

Mau saya buka/baca salah satunya?
\`\`\`

### Konfirmasi sebelum membuat:
\`\`\`
Yang akan saya buat di Notion:
📄 Judul: [judul]
📁 Lokasi: [workspace root / sub-halaman tertentu]
📝 Isi: [ringkasan singkat]

Lanjut? (ya / ubah dulu / batalkan)
\`\`\`

### Setelah berhasil:
\`\`\`
✅ Berhasil dibuat di Notion!
📄 [Judul Halaman]
🔗 Link: [notion.so/...]

Mau saya tambahkan ke halaman lain atau buat reminder deadline juga?
\`\`\``;

// ─────────────────────────────────────────────────────────────────────────────
// PATCH RUNNER
// ─────────────────────────────────────────────────────────────────────────────

export type NotionPatchStage = "toolbox" | "agent" | "knowledge-1" | "knowledge-2" | "link" | "marker";

// The callback and database override allow fault injection against an isolated test database.
export async function patchLexSkripsiNotionAgent(
  options: { database?: typeof db; afterStage?: (stage: NotionPatchStage) => void | Promise<void> } = {},
): Promise<{ done: boolean; skipped: boolean }> {
  return (options.database ?? db).transaction(async (tx) => {
  // Lock the shared parent before reading candidates or markers. A second startup
  // waits for this transaction to commit, then inspects the committed state.
  const lexSeriesRows = await tx.select({ id: series.id }).from(series)
    .where(eq(series.slug, "lexskripsi-asisten-skripsi-hukum")).for("update");
  if (lexSeriesRows.length !== 1) throw new Error("Seri LexSkripsi tidak pasti; patch AGENT-NOTION dibatalkan");
  const lexSeries = lexSeriesRows[0];
  const orchestratorRows = await tx.select({
    id: agentsTable.id, name: agentsTable.name, slug: agentsTable.slug,
    description: agentsTable.description, systemPrompt: agentsTable.systemPrompt,
    seriesSlug: series.slug,
  }).from(agentsTable).leftJoin(toolboxes, eq(agentsTable.toolboxId, toolboxes.id))
    .leftJoin(series, eq(toolboxes.seriesId, series.id))
    .where(eq(agentsTable.name, "LexSkripsi"));
  const { orchestrator } = selectLexSkripsiTargets(orchestratorRows, ["orchestrator"]);
  const markers = await tx.select({ agentId: knowledgeBases.agentId }).from(knowledgeBases)
    .where(like(knowledgeBases.name, `%${PATCH_MARKER}%`));
  const notionCandidates = await tx.select({
    id: agentsTable.id, name: agentsTable.name, slug: agentsTable.slug,
    description: agentsTable.description, systemPrompt: agentsTable.systemPrompt, toolboxId: agentsTable.toolboxId,
  }).from(agentsTable).where(or(eq(agentsTable.name, "AGENT-NOTION"), eq(agentsTable.slug, LEX_NOTION_SLUG)));
  const candidateToolboxes = notionCandidates.length
    ? await tx.select({ id: toolboxes.id, seriesId: toolboxes.seriesId }).from(toolboxes)
      .where(inArray(toolboxes.id, notionCandidates.map((candidate) => candidate.toolboxId ?? -1)))
    : [];
  const [priorOrchestrator] = await tx.select({ agenticSubAgents: agentsTable.agenticSubAgents })
    .from(agentsTable).where(eq(agentsTable.id, orchestrator.id));
  const state = inspectNotionPatchState(
    notionCandidates.map((candidate) => ({
      ...candidate,
      seriesSlug: candidateToolboxes.find((toolbox) => toolbox.id === candidate.toolboxId)?.seriesId === lexSeries.id
        ? "lexskripsi-asisten-skripsi-hukum" : null,
    })),
    markers, orchestrator.id, priorOrchestrator?.agenticSubAgents,
  );
  // A marker alone is not proof that the two KB entries and link survived a legacy run.
  const kbNames = [
    "Panduan Workspace Skripsi di Notion — Template & Struktur yang Disarankan",
    "Panduan Perintah AGENT-NOTION — Cara Meminta & Format Output",
  ];
  const existingKb = state.notionId === null ? [] : await tx.select({
    name: knowledgeBases.name,
  }).from(knowledgeBases).where(and(
    eq(knowledgeBases.agentId, state.notionId),
    inArray(knowledgeBases.name, kbNames),
  ));
  if (state.markerExists && state.notionId !== null && state.linked &&
      kbNames.every((name) => existingKb.some((kb) => kb.name === name))) {
    log(`[Patch AGENT-NOTION] Penanda dan identitas agen (${state.notionId}) terverifikasi, skip.`);
    return { done: false, skipped: true };
  }
  if (state.markerExists) log("[Patch AGENT-NOTION] Penanda ada tetapi agen hilang; memulihkan dari definisi LexSkripsi.");

  log("[Patch AGENT-NOTION] Menyiapkan AGENT-NOTION...");

  // ── 1. BUAT TOOLBOX untuk AGENT-NOTION ──
  const toolboxName = "📒 AGENT-NOTION — Workspace Skripsi Manager";
  const toolboxCandidates = await tx.select({ id: toolboxes.id, seriesId: toolboxes.seriesId })
    .from(toolboxes).where(eq(toolboxes.name, toolboxName));
  if (toolboxCandidates.length > 1 || (toolboxCandidates.length === 1 &&
      toolboxCandidates[0].seriesId !== lexSeries.id)) {
    throw new Error("Toolbox AGENT-NOTION ambigu atau bukan milik LexSkripsi");
  }
  let toolboxId = toolboxCandidates[0]?.id;
  if (!toolboxId) {
    const [created] = await tx.insert(toolboxes).values({
      seriesId: lexSeries.id,
      name: "📒 AGENT-NOTION — Workspace Skripsi Manager",
      description: "Sub-agent LexSkripsi yang mengelola Notion workspace mahasiswa. Simpan catatan bimbingan, buat database tracker bab, update status progress, dan cari dokumen skripsi di Notion.",
      purpose: "Manajemen knowledge & dokumentasi skripsi via Notion API",
      capabilities: [
        "Cari & baca halaman Notion berdasarkan kata kunci",
        "Simpan catatan bimbingan ke halaman Notion baru",
        "Buat database tracker progress bab dengan kolom terstruktur",
        "Update status kemajuan per bab (Draft/Revisi/Final)",
        "Sinkronisasi ringkasan diskusi LexSkripsi ke Notion",
      ],
      limitations: [
        "Hanya bisa akses Notion workspace yang sudah dihubungkan",
        "Tidak bisa menghapus halaman (keamanan data)",
        "Tidak bisa membaca file attachment di Notion",
        "Perubahan besar selalu minta konfirmasi dulu",
      ],
      isActive: true,
    } as any).returning({ id: toolboxes.id });
    toolboxId = created.id;
  }
  await options.afterStage?.("toolbox");

  // ── 2. BUAT AGENT-NOTION ──
  let notionId = state.notionId;
  if (!notionId) {
    const [created] = await tx.insert(agentsTable).values({
      toolboxId,
      slug: LEX_NOTION_SLUG,
      name: "AGENT-NOTION",
      description: "Sub-agent LexSkripsi & agent mandiri untuk manajemen workspace skripsi di Notion. Bisa mencari, membaca, membuat, dan mengupdate halaman Notion secara interaktif.",
      avatar: "📒",
      tagline: "Organisir skripsimu di Notion — catatan, tracker, & database",
      systemPrompt: SYSTEM_PROMPT_NOTION,
      greetingMessage: GREETING_NOTION,
      temperature: 0.4,
      maxTokens: 2000,
      aiModel: "gpt-4o",
      isActive: true,
      isPublic: false,
      isOrchestrator: false,
      agenticSubAgents: [],
    } as any).returning({ id: agentsTable.id });
    notionId = created.id;
    log(`[Patch AGENT-NOTION] ✅ AGENT-NOTION (${notionId}) dibuat`);
  } else {
    await tx.update(agentsTable).set({
        description: "Sub-agent LexSkripsi & agent mandiri untuk manajemen workspace skripsi di Notion.",
        systemPrompt: SYSTEM_PROMPT_NOTION,
        greetingMessage: GREETING_NOTION,
        tagline: "Organisir skripsimu di Notion — catatan, tracker, & database",
        avatar: "📒",
        aiModel: "gpt-4o",
        temperature: 0.4,
        maxTokens: 2000,
      } as any).where(eq(agentsTable.id, notionId));
    log(`[Patch AGENT-NOTION] ✅ AGENT-NOTION (${notionId}) sudah ada, diupdate`);
  }
  await options.afterStage?.("agent");

  // ── 3. TAMBAH KB UNTUK AGENT-NOTION ──
  if (!existingKb.some((kb) => kb.name === kbNames[0])) await tx.insert(knowledgeBases).values({
    agentId: notionId,
    name: kbNames[0],
    type: "text",
    content: KB_PANDUAN_NOTION_SKRIPSI,
    description: "Panduan lengkap membangun workspace skripsi di Notion: hierarki halaman, database tracker, template catatan bimbingan, database referensi",
    processingStatus: "completed",
    status: "active",
  });
  await options.afterStage?.("knowledge-1");

  if (!existingKb.some((kb) => kb.name === kbNames[1])) await tx.insert(knowledgeBases).values({
    agentId: notionId,
    name: kbNames[1],
    type: "text",
    content: KB_NOTION_API_COMMANDS,
    description: "Referensi perintah yang bisa diberikan ke AGENT-NOTION dan format output standar yang dihasilkan",
    processingStatus: "completed",
    status: "active",
  });
  await options.afterStage?.("knowledge-2");

  log("[Patch AGENT-NOTION] ✅ 2 KB ditambahkan ke AGENT-NOTION");

  // ── 4. UPDATE ORCHESTRATOR — tambah AGENT-NOTION ke agentic_sub_agents ──
  const [orchRaw] = await tx.select({ agenticSubAgents: agentsTable.agenticSubAgents })
    .from(agentsTable).where(eq(agentsTable.id, orchestrator.id)).limit(1);
  if (!Array.isArray(orchRaw?.agenticSubAgents)) throw new Error("Relasi subagen LexSkripsi tidak valid");
  const currentSubAgents = orchRaw.agenticSubAgents as Array<{ agentId: number | string; role: string; description: string }>;
  const alreadyIn = currentSubAgents.some((subAgent) => Number(subAgent.agentId) === notionId && subAgent.role === "AGENT-NOTION");
  if (currentSubAgents.some((subAgent) => subAgent.role === "AGENT-NOTION" && Number(subAgent.agentId) !== notionId))
    throw new Error("Relasi AGENT-NOTION menunjuk agen lain; patch dibatalkan");
  if (!alreadyIn) {
    const newSubAgents = [
      ...currentSubAgents,
      {
        agentId: notionId,
        role: "AGENT-NOTION",
        description: "Manajemen workspace Notion: simpan catatan bimbingan, buat database tracker bab, update progress, cari dokumen skripsi",
      },
    ];
    await tx.update(agentsTable).set({ agenticSubAgents: newSubAgents })
      .where(eq(agentsTable.id, orchestrator.id));
    log(`[Patch AGENT-NOTION] ✅ Orchestrator (${orchestrator.id}) diupdate — agenticSubAgents kini ${newSubAgents.length} sub-agent`);
  } else {
    log("[Patch AGENT-NOTION] Orchestrator sudah memiliki AGENT-NOTION, skip update");
  }
  await options.afterStage?.("link");

  // ── 5. MARKER ──
  if (!state.markerExists) await tx.insert(knowledgeBases).values({
    agentId: orchestrator.id,
    name: `[PATCH_MARKER] ${PATCH_MARKER} — ${new Date().toISOString()}`,
    type: "text",
    content: `Patch marker: ${PATCH_MARKER}. AGENT-NOTION (ID ${notionId}) dibuat sebagai sub-agent LexSkripsi ke-5.`,
    description: "Patch marker otomatis — jangan dihapus",
    processingStatus: "completed",
    status: "active",
  });
  await options.afterStage?.("marker");

  log("[Patch AGENT-NOTION] SELESAI — AGENT-NOTION siap sebagai sub-agent LexSkripsi & agent mandiri");
  return { done: true, skipped: false };
  });
}
