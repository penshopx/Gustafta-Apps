# Kontrak Integrasi SIGAP — Usulan yang Dapat Diuji

Status: kontrak target. Contoh endpoint/schema bukan klaim route live.

## 1. Compatibility dan registry

Endpoint baru direkomendasikan `/api/v1/...`; adapter mencatat base URL dan path aktual aplikasi lama yang memakai `/v1`. Jangan mengganti route publik atau format error aplikasi yang sudah ada tanpa versi dan migrasi konsumen.

Kontrak Ruang Simpan saat ini terpisah dari kontrak SIGAP target:

- Profil: `/api/v1/ruang-simpan/company-profile`.
- Scope `profile:read` hanya membaca profil pemilik koneksi.
- Header respons privat: `Cache-Control: private, no-store` dan `X-Gustafta-RS-Contract: rs-app-v1-private-no-store`.
- Token/scope yang ada tidak otomatis dimigrasikan ke OAuth/JWT hanya karena spesifikasi SIGAP mengusulkannya.
- Auth SBU lokal harus membatasi pengguna yang boleh membaca profil perusahaan terkonfigurasi. Keberhasilan token server tidak membuktikan izin semua pengguna SBU.

Registry capability menyimpan implemented/tested status per route/tool/event, tanggal tes, evidence_ref, auth method, compatibility version dan owner. URL contoh `lsbu.co.id` pada sumber tidak dianggap domain operasional yang telah tersedia.

## 2. Autentikasi dan otorisasi

Client credentials/OAuth2 adalah pilihan target untuk app-to-app setelah identity authority disepakati. Jangan membuat issuer berbeda pada setiap aplikasi tanpa trust model.

Jika JWT digunakan, verifikasi signature, algoritma allowlist, issuer, audience, expiry/not-before, key ID, client status, revocation policy dan clock skew. Token audience terikat aplikasi; service identity terikat tenant/project grant. Kredensial per role-app-environment, bukan satu token semua tenant.

Otorisasi wajib memeriksa:

```text
client/user aktif
AND koneksi aktif
AND audience/app benar
AND tenant diizinkan
AND project membership/grant sesuai
AND action scope eksplisit
AND field/document grant sesuai
AND policy bisnis dan status objek mengizinkan
```

Scope `read` tidak mencakup semua field, dokumen atau tenant. Hindari wildcard produksi seperti `*:read` dan `smap.*:read`; enumerate resource/field yang diberikan. Whistleblowing content dilarang bagi agen umum, termasuk dashboard agregasi, vector index, log dan event payload.

`X-Actor` atau field `by` tidak menentukan identitas. Server mendapatkan pelaku dari token/sesi. Jika on-behalf-of diperlukan, gunakan delegated proof terverifikasi, grant terbatas dan audit actor+delegator; header plaintext tidak cukup.

## 3. Data dan HTTP

- Internal ID opaque stabil (misalnya UUID); kode `PRJ-YYYY-NNN` untuk tampilan dan mapping, bukan pembatas kapasitas atau sumber hak akses.
- Tenant/project context wajib dan dicek server, tidak dipercaya dari body saja.
- Waktu timestamp UTC atau ISO-8601 ber-offset; simpan timezone proyek untuk deadline/cutoff. Date-only digunakan untuk tanggal bisnis.
- Kuantitas/koefisien/tarif memakai decimal string atau numeric decimal, unit dan precision eksplisit. Nilai final rupiah mengikuti rounding rule versi; no JavaScript float untuk kalkulasi finansial.
- Optimistic concurrency memakai integer `revision` dan atomic conditional update. Revision berubah setiap mutasi material.
- Body limit pra-parse, input schema strict, pagination bounded, timeouts dan rate limits per principal/tenant sesuai beban.
- Status: 401 identitas tidak valid; 403 tidak berizin; 404 sesuai policy concealment; 409 revision/idempotency conflict; 422 aturan bisnis; 429 rate limit; 503 dependency tidak tersedia.
- `application/problem+json` untuk kontrak baru; route legacy boleh mempertahankan JSON existing melalui adapter.
- Semua respons privat termasuk penolakan, unduhan dan error: `Cache-Control: private, no-store` sebelum auth/rate limiting.

Contoh error target:

```json
{
  "type": "urn:sigap:error:revision-conflict",
  "title": "Objek berubah sejak ditinjau",
  "status": 409,
  "detail": "Muat ulang objek dan ajukan persetujuan untuk revisi terbaru.",
  "trace_id": "trace-opaque",
  "retryable": false
}
```

Jangan memasukkan token, isi dokumen privat atau detail internal SQL dalam error.

## 4. Draf dan approval state machine

```text
draft -> pending_approval -> approved -> execution_pending -> executed
                           -> rejected
                           -> expired
                           -> superseded (revision/bukti/policy berubah)
execution_pending -> failed_retryable / failed_manual_review
```

Approval harus mengikat:

```json
{
  "approval_id": "opaque",
  "tenant_id": "tenant-opaque",
  "project_id": "project-opaque",
  "object": {
    "app_id": "procure",
    "type": "purchase_order",
    "id": "po-opaque",
    "revision": 3,
    "payload_hash": "sha256-of-canonical-approved-fields"
  },
  "evidence_refs": [
    {"id": "quote-opaque", "revision": 2, "checksum": "sha256"}
  ],
  "policy_id": "procurement-policy",
  "policy_version": 2,
  "required_roles": ["project_manager"],
  "expires_at": "2026-10-10T10:00:00Z",
  "state": "pending_approval"
}
```

Canonical payload hashing harus memiliki field list dan normalization/version yang ditentukan. Perubahan harga/item/penerima, bukti terkait atau policy yang memengaruhi keputusan meng-invalidasi approval.

Keputusan manusia lewat sesi terverifikasi:

```text
POST /api/v1/approvals/{id}/decision
Idempotency-Key: opaque-client-generated-key
```

```json
{"decision":"approved","expected_revision":3,"note":"Sesuai hasil review."}
```

Server menetapkan approved_by dan waktu; memeriksa entitlement saat keputusan serta saat execution. Agen tidak memiliki decision scope. Tombol WA/Telegram membawa deep link/login atau challenge sekali pakai terikat approver/objek/action/expiry; bukan persetujuan siapa saja yang menerima forwarded message.

Segregasi tugas: maker tidak mengesahkan transaksi sendiri pada domain yang memerlukan checker. Approval nilai menggunakan nilai kumulatif dan transaksi terkait untuk mencegah split PO. Timeout atau approver tidak tersedia tidak berarti approved.

Eksekusi otomatis hanya boleh dilakukan executor aplikasi terhadap aksi yang memang disahkan policy, setelah approval valid dan kondisi terakhir diperiksa ulang. Transfer dana, tanda tangan, atau keputusan keselamatan tidak menjadi hak agen generik.

## 5. Idempotensi dan simulasi

Untuk mutasi agen (POST/PUT/PATCH dan DELETE jika tersedia), key disimpan dengan tenant, client, route, normalized-request hash, state, response reference, expiry dan business operation ID.

- Key sama + payload sama: hasil operasi yang sama, tidak efek kedua.
- Key sama + payload berbeda: 409.
- Concurrent same key: unique constraint/lock; hanya satu efek bisnis.
- Ambiguous timeout: query operation status atau retry key yang sama, bukan membuat key baru.
- TTL harus mencakup retry/offline window; aturan unik business operation tetap mencegah duplikasi setelah key record expired.
- Reauthorization tetap dilakukan saat replay; jangan replay response privat setelah akses dicabut.

`dry_run=true` menjalankan auth dan validasi tanpa commit, outbox, email, WA, debit, reservation, file persistence atau efek eksternal lain. Simulasi tidak memberikan jaminan kapasitas/budget masih tersedia saat execution; validasi ulang dalam transaksi.

## 6. Event CloudEvents, HMAC dan reliability

```json
{
  "specversion": "1.0",
  "id": "event-opaque",
  "source": "urn:sigap:app:procure",
  "type": "id.sigap.procure.goods.accepted.v1",
  "subject": "receipt/receipt-opaque",
  "time": "2026-10-09T03:00:00Z",
  "datacontenttype": "application/json",
  "tenantid": "tenant-opaque",
  "projectid": "project-opaque",
  "traceid": "trace-opaque",
  "data": {
    "receipt_id": "receipt-opaque",
    "revision": 4,
    "acceptance_ref": "qc-opaque"
  }
}
```

Gunakan satu namespace registry. Event observation/proposed berbeda dari accepted/issued/posted. `progress.accepted`, bukan `progress.updated` yang ambigu; `qaqc.ncr.opened`, bukan Project sebagai penerbit NCR final. Event tender won membuat **draf** dependency, bukan mengesahkan kontrak/jaminan.

Pengirim webhook:

```text
X-Sigap-Key-Id: key-version
X-Sigap-Timestamp: unix-seconds
X-Sigap-Delivery: delivery-uuid
X-Sigap-Signature: sha256=<hex>
signature = HMAC_SHA256(key, timestamp + "." + delivery_id + "." + raw_body)
```

Penerima memakai raw bytes sebelum parsing, constant-time comparison, timestamp window contoh ±5 menit sesuai policy, unique `(source,event_id)` dan delivery record. Delivery replay ditolak; pengiriman ulang sah membuat delivery ID/timestamp baru dengan event ID tetap. Auth producer diperiksa against tenant/source allowlist, bukan percaya tenantid dari payload.

Alur durable:

1. Transaksi domain + outbox ditulis atomik.
2. Worker claim dengan lease, retry/backoff/jitter dan attempt count.
3. Penerima verifikasi lalu menyimpan inbox sebelum acknowledge.
4. Consumer menerapkan efek dan menandai processed secara atomik/idempoten.
5. Poison event -> DLQ; schema mismatch tidak dibuang diam-diam.
6. Replay dilakukan operator dengan izin, alasan dan audit; rekonsiliasi membandingkan revision/domain state.

Urutan tidak dijamin global. Gunakan object revision/sequence untuk mendeteksi event tua atau gap; fetch state resmi bila perlu. Outbox mengurangi risiko kehilangan, tidak menghapus kemungkinan kegagalan permanen. Monitor backlog age, failed deliveries, DLQ dan reconciliation drift.

429/5xx/network transient dapat retry bounded; 401/403 berhenti sampai konfigurasi/izin diperbaiki; 409 perlu rekonsiliasi; 422 perlu keputusan proses. Side effect eksternal yang hasilnya ambigu masuk manual review jika provider tidak memiliki idempotency/status proof.

## 7. MCP bukan pengganti otorisasi

REST adapter diprioritaskan; MCP opsional untuk runtime yang membutuhkannya. Tool mengikuti auth API yang sama, bukan jalur privileged kedua.

Contoh metadata:

```json
{
  "name": "procure_create_purchase_request_draft",
  "description": "Membuat draf MR; tidak menyetujui atau menerbitkan PO.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["project_id", "items"],
    "properties": {
      "project_id": {"type": "string"},
      "items": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["material_id", "quantity", "uom"],
          "properties": {
            "material_id": {"type": "string"},
            "quantity": {"type": "string", "pattern": "^[0-9]+([.][0-9]+)?$"},
            "uom": {"type": "string"}
          }
        }
      }
    }
  },
  "annotations": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false,
    "openWorldHint": false
  }
}
```

Validasi bisnis tetap mensyaratkan quantity >0, satuan valid, precision dan batas nilai. Hint idempotent false di contoh karena input tidak mendefinisikan operation key; adapter harus menyediakan idempotency key stabil untuk retry. Hint hanyalah metadata, bukan proof keamanan. Approval requirement tercatat dalam policy registry/extension vendor, lalu ditegakkan server.

Metadata/output tool dan dokumen eksternal tidak dipercaya sebagai instruksi. Prompt injection tidak boleh menambah grant, memilih arbitrary URL, membaca secret, atau membuat aksi final.

## 8. Offline, dokumen dan privasi

- Offline boleh capture observation/draft; approval, accepted stock/progress/payroll tidak final sebelum server menerima.
- Queue lokal menyimpan operation ID/revision; reauth dan recheck izin sebelum sync; konflik masuk review, bukan last-write-wins pada uang/stok.
- PWA service worker tidak men-cache API privat; browser lokal hanya menyimpan data minimal dengan TTL/clear-on-logout, revoked-state handling dan shared-device policy.
- File upload memiliki limit, allowlist type, malware checks bila diperlukan, checksum dan tenant isolation.
- Presigned URL pendek, operation/resource-bound, tidak dicatat ke analytics/log; server memeriksa grant sebelum menerbitkan. Folder grant mengikuti policy aktual, bukan snapshot izin seumur hidup.
- Memori/vector retrieval menerapkan filter izin sebelum pengambilan konteks; log prompt tidak otomatis menyimpan dokumen mentah/PII.
- Audit append-only untuk role aplikasi, akses operator terbatas, backup/protected export dan pemeriksaan integritas. “Tidak bisa dihapus” bukan klaim absolut terhadap DB administrator.
- Retensi/tombstone/redaction mengikuti kebijakan dan kewajiban hukum; audit tidak menjadi alasan menyimpan seluruh PII tanpa batas.

## 9. Skenario penerimaan integrasi

| Uji | Hasil wajib |
| --- | --- |
| Tanpa token/malformed/expired/revoked | 401 JSON; private no-store |
| Token tanpa action scope | 403; tidak ada efek |
| Tenant A menebak objek/proyek B | Ditolak; metadata, dokumen, event, memory tidak bocor |
| Pengguna SBU tanpa explicit company permission | Ditolak di SBU sebelum fetch profil perusahaan |
| Header X-Actor/body by dipalsukan | Tidak mengubah actor server; approval ditolak bila unauthorized |
| Approval revision 3, objek berubah revision 4 | 409/superseded; tidak execution |
| Dua keputusan/dua execution serentak | Satu hasil legal; audit lengkap; tidak efek ganda |
| Key sama, request berbeda | 409 |
| Webhook bad signature/stale/delivery replay | Ditolak sebelum business processing |
| Event duplikat/out-of-order | Tidak saldo ganda; revision reconcile |
| Worker mati setelah external call | Retry/status check atau manual review; bukan aksi ganda diam-diam |
| Dry-run | Tidak data/outbox/file/email/WA/reservation berubah |
| Offline sync setelah revoke | Ditolak; data lokal tidak menjadi final |
| AI/HUB down | Aplikasi domain tetap berjalan; jalur manual dan alarm darurat tersedia |
| Restore | RPO/RTO yang disetujui terbukti lewat drill, bukan sekadar backup tersedia |

Paket dokumen tidak menjalankan skenario tersebut terhadap semua aplikasi. Bukti test harus ditambahkan per capability sebelum status “pilot diterima”.
