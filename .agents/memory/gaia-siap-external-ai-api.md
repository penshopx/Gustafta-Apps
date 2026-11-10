---
name: Gaia SIAP external AI API
description: Kontrak & keputusan desain POST /api/v1/ai/assist (server-to-server, Bearer GAIA_SIAP_API_KEY)
---

- External AI harus tetap berupa endpoint server-to-server JSON terpisah dari chat/session; jangan mengekspos mesin chat publik sebagai substitusi.
- **Fail-closed by design:** tanpa env `GAIA_SIAP_API_KEY` semua request → 503 `service_not_configured`. Jangan pernah membuat key default/dummy.
- Auth harus fail-closed, memakai perbandingan constant-time, dan tidak pernah memiliki credential default.
- Reuse router dan gerbang beban existing, bukan jalur chat atau dialog publik.
- **Why:** ChatGPT (arsitek bisnis) menetapkan Gaia SIAP = client resmi, bukan user menyamar agen publik; endpoint harus stabil & terpisah dari chat engine.
- Guard ukuran body harus berupa parser route-scoped, bukan cek Content-Length; transfer chunked tanpa header panjang tetap harus dibatasi sebelum parser global.
- Error handler global tidak boleh log err.body (body-parser menaruh RAW BODY di err.body pada JSON rusak → bocor prompt ke log). Sudah disanitasi di server/index.ts.
- Rate limit harus per credential dengan hash bucket (jangan simpan API key mentah), shared lintas instance, dengan fallback lokal bila store bersama gagal.
- Respons AI tidak boleh masuk logger body generik bahkan di development; endpoint hanya mencatat metadata yang sudah disanitasi.
