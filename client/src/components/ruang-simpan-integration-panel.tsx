import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Copy, KeyRound, Loader2, LockKeyhole, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface CompanyProfile {
  name: string;
  nib: string;
  address: string;
  revision: number;
}

interface AppConnection {
  id: string;
  revision: number;
  name: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  file_ids: string[];
  folder_ids: string[];
}
interface DocumentOption { id: string; original_name: string; folder_id: string | null }
interface FolderOption { id: string; name: string }
interface ConnectionChange {
  id: string;
  actor_user_id: string;
  connection_id: string;
  action: "created" | "token_rotated" | "revoked" | "selections_changed";
  changed_at: string;
}
const CHANGE_LABELS: Record<ConnectionChange["action"], string> = {
  created: "Akses dibuat", token_rotated: "Token diganti",
  revoked: "Akses dicabut", selections_changed: "Pilihan dokumen diubah",
};

const EMPTY_PROFILE: CompanyProfile = { name: "", nib: "", address: "", revision: 0 };
const PROFILE_QUERY_KEY = ["/api/ruang-simpan/company-profile"];
const CONNECTIONS_QUERY_KEY = ["/api/ruang-simpan/app-connections"];
const HISTORY_QUERY_KEY = ["/api/ruang-simpan/app-connections/history"];

function formatConnectionDate(value: string | null) {
  if (!value) return "Tidak ditentukan";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Tanggal tidak valid"
    : date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function isConnectionExpired(expiresAt: string | null) {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt).getTime();
  return !Number.isFinite(expiry) || expiry <= Date.now();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba lagi.";
}

export function RuangSimpanIntegrationPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [profileDraft, setProfileDraft] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [profileEdited, setProfileEdited] = useState(false);
  const [profileConflict, setProfileConflict] = useState(false);
  const [connectionName, setConnectionName] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [canReadFiles, setCanReadFiles] = useState(false);
  const [canUploadFiles, setCanUploadFiles] = useState(false);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [editingConnection, setEditingConnection] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [connectionToRevoke, setConnectionToRevoke] = useState<AppConnection | null>(null);
  const [connectionToRotate, setConnectionToRotate] = useState<AppConnection | null>(null);
  const [connectionReloadRequired, setConnectionReloadRequired] = useState(false);
  const [tokenAppName, setTokenAppName] = useState("");
  const profileQuery = useQuery<CompanyProfile>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => apiRequest("GET", "/api/ruang-simpan/company-profile"),
    staleTime: 0,
  });
  const connectionsQuery = useQuery<{ connections: AppConnection[] }>({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: () => apiRequest("GET", "/api/ruang-simpan/app-connections"),
    staleTime: 0,
  });
  const historyQuery = useQuery<{ history: ConnectionChange[] }>({
    queryKey: HISTORY_QUERY_KEY,
    queryFn: () => apiRequest("GET", HISTORY_QUERY_KEY[0]),
    staleTime: 0,
  });
  const refreshConnectionHistory = () => {
    void queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
  };
  const filesQuery = useQuery<DocumentOption[]>({
    queryKey: ["/api/ruang-simpan/files"],
    queryFn: () => apiRequest("GET", "/api/ruang-simpan/files"),
  });
  const foldersQuery = useQuery<{ folders: FolderOption[] }>({
    queryKey: ["/api/ruang-simpan/overview"],
    queryFn: () => apiRequest("GET", "/api/ruang-simpan/overview"),
  });

  useEffect(() => {
    if (profileQuery.data && !profileEdited) {
      setProfileDraft(profileQuery.data);
      setProfileConflict(false);
    }
  }, [profileQuery.data, profileEdited]);

  const saveProfile = useMutation({
    mutationFn: (profile: CompanyProfile) =>
      apiRequest("PUT", "/api/ruang-simpan/company-profile", {
        name: profile.name,
        nib: profile.nib,
        address: profile.address,
        revision: profile.revision,
      }),
    onSuccess: (profile: CompanyProfile) => {
      setProfileDraft(profile);
      setProfileEdited(false);
      setProfileConflict(false);
      queryClient.setQueryData(PROFILE_QUERY_KEY, profile);
      toast({ title: "Profil perusahaan tersimpan" });
    },
    onError: (error: unknown) => {
      if (getErrorMessage(error).startsWith("409")) {
        setProfileConflict(true);
        void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      } else {
        toast({ title: "Gagal menyimpan profil", description: getErrorMessage(error), variant: "destructive" });
      }
    },
  });

  const createConnection = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: (payload: { name: string; scopes: string[]; file_ids: string[]; folder_ids: string[] }) =>
      apiRequest("POST", "/api/ruang-simpan/app-connections", payload),
    onSuccess: (result: { connection: AppConnection; token: string }) => {
      setNewToken(result.token);
      refreshConnectionHistory();
      setTokenAppName(result.connection.name);
      setConnectionName("");
      setCanRead(true);
      setCanWrite(false);
      setCanReadFiles(false);
      setCanUploadFiles(false);
      setFileIds([]);
      setFolderIds([]);
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      toast({ title: "Akses aplikasi berhasil dibuat", description: "Salin token sekarang; token hanya ditampilkan satu kali." });
    },
    onError: (error: unknown) => {
      refreshConnectionHistory();
      toast({ title: "Gagal membuat akses aplikasi", description: getErrorMessage(error), variant: "destructive" });
    },
  });
  const rotateToken = useMutation({
    mutationFn: (connection: AppConnection) => apiRequest("POST", `/api/ruang-simpan/app-connections/${encodeURIComponent(connection.id)}/rotate-token`, { revision: connection.revision }),
    retry: false,
    gcTime: 0,
    onSuccess: (result: { connection: AppConnection; token: string }) => {
      setNewToken(result.token);
      setTokenAppName(result.connection.name);
      setConnectionToRotate(null);
      refreshConnectionHistory();
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      toast({ title: "Token berhasil diganti", description: "Token lama tidak berlaku. Simpan token baru di server aplikasi." });
    },
    onError: (error: unknown) => {
      setConnectionToRotate(null);
      setConnectionReloadRequired(true);
      refreshConnectionHistory();
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      toast({ title: "Token baru tidak diterima", description: getErrorMessage(error).startsWith("409")
        ? "Koneksi telah berubah di sesi lain. Muat ulang daftar aplikasi, lalu konfirmasikan kembali sebelum mengganti token."
        : `${getErrorMessage(error)} Jika respons terputus, token lama mungkin sudah diganti. Muat ulang daftar aplikasi sebelum melakukan rotasi lagi untuk mendapatkan token baru.`, variant: "destructive" });
    },
  });
  const saveSelections = useMutation({
    mutationFn: (payload: { id: string; file_ids: string[]; folder_ids: string[] }) =>
      apiRequest("PUT", `/api/ruang-simpan/app-connections/${encodeURIComponent(payload.id)}/selections`, {
        file_ids: payload.file_ids, folder_ids: payload.folder_ids,
      }),
    onSuccess: () => {
      setEditingConnection(null);
      refreshConnectionHistory();
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      toast({ title: "Pilihan dokumen disimpan" });
    },
    onError: (error: unknown) => {
      refreshConnectionHistory();
      toast({ title: "Gagal menyimpan pilihan", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const revokeConnection = useMutation({
    retry: false,
    mutationFn: (connection: AppConnection) => apiRequest("DELETE", `/api/ruang-simpan/app-connections/${encodeURIComponent(connection.id)}`, { revision: connection.revision }),
    onSuccess: () => {
      setConnectionToRevoke(null);
      refreshConnectionHistory();
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      toast({ title: "Akses aplikasi dicabut" });
    },
    onError: (error: unknown) => {
      setConnectionToRevoke(null);
      setConnectionReloadRequired(true);
      refreshConnectionHistory();
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
      toast({ title: "Gagal mencabut akses", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const reloadProfile = async () => {
    const result = await profileQuery.refetch();
    if (result.data) {
      setProfileDraft(result.data);
      setProfileEdited(false);
      setProfileConflict(false);
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      toast({ title: "Token disalin" });
    } catch {
      toast({ title: "Tidak dapat menyalin otomatis", description: "Pilih token lalu salin secara manual.", variant: "destructive" });
    }
  };

  const connections = connectionsQuery.data?.connections || [];
  const activeConnections = connections.filter((connection) => !connection.revoked_at && !isConnectionExpired(connection.expires_at));
  const profileHasChanges = !!profileQuery.data && (
    profileDraft.name !== profileQuery.data.name ||
    profileDraft.nib !== profileQuery.data.nib ||
    profileDraft.address !== profileQuery.data.address
  );
  const toggleId = (id: string, selected: string[], setSelected: (ids: string[]) => void) =>
    setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const documentChoices = (readOnly = false) => (
    <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-2 text-xs">
      {filesQuery.isError || foldersQuery.isError ? <p role="alert">Daftar dokumen tidak dapat dimuat. Coba muat ulang halaman.</p> : <>
        {(foldersQuery.data?.folders ?? []).map((folder) => (
          <label key={folder.id} className="flex items-center gap-2">
            <input type="checkbox" disabled={readOnly} checked={folderIds.includes(folder.id)}
              onChange={() => toggleId(folder.id, folderIds, setFolderIds)} />
            Folder: {folder.name} (termasuk dokumen baru yang dipindahkan ke sini)
          </label>
        ))}
        {(filesQuery.data ?? []).map((file) => (
          <label key={file.id} className="flex items-center gap-2">
            <input type="checkbox" disabled={readOnly} checked={fileIds.includes(file.id)}
              onChange={() => toggleId(file.id, fileIds, setFileIds)} />
            File: {file.original_name}
          </label>
        ))}
        {!foldersQuery.data && !filesQuery.data && <p>Memuat pilihan dokumen…</p>}
      </>}
    </div>
  );

  return (
    <section aria-labelledby="company-data-heading" className="max-w-7xl mx-auto px-4 pt-5">
      <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-sm dark:border-indigo-900/50 dark:bg-card">
        <div className="flex flex-col gap-3 border-b border-border bg-gradient-to-r from-indigo-50 to-violet-50 px-5 py-4 dark:from-indigo-950/40 dark:to-violet-950/30 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-indigo-100 p-2.5 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="company-data-heading" className="font-bold text-foreground">Data Resmi & Akses Aplikasi</h2>
              <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
                Profil di sini adalah acuan perusahaan. Aplikasi Gustafta lain dan aplikasi tepercaya dapat memakai data yang sama melalui izin terbatas.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="w-fit gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            <LockKeyhole className="h-3 w-3" aria-hidden="true" /> Pemilik akun
          </Badge>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Profil resmi perusahaan</h3>
              <p className="mt-1 text-xs text-muted-foreground">Gunakan satu profil ini sebagai acuan bersama antaraplikasi. Perubahan disimpan dengan pemeriksaan versi agar pembaruan tidak saling menimpa.</p>
            </div>

            {profileQuery.isLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Memuat profil…</div>
            ) : profileQuery.isError ? (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                Gagal memuat profil. {getErrorMessage(profileQuery.error)}
                <Button variant="outline" size="sm" className="ml-2" onClick={() => void profileQuery.refetch()}>Coba lagi</Button>
              </div>
            ) : (
              <>
                {profileConflict && (
                  <div role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Profil berubah di tempat lain. Muat versi terbaru sebelum menyimpan lagi.</span>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void reloadProfile()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Muat versi terbaru</Button>
                  </div>
                )}
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (profileQuery.data && profileHasChanges) {
                      saveProfile.mutate({ ...profileDraft, revision: profileQuery.data.revision });
                    }
                  }}
                >
                  <div className="grid gap-1.5">
                    <Label htmlFor="rs-company-name">Nama badan usaha</Label>
                    <Input id="rs-company-name" value={profileDraft.name} maxLength={200} onChange={(event) => { setProfileEdited(true); setProfileDraft((current) => ({ ...current, name: event.target.value })); }} placeholder="Nama resmi perusahaan" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="rs-company-nib">NIB</Label>
                    <Input id="rs-company-nib" value={profileDraft.nib} maxLength={32} onChange={(event) => { setProfileEdited(true); setProfileDraft((current) => ({ ...current, nib: event.target.value })); }} placeholder="Nomor Induk Berusaha" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="rs-company-address">Alamat perusahaan</Label>
                    <Input id="rs-company-address" value={profileDraft.address} maxLength={500} onChange={(event) => { setProfileEdited(true); setProfileDraft((current) => ({ ...current, address: event.target.value })); }} placeholder="Alamat sesuai dokumen resmi" />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button type="submit" size="sm" disabled={!profileHasChanges || saveProfile.isPending || profileConflict}>
                      {saveProfile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Simpan profil
                    </Button>
                    {profileQuery.data && <span className="text-[11px] text-muted-foreground">Versi data {profileQuery.data.revision}</span>}
                  </div>
                </form>
              </>
            )}
          </div>

          <div className="space-y-4 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div>
              <h3 className="text-sm font-semibold">Hubungkan aplikasi eksternal</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Buat izin terpisah untuk setiap aplikasi. Hanya hubungkan aplikasi yang Anda percayai; rahasiakan token dan simpan hanya di server aplikasi, jangan di browser atau kode publik.
              </p>
            </div>

            {newToken && (
              <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200"><KeyRound className="h-4 w-4" /> Token akses — tampil sekali</p>
                <p className="text-xs text-emerald-800 dark:text-emerald-200">Token untuk {tokenAppName}. Salin sekarang dan simpan sebagai secret di server aplikasi tepercaya. Setelah panel ditutup, token tidak dapat ditampilkan lagi.</p>
                <div className="flex gap-2">
                  <Input aria-label="Token akses baru, salin dan simpan sekarang" readOnly value={newToken} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
                  <Button type="button" variant="outline" size="icon" aria-label="Salin token akses" onClick={() => void copyToken()}><Copy className="h-4 w-4" /></Button>
                </div>
                 <Button type="button" variant="ghost" size="sm" onClick={() => { setNewToken(null); setTokenAppName(""); createConnection.reset(); rotateToken.reset(); }}><Check className="mr-1.5 h-4 w-4" /> Sudah saya simpan, tutup token</Button>
              </div>
            )}

            <form
              className="space-y-3 rounded-xl border border-border bg-muted/20 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const scopes = [canRead && "profile:read", canWrite && "profile:write", canReadFiles && "files:read", canUploadFiles && "files:write"].filter((scope): scope is string => !!scope);
                if (!connectionName.trim() || scopes.length === 0) return;
                createConnection.mutate({ name: connectionName.trim(), scopes, file_ids: fileIds, folder_ids: folderIds });
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="rs-connection-name">Nama aplikasi</Label>
                <Input id="rs-connection-name" value={connectionName} maxLength={100} onChange={(event) => setConnectionName(event.target.value)} placeholder="Contoh: Portal Proyek" />
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-medium">Izin profil perusahaan</legend>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5 accent-indigo-600" checked={canRead} onChange={(event) => setCanRead(event.target.checked)} />
                  <span><strong>Baca</strong> — aplikasi dapat membaca profil resmi.</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5 accent-indigo-600" checked={canWrite} onChange={(event) => setCanWrite(event.target.checked)} />
                  <span><strong>Ubah</strong> — aplikasi dapat memperbarui profil resmi. Berikan hanya bila diperlukan.</span>
                </label>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium">Izin dokumen (tidak diberikan secara otomatis)</legend>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={canReadFiles} onChange={(e) => setCanReadFiles(e.target.checked)} /> Baca metadata dan unduh file yang dipilih</label>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={canUploadFiles} onChange={(e) => setCanUploadFiles(e.target.checked)} /> Unggah ke folder yang dipilih</label>
                {(canReadFiles || canUploadFiles) && <>
                  <p className="text-[11px] text-muted-foreground">Pilih file tertentu untuk dibaca, atau folder untuk dibaca/unggah. Folder mencakup file baru di dalamnya.</p>
                  {documentChoices()}
                </>}
              </fieldset>
               <Button type="submit" size="sm" disabled={!connectionName.trim() || (!canRead && !canWrite && !canReadFiles && !canUploadFiles) || ((canReadFiles || canUploadFiles) && fileIds.length + folderIds.length === 0) || (canUploadFiles && folderIds.length === 0) || createConnection.isPending || rotateToken.isPending || !!newToken}>
                {createConnection.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                 {newToken ? "Simpan token di atas dahulu" : "Buat token akses"}
              </Button>
               <p className="text-[11px] text-muted-foreground">Token berlaku 90 hari. Simpan hanya di server aplikasi. Akses file dibatasi pada pilihan di atas.</p>
            </form>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold">Aplikasi yang terhubung</h4>
                <span className="text-[11px] text-muted-foreground">{activeConnections.length} aktif</span>
              </div>
              {connectionReloadRequired && (
                <div role="alert" className="mb-3 text-xs">
                  Koneksi mungkin telah berubah. Muat ulang daftar aplikasi sebelum mengganti token atau mencabut akses.
                  <Button type="button" variant="outline" size="sm" disabled={connectionsQuery.isFetching}
                    onClick={async () => {
                      const result = await connectionsQuery.refetch();
                      if (!result.isError) setConnectionReloadRequired(false);
                    }}>Muat ulang daftar aplikasi</Button>
                </div>
              )}
              {connectionsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat akses…</div>
              ) : connectionsQuery.isError ? (
                <div role="alert" className="text-xs text-red-600 dark:text-red-400">Gagal memuat daftar aplikasi. {getErrorMessage(connectionsQuery.error)}</div>
              ) : connections.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Belum ada aplikasi eksternal yang diberi akses.</p>
              ) : (
                <ul className="space-y-2">
                  {connections.map((connection) => {
                    const revoked = !!connection.revoked_at;
                    const expired = isConnectionExpired(connection.expires_at);
                    return (
                      <li key={connection.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{connection.name}</span>
                            <Badge variant="outline" className={revoked || expired ? "text-muted-foreground" : "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"}>
                              {revoked ? "Dicabut" : expired ? "Kedaluwarsa" : "Aktif"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                             Izin: {connection.scopes.map((scope) => scope === "profile:read" ? "Baca profil" : scope === "profile:write" ? "Ubah profil" : scope === "files:read" ? "Baca dokumen" : "Unggah dokumen").join(", ")}
                          </p>
                           {connection.scopes.some((scope) => scope.startsWith("files:")) && <p className="text-[11px] text-muted-foreground">{connection.file_ids?.length ?? 0} file · {connection.folder_ids?.length ?? 0} folder dipilih</p>}
                          <p className="text-[11px] text-muted-foreground">Dibuat {formatConnectionDate(connection.created_at)} · Berakhir {formatConnectionDate(connection.expires_at)}</p>
                           {editingConnection === connection.id && <div className="mt-3 space-y-2">
                             {documentChoices()}
                             <Button size="sm" disabled={saveSelections.isPending || (connection.scopes.includes("files:write") && folderIds.length === 0)}
                               onClick={() => saveSelections.mutate({ id: connection.id, file_ids: fileIds, folder_ids: folderIds })}>Simpan pilihan</Button>
                             <Button size="sm" variant="ghost" onClick={() => setEditingConnection(null)}>Batal</Button>
                           </div>}
                        </div>
                         <div className="flex gap-2">
                         {!revoked && !expired && (
                           <Button type="button" variant="outline" size="sm"
                             disabled={connectionReloadRequired || !!newToken || rotateToken.isPending || createConnection.isPending}
                             onClick={() => setConnectionToRotate(connection)}>
                             <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Ganti token
                           </Button>
                         )}
                         {!revoked && !expired && connection.scopes.some((scope) => scope.startsWith("files:")) && (
                           <Button type="button" variant="outline" size="sm" onClick={() => {
                             setEditingConnection(connection.id);
                             setFileIds(connection.file_ids ?? []);
                             setFolderIds(connection.folder_ids ?? []);
                           }}>Pilih dokumen</Button>
                         )}
                         {!revoked && (
                          <Button type="button" variant="outline" size="sm" disabled={connectionReloadRequired || revokeConnection.isPending} className="shrink-0 text-red-600 hover:text-red-700" onClick={() => setConnectionToRevoke(connection)}>
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Cabut akses
                          </Button>
                        )}
                         </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      <section aria-labelledby="connection-history-heading" className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 id="connection-history-heading" className="text-sm font-semibold">Riwayat akses aplikasi</h3>
          <Button type="button" variant="outline" size="sm" disabled={historyQuery.isFetching}
            onClick={() => void historyQuery.refetch()}>Muat ulang riwayat</Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Maksimal 50 perubahan terbaru milik akun ini. Token dan isi dokumen tidak dicatat. Perubahan sebelum riwayat diaktifkan tidak tersedia.</p>
        {historyQuery.isLoading ? <p role="status" className="mt-3 text-sm">Memuat riwayat…</p>
          : historyQuery.isError ? <p role="alert" className="mt-3 text-sm text-destructive">Riwayat belum dapat dimuat. Coba muat ulang riwayat.</p>
          : !historyQuery.data?.history.length ? <p className="mt-3 text-sm text-muted-foreground">Belum ada perubahan akses yang tercatat.</p>
          : <ol className="mt-3 max-h-80 space-y-3 overflow-y-auto">
            {historyQuery.data.history.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border p-3 text-xs">
                <p className="font-medium">{CHANGE_LABELS[entry.action]}</p>
                <time dateTime={entry.changed_at}>{new Date(entry.changed_at).toLocaleString("id-ID")}</time>
                <p className="break-all">Pelaku: {entry.actor_user_id}</p>
                <p className="break-all">ID koneksi: {entry.connection_id}</p>
              </li>
            ))}
          </ol>}
      </section>

      <Dialog open={!!connectionToRotate} onOpenChange={(open) => !open && !rotateToken.isPending && setConnectionToRotate(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ganti token aplikasi?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Token lama untuk <strong>{connectionToRotate?.name}</strong> langsung tidak berlaku.
            Pilihan file/folder, izin, dan tanggal kedaluwarsa tidak berubah.
            Simpan token baru di server aplikasi agar koneksi dapat digunakan kembali.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={rotateToken.isPending} onClick={() => setConnectionToRotate(null)}>Batal</Button>
            <Button type="button" disabled={rotateToken.isPending || !!newToken} onClick={() => connectionToRotate && rotateToken.mutate(connectionToRotate)}>
              {rotateToken.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Ganti token sekarang
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!connectionToRevoke} onOpenChange={(open) => !open && setConnectionToRevoke(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cabut akses aplikasi?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Aplikasi <strong>{connectionToRevoke?.name}</strong> tidak akan dapat memakai token ini lagi. Tindakan ini tidak dapat dibatalkan.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConnectionToRevoke(null)}>Batal</Button>
            <Button type="button" variant="destructive" disabled={revokeConnection.isPending} onClick={() => connectionToRevoke && revokeConnection.mutate(connectionToRevoke)}>
              {revokeConnection.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cabut akses
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}