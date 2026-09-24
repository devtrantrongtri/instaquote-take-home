import { handleExtractionRequest } from "../../../lib/api/extract";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleExtractionRequest(request);
}
