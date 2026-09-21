import { platformPrisma } from "@estoque-saas/shared";

export async function GET() {
  try {
    await platformPrisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}
