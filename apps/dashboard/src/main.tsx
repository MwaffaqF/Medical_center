import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import type { SessionUser } from "@mc/shared";
import { useMe } from "./auth";
import { I18nProvider } from "./i18n";
import { AppShell } from "./layout";
import { ActivityPage } from "./pages/admin/Activity";
import { CenterDetailPage } from "./pages/admin/CenterDetail";
import { CentersPage } from "./pages/admin/Centers";
import { AccountPasswordPage, ForcedPasswordPage } from "./pages/auth/ChangePassword";
import { MfaPage } from "./pages/auth/Mfa";
import { DoctorEditPage } from "./pages/center/DoctorEdit";
import { DoctorsPage } from "./pages/center/Doctors";
import { SettingsPage } from "./pages/center/Settings";
import { SpecialtiesPage } from "./pages/center/Specialties";
import { StaffPage } from "./pages/center/Staff";
import { TemplatesPage } from "./pages/center/Templates";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { Loading } from "./ui";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Gate({ children }: { children: (user: SessionUser) => ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (!me.data) return <Navigate to="/login" replace />;
  const { user, restriction } = me.data;
  if (restriction === "mfa_setup") return <MfaPage setup />;
  if (restriction === "mfa") return <MfaPage setup={false} />;
  if (restriction === "password") return <ForcedPasswordPage />;
  return <AppShell user={user}>{children(user)}</AppShell>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.data) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes({ user }: { user: SessionUser }) {
  const isAdmin = user.role === "super_admin";
  const inCenter = !isAdmin || !!user.supportCenterId;
  const canConfigure = inCenter && (user.role === "manager" || isAdmin);
  return (
    <Routes>
      <Route path="/" element={inCenter ? <HomePage user={user} /> : <Navigate to="/admin" replace />} />
      {isAdmin && (
        <>
          <Route path="/admin" element={<CentersPage />} />
          <Route path="/admin/centers/:id" element={<CenterDetailPage />} />
          <Route path="/admin/activity" element={<ActivityPage />} />
        </>
      )}
      {canConfigure && (
        <>
          <Route path="/doctors" element={<DoctorsPage />} />
          <Route path="/doctors/:id" element={<DoctorEditPage />} />
          <Route path="/specialties" element={<SpecialtiesPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/templates" element={<TemplatesPage />} />
        </>
      )}
      <Route path="/account/password" element={<AccountPasswordPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={
                <GuestOnly>
                  <LoginPage />
                </GuestOnly>
              }
            />
            <Route path="/*" element={<Gate>{(user) => <AppRoutes user={user} />}</Gate>} />
          </Routes>
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
