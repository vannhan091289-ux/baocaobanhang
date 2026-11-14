import { handleApi } from "@/server/api-guard";
import { listRoleAssignments } from "@/server/role-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "role_assignment" },
    ({ actor, url }) => listRoleAssignments(actor, url.searchParams),
  );
}
