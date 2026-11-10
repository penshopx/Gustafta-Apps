---
name: Archive alias provenance
description: Distinguish an archive lookup alias from the age and trust of the original evidence.
---

An authorized archive custodian may assign a new opaque lookup alias to an existing original record. The alias may be new; the authenticated creation record must already have existed independently before review.

**Why:** Requiring every lookup alias to predate review would prevent safe migration away from free-text references. Conversely, treating a newly minted alias as evidence would allow fabricated records to pass as historical proof.

**How to apply:** When connecting or migrating an archive, prove the provenance and immutability of the original bytes independently of the alias. Keep the alias-to-location catalog access-controlled and separate from reviewer metadata; an alias must never serve as a bearer credential.

## Batas persetujuan pemulihan

Persetujuan pemulihan memori ditolak sepenuhnya hingga tersedia sumber arsip kejadian asli yang terautentikasi, independen, tidak dapat diubah (immutable), dan mengikat ID memori, agen, serta pengguna secara eksplisit. Jangan memproses, menyetujui, atau mengeksekusi pemulihan tanpa sumber yang memenuhi seluruh kriteria tersebut.

**Why:** Pengguna menegaskan keempat kriteria sebagai prasyarat pemulihan.

**How to apply:** Verifikasi sumber sebelum membuka persetujuan; merge perubahan kode tidak menggantikan bukti arsip yang valid.

## Makna sinyal gangguan arsip

Tidak adanya sinyal kegagalan bukan bukti arsip sehat atau adapter aktif. Telemetri gangguan hanya observasi operasional, bukan bukti provenance atau audit persetujuan.

**Why:** Mode karantina tanpa sumber tepercaya tidak melakukan pembacaan arsip. Menafsirkan penghitung nol sebagai kesiapan dapat membuka persetujuan tanpa bukti.

**How to apply:** Saat menghubungkan sumber dan membuat alarm operator, buktikan kesiapan sumber secara terpisah; jangan membuka akses berdasarkan penghitung nol. Klasifikasikan izin dari hasil otoritatif penyedia, bukan pencarian kata pada pesan error yang dapat berisi bukti privat.
