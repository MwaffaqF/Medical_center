import { api } from "../../api";
import { useI18n } from "../../i18n";
import { PageHeader } from "../../ui";
import { StaffList } from "../shared/StaffList";

export function StaffPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("staff.title")} />
      <StaffList
        title={t("centers.staff")}
        queryKey={["center", "users"]}
        load={api.center.users}
        create={api.center.createUser}
        update={api.center.updateUser}
        resetPassword={api.center.resetPassword}
      />
    </>
  );
}
