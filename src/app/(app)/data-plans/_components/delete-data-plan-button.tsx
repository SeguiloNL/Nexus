"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteDataPlanAction } from "../actions";

interface Props {
  planId: string;
  planName: string;
  disabled?: boolean;
}

export function DeleteDataPlanButton({ planId, planName, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  async function handleDelete() {
    start(async () => {
      try {
        const result = await deleteDataPlanAction(planId);
        if (result.ok) {
          toast.success(result.message ?? "Dataplan is verwijderd.");
          setOpen(false);
          router.replace("/data-plans");
          router.refresh();
        } else {
          toast.error(result.error ?? "Kon dataplan niet verwijderen.");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || pending} className="text-red-700 hover:bg-red-50 hover:text-red-800 border-red-200">
          <Trash2 className="mr-2 h-4 w-4" />
          Verwijderen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dataplan verwijderen</DialogTitle>
          <DialogDescription>
            Weet je zeker dat je <strong>{planName}</strong> wilt verwijderen?
            Dit kan niet ongedaan worden gemaakt. Gebruikte plannen kunnen niet
            worden verwijderd — deactiveer ze dan in plaats van verwijderen.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Annuleren
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            {pending ? "Bezig…" : "Definitief verwijderen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
