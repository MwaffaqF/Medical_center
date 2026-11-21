import type { LoginInput, SessionUser } from "@mc/shared";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  if (!res.ok) throw new ApiRequestError(res.status, body?.error?.code ?? "network_error");
  return body as T;
}

export const api = {
  me: () => request<{ user: SessionUser }>("/auth/me"),
  login: (input: LoginInput) => request<{ user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST", body: "{}" }),
};
