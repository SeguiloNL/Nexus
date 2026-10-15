import { NextResponse } from "next/server";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import { listAvailableDataPlansForCustomer } from "@/server/services/data-plan.service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/data-plans/available?customerId=...
 *
 * Retourneert de actieve, niet-vervallen Sim-only dataplannen die beschikbaar
 * zijn voor de opgegeven klant (op basis van klanttype + regio) én gekoppeld
 * zijn aan een actief factureerbaar product. Wordt door de activatie-wizard
 * event-driven aangeroepen zodra voor Sim-only wordt gekozen.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Niet ingelogd." },
      { status: 401 },
    );
  }

  const allowed =
    canUserRole(user.permissions, "create", "activation_order") ||
    canUserRole(user.permissions, "edit", "activation_order");
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "Onvoldoende rechten." },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId");
  if (!customerId) {
    return NextResponse.json(
      { ok: false, error: "customerId is verplicht." },
      { status: 400 },
    );
  }

  const scope = user.customerIds ?? [];
  if (scope.length > 0 && !scope.includes(customerId)) {
    return NextResponse.json(
      { ok: false, error: "Klant valt niet binnen je toegang." },
      { status: 403 },
    );
  }

  try {
    const result = await listAvailableDataPlansForCustomer({ customerId });
    // JSON-veilig maken (BigInt/Decimal → primitives).
    const plans = result.plans.map((p) => ({
      id: p.id,
      name: p.name,
      dataAmountBytes: p.dataAmountBytes != null ? p.dataAmountBytes.toString() : null,
      dataAmountDisplayUnit: p.dataAmountDisplayUnit,
      monthlyPrice:
        p.monthlyPrice != null ? Number(p.monthlyPrice as any) : null,
      currency: p.currency,
      validityDays: p.validityDays,
      validityBillingCycle: p.validityBillingCycle,
      provider: p.provider,
      productId: p.productId,
      productName: p.productName,
      targetRegions: p.targetRegions,
      targetCustomerTypes: p.targetCustomerTypes,
      availableUntil: p.availableUntil ? p.availableUntil.toISOString() : null,
    }));

    return NextResponse.json({
      ok: true,
      customerType: result.customerType,
      region: result.region,
      plans,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[data-plans/available] fout voor klant ${customerId}: ${message}`);
    return NextResponse.json(
      { ok: false, error: "Dataplannen konden niet geladen worden." },
      { status: 500 },
    );
  }
}
