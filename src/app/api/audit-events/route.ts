import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import { listAuditEvents } from "@/server/audit-query-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "audit_event" },
    ({ actor, url }) => listAuditEvents(actor, url),
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
