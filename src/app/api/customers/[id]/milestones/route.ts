import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import { createCustomerMilestone } from "@/server/customers/p0d-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleApi(
    request,
    { mutating: true, resourceType: "customer_milestone" },
    ({ actor, body }) => createCustomerMilestone(actor, id, body),
  );
}

export function GET() {
  return methodNotAllowed("POST");
}
export function PUT() {
  return methodNotAllowed("POST");
}
export function PATCH() {
  return methodNotAllowed("POST");
}
export function DELETE() {
  return methodNotAllowed("POST");
}
