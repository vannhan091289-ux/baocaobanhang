import type { NextRequest } from "next/server";
import { handleApi, methodNotAllowed } from "@/server/api-guard";
import {
  createKpiActual,
  listKpiActuals,
  patchKpiActual,
} from "@/server/kpi/p0b2-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(
    request,
    { mutating: false, resourceType: "kpi_actual_record" },
    ({ actor, url }) => listKpiActuals(actor, url),
  );
}

export async function POST(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "kpi_actual_record" },
    ({ actor, body }) => createKpiActual(actor, body),
  );
}

export async function PATCH(request: NextRequest) {
  return handleApi(
    request,
    { mutating: true, resourceType: "kpi_actual_record" },
    ({ actor, body }) => patchKpiActual(actor, body),
  );
}

export function DELETE() {
  return methodNotAllowed("GET, POST, PATCH");
}
