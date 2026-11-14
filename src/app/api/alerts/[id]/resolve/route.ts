import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import { resolveInAppAlert } from "@/server/alerts/p0c-alerts-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleApi(
    request,
    { mutating: true, resourceType: "in_app_alert" },
    ({ actor, body }) => resolveInAppAlert(actor, id, body),
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
