// Rate limiting para endpoints públicos de autenticação (security-engineer finding H-5, Wave B).
//
// PROBLEMA: /api/auth/login, /api/auth/signup e /api/platform-admin/login não tinham NENHUMA
// proteção contra força bruta / credential stuffing / criação em massa de tenants falsos — grep
// repo-wide confirmou zero referências a rate-limit/throttle fora dos arquivos de protocolo do
// pipeline. /api/platform-admin/login em particular é a credencial de maior raio de explosão do
// sistema (visibilidade de todos os tenants + poder de suspender/reativar qualquer um).
//
// SOLUÇÃO: janela fixa (fixed window) contada no Redis já usado pelo BullMQ (REDIS_URL) — cada
// tentativa incrementa um contador (`INCR`) com expiração (`PEXPIRE ... NX`, só define TTL na
// primeira vez que a chave é criada na janela, para não estender a janela a cada tentativa).
// Store é injetável (RateLimitStore) para que o teste unitário não dependa de Redis real.
import Redis from "ioredis";
import { RateLimitedError, redisConnectionOptions } from "@estoque-saas/shared";

export interface RateLimitStore {
  // Incrementa o contador da chave e devolve a contagem atual dentro da janela; define a
  // expiração da chave para windowMs apenas na primeira chamada (chave nova).
  increment(key: string, windowMs: number): Promise<number>;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: Redis) {}

  async increment(key: string, windowMs: number): Promise<number> {
    const multi = this.client.multi();
    multi.incr(key);
    // NX: só aplica o TTL se a chave não tinha expiração — evita que uma tentativa no meio da
    // janela reinicie o relógio (o que tornaria o limite inútil sob tráfego contínuo).
    multi.pexpire(key, windowMs, "NX");
    const results = await multi.exec();
    const count = results?.[0]?.[1];
    return typeof count === "number" ? count : Number(count ?? 0);
  }
}

let sharedRedis: Redis | undefined;
function getSharedRedis(): Redis {
  sharedRedis ??= new Redis(redisConnectionOptions().url, { lazyConnect: false, maxRetriesPerRequest: 1 });
  return sharedRedis;
}

let defaultStore: RateLimitStore | undefined;
function getDefaultStore(): RateLimitStore {
  defaultStore ??= new RedisRateLimitStore(getSharedRedis());
  return defaultStore;
}

export interface RateLimitRule {
  key: string;
  limit: number;
  windowMs: number;
}

// Limites configuráveis via env var (produção usa os defaults abaixo — pensados para uso humano
// legítimo vs. força bruta/criação em massa). Existe para permitir que o ambiente de testes de
// integração (tests/integration/docker-compose.test.yml, que roda dezenas de cenários chamando
// signUpAndLogin()/login a partir do MESMO IP do test runner, ver tests/fixtures/http-test-client.ts)
// suba os limites sem precisar de um branch "disable rate limit in test mode" no código de
// produção — mesma técnica usada por AUTH_SECRET/PAGBANK_WEBHOOK_SECRET (configuração via
// ambiente, nunca lógica condicional por NODE_ENV espalhada pelo código, ver secure-cookies.ts).
// Nunca reduzir estes defaults sem justificativa de segurança equivalente à finding H-5 original.
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RATE_LIMITS = {
  loginByIp: { limit: envInt("RATE_LIMIT_LOGIN_IP_MAX", 20), windowMs: envInt("RATE_LIMIT_LOGIN_IP_WINDOW_MS", 5 * 60_000) },
  loginByEmail: { limit: envInt("RATE_LIMIT_LOGIN_EMAIL_MAX", 6), windowMs: envInt("RATE_LIMIT_LOGIN_EMAIL_WINDOW_MS", 15 * 60_000) },
  signupByIp: { limit: envInt("RATE_LIMIT_SIGNUP_IP_MAX", 5), windowMs: envInt("RATE_LIMIT_SIGNUP_IP_WINDOW_MS", 60 * 60_000) },
  // Login de platform_admin: maior raio de explosão do sistema (finding H-5) — estritamente mais
  // restritivo que o login de tenant, nunca configurado para ser igual ou mais fraco.
  adminLoginByIp: { limit: envInt("RATE_LIMIT_ADMIN_LOGIN_IP_MAX", 10), windowMs: envInt("RATE_LIMIT_ADMIN_LOGIN_IP_WINDOW_MS", 5 * 60_000) },
  adminLoginByEmail: { limit: envInt("RATE_LIMIT_ADMIN_LOGIN_EMAIL_MAX", 4), windowMs: envInt("RATE_LIMIT_ADMIN_LOGIN_EMAIL_WINDOW_MS", 15 * 60_000) },
} as const;

// Lança RateLimitedError (429) se a chave já excedeu `limit` tentativas na janela `windowMs`.
// Fail-open deliberado em caso de erro de infraestrutura (Redis fora do ar): preferimos deixar o
// login funcionar sem rate-limit temporariamente a derrubar autenticação inteira do produto por
// causa de uma dependência de defesa em profundidade — o mesmo Redis já é requerido por BullMQ
// (filas), então uma indisponibilidade aqui já seria visível/alarmada por outros meios.
export async function checkRateLimit(rule: RateLimitRule, store: RateLimitStore = getDefaultStore()): Promise<void> {
  let count: number;
  try {
    count = await store.increment(rule.key, rule.windowMs);
  } catch {
    return;
  }
  if (count > rule.limit) {
    throw new RateLimitedError("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  }
}

// Extrai o IP do cliente a partir de X-Forwarded-For (padrão atrás de proxy reverso/load balancer,
// ADR-001) — o primeiro endereço da lista é o cliente original. Sem proxy confiável configurado,
// cai para um valor fixo (todas as requisições compartilham o mesmo bucket — pior caso é um limite
// mais apertado para todos, nunca ausência de limite).
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
