import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useSetMe } from "../auth";
import { useI18n } from "../i18n";
import { Alert, Button, TextField } from "../ui";
import { ApiRequestError } from "../api";
import { AuthCard } from "./auth/AuthCard";

export function LoginPage() {
  const { t, tx } = useI18n();
  const navigate = useNavigate();
  const setMe = useSetMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMe(await api.login({ email, password }));
      navigate("/", { replace: true });
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : "generic";
      setError(tx(`auth.error.${code}`, tx(`error.${code}`, t("auth.error.generic"))));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t("auth.title")} showLogout={false}>
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label={t("auth.email")}
          type="email"
          dir="ltr"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label={t("auth.password")}
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" busy={busy} className="w-full py-2.5">
          {t("auth.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
