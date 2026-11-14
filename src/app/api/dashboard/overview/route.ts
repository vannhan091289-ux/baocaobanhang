import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import { getDashboardOverview } from "@/server/kpi/p0b2-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "dashboard_overview" },
    ({ actor, url }) => getDashboardOverview(actor, url),
  );
}

export function POST() {
  return methodNotAllowed("GET");
}

export function PATCH() {
  return methodNotAllowed("GET");
}

export function DELETE() {
  return methodNotAllowed("GET");
}
