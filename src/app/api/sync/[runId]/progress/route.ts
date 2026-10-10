import { NextRequest } from "next/server";
import { requirePermission, pickAuth } from "@/lib/rbac";
import { getCurrentUserOrNull } from "@/lib/auth/session";
import { subscribe, type SyncProgressState } from "@/lib/progress/sync-progress-registry";
import { RoleScope } from "@/types/enums";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const user = await getCurrentUserOrNull();
  if (!user) return new Response("Unauthorized", { status: 401 });
  try {
    await requirePermission(pickAuth(user as any), "import_from_inserve", "customer");
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const anyUser = user as any;
  if (anyUser.roleScope && anyUser.roleScope !== RoleScope.INTERNAL) {
    return new Response("Forbidden", { status: 403 });
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let idleTimeout: ReturnType<typeof setTimeout> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const encoder = new TextEncoder();

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      unsubscribe?.();
    } catch {
      /* noop */
    }
    if (idleTimeout) clearTimeout(idleTimeout);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    idleTimeout = null;
    keepaliveTimer = null;
    try {
      controller?.close();
    } catch {
      /* noop */
    }
    controller = null;
  };

  const touchIdle = () => {
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => close(), 45_000);
  };

  const sendEvent = (
    name: "progress" | "finalized" | "keepalive" | "error",
    data: unknown
  ) => {
    if (!controller || closed) return;
    try {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      controller.enqueue(
        encoder.encode(`event: ${name}\ndata: ${payload}\n\n`)
      );
      touchIdle();
    } catch {
      close();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      touchIdle();
      keepaliveTimer = setInterval(() => {
        sendEvent("keepalive", { t: Date.now() });
      }, 15_000);
      try {
        unsubscribe = subscribe(runId, (s: SyncProgressState) => {
          sendEvent("progress", s);
          if (
            s.overallStatus !== "PENDING" &&
            s.overallStatus !== "RUNNING"
          ) {
            sendEvent("finalized", {
              runId,
              status: s.overallStatus,
              percent: s.percent,
            });
            setTimeout(close, 750);
          }
        });
      } catch (subErr: any) {
        sendEvent("error", { message: (subErr as Error)?.message ?? String(subErr) });
        setTimeout(close, 300);
      }
    },
    cancel() {
      close();
    },
  });

  try {
    req.signal.addEventListener?.("abort", close);
  } catch {
    /* noop */
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Keep-Alive": "timeout=60",
    },
  });
}
