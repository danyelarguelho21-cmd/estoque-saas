import { signOut } from "@/modules/auth";
import { handleRoute, noContent } from "@/lib/http";

export async function POST(): Promise<Response> {
  return handleRoute(async () => {
    await signOut({ redirect: false });
    return noContent();
  });
}
