# Pemulihan penanda AGENT-NOTION LexSkripsi

Penanda lama dapat menunjuk ID orchestrator yang sudah tidak ada. Jangan hapus
penanda atau pindahkan dokumen Notion berdasarkan nomor ID lama. Startup sengaja
menolak penanda itu agar tidak menghubungkan agen yang salah.

1. Jalankan `npx tsx scripts/review-lexskripsi-notion-marker.ts`. Perintah ini
   **hanya membaca**: tampilkan ID penanda, pemilik sekarang (atau `null` bila
   yatim), orchestrator dan seri terverifikasi, ID agen Notion historis dari isi
   penanda, serta dua judul/ID dokumen historis. Cocokkan dengan riwayat
   operasional sebelum menyetujui perubahan.
2. Hanya untuk kasus ketika **kedua** agen lama sudah tidak ada, kedua dokumen
   historis cocok, tidak ada kandidat Notion/relasi yang bertentangan, dan
   orchestrator berada pada seri LexSkripsi yang benar, jalankan:

   `npx tsx scripts/review-lexskripsi-notion-marker.ts --apply <marker-id> <old-owner-id> <orchestrator-id> <historical-notion-id>`

   Gunakan keempat angka dari laporan yang sudah diperiksa, bukan dari contoh
   atau tebakan. Perintah akan mengulang pemeriksaan dan mengunci seri bersama
   dengan startup sebelum memindahkan **hanya penanda**; isi lama dipertahankan
   sebagai catatan asal. Jika salah satu bukti berubah, perintah gagal tanpa
   menulis. Jika pemilik lama masih ada atau kandidat ambigu, investigasi
   manual diperlukan; jangan paksa mode apply.
3. Jalankan ulang startup. Patch AGENT-NOTION akan membuat agen dan dokumen
   baru bila perlu serta menghubungkan orchestrator terverifikasi. Jalankan
   perintah diagnosis lagi dan pastikan `markerOwnerId` sama dengan
   `orchestratorId`, `currentNotionId` terisi, `linked` bernilai `true`,
   dan log patch menyatakan
   identitas/penanda terverifikasi. Dua dokumen yang menunjuk ID agen lama
   dibiarkan sebagai bukti historis, bukan dijadikan sumber agen baru.