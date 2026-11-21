import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useMe } from "./auth";
import { I18nProvider, useI18n } from "./i18n";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import "./index.css";

const queryClient = new QueryClient();

function Loading() {
  const { t } = useI18n();
  return <p className="p-8 text-center text-slate-500">{t("common.loading")}</p>;
}

function Protected({ children }: { children: (user: NonNullable<ReturnType<typeof useMe>["data"]>) => ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (!me.data) return <Navigate to="/login" replace />;
  return <>{children(me.data)}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.data) return <Navigate to="/" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/*" element={<Protected>{(user) => <HomePage user={user} />}</Protected>} />
          </Routes>
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
