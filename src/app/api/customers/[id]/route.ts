import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import { updateCustomerReference } from "@/server/customers/p0d-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleApi(
    request,
    { mutating: true, resourceType: "customer_reference" },
    ({ actor, body }) => updateCustomerReference(actor, id, body),
  );
}

export function GET() {
  return methodNotAllowed("PATCH");
}
export function POST() {
  return methodNotAllowed("PATCH");
}
export function PUT() {
  return methodNotAllowed("PATCH");
}
export function DELETE() {
  return methodNotAllowed("PATCH");
}
