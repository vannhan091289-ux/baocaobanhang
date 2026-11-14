import { handleApi } from "@/server/api-guard";
import {
  createKpiDefinition,
  listKpiDefinitions,
  patchKpiDefinition,
} from "@/server/kpi/p0a-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "kpi_definition" },
    ({ actor, url }) => listKpiDefinitions(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "kpi_definition" },
    ({ actor, body }) => createKpiDefinition(actor, body),
  );
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "kpi_definition" },
    ({ actor, body }) => patchKpiDefinition(actor, body),
  );
}
