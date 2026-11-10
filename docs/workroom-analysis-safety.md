# Pengamanan analisis AI Workroom — tahap pertama

Lingkup perubahan ini hanya `POST /api/workrooms/:id/analyze`, bukan aktivasi
engine agen otonom. Analisis menghasilkan **draf deliverable**, bukan persetujuan
gate, perpindahan tahap, penyelesaian Workroom, atau tindakan eksternal.

Tahap berikutnya, [identitas eksekusi tersimpan](workroom-analysis-executions.md),
menambahkan `Idempotency-Key`, reservasi database, riwayat setelah restart,
dan pengakuan ketidakpastian. Rincian di bawah tetap berlaku untuk panggilan model.
[Batas harian pilot](workroom-analysis-budget.md) menambahkan kuota jumlah serta
cadangan estimasi per akun dan gabungan tanpa mengubah kuota chat.

## Sebelum memanggil model

- Sesi harus lolos autentikasi dan Workroom harus dimiliki akun tersebut.
- Snapshot harus aktif secara efektif dan tidak sedang dihapus.
- Revisi integer dan fingerprint yang dikirim browser harus cocok dengan snapshot.
- Semua sumber terikat harus tersedia dan dapat diverifikasi.
- Konteks berkas Ruang Simpan tidak otomatis dikirim: masukan model tetap judul
  dan isian konteks berbentuk string, seperti jalur analisis sebelumnya.
- Sistem menjelaskan bahwa isian kasus adalah data, bukan instruksi berwenang.
  Tidak ada daftar alat, akses shell/database, atau delegasi ke runtime eksternal.

Menjalankan analisis tidak memerlukan gate sudah disetujui: draf justru dibuat
untuk ditinjau manusia. Analisis tidak boleh menyetujui gate tersebut sendiri.

## Batas model

Kebijakan pilot berada di `shared/workroom-analysis-policy.ts`:

| Batas | Nilai |
|---|---|
| Penyedia/model yang diminta | OpenAI / `gpt-4o` — mempertahankan jalur sebelumnya |
| Percobaan SDK otomatis | 0 retry; satu panggilan per permintaan |
| Waktu panggilan model | 45 detik |
| Total karakter pesan sistem + pengguna | 16.000 |
| Token keluaran yang diminta | Maksimal 1.500 |
| Karakter keluaran yang diterima | Maksimal 24.000 |
| Jumlah butir per daftar hasil | Maksimal 10 |

Waktu di atas hanya panggilan model; pembacaan/verifikasi sumber dan penyimpanan
database berada di luar waktu tersebut. Batas karakter/token **bukan** kuota harian,
jaminan biaya rupiah, atau pembatasan agregat lintas pengguna/replica.

SDK dan pembatas waktu lokal sama-sama digunakan. Jika provider mengabaikan
AbortSignal, hasil yang datang setelah pembatas waktu sudah menolak permintaan
tidak diteruskan ke penyimpan. Tidak ada fallback ke Claude, NVIDIA, Gemini,
DeepSeek, atau model lain. Key dan kebijakan data penyedia tidak diubah.

## Keluaran dan penyimpanan

- JSON harus lengkap, tidak terpotong, dan sesuai skema. Skor harus 0–100,
  jenis field harus tepat, panjang teks dibatasi, dan field tambahan ditolak.
- Refusal, tool call, JSON rusak, struktur salah, atau keluaran terlalu panjang
  ditolak. Tidak ada fallback menyimpan `{ raw: ... }`.
- Bentuk yang valid bukan jaminan kebenaran faktual; tinjauan manusia tetap wajib.
- Saat menyimpan, parent dikunci. Pemilik, tahap saat ini, status efektif,
  status penghapusan, sumber, dan token tinjauan diperiksa kembali.
- Perubahan konteks/hasil/revisi selama panggilan menolak hasil lama. Reservasi
  database juga menahan permintaan paralel agar tidak memulai dua panggilan
  model aktif pada Workroom/pemilik yang sama.
- Metadata sukses mencatat ID eksekusi acak, model yang diminta, versi kebijakan,
  waktu mulai, aktor, tahap, dan tinjauan asal. Catatan biasa tidak dapat
  memalsukan penanda eksekusi resmi.
- Hasil, metadata, pembatalan persetujuan lama akibat deliverable baru, dan
  pembukaan ulang status lama dilakukan dalam transaksi yang sama.
- Error provider/database yang tidak dikenal tidak diteruskan mentah kepada
  pengguna. Tidak ada key, prompt lengkap, atau respons mentah dalam audit sukses.

## Menghentikan permintaan

Tombol **Hentikan permintaan**, keluar dari halaman, atau koneksi HTTP yang
terputus mengirim/memicu pembatalan. Server memeriksa sinyal sebelum panggilan
model dan pada jalur penyimpanan, termasuk sebelum transaksi dikomit.

Penghentian provider tetap **best-effort**, meskipun status eksekusi kini disimpan:

- Provider mungkin sudah memproses/menagihkan panggilan.
- Pembatalan tidak membatalkan hasil yang sudah dikomit sebelum sinyal teramati.
- Kehilangan koneksi saat commit dapat membuat hasil tidak diketahui klien.

UI tidak menyatakan sukses saat fetch dibatalkan dan memuat ulang riwayat.
Pesan meminta pengguna memeriksa riwayat sebelum mengulang secara manual.

## Yang belum dijamin

Reservasi, idempotency key, dan cadangan estimasi harian sekarang tersedia,
tetapi belum ada antrean worker yang melanjutkan pekerjaan otomatis, pengukuran
invoice aktual, atau jaminan membatalkan pemrosesan/tagihan provider. Status pekerjaan setelah
proses mati dapat diperiksa; panggilan yang tidak jelas tidak diulang otomatis.
Autentikasi sesi berjalan di pintu masuk; pemeriksaan pemilik saat tulis bukan
pemeriksaan ulang seluruh status akun/izin penyedia di tengah panggilan.

Ini belum kontrak terpadu semua AI Gustafta. Chat harian, builder Claude,
OpenClaw/Hermes, tool eksternal dan izin lintas aplikasi tidak diubah.

## Verifikasi

```sh
bash scripts/test-workroom-gates.sh
node node_modules/typescript/bin/tsc -p tests/workroom-gates.tsconfig.json
node node_modules/vitest/vitest.mjs run tests/workroom-gates.vitest.tsx tests/workroom-sources.vitest.tsx tests/workroom-versions.vitest.tsx
```

Tes mengeksekusi rute produksi dengan identitas fixture, PostgreSQL disposable,
dan provider tiruan. Ada pengujian penolakan sebelum panggilan, JSON invalid,
batas waktu, pembatalan koneksi, rollback tulis, perubahan pemilik/tahap/status/
konten saat model berjalan, serta dua permintaan paralel. Tidak memanggil model
berbayar, menyalin dokumen pengguna, atau menyentuh database aplikasi nyata.
