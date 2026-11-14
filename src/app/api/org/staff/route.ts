import { handleApi } from "@/server/api-guard";
import { listStaff, createStaff } from "@/server/org-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "staff" },
    ({ actor, url }) => listStaff(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "staff" },
    ({ actor, body }) => createStaff(actor, body),
  );
}
