import { reviewNotionMarker, type NotionMarkerConfirmation } from "../server/lexskripsi-notion-marker-repair";

// Usage: npx tsx scripts/review-lexskripsi-notion-marker.ts
//        npx tsx scripts/review-lexskripsi-notion-marker.ts --apply <marker-id> <old-owner-id> <orchestrator-id> <historical-notion-id>
// Review the read-only report first. Never run --apply from application startup.
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 5 || args[0] !== "--apply" ||
    args.slice(1).some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))))) {
  throw new Error("Gunakan tanpa argumen untuk diagnosis, atau --apply <marker-id> <old-owner-id> <orchestrator-id> <historical-notion-id>");
}
const confirmation: NotionMarkerConfirmation | undefined = args.length ? {
  markerId: Number(args[1]), oldOwnerId: Number(args[2]),
  orchestratorId: Number(args[3]), historicalNotionId: Number(args[4]),
} : undefined;
console.log(JSON.stringify(await reviewNotionMarker(confirmation), null, 2));