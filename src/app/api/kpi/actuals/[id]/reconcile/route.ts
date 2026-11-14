import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import { reconcileKpiActual } from "@/server/kpi/p0b2-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleApi(
    request,
    { mutating: true, resourceType: "kpi_actual_record" },
    ({ actor, body }) => reconcileKpiActual(actor, id, body),
  );
}

export function GET() {
  return methodNotAllowed("POST");
}

export function PATCH() {
  return methodNotAllowed("POST");
}

export function DELETE() {
  return methodNotAllowed("POST");
}
