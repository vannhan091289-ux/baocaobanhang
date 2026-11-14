import { handleApi } from "@/server/api-guard";
import { decideProposal } from "@/server/role-workflow";

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
    { mutating: true, resourceType: "role_assignment_proposal" },
    ({ actor, body }) => decideProposal(actor, id, body),
  );
}
