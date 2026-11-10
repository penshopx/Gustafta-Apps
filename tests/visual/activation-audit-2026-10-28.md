# Aktivasi required visual check — 28 Oktober 2026

Repositori: [`penshopx/landing-page`](https://github.com/penshopx/landing-page), branch `main`.

## Persetujuan dan urutan tindakan

- Pengelola mengizinkan merge PR #2, setelah sebelumnya membatasi pekerjaan pada persiapan/tinjauan PR.
- Sebelum merge, keberadaan `NOTIFY_WEBHOOK_KEY` sebagai Secret produksi diperiksa tanpa membaca nilainya. Pengelola mengonfirmasi pengirim webhook sudah memakai kunci baru. Tidak dilakukan pengiriman notifikasi uji atau verifikasi langsung pencabutan kunci pada runtime lama.
- Ketiga check PR #2 pada revisi `6b654b7933ac7e0e150db0104db2828a0cfa2e86` berstatus sukses sebelum merge.
- [PR #2](https://github.com/penshopx/landing-page/pull/2) digabungkan dengan pemeriksaan SHA head, menghasilkan commit `5a453f741465a1ca55842d009512e9091b20f044`. Workflow visual, skrip, tes kontrak, fixture, manifest, dan delapan PNG referensi diverifikasi tersedia di `main` sebelum aturan diaktifkan. Check sungguhan pada commit main mengidentifikasi GitHub Actions sebagai aplikasi `15368`.
- Tidak dilakukan deployment, perubahan baseline/ambang visual, atau pengujian terhadap database aplikasi.

## Konfigurasi sebelum dan sesudah

Audit ulang sebelum aktivasi:

- Perlindungan branch klasik: HTTP 404, `Branch not protected`.
- Ruleset repositori termasuk induk: `[]`.
- Aturan efektif `main`: `[]`.

Satu-satunya perubahan adalah penambahan [ruleset 26010672](https://github.com/penshopx/landing-page/rules/26010672), bernama `Main public application visual gate`:

```json
{
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [{
    "type": "required_status_checks",
    "parameters": {
      "required_status_checks": [{
        "context": "Public application visual gate",
        "integration_id": 15368
      }],
      "strict_required_status_checks_policy": false,
      "do_not_enforce_on_create": false
    }
  }]
}
```

Konfigurasi disimpan lalu dibaca ulang dari API ruleset dan `/rules/branches/main`. Hasil efektif menunjuk ruleset dan check/provider yang sama. `current_user_can_bypass` untuk aktor koneksi GitHub adalah **`never`**, dengan daftar bypass kosong. Tidak ada aturan review, push, force-push, penghapusan, required check lain, atau bypass lama yang diganti. Kebijakan branch terbaru/strict tidak ditambahkan; gate ini tidak menjanjikan pengujian ulang otomatis setiap kali base branch bergerak.

## Bukti gagal dan pemblokiran

[PR uji #3](https://github.com/penshopx/landing-page/pull/3) dibuat non-draft dari commit main di atas. Hanya `client/src/index.css` yang diubah, dengan inversi warna yang disengaja. Baseline, checksum referensi, workflow, dan pembanding tidak diubah. PR diberi penanda **DO NOT MERGE**.

Revisi gagal: `ae8b53fbc3110790819f8a701b230880be373299`.

| Check pada revisi gagal | Hasil | Bukti |
| --- | --- | --- |
| Public application visual gate | **failure** | [Job visual gagal](https://github.com/penshopx/landing-page/actions/runs/40632104814/job/122630624548) |
| Run test suite | success | [Job tes umum](https://github.com/penshopx/landing-page/actions/runs/40632104762/job/122630624067) |
| Detect leaked secrets | success | [Job pemindaian secret](https://github.com/penshopx/landing-page/actions/runs/40632104772/job/122630624139) |

Pemasangan dependensi, pemeriksaan modul, penyiapan browser/font, tes kontrak dan uji fixture negatif berhasil. Kegagalan terjadi pada langkah **Build, start application frontend and compare reviewed references**, bukan karena instalasi, decoding gambar, atau browser gagal berjalan. Log pembandingan mencatat:

| Gambar | Piksel berubah |
| --- | ---: |
| beranda-desktop | 99,97% |
| kontraktor-desktop | 99,99% |
| prose-desktop | 99,99% |
| ring-desktop | 99,99% |
| beranda-mobile | 99,99% |
| kontraktor-mobile | 100,00% |
| prose-mobile | 99,99% |
| ring-mobile | 99,95% |

Proses keluar dengan kode **1** dan unggahan artefak visual berhasil.

Sebelum pemulihan, API PR menunjuk tepat ke revisi gagal tersebut:

- REST: `mergeable: true`, `mergeable_state: "blocked"`, `merged: false`.
- GraphQL: `mergeable: MERGEABLE`, `mergeStateStatus: BLOCKED`, status rollup commit `FAILURE`.
- Ruleset: aktif, tanpa bypass, `current_user_can_bypass: never`.

Dengan demikian tidak ada konflik yang menjelaskan blokir; required visual check gagal untuk aktor tanpa bypass. Tes umum dan pemindaian secret pada revisi gagal akhirnya sama-sama sukses. Bukti ini berasal dari status GitHub dan aturan efektif, bukan sekadar hasil tes lokal. **Tidak dilakukan percobaan API merge pada PR uji**, agar salah konfigurasi tidak berisiko menggabungkan perubahan buruk.

## Pemulihan dan pembersihan

- CSS dikembalikan tepat ke blob asli `fa9b3615e9a39c794c5f6905159dfed5150c084c`.
- Revisi pemulihan: `b55472dab8c3588bedfaaa9e2cbdfe41f90db968`.
- Perbandingan commit main dengan revisi pemulihan menunjukkan **nol berkas berubah**, dengan dua commit uji dalam riwayat. Bukan pembaruan baseline atau pelonggaran toleransi.
- [Public application visual gate pada revisi pemulihan](https://github.com/penshopx/landing-page/actions/runs/40632701013/job/122632534343) **success**; langkah pembandingan aplikasi asli selesai sukses pada `2026-10-28T04:33:12Z`.
- [Pemindaian secret revisi pemulihan](https://github.com/penshopx/landing-page/actions/runs/40632701136/job/122632535085) juga sukses. [Tes umum revisi pemulihan](https://github.com/penshopx/landing-page/actions/runs/40632700980/job/122632534002) masih berjalan pada snapshot penutupan `2026-10-28T04:36:49Z`; tidak diklaim lulus dalam snapshot tersebut.
- PR #3 dibaca ulang setelah ditutup: **`state: closed`, `merged: false`**, head sesuai revisi pemulihan. Tidak ada pemanggilan merge untuk PR uji.
- [Komentar bukti di GitHub](https://github.com/penshopx/landing-page/pull/3#issuecomment-6460778382) menyimpan tautan kegagalan, status blokir, dan hasil pemulihan sebelum penutupan.

Ketiga check commit main hasil merge sudah sukses saat penutupan:

- [Public application visual gate](https://github.com/penshopx/landing-page/actions/runs/40632000122/job/122630288231).
- [Run test suite](https://github.com/penshopx/landing-page/actions/runs/40632000134/job/122630287974).
- [Detect leaked secrets](https://github.com/penshopx/landing-page/actions/runs/40632000120/job/122630287996).

## Batas jaminan

- Gate memblokir merge biasa ke `main` untuk check visual yang hilang, belum selesai, atau gagal. Aturan ini hanya menambahkan check visual, bukan menjadikan semua check lain wajib.
- Tidak ada bypass terdaftar pada ruleset ini, termasuk untuk aktor yang dipakai selama pembuktian. Namun pihak berhak administrasi tetap dapat mengubah/nonaktifkan aturan atau menambahkan bypass. Bukti ini tidak menjanjikan ketahanan terhadap perubahan kebijakan oleh administrator.
- Gambar referensi, manifest, skrip pembanding dan workflow tetap memerlukan tinjauan; required check saja bukan aturan persetujuan independen untuk perubahan file-file itu.
- Deployment dari Replit/workspace, CLI, layanan lain, atau kode yang tidak melalui PR terlindungi **tidak dikunci oleh ruleset GitHub ini**. Run `push` ke main hanya mendeteksi masalah setelah push.
- Tidak ada deployment atau pengujian notifikasi langsung dalam aktivasi ini. Penghapusan kredensial dari konfigurasi Git tidak menghapus salinan dari riwayat/log atau membuktikan semua runtime lama sudah mencabutnya.
