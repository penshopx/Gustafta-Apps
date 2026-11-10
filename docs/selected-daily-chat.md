# Pilihan model chat harian

## Cara pakai

Pada pengaturan agen **Persona → Model chat harian**, pilih provider lalu simpan
melalui mekanisme penyimpanan pengaturan yang sudah ada. Editor konfigurasi
MultiClaw memakai pilihan yang sama. Membuka menu tidak mengubah agen atau
menguji provider. Tidak ada migrasi massal atau perubahan model bawaan global.

Pilihan baru:

| Provider | Model |
| --- | --- |
| OpenAI | `gpt-4o-mini` |
| DeepSeek | `deepseek-chat` |
| NVIDIA | `nvidia/llama-3.3-nemotron-super-49b-v1` |
| Google | `gemini-2.5-flash` |

Claude tetap menjadi jalur penyusunan/perbaikan otak atau system prompt, bukan
pilihan chat harian baru pada kedua editor ini. Konfigurasi lama, termasuk
Claude/custom/Qwen, tetap dapat dipertahankan; backend tetap menerima ID lama
untuk kompatibilitas. Kebijakan ini bukan pelarangan global atas API lama.

## Kegagalan dan biaya

Pilihan baru menggunakan tepat satu provider, model dan endpoint yang dipatok
server, dengan key platform untuk provider tersebut. Tidak memakai key custom
agen atau key provider lain sebagai pengganti. UI tidak meminta/menerima key.

- Tidak ada fallback provider atau retry SDK otomatis pada jalur pilihan baru.
- Key tidak tersedia, HTTP error, respons kosong, timeout atau stream terputus
  menghasilkan kegagalan yang aman, tanpa menampilkan diagnostik provider.
- Deadline HTTP maksimal 45 detik. Terputusnya koneksi klien membatalkan request
  chat yang sedang dikelola. Pembatalan bukan jaminan provider membatalkan biaya.
- Partial stream boleh sudah terlihat, tetapi stream yang gagal tidak disimpan
  sebagai jawaban assistant sukses dan tidak diteruskan ke provider lain.
- Pilihan NVIDIA/DeepSeek dalam katalog ini untuk pesan teks. Gambar tidak
  dialihkan otomatis ke GPT; pengguna perlu memilih model yang sesuai.
- Jika batas model murah mitra tidak cocok dengan pilihan baru, request ditolak
  alih-alih diam-diam mengganti provider/model atau melewati pembatasan mitra.
- Kredit, kuota, harga dan ketersediaan tetap mengikuti provider. NVIDIA bukan
  jaminan gratis tanpa batas. Menu tidak menjamin kredensial/kredit masih valid.
- Ini kebijakan provider respons chat, **bukan cap tagihan seluruh aplikasi**.
  Embedding/RAG, alat, delegasi ke agen lain, dan analisis native Workroom tetap
  memiliki jalur tersendiri. Batas pilot Workroom tidak otomatis mencakup chat.
- Ini bukan idempotensi chat atau jaminan exactly-once biaya. Pengiriman ulang
  oleh pengguna dapat menjadi panggilan baru dan menimbulkan biaya baru.

## Kompatibilitas dan cakupan

Pilihan baru memakai ID opt-in dalam kolom teks `ai_model` yang sudah ada.
Tidak ada kolom/tabel baru atau DDL. ID tersebut diterjemahkan menjadi model
provider yang sebenarnya; ID internal bukan nama model untuk dikirim langsung
ke API eksternal.

ID lama mempertahankan routing/fallback sebelumnya sampai pemilik secara
eksplisit memilih dan menyimpan konfigurasi baru. Unknown ID pada namespace
pilihan baru gagal tertutup, tidak masuk ke routing lama.

Dispatch diterapkan ke chat non-stream, SSE, pemanggilan sub-agen, dan helper
respons kanal eksternal. Tiga pembuat materi terjadwal yang sebelumnya membaca
model agen juga mengenali ID baru agar tidak mengirim ID internal ke OpenAI atau
membutuhkan key OpenAI ketika memilih provider lain. Jadwal mereka tidak diubah;
tidak ada pekerjaan terjadwal baru.

Pengaturan brain builder Claude dan fallback Claude melalui OpenRouter tidak
diubah; itu jalur terpisah dari chat harian. Analisis Workroom juga tetap memakai
model dan estimasi anggarannya sendiri.

## Verifikasi

`npm run check:selected-daily-chat` memeriksa tipe suite.
`npm run test:selected-daily-chat` menjalankan tes SDK/routing dan komponen React.
SDK sungguhan memakai fetch fixture sepenuhnya; tidak membaca key asli,
memanggil provider berbayar, atau mengubah database aplikasi.

Tes mencakup endpoint/model/key-name keempat provider, retry 503 dinonaktifkan,
stream berhasil/terputus, respons kosong, pembatalan/deadline, batas mitra,
gambar, namespace tak dikenal, cabang produksi dan generator terjadwal,
pelestarian model lama, serta pemilihan eksplisit di UI.

Referensi kontrak provider:
- NVIDIA: https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_3-nemotron-super-49b-v1
- Gemini OpenAI-compatible: https://ai.google.dev/gemini-api/docs/openai

Tes ini bukan verifikasi live atas validitas key atau sisa kredit.
