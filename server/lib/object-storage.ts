/**
 * Thin wrapper untuk Replit Object Storage.
 * Digunakan oleh Ruang Simpan untuk menyimpan file binary pengguna
 * (menggantikan penyimpanan bytea di PostgreSQL).
 *
 * Key format: ruang-simpan/{userId}/{fileId}/{filename}
 */
import { Client } from "@replit/object-storage";

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    _client = new Client();
  }
  return _client;
}

/**
 * Upload buffer ke Object Storage.
 * @returns storage key yang harus disimpan di DB
 */
export async function uploadFile(
  userId: string,
  fileId: string,
  filename: string,
  buffer: Buffer,
  _contentType: string,
): Promise<string> {
  const key = getStorageKey(userId, fileId, filename);
  const client = getClient();
  const { ok, error } = await client.uploadFromBytes(key, buffer);
  if (!ok) throw new Error(`Object Storage upload gagal: ${error}`);
  return key;
}

export function getStorageKey(userId: string, fileId: string, filename: string): string {
  return `ruang-simpan/${userId}/${fileId}/${encodeURIComponent(filename)}`;
}

/** Reconciliation must observe provider errors; a missing object is already clean. */
export async function deleteFileStrict(storageKey: string): Promise<void> {
  const { ok, error } = await getClient().delete(storageKey, { ignoreNotFound: true });
  if (!ok) throw new Error(`Object Storage delete gagal: ${error}`);
}

/**
 * Download file dari Object Storage sebagai Buffer.
 */
export async function downloadFile(storageKey: string): Promise<Buffer> {
  const client = getClient();
  const { ok, value, error } = await client.downloadAsBytes(storageKey);
  if (!ok || !value) throw new Error(`Object Storage download gagal: ${error}`);
  return Buffer.from(value[0]);
}

/**
 * Hapus file dari Object Storage. Fire-and-forget safe (tidak throw).
 */
export async function deleteFile(storageKey: string): Promise<void> {
  try {
    const client = getClient();
    await client.delete(storageKey);
  } catch (e) {
    console.error("[ObjectStorage] delete failed:", (e as Error).message);
  }
}

/**
 * Cek apakah file ada di Object Storage.
 */
export async function fileExists(storageKey: string): Promise<boolean> {
  try {
    const client = getClient();
    const { ok } = await client.exists(storageKey);
    return ok ?? false;
  } catch {
    return false;
  }
}
