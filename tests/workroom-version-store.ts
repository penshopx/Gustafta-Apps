import type { VersionBlobStore } from "../server/lib/workroom-source-versions";

/** Test-only store: no network, real SHA verification still runs in production code. */
export class FixtureVersionStore implements VersionBlobStore {
  readonly objects = new Map<string, Buffer>();
  readonly writes: string[] = [];
  failPut = false;
  failRead = false;
  failRemoveAfter: number | undefined;
  async put(key: string, bytes: Buffer) {
    if (this.objects.has(key)) throw new Error("Must never overwrite an existing archive object");
    this.writes.push(key);
    this.objects.set(key, Buffer.from(bytes));
    // Simulate an ambiguous transport failure: bytes persisted before rejection.
    if (this.failPut) throw new Error("PRIVATE PROVIDER FAILURE");
  }
  async read(key: string) {
    if (this.failRead) throw new Error("PRIVATE READ FAILURE");
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("Not found");
    return Buffer.from(bytes);
  }
  async remove(key: string) {
    if (this.failRemoveAfter !== undefined) {
      if (this.failRemoveAfter <= 0) throw new Error("PRIVATE DELETE FAILURE");
      this.failRemoveAfter--;
    }
    this.objects.delete(key);
  }
}
