// Workroom IDs are private resources. Resolve the parent before reading children
// or writing gates/logs; do not accept parseInt prefixes such as "12-other".
export async function getOwnedWorkroom(
  req: any,
  getWorkroom: (id: number) => Promise<{ id: number; userId: string; [key: string]: any } | undefined>,
): Promise<{ workroom: any; userId: string } | null> {
  const userId = req.user?.claims?.sub || req.user?.id || req.session?.emailUser?.id;
  if (!userId || !/^[1-9]\d*$/.test(String(req.params.id))) return null;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return null;
  const workroom = await getWorkroom(id);
  if (!workroom || workroom.userId !== userId) return null;
  return { workroom, userId };
}