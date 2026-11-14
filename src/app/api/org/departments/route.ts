import { handleApi } from "@/server/api-guard";
import { listDepartments, createDepartment } from "@/server/org-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "department" },
    ({ actor, url }) => listDepartments(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "department" },
    ({ actor, body }) => createDepartment(actor, body),
  );
}
