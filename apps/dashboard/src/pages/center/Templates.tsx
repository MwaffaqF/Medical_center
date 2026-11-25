import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { MESSAGE_TEMPLATE_KEYS, type MessageTemplateKey } from "@mc/shared";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import type { MessageTemplate } from "../../types";
import { Alert, Button, Card, Loading, PageHeader, TextAreaField, useErrorText, useFlash } from "../../ui";

const KEY = ["center", "templates"];

export function TemplatesPage() {
  const { t } = useI18n();
  const templates = useQuery({ queryKey: KEY, queryFn: api.center.templates });
  return (
    <>
      <PageHeader title={t("templates.title")} />
      <p className="mb-6 max-w-2xl text-sm text-slate-600">{t("templates.intro")}</p>
      {templates.isPending ? <Loading /> : <TemplatesForm templates={templates.data?.templates ?? []} />}
    </>
  );
}

function TemplatesForm({ templates }: { templates: MessageTemplate[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [flash, setFlash] = useFlash();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      MESSAGE_TEMPLATE_KEYS.map((k) => {
        const tpl = templates.find((x) => x.key === k);
        return [k, { bodyAr: tpl?.bodyAr ?? "", bodyEn: tpl?.bodyEn ?? "" }];
      }),
    ) as Record<MessageTemplateKey, { bodyAr: string; bodyEn: string }>,
  );

  const save = useMutation({
    mutationFn: () =>
      api.center.updateTemplates({
        templates: MESSAGE_TEMPLATE_KEYS.filter((k) => values[k].bodyAr.trim() && values[k].bodyEn.trim()).map((k) => ({
          key: k,
          ...values[k],
        })),
      }),
    onSuccess: (r) => {
      qc.setQueryData(KEY, r);
      setError(null);
      setFlash(t("common.saved"));
    },
    onError: (e) => setError(errorText(e).message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {MESSAGE_TEMPLATE_KEYS.map((k) => (
        <Card key={k} title={t(`templates.${k}`)}>
          <div className="grid gap-4 lg:grid-cols-2">
            <TextAreaField
              label={t("common.arabic")}
              dir="rtl"
              rows={5}
              value={values[k].bodyAr}
              onChange={(e) => setValues((v) => ({ ...v, [k]: { ...v[k], bodyAr: e.target.value } }))}
            />
            <TextAreaField
              label={t("common.english")}
              dir="ltr"
              rows={5}
              value={values[k].bodyEn}
              onChange={(e) => setValues((v) => ({ ...v, [k]: { ...v[k], bodyEn: e.target.value } }))}
            />
          </div>
        </Card>
      ))}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl">
        {error && <Alert>{error}</Alert>}
        {flash && <span className="text-sm text-emerald-700">{flash}</span>}
        <Button type="submit" busy={save.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
