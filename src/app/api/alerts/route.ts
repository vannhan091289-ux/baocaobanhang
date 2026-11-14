import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  evaluateP0Alerts,
  listInAppAlerts,
} from "@/server/alerts/p0c-alerts-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "in_app_alert" },
    ({ actor, url }) => listInAppAlerts(actor, url),
  );
}

export async function POST(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "in_app_alert" },
    ({ actor, body }) => evaluateP0Alerts(actor, body),
  );
}

export function PATCH() {
  return methodNotAllowed("GET, POST");
}

export function DELETE() {
  return methodNotAllowed("GET, POST");
}
