import { handleApi } from "@/server/api-guard";
import { listIdentityLinks, createIdentityLink } from "@/server/org-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "identity_link" },
    ({ actor, url }) => listIdentityLinks(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "identity_link" },
    ({ actor, body }) => createIdentityLink(actor, body),
  );
}
