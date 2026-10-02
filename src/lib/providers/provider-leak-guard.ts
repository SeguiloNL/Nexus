import type { RoleScope } from "@/types/enums";
import { RoleScope as _RoleScope } from "@/types/enums";

const PROVIDER_NAME_HINT_RE = /[Ss]imhuis/;
const WARNING_PREFIX = "[PROVIDER_NAME_LEAK_WARNING]";

interface ProviderLeakContext {
  readonly userId?: string;
  readonly userRole?: string;
  readonly roleScope?: RoleScope | string | null;
  readonly actionName: string;
  readonly source: string;
  readonly allowed?: boolean;
}

export function containsProviderBrandName(value: string | null | undefined): boolean {
  if (!value) return false;
  return PROVIDER_NAME_HINT_RE.test(value);
}

function isAllowedScope(roleScope: RoleScope | string | null | undefined): boolean {
  if (roleScope == null) return false;
  return roleScope === _RoleScope.INTERNAL || roleScope === "INTERNAL";
}

export function assertNoProviderNameLeak(
  messageParts: ReadonlyArray<string | null | undefined>,
  context: ProviderLeakContext
): void {
  try {
    if (context.allowed === true) return;
    if (isAllowedScope(context.roleScope)) return;

    for (const part of messageParts) {
      if (containsProviderBrandName(part)) {
        console.warn(
          WARNING_PREFIX,
          JSON.stringify({
            timestamp: new Date().toISOString(),
            action: context.actionName,
            source: context.source,
            userId: context.userId ?? "unknown",
            userRole: context.userRole ?? "unknown",
            roleScope: context.roleScope ?? "unknown",
            hint:
              "User-facing message contains SIM-provider brand name while user does not have INTERNAL scope. Consider using the generic provider label in this response.",
            sample: String(part).slice(0, 160),
          })
        );
        return;
      }
    }
  } catch (err) {
    void err;
  }
}
