import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@mc/shared";
import { api, ApiRequestError } from "./api";

export const ME_KEY = ["me"] as const;

/** Current staff user, or null when signed out. */
export function useMe() {
  return useQuery<SessionUser | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await api.me()).user;
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
  return (user: SessionUser | null) => qc.setQueryData(ME_KEY, user);
}
