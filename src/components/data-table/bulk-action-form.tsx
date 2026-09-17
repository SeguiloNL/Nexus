"use client";

import * as React from "react";
import { useTransition } from "react";
import { useFormState } from "react-dom";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

export type BulkActionState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  count?: number;
};

interface BulkActionFormProps {
  action: (prev: BulkActionState, form: FormData) => Promise<BulkActionState>;
  ids: string[];
  clearSelection: () => void;
  children: React.ReactNode;
  confirmTitle?: string;
  confirmDescription?: string;
  confirmConfirmLabel?: string;
  onSuccess?: () => void;
}

export function BulkActionForm({
  action,
  ids,
  clearSelection,
  children,
  confirmTitle,
  confirmDescription,
  confirmConfirmLabel = "Bevestigen",
  onSuccess,
}: BulkActionFormProps) {
  const [state, formAction] = useFormState(action, { ok: false });
  const [isPending, startTransition] = useTransition();

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      clearSelection();
      onSuccess?.();
    } else if (!state.ok && state.error) {
      toast.error(state.error);
    }
  }, [state, clearSelection, onSuccess]);

  const handleSubmit = (formEl: HTMLFormElement) => {
    startTransition(() => {
      const fd = new FormData(formEl);
      formAction(fd);
    });
  };

  const form = (
    <form
      action={formAction as any}
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit(e.currentTarget);
      }}
    >
      <input type="hidden" name="ids" value={JSON.stringify(ids)} />
      {children}
    </form>
  );

  if (!confirmTitle) return form;

  return (
    <Dialog>
      <DialogTrigger asChild>{form}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmTitle}</DialogTitle>
          {confirmDescription ? (
            <DialogDescription>{confirmDescription}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          action={formAction as any}
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(e.currentTarget);
          }}
        >
          <input type="hidden" name="ids" value={JSON.stringify(ids)} />
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Annuleren
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Bezig…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {confirmConfirmLabel}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
        {state.error && !state.ok ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {state.error}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
