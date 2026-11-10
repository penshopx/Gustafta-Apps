import { useEffect } from "react";
import { useTaxonomy } from "@/hooks/use-taxonomy";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface KnowledgeTaxonomySelectProps {
  taxonomyId: number | null;
  onChange: (taxonomyId: number | null) => void;
}

/** New-document choices only. Existing documents keep their stored taxonomyId. */
export function KnowledgeTaxonomySelect({ taxonomyId, onChange }: KnowledgeTaxonomySelectProps) {
  const { data: taxonomy = [], isSuccess } = useTaxonomy(true, { activeOnly: true });
  const sektor = taxonomy.find((node) =>
    node.id === taxonomyId || node.children.some((child) => child.id === taxonomyId)
  );
  const subId = sektor?.children.find((child) => child.id === taxonomyId)?.id;
  const subsektorOptions = sektor?.children ?? [];

  // A category may be deactivated while the add dialog is open. Never leave
  // an invisible draft selection that could be submitted as a new assignment.
  useEffect(() => {
    if (isSuccess && taxonomyId != null && !sektor) onChange(null);
  }, [isSuccess, taxonomyId, sektor, onChange]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="kb-sektor" className="text-xs">Sektor</Label>
        <Select value={sektor?.id.toString() ?? "none"} onValueChange={(value) =>
          onChange(value === "none" ? null : Number(value))
        }>
          <SelectTrigger id="kb-sektor" data-testid="select-kb-sektor">
            <SelectValue placeholder="Pilih sektor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Tanpa Taksonomi —</SelectItem>
            {taxonomy.map((node) => (
              <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kb-subsektor" className="text-xs">Subsektor</Label>
        <Select
          value={subId?.toString() ?? "none"}
          onValueChange={(value) => onChange(value === "none" ? sektor?.id ?? null : Number(value))}
          disabled={!sektor || subsektorOptions.length === 0}
        >
          <SelectTrigger id="kb-subsektor" data-testid="select-kb-subsektor">
            <SelectValue placeholder={sektor ? "Pilih subsektor" : "Pilih sektor dulu"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Sektor Saja —</SelectItem>
            {subsektorOptions.map((node) => (
              <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
