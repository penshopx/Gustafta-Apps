# Inventaris akses Blueprint, Workroom, Knowledge Base

Pemeriksaan ini berlaku pada endpoint di `server/blueprint-engine-routes.ts` dan `server/routes.ts`. `isAuthenticated` menerima login OIDC maupun sesi email aktif. ID dari URL/body tidak pernah menjadi bukti kepemilikan.

| Permukaan | Endpoint | Akses |
| --- | --- | --- |
| Blueprint stateless | POST `/api/blueprint/start`, `/answer`, `/state`, `/analyze` | Login; hanya mengolah JSON dari pemanggil, tanpa mengambil Blueprint pengguna lain dari DB. |
| Blueprint simpan | POST `/api/blueprint/configure` | Login; create menstempel user sesi, update target `agentId` wajib owner/editor/admin (termasuk dryRun). Agen sistem tidak dapat diubah non-admin. |
| Sertifikat Blueprint | POST `/api/blueprint/certificate/share`; GET `/api/blueprint/certificate/:token` | Share: login, snapshot dari body pemanggil dan user sesi. GET: anonim boleh lewat token acak yang sengaja dibagikan, hanya snapshot tanpa identitas pemilik. |
| Workroom daftar/buat | GET/POST `/api/workrooms` | Login; daftar difilter user sesi, create menstempel user sesi; kolaborator agen tidak otomatis menjadi kolaborator Workroom. |
| Workroom detail/mutasi | GET/PATCH/DELETE `/api/workrooms/:id`; POST `/:id/log`, `/:id/gate`, `/:id/gate/:gateId/decide`, `/:id/analyze` | Login + parent Workroom harus milik user sesi; anak gate diambil dari parent yang lolos. ID workroom non-kanonik ditolak. Selain owner tidak dapat melihat/mengubah. |
| KB baca mentah | GET `/api/knowledge-base/:agentId`, `/:agentId/rag-stats`, `/:id/versions`; GET `/api/taxonomy/:id/knowledge-bases` | Login + owner/admin/kolaborator agen (viewer dapat membaca). Agen sistem tanpa owner tetap dapat dibaca login. Agen publik **tidak** otomatis mengizinkan unduh teks mentah; flag KB `isShared` tidak melompati pemeriksaan agen. Setiap versi dalam riwayat lintas agen disaring tersendiri. |
| KB tulis | POST `/api/knowledge-base`, `/from-ruang-simpan`, PATCH/DELETE `/:id`, POST `/:id/reprocess`, `/:id/supersede` | Login + owner/editor/admin agen; `supersede` memeriksa kedua agen; impor Ruang Simpan juga memeriksa kepemilikan file. PATCH tidak boleh memindahkan `agentId`. Agen sistem hanya dapat dimutasi admin. |
| KB pra-impor | POST `/api/knowledge-base/upload`, `/process-url` | Login; hanya upload/ekstraksi, belum mengikat ke agen. |

Taksonomi publik (`GET /api/taxonomy`) memuat struktur kategori, bukan teks KB. Mutasi kategori terpisah dari akses dokumen agen. Riwayat chat publik tidak boleh dipakai sebagai izin membaca sumber KB mentah.

Ekspor render eBook/eCourse/DocGen dari agen publik tetap bisa dibuka, tetapi sumber KB mentah hanya disertakan untuk pemilik/admin/kolaborator; untuk pengunjung lain daftar KB dikosongkan. Alat AI yang membaca KB berdasarkan `agentId` (`/api/ai/tender-doc`, `/api/ai/ekosistem-multiclaw`) memerlukan izin baca sumber sebelum mengambil konten. Fitur chat/DocGen interaktif publik tetap menggunakan jawaban agen sesuai pengaturan publikasinya, bukan izin untuk endpoint dump KB.