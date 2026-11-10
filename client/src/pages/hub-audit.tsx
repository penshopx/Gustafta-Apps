import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Network, Zap, Wand2, CheckCircle2, ChevronDown, ChevronRight, Copy, Save, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";

interface Candidate {
  agent_id: number;
  agent_name: string;
  is_orchestrator: boolean;
  toolbox_name: string;
  toolbox_id: number;
}

interface HubItem {
  hub_id: number;
  hub_name: string;
  hub_slug: string;
  toolbox_id: number;
  toolbox_name: string;
  series_id: string | null;
  prompt_len: number;
  prompt_preview: string;
  agentic_sub_agents_raw: string;
  toolbox_is_orch: boolean;
  candidates: Candidate[];
}

function getConnectedSubAgentCount(raw: string): number {
  try {
    const parsed = JSON.parse(raw || "[]");
    const normalized = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    return Array.isArray(normalized) ? normalized.length : 0;
  } catch {
    return 0;
  }
}

export function HubRow({ hub }: { hub: HubItem }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  const nonOrcCandidates = hub.candidates.filter(c => !c.is_orchestrator);
  const connectedCount = getConnectedSubAgentCount(hub.agentic_sub_agents_raw);

  const autoConnect = useMutation({
    mutationFn: async () => {
      // Raw fetch (bukan apiRequest) agar status 207 vs 200 bisa diperiksa.
      const res = await fetch(`/api/admin/hub-audit/${hub.hub_id}/auto-connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: Array.from(selectedIds) }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        throw new Error(data.error || `${res.status}: gagal menghubungkan sub-agen`);
      }
      return { status: res.status, ...data };
    },
    onSuccess: (data: { status: number; agenticSubAgents?: any[]; skipped?: number[] }) => {
      const wiredCount = data.agenticSubAgents?.length ?? 0;
      if (data.status === 207 && (data.skipped?.length ?? 0) > 0) {
        toast({
          title: "⚠️ Sebagian kandidat dilewati",
          description: `${wiredCount} agen terhubung. Dilewati (tidak ditemukan): #${data.skipped!.join(", #")}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "✅ Sub-agen terhubung!", description: `${wiredCount} agen berhasil dikonfigurasi.` });
      }
      qc.invalidateQueries({ queryKey: ["/api/admin/hub-audit"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });

  const resetToSolo = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/hub-audit/${hub.hub_id}/auto-connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: [] }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `${res.status}: gagal mereset hub ke solo`);
      }
      return data;
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      toast({
        title: "Hub direset ke solo",
        description: "Semua sub-agen dilepas dan harga kembali ke tier solo Rp299.000.",
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/hub-audit"] });
    },
    onError: (e: any) => toast({ title: "Reset gagal", description: e.message, variant: "destructive" }),
  });

  const savePrompt = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/admin/hub-audit/${hub.hub_id}/save-prompt`, { prompt: generatedPrompt }),
    onSuccess: () => {
      toast({ title: "✅ Prompt tersimpan!" });
      qc.invalidateQueries({ queryKey: ["/api/admin/hub-audit"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" })
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const selectedNames = nonOrcCandidates
        .filter(c => selectedIds.has(c.agent_id))
        .map(c => c.agent_name);
      const res = await apiRequest("POST", `/api/admin/hub-audit/${hub.hub_id}/generate-prompt`, {
        hubName: hub.hub_name,
        subAgentNames: selectedNames.length > 0 ? selectedNames : nonOrcCandidates.map(c => c.agent_name),
        existingPrompt: hub.prompt_preview
      });
      const data = res;
      setGeneratedPrompt(data.prompt || "");
    } catch (e: any) {
      toast({ title: "Error generate", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const toggleAll = () => {
    if (selectedIds.size === nonOrcCandidates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(nonOrcCandidates.map(c => c.agent_id)));
    }
  };

  return (
    <div className="border rounded-lg mb-3 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
        <Network className="w-4 h-4 text-purple-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{hub.hub_name}</div>
          <div className="text-xs text-muted-foreground truncate">{hub.toolbox_name}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-[10px]">
            {hub.prompt_len} chars
          </Badge>
          <Badge variant={nonOrcCandidates.length > 0 ? "secondary" : "destructive"} className="text-[10px]">
            {nonOrcCandidates.length} kandidat
          </Badge>
          <Badge variant={connectedCount > 0 ? "default" : "outline"} className="text-[10px]">
            {connectedCount} sub-agen
          </Badge>
        </div>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-4 bg-muted/20">
          {/* Prompt Preview */}
          {hub.prompt_preview && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">PROMPT SAAT INI</div>
              <div className="text-xs bg-muted rounded p-2 text-muted-foreground line-clamp-3">{hub.prompt_preview}…</div>
            </div>
          )}

          {/* Candidate sub-agents */}
          {nonOrcCandidates.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-muted-foreground">PILIH SUB-AGEN ({nonOrcCandidates.length})</div>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={toggleAll}>
                  {selectedIds.size === nonOrcCandidates.length ? "Batalkan Semua" : "Pilih Semua"}
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {nonOrcCandidates.map(c => (
                  <label key={c.agent_id} className="flex items-center gap-2 cursor-pointer hover:bg-muted rounded px-2 py-1 text-sm">
                    <Checkbox
                      checked={selectedIds.has(c.agent_id)}
                      onCheckedChange={(v) => {
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          v ? next.add(c.agent_id) : next.delete(c.agent_id);
                          return next;
                        });
                      }}
                    />
                    <span className="text-xs flex-1 truncate">{c.agent_name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">#{c.agent_id}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">Tidak ada kandidat sub-agen dalam series yang sama.</div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={selectedIds.size === 0 || autoConnect.isPending}
              onClick={() => autoConnect.mutate()}
              data-testid={`btn-auto-connect-${hub.hub_id}`}
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              {autoConnect.isPending ? "Menghubungkan…" : `Hubungkan (${selectedIds.size})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={generating}
              onClick={handleGenerate}
              data-testid={`btn-generate-prompt-${hub.hub_id}`}
            >
              <Wand2 className="w-3.5 h-3.5 mr-1.5" />
              {generating ? "Generating…" : "Generate Prompt"}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={connectedCount === 0 || resetToSolo.isPending}
                  data-testid={`btn-reset-solo-${hub.hub_id}`}
                >
                  <Unplug className="w-3.5 h-3.5 mr-1.5" />
                  {resetToSolo.isPending ? "Mereset…" : "Reset ke solo"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset {hub.hub_name} ke solo?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tindakan ini akan melepas seluruh {connectedCount} sub-agen dan mengembalikan harga Store ke tier solo Rp299.000.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid={`btn-cancel-reset-solo-${hub.hub_id}`}>
                    Batal
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => resetToSolo.mutate()}
                    data-testid={`btn-confirm-reset-solo-${hub.hub_id}`}
                  >
                    Ya, reset ke solo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Generated prompt */}
          {generatedPrompt && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">PROMPT YANG DIGENERATE</div>
              <Textarea
                value={generatedPrompt}
                onChange={e => setGeneratedPrompt(e.target.value)}
                className="text-xs min-h-[160px] font-mono"
                data-testid={`textarea-prompt-${hub.hub_id}`}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => savePrompt.mutate()}
                  disabled={savePrompt.isPending}
                  data-testid={`btn-save-prompt-${hub.hub_id}`}
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  {savePrompt.isPending ? "Menyimpan…" : "Simpan Prompt"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { navigator.clipboard.writeText(generatedPrompt); toast({ title: "Disalin!" }); }}
                >
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  Copy
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HubAudit() {
  const [filter, setFilter] = useState<"all" | "has-candidates" | "no-candidates">("all");
  const [search, setSearch] = useState("");

  const { data: hubs = [], isLoading, error } = useQuery<HubItem[]>({
    queryKey: ["/api/admin/hub-audit"],
  });

  const filtered = hubs.filter(h => {
    const nonOrc = h.candidates.filter(c => !c.is_orchestrator);
    const matchFilter =
      filter === "all" ? true :
      filter === "has-candidates" ? nonOrc.length > 0 :
      nonOrc.length === 0;
    const matchSearch = !search || h.hub_name.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const totalWithCandidates = hubs.filter(h => h.candidates.filter(c => !c.is_orchestrator).length > 0).length;
  const totalNoCandidates = hubs.filter(h => h.candidates.filter(c => !c.is_orchestrator).length === 0).length;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <Network className="w-6 h-6 text-purple-500" />
            <h1 className="text-2xl font-bold">Hub Audit</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Audit dan atur koneksi sub-agen untuk seluruh Hub Orchestrator.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-600">{hubs.length}</div>
            <div className="text-xs text-muted-foreground">Total Hub</div>
          </div>
          <div className="border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{totalWithCandidates}</div>
            <div className="text-xs text-muted-foreground">Punya Kandidat</div>
          </div>
          <div className="border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{totalNoCandidates}</div>
            <div className="text-xs text-muted-foreground">Tanpa Kandidat</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <input
            type="text"
            placeholder="Cari nama Hub…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-48 text-sm border rounded-md px-3 py-1.5 bg-background"
            data-testid="input-hub-search"
          />
          {(["all", "has-candidates", "no-candidates"] as const).map(f => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
              data-testid={`filter-${f}`}
            >
              {f === "all" ? "Semua" : f === "has-candidates" ? "Ada Kandidat" : "Tanpa Kandidat"}
            </Button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Memuat data Hub…</div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">Gagal memuat data. Pastikan sudah login.</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
            Tidak ada Hub yang kosong!
          </div>
        ) : (
          <div>
            <div className="text-xs text-muted-foreground mb-3">Menampilkan {filtered.length} Hub</div>
            {filtered.map(hub => (
              <HubRow key={hub.hub_id} hub={hub} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
