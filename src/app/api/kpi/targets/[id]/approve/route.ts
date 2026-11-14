import { handleApi } from "@/server/api-guard";
import { approveKpiTarget } from "@/server/kpi/p0a-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  return handleApi(
    request,
    { mutating: true, resourceType: "kpi_target" },
    ({ actor, body }) => approveKpiTarget(actor, id, body),
  );
}
