import { handleApi } from "@/server/api-guard";
import {
  createKpiTarget,
  listKpiTargets,
  patchKpiTarget,
} from "@/server/kpi/p0a-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "kpi_target" },
    ({ actor, url }) => listKpiTargets(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "kpi_target" },
    ({ actor, body }) => createKpiTarget(actor, body),
  );
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "kpi_target" },
    ({ actor, body }) => patchKpiTarget(actor, body),
  );
}
