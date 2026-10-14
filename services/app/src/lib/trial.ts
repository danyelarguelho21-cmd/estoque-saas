// Teste grátis do cadastro pelo site. Definido por ambiente (SIGNUP_TRIAL_DAYS, ex.: 7 em
// produção). Sem a variável = 0 = sem teste (cadastro já começa aguardando pagamento) — é o
// comportamento esperado pelos testes automatizados do CI.
export function signupTrialDays(): number {
  const raw = Number.parseInt(process.env.SIGNUP_TRIAL_DAYS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 60) : 0;
}
