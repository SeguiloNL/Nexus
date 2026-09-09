import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findSimById } from "@/server/services/sim.service";
import { SimDetail } from "../_components/sim-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import { deleteSimAction, updateSimAction } from "../actions";

export default async function SimDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "sim")) {
    throw new PermissionError("Je mag geen SIM-kaarten bekijken.");
  }

  const sim = await findSimById(params.id);
  if (!sim) notFound();

  const deleteAction: any = deleteSimAction.bind(null, params.id);
  const updateAction: any = async (
    prev: any,
    formData: FormData
  ) => updateSimAction(params.id, prev, formData);

  return (
    <SimDetail
      sim={sim as any}
      role={session.user.role}
      updateAction={updateAction}
      deleteAction={deleteAction}
      simId={params.id}
    />
  );
}
