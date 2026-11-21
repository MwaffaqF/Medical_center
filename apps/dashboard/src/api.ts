import type {
  CenterAdminUpdateInput,
  CenterCreateInput,
  CenterSettingsInput,
  ChangePasswordInput,
  DoctorInput,
  DoctorServicesInput,
  LoginInput,
  MeResponse,
  SpecialtyInput,
  TemplatesUpdateInput,
  UserCreateInput,
  UserUpdateInput,
} from "@mc/shared";
import type { ActivityItem, Center, CenterWithCounts, Doctor, MessageTemplate, Specialty, StaffUser } from "./types";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(code);
  }
}

type ErrorBody = { error?: { code?: string; fields?: Record<string, string> } } | null;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiRequestError(0, "network_error");
  }
  const body = (await res.json().catch(() => null)) as ErrorBody;
  if (!res.ok) throw new ApiRequestError(res.status, body?.error?.code ?? "generic", body?.error?.fields ?? {});
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const send = <T>(method: string, path: string, body: unknown = {}) =>
  request<T>(path, { method, body: JSON.stringify(body) });
const upload = <T>(path: string, file: Blob) =>
  request<T>(path, { method: "PUT", body: file, headers: { "content-type": file.type } });

export const api = {
  // auth
  me: () => get<MeResponse>("/auth/me"),
  login: (input: LoginInput) => send<MeResponse>("POST", "/auth/login", input),
  logout: () => send<{ ok: true }>("POST", "/auth/logout"),
  changePassword: (input: ChangePasswordInput) => send<{ ok: true }>("POST", "/auth/change-password", input),
  mfaSetup: () => send<{ secret: string; otpauthUri: string }>("POST", "/auth/mfa/setup"),
  mfaVerify: (code: string) => send<MeResponse>("POST", "/auth/mfa/verify", { code }),

  // platform (super admin)
  admin: {
    stats: () => get<{ centers: number; activeUsers: number; usersSignedInLast7Days: number }>("/admin/stats"),
    centers: () => get<{ centers: CenterWithCounts[] }>("/admin/centers"),
    center: (id: string) => get<{ center: Center }>(`/admin/centers/${id}`),
    createCenter: (input: CenterCreateInput) => send<{ center: Center }>("POST", "/admin/centers", input),
    updateCenter: (id: string, input: CenterAdminUpdateInput) => send<{ center: Center }>("PATCH", `/admin/centers/${id}`, input),
    users: (centerId: string) => get<{ users: StaffUser[] }>(`/admin/centers/${centerId}/users`),
    createUser: (centerId: string, input: UserCreateInput) =>
      send<{ user: StaffUser; temporaryPassword: string }>("POST", `/admin/centers/${centerId}/users`, input),
    updateUser: (id: string, input: UserUpdateInput) => send<{ user: StaffUser }>("PATCH", `/admin/users/${id}`, input),
    resetPassword: (id: string) => send<{ temporaryPassword: string }>("POST", `/admin/users/${id}/reset-password`),
    startSupport: (centerId: string) => send<{ ok: true }>("POST", "/admin/support", { centerId }),
    exitSupport: () => send<{ ok: true }>("POST", "/admin/support/exit"),
    activity: (params: { centerId?: string; supportOnly?: boolean }) => {
      const q = new URLSearchParams();
      if (params.centerId) q.set("centerId", params.centerId);
      if (params.supportOnly) q.set("supportOnly", "1");
      return get<{ activity: ActivityItem[] }>(`/admin/activity?${q}`);
    },
  },

  // center (manager / support)
  center: {
    settings: () => get<{ center: Center }>("/center/settings"),
    updateSettings: (input: CenterSettingsInput) => send<{ center: Center }>("PATCH", "/center/settings", input),
    uploadLogo: (file: Blob) => upload<{ logoUrl: string }>("/center/logo", file),
    templates: () => get<{ templates: MessageTemplate[] }>("/center/templates"),
    updateTemplates: (input: TemplatesUpdateInput) => send<{ templates: MessageTemplate[] }>("PUT", "/center/templates", input),
    users: () => get<{ users: StaffUser[] }>("/center/users"),
    createUser: (input: UserCreateInput) => send<{ user: StaffUser; temporaryPassword: string }>("POST", "/center/users", input),
    updateUser: (id: string, input: UserUpdateInput) => send<{ user: StaffUser }>("PATCH", `/center/users/${id}`, input),
    resetPassword: (id: string) => send<{ temporaryPassword: string }>("POST", `/center/users/${id}/reset-password`),
    specialties: () => get<{ specialties: Specialty[] }>("/center/specialties"),
    createSpecialty: (input: SpecialtyInput) => send<{ specialty: Specialty }>("POST", "/center/specialties", input),
    updateSpecialty: (id: string, input: Partial<SpecialtyInput>) =>
      send<{ specialty: Specialty }>("PATCH", `/center/specialties/${id}`, input),
    doctors: () => get<{ doctors: Doctor[] }>("/center/doctors"),
    doctor: (id: string) => get<{ doctor: Doctor }>(`/center/doctors/${id}`),
    createDoctor: (input: DoctorInput) => send<{ doctor: Doctor }>("POST", "/center/doctors", input),
    updateDoctor: (id: string, input: Partial<DoctorInput>) => send<{ doctor: Doctor }>("PATCH", `/center/doctors/${id}`, input),
    updateServices: (id: string, input: DoctorServicesInput) =>
      send<{ doctor: Doctor }>("PUT", `/center/doctors/${id}/services`, input),
    uploadPhoto: (id: string, file: Blob) => upload<{ photoUrl: string }>(`/center/doctors/${id}/photo`, file),
    removePhoto: (id: string) => send<{ ok: true }>("DELETE", `/center/doctors/${id}/photo`),
  },
};
