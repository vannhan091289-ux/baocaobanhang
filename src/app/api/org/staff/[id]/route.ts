import { handleApi } from "@/server/api-guard";
import { getStaff, patchStaff } from "@/server/org-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  return handleApi(
    request,
    { mutating: false, resourceType: "staff" },
    ({ actor }) => getStaff(actor, id),
  );
}

export async function PATCH(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  return handleApi(
    request,
    { mutating: true, resourceType: "staff" },
    ({ actor, body }) => patchStaff(actor, id, body),
  );
}
