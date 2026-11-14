import { handleApi } from "@/server/api-guard";
import { patchDepartment } from "@/server/org-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  return handleApi(
    request,
    { mutating: true, resourceType: "department" },
    ({ actor, body }) => patchDepartment(actor, id, body),
  );
}
