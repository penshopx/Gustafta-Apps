import { useQuery } from "@tanstack/react-query";

/** Same resolved role that the admin endpoints enforce, including configured email/ID grants. */
export function useAdminStatus(enabled = true) {
  return useQuery<{ isAdmin: boolean; isSuperAdmin: boolean }>({
    queryKey: ["/api/admin/me"],
    enabled,
    retry: false,
  });
}
