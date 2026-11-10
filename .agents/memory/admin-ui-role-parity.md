---
name: Admin UI role parity
description: Effective admin access can differ from the user's stored role.
---

Gerbang UI untuk fitur admin harus membaca izin efektif dari pemeriksaan admin server, bukan hanya role yang tersimpan pada profil pengguna.

**Why:** Admin dapat diberi izin melalui konfigurasi email/ID sementara role tersimpan tetap "user". Mengandalkan profil membuat admin sah ditolak di layar walaupun endpoint menerimanya.

**How to apply:** Saat menambah tautan atau layar admin, gunakan hasil pemeriksaan izin admin yang sama dengan panel admin utama; tetap tegakkan otorisasi di endpoint.
