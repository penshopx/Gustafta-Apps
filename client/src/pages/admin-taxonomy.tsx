import "@/styles/serif-font.css";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, BookOpen, FolderTree, History, Layers3, Loader2, Lock, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { InsertKnowledgeTaxonomy, KnowledgeTaxonomyTreeNode } from "@shared/schema";
import { SharedHeader } from "@/components/shared-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { useTaxonomy, useTaxonomyMutations, useTaxonomyUsage } from "@/hooks/use-taxonomy";
import { useToast } from "@/hooks/use-toast";
import { TAXONOMY_SLUG_CONFLICT } from "@shared/taxonomy-slug";
import { TaxonomyHistory } from "@/components/taxonomy-history";

const LEVELS = [
  { value: "sektor", label: "Sektor", depth: 0 },
  { value: "subsektor", label: "Subsektor", depth: 1 },
  { value: "topik", label: "Topik", depth: 2 },
  { value: "klausul", label: "Klausul", depth: 3 },
] as const;

type TaxonomyLevel = typeof LEVELS[number]["value"];
type FlatNode = KnowledgeTaxonomyTreeNode & { depth: number; parentName: string };
type FormValues = { name: string; slug: string; description: string; level: TaxonomyLevel; parentId: string; sortOrder: string; isActive: boolean };

const blankForm = (): FormValues => ({ name: "", slug: "", description: "", level: "sektor", parentId: "none", sortOrder: "0", isActive: true });
const toSlug = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const errorText = (error: unknown) => {
  if (!(error instanceof Error)) return "Terjadi kesalahan. Silakan coba lagi.";
  // apiRequest exposes HTTP errors as "409: { ... }"; show the server's
  // actionable message instead of raw JSON, without losing the form draft.
  try {
    const body = JSON.parse(error.message.replace(/^\d{3}:\s*/, ""));
    if (typeof body.error === "string") return body.error;
  } catch { /* Non-JSON network errors retain their original message. */ }
  return error.message;
};

function flattenTree(nodes: KnowledgeTaxonomyTreeNode[], depth = 0, parentName = ""): FlatNode[] {
  return nodes.flatMap((node) => [
    { ...node, depth, parentName },
    ...flattenTree(node.children || [], depth + 1, node.name),
  ]);
}

function collectDescendantIds(node: KnowledgeTaxonomyTreeNode): Set<number> {
  const ids = new Set<number>([node.id]);
  for (const child of node.children || []) for (const id of collectDescendantIds(child)) ids.add(id);
  return ids;
}

export default function AdminTaxonomyPage() {
  const { user, isLoading: authLoading } = useAuth();
  const adminStatus = useAdminStatus(!!user);
  const isAdmin = adminStatus.data?.isAdmin === true;
  const { toast } = useToast();
  const taxonomyQuery = useTaxonomy(isAdmin);
  const usageQuery = useTaxonomyUsage(isAdmin);
  const { create, update, remove } = useTaxonomyMutations();
  const tree = taxonomyQuery.data || [];
  const flat = useMemo(() => flattenTree(tree), [tree]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeTaxonomyTreeNode | null>(null);
  const [form, setForm] = useState<FormValues>(blankForm);
  const [deleteReview, setDeleteReview] = useState<{ target: KnowledgeTaxonomyTreeNode; count: number } | null>(null);
  const [formError, setFormError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [historyTarget, setHistoryTarget] = useState<{ id: number; name: string } | "all" | null>(null);
  const pending = create.isPending || update.isPending || remove.isPending;

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setFormError("");
    setFormOpen(true);
  };
  const openEdit = (node: KnowledgeTaxonomyTreeNode) => {
    setEditing(node);
    setForm({
      name: node.name,
      slug: node.slug,
      description: node.description || "",
      level: node.level as TaxonomyLevel,
      parentId: node.parentId == null ? "none" : String(node.parentId),
      sortOrder: String(node.sortOrder ?? 0),
      isActive: node.isActive !== false,
    });
    setFormError("");
    setFormOpen(true);
  };

  const descendants = editing ? collectDescendantIds(editing) : new Set<number>();
  const expectedParentLevel = LEVELS[Math.max(0, LEVELS.findIndex((level) => level.value === form.level) - 1)]?.value;
  const availableParents = flat.filter((node) =>
    node.level === expectedParentLevel && !descendants.has(node.id) && node.id !== editing?.id
  );
  const validParent = form.level === "sektor"
    ? form.parentId === "none"
    : availableParents.some((node) => String(node.id) === form.parentId);

  const onLevelChange = (level: TaxonomyLevel) => {
    setForm((current) => {
      const nextParents = flat.filter((node) => node.level === LEVELS[Math.max(0, LEVELS.findIndex((entry) => entry.value === level) - 1)]?.value && !descendants.has(node.id) && node.id !== editing?.id);
      return { ...current, level, parentId: level === "sektor" ? "none" : nextParents.some((node) => String(node.id) === current.parentId) ? current.parentId : "none" };
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const slug = form.slug.trim() || toSlug(name);
    if (!name || !slug) {
      setFormError("Nama dan slug wajib diisi.");
      return;
    }
    if (form.level !== "sektor" && !validParent) {
      setFormError(`Pilih ${LEVELS.find((level) => level.value === expectedParentLevel)?.label.toLowerCase()} induk yang valid.`);
      return;
    }
    const payload: InsertKnowledgeTaxonomy = {
      name,
      slug,
      description: form.description.trim(),
      level: form.level,
      parentId: form.level === "sektor" ? null : Number(form.parentId),
      sortOrder: Number(form.sortOrder) || 0,
      isActive: form.isActive,
    };
    setFormError("");
    const onSuccess = () => {
      toast({ title: editing ? "Kategori diperbarui" : "Kategori dibuat", description: `${name} berhasil disimpan.` });
      setFormOpen(false);
      setEditing(null);
    };
    const onError = (error: Error) => {
      setFormError(errorText(error));
      toast({ title: "Gagal menyimpan kategori", description: errorText(error), variant: "destructive" });
    };
    if (editing) update.mutate({ id: editing.id, data: payload }, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  };

  const confirmDelete = () => {
    if (!deleteReview || deleteReview.target.children?.length || !usageQuery.isSuccess || usageQuery.data == null) return;
    setDeleteError("");
    const liveCount = usageQuery.data[deleteReview.target.id] ?? 0;
    if (liveCount !== deleteReview.count) {
      setDeleteError("Jumlah tautan kategori berubah sejak ditinjau. Tutup dialog lalu buka kembali untuk meninjau jumlah terbaru.");
      return;
    }
    const confirmedUsageCount = deleteReview.count;
    remove.mutate({ id: deleteReview.target.id, confirmedUsageCount }, {
      onSuccess: () => {
        toast({ title: "Kategori dihapus", description: `${confirmedUsageCount} tautan kategori pada dokumen KB dilepas.` });
        setDeleteReview(null);
      },
      onError: (error) => {
        setDeleteError(errorText(error));
        toast({ title: "Gagal menghapus kategori", description: errorText(error), variant: "destructive" });
      },
    });
  };

  if (authLoading || (!!user && adminStatus.isLoading)) return (
    <div className="min-h-[100dvh] bg-background"><SharedHeader /><main className="mx-auto max-w-6xl px-5 py-12">
      <div className="h-8 w-52 animate-pulse rounded bg-muted" /><div className="mt-8 h-48 animate-pulse rounded-2xl bg-muted" />
    </main></div>
  );
  if (user && adminStatus.isError) return (
    <div className="min-h-[100dvh] bg-background"><SharedHeader /><main className="mx-auto max-w-md px-5 py-24 text-center">
      <h1 className="text-xl font-bold">Status admin tidak dapat dimuat</h1>
      <p className="mt-2 text-muted-foreground">Periksa koneksi lalu coba lagi.</p>
      <Button variant="outline" className="mt-5" onClick={() => adminStatus.refetch()}>Coba lagi</Button>
    </main></div>
  );
  if (!isAdmin) return (
    <div className="min-h-[100dvh] bg-background"><SharedHeader /><main className="mx-auto max-w-md px-5 py-24 text-center" data-testid="gate-admin-taxonomy">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-foreground"><Lock className="h-6 w-6" /></div>
      <h1 className="text-xl font-bold text-foreground">Khusus Admin</h1>
      <p className="mt-2 text-sm text-muted-foreground">Pengelolaan kategori hanya tersedia untuk admin Gustafta.</p>
      <Link href="/dashboard" className="mt-6 inline-flex"><Button variant="outline" className="gap-2">Kembali <ArrowRight className="h-4 w-4" /></Button></Link>
    </main></div>
  );

  return (
    <div className="min-h-[100dvh] bg-background text-foreground" data-testid="page-admin-taxonomy">
      <SharedHeader />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:pt-12">
        <Link href="/admin" className="mb-7 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Panel admin
        </Link>
        <section className="relative overflow-hidden rounded-[1.75rem] bg-slate-950 px-6 py-8 text-slate-50 sm:px-10 sm:py-10">
          <div className="absolute -right-12 -top-20 h-64 w-64 rounded-full border border-sky-200/20" />
          <div className="absolute -right-3 -top-11 h-44 w-44 rounded-full border border-sky-200/20" />
          <div className="relative flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200/25 bg-white/5 px-3 py-1.5 text-xs tracking-wide text-sky-100">
                <FolderTree className="h-3.5 w-3.5" /> TAKSONOMI KNOWLEDGE BASE
              </div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Struktur pengetahuan, <span className="font-serif italic text-sky-300">tetap tertata.</span></h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-200">Atur kategori berjenjang dari sektor hingga klausul. Perubahan kategori tidak menghapus isi dokumen KB.</p>
            </div>
            <Button onClick={openCreate} className="shrink-0 gap-2 bg-sky-300 text-slate-950 hover:bg-sky-200" data-testid="button-add-taxonomy">
              <Plus className="h-4 w-4" /> Kategori baru
            </Button>
          </div>
          <div className="relative mt-8 flex flex-wrap gap-2 border-t border-white/15 pt-5">
            {LEVELS.map((level, index) => <span key={level.value} className="flex items-center gap-2 text-xs text-slate-200"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 font-mono text-[10px] text-sky-200">{String(index + 1).padStart(2, "0")}</span>{level.label}{index < LEVELS.length - 1 && <span className="mx-1 text-white/35">/</span>}</span>)}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Katalog kategori</p><h2 className="mt-1 text-xl font-semibold">Semua level <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">{flat.length}</span></h2></div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" className="gap-2" onClick={() => setHistoryTarget("all")}><History className="h-4 w-4" /> Cari riwayat kategori</Button>
            <span className="flex items-center gap-2 text-xs text-muted-foreground"><BookOpen className="h-4 w-4" /> Hitungan penggunaan langsung pada dokumen KB</span>
          </div>
        </div>
        <Card className="mt-4 overflow-hidden rounded-2xl border-border bg-card shadow-sm">
          {taxonomyQuery.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-muted" />)}</div>
            : taxonomyQuery.isError ? <div className="px-6 py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><RefreshCw className="h-5 w-5" /></div>
              <h3 className="mt-4 font-semibold">Kategori belum dapat dimuat</h3><p className="mt-1 text-sm text-muted-foreground">Periksa koneksi lalu coba lagi.</p>
              <Button variant="outline" className="mt-5 gap-2" onClick={() => taxonomyQuery.refetch()}><RefreshCw className="h-4 w-4" /> Coba lagi</Button>
            </div>
            : flat.length === 0 ? <div className="px-6 py-16 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Layers3 className="h-5 w-5" /></div>
              <h3 className="mt-4 font-semibold">Belum ada kategori</h3><p className="mt-1 text-sm text-muted-foreground">Mulai dari sektor, lalu susun level di bawahnya.</p>
              <Button onClick={openCreate} className="mt-5 gap-2"><Plus className="h-4 w-4" /> Buat sektor pertama</Button>
            </div>
            : <div className="divide-y divide-border">
              {flat.map((node) => {
                const usage = usageQuery.data?.[node.id];
                return <div key={node.id} className="group flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/50 sm:px-6" data-testid={`taxonomy-row-${node.id}`}>
                  <div className="flex min-w-0 flex-1 items-center gap-3" style={{ paddingLeft: `${node.depth * 22}px` }}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${node.isActive ? "bg-primary" : "bg-muted-foreground/50"}`} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{node.name}</span>
                        <Badge variant="outline" className="text-[10px] font-medium">{LEVELS.find((level) => level.value === node.level)?.label || node.level}</Badge>
                        {!node.isActive && <Badge variant="secondary" className="text-[10px]">Nonaktif</Badge>}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{node.slug}{node.parentName ? <span className="font-sans"> · di bawah {node.parentName}</span> : ""}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                    <div className="min-w-[76px] text-right">
                      {usageQuery.isLoading ? <span className="inline-block h-4 w-10 animate-pulse rounded bg-muted" /> : usageQuery.isError ? <span className="text-xs text-destructive">Tidak tersedia</span> : <><span className="font-mono text-sm font-semibold text-foreground">{usage ?? 0}</span><span className="ml-1 hidden text-xs text-muted-foreground sm:inline">dokumen</span></>}
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" aria-label={`Riwayat ${node.name}`} onClick={() => setHistoryTarget({ id: node.id, name: node.name })}><History className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" aria-label={`Edit ${node.name}`} onClick={() => openEdit(node)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-30" aria-label={`Hapus ${node.name}`} disabled={!!node.children?.length || !usageQuery.isSuccess || pending} title={node.children?.length ? "Hapus anak kategori terlebih dahulu" : !usageQuery.isSuccess ? "Menunggu data penggunaan kategori" : "Hapus kategori"} onClick={() => { setDeleteError(""); setDeleteReview({ target: node, count: usageQuery.data?.[node.id] ?? 0 }); }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>;
              })}
            </div>}
        </Card>
        {usageQuery.isError && <div className="mt-3 flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span>Data penggunaan belum tersedia. Penghapusan dinonaktifkan sampai data berhasil dimuat.</span>
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => usageQuery.refetch()}><RefreshCw className="h-3.5 w-3.5" /> Muat ulang</Button>
        </div>}
      </main>

      {historyTarget && <TaxonomyHistory target={historyTarget === "all" ? null : historyTarget} onClose={() => setHistoryTarget(null)} />}
      <Dialog open={formOpen} onOpenChange={(open) => { if (!pending) setFormOpen(open); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Edit kategori" : "Kategori baru"}</DialogTitle><DialogDescription>Lengkapi identitas kategori dan posisinya pada hierarki Knowledge Base.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-4 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="taxonomy-name">Nama kategori</Label><Input id="taxonomy-name" value={form.name} onChange={(event) => { const name = event.target.value; setForm((current) => ({ ...current, name, slug: current.slug === toSlug(current.name) || !current.slug ? toSlug(name) : current.slug })); }} placeholder="Contoh: Konstruksi Gedung" autoFocus /></div>
              <div className="space-y-1.5"><Label htmlFor="taxonomy-slug">Slug</Label><Input id="taxonomy-slug" value={form.slug} aria-invalid={formError === TAXONOMY_SLUG_CONFLICT} aria-describedby={formError === TAXONOMY_SLUG_CONFLICT ? "taxonomy-form-error taxonomy-slug-help" : "taxonomy-slug-help"} onChange={(event) => { setForm((current) => ({ ...current, slug: toSlug(event.target.value) })); setFormError(""); }} placeholder="konstruksi-gedung" className="font-mono text-sm" /><p id="taxonomy-slug-help" className="text-xs text-muted-foreground">Unik di seluruh kategori, termasuk kategori nonaktif dan induk berbeda.</p></div>
              <div className="space-y-1.5"><Label htmlFor="taxonomy-order">Urutan</Label><Input id="taxonomy-order" type="number" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Level</Label><Select value={form.level} onValueChange={(value) => onLevelChange(value as TaxonomyLevel)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LEVELS.map((level) => <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>{form.level === "sektor" ? "Posisi induk" : `Induk · ${LEVELS.find((level) => level.value === expectedParentLevel)?.label}`}</Label><Select value={form.parentId} onValueChange={(value) => setForm((current) => ({ ...current, parentId: value }))} disabled={form.level === "sektor"}><SelectTrigger><SelectValue placeholder="Pilih kategori induk" /></SelectTrigger><SelectContent>{form.level === "sektor" ? <SelectItem value="none">Tidak ada · kategori utama</SelectItem> : <>{availableParents.length ? availableParents.map((node) => <SelectItem key={node.id} value={String(node.id)}>{`${"— ".repeat(node.depth)}${node.name}`}</SelectItem>) : <SelectItem value="none" disabled>Tidak ada induk level yang sesuai</SelectItem>}</>}</SelectContent></Select></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="taxonomy-description">Deskripsi</Label><Textarea id="taxonomy-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} placeholder="Keterangan singkat kategori (opsional)" /></div>
              <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3 sm:col-span-2"><div><Label htmlFor="taxonomy-active">Kategori aktif</Label><p className="mt-0.5 text-xs text-muted-foreground">Kategori nonaktif tetap tersimpan.</p></div><Switch id="taxonomy-active" checked={form.isActive} onCheckedChange={(isActive) => setForm((current) => ({ ...current, isActive }))} /></div>
            </div>
            {formError && <p id="taxonomy-form-error" role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={pending}>Batal</Button><Button type="submit" className="gap-2" disabled={pending || (form.level !== "sektor" && !validParent)}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? "Simpan perubahan" : "Buat kategori"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteReview} onOpenChange={(open) => { if (!open && !remove.isPending) { setDeleteReview(null); setDeleteError(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Hapus kategori?</DialogTitle><DialogDescription>Kategori <strong>{deleteReview?.target.name}</strong> akan dihapus dari taksonomi.</DialogDescription></DialogHeader>
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm leading-6 text-foreground">
            {deleteReview ? <><strong>{deleteReview.count} tautan kategori KB</strong> pada dokumen akan dilepas. Dokumen dan isi Knowledge Base <strong>tidak dihapus</strong>.</> : "Data penggunaan wajib dimuat sebelum kategori dapat dihapus."}
          </div>
          {deleteReview && usageQuery.isSuccess && (usageQuery.data?.[deleteReview.target.id] ?? 0) !== deleteReview.count && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">Jumlah berubah menjadi {usageQuery.data?.[deleteReview.target.id] ?? 0}. Tutup lalu buka kembali dialog untuk meninjau dan mengonfirmasi jumlah terbaru.</p>
          )}
          {deleteError && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{deleteError}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setDeleteReview(null)} disabled={remove.isPending}>Batal</Button><Button variant="destructive" onClick={confirmDelete} disabled={!usageQuery.isSuccess || !deleteReview || !!deleteReview.target.children?.length || remove.isPending || (deleteReview ? (usageQuery.data?.[deleteReview.target.id] ?? 0) !== deleteReview.count : false)} className="gap-2">{remove.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Hapus kategori</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
