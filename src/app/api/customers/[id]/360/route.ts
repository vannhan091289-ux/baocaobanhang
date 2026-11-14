import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import { getCustomer360 } from "@/server/customers/p0d-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleApi(
    request,
    { mutating: false, resourceType: "customer_reference" },
    ({ actor }) => getCustomer360(actor, id),
  );
}

export function POST() {
  return methodNotAllowed("GET");
}
export function PUT() {
  return methodNotAllowed("GET");
}
export function PATCH() {
  return methodNotAllowed("GET");
}
export function DELETE() {
  return methodNotAllowed("GET");
}
