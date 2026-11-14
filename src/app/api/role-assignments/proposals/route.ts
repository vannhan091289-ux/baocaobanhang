import { handleApi } from "@/server/api-guard";
import { listProposals, createProposal } from "@/server/role-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: false, resourceType: "role_assignment_proposal" },
    ({ actor, url }) => listProposals(actor, url.searchParams),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleApi(
    request,
    { mutating: true, resourceType: "role_assignment_proposal" },
    ({ actor, body }) => createProposal(actor, body),
  );
}
