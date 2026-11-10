# Keunikan slug kategori

Slug kategori memakai **satu namespace global**, bukan per induk atau jenjang.
Kategori nonaktif tetap memiliki slugnya sehingga pengaktifan kembali tidak
membuat rujukan ambigu. PostgreSQL membandingkan `lower(btrim(slug))`; form/API
baru hanya menerima huruf kecil, angka, dan tanda hubung.

Migrasi `0031_taxonomy_slug_unique.sql` juga dijalankan sebelum rute tersedia
saat startup. Seluruh perbaikan dan pembuatan indeks berada dalam satu pernyataan
atomik yang mengunci penulisan kategori. Bila gagal, startup berhenti; tidak ada
perbaikan sebagian yang tersimpan atau API tanpa perlindungan indeks.

Untuk setiap kelompok duplikat, ID terkecil mempertahankan slug asli. Baris lain
mendapat `<slug>-dup-<id>`, atau akhiran angka tambahan jika calon itu sudah
digunakan. Nama, ID, status, hierarki, dokumen dan tautan `taxonomy_id` tidak
digabung, dihapus atau dipindahkan. Catatan `knowledge_taxonomy_slug_repairs`
menyimpan ID, slug lama, slug baru, dan waktu perbaikan, tanpa FK penghapusan.
Migrasi ulang tidak mengubah hasil atau menggandakan catatan.

Pemeriksaan pascamigrasi (baca saja):

```sql
SELECT lower(btrim(slug)), count(*)
FROM knowledge_taxonomy GROUP BY 1 HAVING count(*) > 1;

SELECT * FROM knowledge_taxonomy_slug_repairs ORDER BY taxonomy_id;
```

Hasil kueri pertama harus kosong. Jangan menghapus indeks saat rollback aplikasi:
versi lama tetap dapat menulis kategori dan tetap harus dicegah membuat duplikat.
Jangan otomatis mengembalikan slug dari catatan perbaikan karena dapat melanggar
keunikan atau menimpa perubahan admin setelah migrasi. Untuk kategori yang
pernah dirujuk lewat slug ambigu, periksa ID tujuan; tidak mungkin menyimpulkan
maksud rujukan lama hanya dari slug ganda.

## Verifikasi tanpa menyentuh database aplikasi

```bash
bash scripts/test-taxonomy-slug.sh
npx vitest run tests/admin-taxonomy-slug.vitest.tsx tests/admin-taxonomy-gate.vitest.tsx
npm run check
```

Skrip pertama membuat dan menghentikan PostgreSQL lokal sementara, menghapus
kredensial layanan dari lingkungan pengujian, dan menguji migrasi berulang,
startup paralel, konflik penulisan, rollback kegagalan, serta kontrak HTTP.
