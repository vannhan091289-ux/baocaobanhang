import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  listAlertRules,
  patchAlertRule,
} from "@/server/alerts/p0c-alerts-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "alert_rule_config" },
    ({ actor, url }) => listAlertRules(actor, url),
  );
}

export async function PATCH(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "alert_rule_config" },
    ({ actor, body }) => patchAlertRule(actor, body),
  );
}

export function POST() {
  return methodNotAllowed("GET, PATCH");
}

export function DELETE() {
  return methodNotAllowed("GET, PATCH");
}
