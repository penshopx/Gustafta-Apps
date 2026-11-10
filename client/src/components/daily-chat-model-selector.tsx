import { AlertTriangle, BrainCircuit, Check, Info, LockKeyhole, Sparkles } from "lucide-react";
import { DAILY_CHAT_MODELS } from "@shared/daily-chat-models";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DailyChatModelSelectorProps {
  value: string;
  legacyValue?: string;
  onValueChange: (value: string) => void;
}

const EMPTY_VALUE_MARKER = "__daily_chat_empty_value__";

const providerNotes: Record<string, string> = {
  openai: "Respons harian melalui OpenAI.",
  deepseek: "Respons harian melalui DeepSeek.",
  nvidia: "Respons harian melalui NVIDIA. Kredit tetap mengikuti kuota penyedia—bukan gratis tanpa batas.",
  gemini: "Respons harian melalui Gemini.",
};

export function DailyChatModelSelector({
  value,
  legacyValue,
  onValueChange,
}: DailyChatModelSelectorProps) {
  const selectedModel = DAILY_CHAT_MODELS.find((model) => model.id === value);
  const hasLegacyChoice = legacyValue !== undefined && !DAILY_CHAT_MODELS.some((model) => model.id === legacyValue);
  const selectedIsLegacy = hasLegacyChoice && value === legacyValue;
  const valueIsUnknown = !selectedModel && !selectedIsLegacy;
  const selectValue = value === "" ? EMPTY_VALUE_MARKER : value;

  return (
    <section
      className="overflow-hidden rounded-lg border border-primary/20 bg-card shadow-sm transition-shadow duration-200 hover:shadow-md"
      data-testid="daily-chat-model-selector"
      aria-labelledby="daily-chat-model-heading"
    >
      <div className="h-1 bg-gradient-to-r from-primary via-primary/70 to-amber-500" />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BrainCircuit className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="daily-chat-model-heading" className="text-base font-semibold text-foreground">
                Model chat harian
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Pilih manual
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Untuk percakapan harian. Claude digunakan terpisah untuk membangun dan menyempurnakan brain/system prompt, bukan sebagai pilihan model harian.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="daily-chat-model">Penyedia model</Label>
          <Select
            value={selectValue}
            onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_VALUE_MARKER ? "" : nextValue)}
          >
            <SelectTrigger
              id="daily-chat-model"
              aria-label="Model chat harian"
              data-testid="daily-chat-model-select"
              className="min-h-11 border-border bg-background transition-colors focus-visible:ring-primary"
            >
              <SelectValue placeholder="Pilih model chat harian" />
            </SelectTrigger>
            <SelectContent>
              {valueIsUnknown && (
                <SelectItem value={selectValue} disabled data-testid="daily-chat-model-unknown">
                  Nilai tersimpan tidak dikenal — {value || "(kosong)"}
                </SelectItem>
              )}
              {DAILY_CHAT_MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id} data-testid={`daily-chat-model-option-${model.provider}`}>
                  {model.label}
                </SelectItem>
              ))}
              {hasLegacyChoice && (
                <SelectItem value={legacyValue === "" ? EMPTY_VALUE_MARKER : legacyValue} data-testid="daily-chat-model-legacy">
                  Pertahankan konfigurasi lama · {legacyValue || "(kosong)"}
                </SelectItem>
              )}
            </SelectContent>
          </Select>

          {selectedModel ? (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground" aria-live="polite" data-testid="daily-chat-model-status">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              {providerNotes[selectedModel.provider]}
            </p>
          ) : selectedIsLegacy ? (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground" aria-live="polite" data-testid="daily-chat-model-status">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              Konfigurasi lama dipertahankan dan tetap memakai perilaku sebelumnya.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-destructive" role="status" data-testid="daily-chat-model-status">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Nilai model saat ini tidak ada di katalog. Tidak ada penyedia lain yang dipilih otomatis.
            </p>
          )}
        </div>

        <div className="grid gap-2 rounded-md border border-border/70 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
          <p className="flex items-start gap-2">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            Kunci platform dikelola di server. Tidak perlu memasukkan API key; menu ini juga tidak menguji koneksi atau kredit.
          </p>
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            Penyedia baru yang gagal akan menampilkan kegagalan—tidak beralih diam-diam ke penyedia lain.
          </p>
          <p className="sm:col-span-2">
            Pilihan ini bukan batas tagihan seluruh aplikasi. Embedding/RAG, alat,
            dan analisis Workroom memiliki jalur serta batas pemakaian tersendiri.
          </p>
        </div>
      </div>
    </section>
  );
}
