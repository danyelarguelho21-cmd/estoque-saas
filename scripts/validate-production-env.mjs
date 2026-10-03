#!/usr/bin/env node
// Run before a production deploy: node --env-file=.env scripts/validate-production-env.mjs
// Intentionally reports variable names and validation errors only, never secret values.
import { isIP } from "node:net";

const errors = [];
const required = [
  "DOMAIN", "TLS_EMAIL", "AUTH_SECRET", "AUTH_URL", "PLATFORM_ADMIN_SESSION_SECRET",
  "POSTGRES_PASSWORD", "APP_DB_PASSWORD", "PLATFORM_ADMIN_DB_PASSWORD",
  "DATABASE_URL", "APP_DATABASE_URL", "PLATFORM_ADMIN_DATABASE_URL",
  "PLATFORM_ADMIN_BOOTSTRAP_EMAIL", "PLATFORM_ADMIN_BOOTSTRAP_PASSWORD",
];
// Gateway de pagamento: a Vindi é o provedor principal. PagBank só é exigido se PAYMENT_PROVIDER
// não for "vindi" (compatibilidade com servidores antigos ainda configurados para o PagBank).
const paymentProvider = (process.env.PAYMENT_PROVIDER ?? "").trim();
const usesVindi = paymentProvider === "vindi";
if (usesVindi) {
  required.push(
    "NEXT_PUBLIC_PAYMENT_PROVIDER", "NEXT_PUBLIC_VINDI_API_BASE_URL", "VINDI_API_BASE_URL", "VINDI_API_KEY", "VINDI_WEBHOOK_SECRET",
    "VINDI_PLAN_ID_BASICO", "VINDI_PLAN_ID_PRO", "VINDI_PLAN_ID_ENTERPRISE",
  );
} else {
  required.push("PAGBANK_API_KEY", "PAGBANK_BASE_URL", "PAGBANK_WEBHOOK_SECRET");
}
for (const key of required) if (!process.env[key]?.trim()) errors.push(`${key} está ausente ou vazio.`);

const developmentValue = (value = "") =>
  /changeme|placeholder|example|devpassword|dummy|not-for-production|^test(?:-|$)/i.test(value);
for (const key of ["AUTH_SECRET", "PLATFORM_ADMIN_SESSION_SECRET", usesVindi ? "VINDI_WEBHOOK_SECRET" : "PAGBANK_WEBHOOK_SECRET"]) {
  const value = process.env[key] ?? "";
  if (value && (value.length < 32 || developmentValue(value))) {
    errors.push(`${key} deve ser exclusivo de produção e ter pelo menos 32 caracteres.`);
  }
}
for (const key of ["POSTGRES_PASSWORD", "APP_DB_PASSWORD", "PLATFORM_ADMIN_DB_PASSWORD"]) {
  const value = process.env[key] ?? "";
  if (value && (value.length < 24 || developmentValue(value))) {
    errors.push(`${key} deve ser exclusivo de produção e ter pelo menos 24 caracteres.`);
  }
}
const passwords = ["POSTGRES_PASSWORD", "APP_DB_PASSWORD", "PLATFORM_ADMIN_DB_PASSWORD"]
  .map((key) => process.env[key]).filter(Boolean);
if (new Set(passwords).size !== passwords.length) errors.push("As senhas do Postgres precisam ser diferentes entre si.");

const domain = process.env.DOMAIN ?? "";
if (domain && (domain.includes("://") || /[\/:\s]/.test(domain) || domain === "localhost" ||
  domain === "example.com" || domain.endsWith(".example.com") || domain.endsWith(".localhost") ||
  domain.endsWith(".local") || domain.endsWith(".example") || domain.endsWith(".test") || isIP(domain))) {
  errors.push("DOMAIN deve ser um domínio DNS público, sem protocolo, caminho ou porta.");
}
const email = process.env.TLS_EMAIL ?? "";
if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /@(example\.com|example\.org|invalid)$/i.test(email))) {
  errors.push("TLS_EMAIL precisa ser um endereço real, não um domínio de exemplo.");
}
const authUrl = process.env.AUTH_URL ?? "";
if (authUrl && domain) {
  try {
    const url = new URL(authUrl);
    if (url.origin !== `https://${domain}` || url.pathname !== "/") {
      errors.push("AUTH_URL deve ser a origem HTTPS pública correspondente a DOMAIN.");
    }
  } catch { errors.push("AUTH_URL não é uma URL válida."); }
}

if (usesVindi) {
  if (process.env.NEXT_PUBLIC_PAYMENT_PROVIDER && process.env.NEXT_PUBLIC_PAYMENT_PROVIDER !== "vindi") {
    errors.push("NEXT_PUBLIC_PAYMENT_PROVIDER deve ser \"vindi\" quando PAYMENT_PROVIDER=vindi.");
  }
  const vindiUrl = process.env.VINDI_API_BASE_URL ?? "";
  if (vindiUrl && vindiUrl.replace(/\/$/, "") !== "https://app.vindi.com.br/api/v1") {
    errors.push("VINDI_API_BASE_URL deve ser https://app.vindi.com.br/api/v1 (produção), nunca o sandbox.");
  }
  const publicVindiUrl = process.env.NEXT_PUBLIC_VINDI_API_BASE_URL ?? "";
  if (/sandbox/i.test(publicVindiUrl)) {
    errors.push("NEXT_PUBLIC_VINDI_API_BASE_URL aponta para o sandbox da Vindi; use https://app.vindi.com.br/api/v1.");
  }
  if (process.env.VINDI_API_KEY && developmentValue(process.env.VINDI_API_KEY)) {
    errors.push("VINDI_API_KEY parece ser uma credencial de teste/desenvolvimento.");
  }
  for (const key of ["VINDI_PLAN_ID_BASICO", "VINDI_PLAN_ID_PRO", "VINDI_PLAN_ID_ENTERPRISE"]) {
    const value = process.env[key] ?? "";
    if (value && !/^\d+$/.test(value)) errors.push(`${key} deve ser o ID numérico do plano na Vindi.`);
  }
  if (process.env.RATE_LIMIT_SIGNUP_IP_MAX && Number(process.env.RATE_LIMIT_SIGNUP_IP_MAX) > 20) {
    errors.push("RATE_LIMIT_SIGNUP_IP_MAX está alto demais para produção (valor de desenvolvimento?).");
  }
}

if (process.env.PAGBANK_API_KEY && developmentValue(process.env.PAGBANK_API_KEY)) {
  errors.push("PAGBANK_API_KEY parece ser uma credencial de teste/desenvolvimento.");
}

const pagBankUrl = process.env.PAGBANK_BASE_URL ?? "";
if (pagBankUrl) {
  try {
    const url = new URL(pagBankUrl);
    if (url.protocol !== "https:" || /sandbox/i.test(url.hostname)) {
      errors.push("PAGBANK_BASE_URL deve ser HTTPS e apontar para produção, sem 'sandbox'.");
    }
  } catch { errors.push("PAGBANK_BASE_URL não é uma URL válida."); }
}

for (const [key, expectedUser, passwordKey] of [
  ["DATABASE_URL", "estoque_app", "POSTGRES_PASSWORD"],
  ["APP_DATABASE_URL", "app_user", "APP_DB_PASSWORD"],
  ["PLATFORM_ADMIN_DATABASE_URL", "platform_admin_role", "PLATFORM_ADMIN_DB_PASSWORD"],
]) {
  const value = process.env[key];
  if (!value) continue;
  try {
    const url = new URL(value);
    if (url.protocol !== "postgresql:" || url.username !== expectedUser || url.pathname !== "/estoque_saas") {
      errors.push(`${key} deve usar a role ${expectedUser} e o banco estoque_saas.`);
    }
    if (process.env[passwordKey] && decodeURIComponent(url.password) !== process.env[passwordKey]) {
      errors.push(`${key} deve usar a senha definida em ${passwordKey}.`);
    }
  } catch { errors.push(`${key} não é uma URL PostgreSQL válida.`); }
}
const bootstrapPassword = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD ?? "";
if (bootstrapPassword && (bootstrapPassword.length < 16 || developmentValue(bootstrapPassword))) {
  errors.push("PLATFORM_ADMIN_BOOTSTRAP_PASSWORD deve ter pelo menos 16 caracteres e não ser padrão de desenvolvimento.");
}

if (errors.length) {
  console.error("[production-preflight] Deploy bloqueado. Corrija o .env do VPS:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("[production-preflight] Configuração aprovada. Valores secretos não foram exibidos.");
