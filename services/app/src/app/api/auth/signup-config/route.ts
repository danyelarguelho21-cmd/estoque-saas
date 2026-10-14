import { handleRoute, ok } from "@/lib/http";
import { signupTrialDays } from "@/lib/trial";

// Público (prefixo /api/auth): a tela de cadastro usa para mostrar "teste grátis de N dias".
export async function GET(): Promise<Response> {
  return handleRoute(async () => ok({ trialDays: signupTrialDays() }));
}
