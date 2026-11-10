---
name: PUB companion Repl
description: Identitas Repl eksternal yang menjadi aplikasi PUB dan titik pengujian integrasi Gustafta.
---

Aplikasi PUB berada di Repl terpisah bernama `sustainable-construction-buddy`.

**Why:** Nama Repl tidak mengandung “PUB”, sehingga mudah tertukar dengan proyek konstruksi lain milik pengguna.

**How to apply:** Untuk probe competency recommendations, konfigurasi Supabase Edge Function, atau pemeriksaan `source: connected`, arahkan pekerjaan ke Repl `sustainable-construction-buddy`, bukan `KonstruksiAI`.

Kontrak production `pub-siap-v1` telah terverifikasi end-to-end melalui Supabase Edge Function: autentikasi dan rekomendasi berhasil, health admin melaporkan `connected`, dan jalur tanpa autentikasi/otorisasi ditolak.