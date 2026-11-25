import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeResponse } from "@mc/shared";
import { api, ApiRequestError } from "./api";

export const ME_KEY = ["me"] as const;

/** Current session (user + restriction), or null when signed out. */
export function useMe() {
  return useQuery<MeResponse | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (me: MeResponse | null) => {
    qc.setQueryData(ME_KEY, me);
    if (!me) qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
  };
}

/** Refetch the session and drop cached data (after entering/leaving support mode). */
export function useRefreshSession() {
  const qc = useQueryClient();
  return async () => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
    await qc.invalidateQueries({ queryKey: ME_KEY });
  };
}
