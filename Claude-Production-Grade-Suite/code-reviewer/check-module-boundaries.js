#!/usr/bin/env node
/**
 * check-module-boundaries.js
 *
 * Mechanical check for ADR-001 (monolito modular) and related architecture
 * conformance rules from ADR-002 / ADR-004. Zero dependencies — plain Node.
 *
 * Automates conformance-checklist.md items: 1.1, 1.2, 1.8, 2.1, 2.2, 3.1 (partial),
 * 4.1, 4.2, 4.3.
 *
 * What it checks, over services/app/src/**\/*.{ts,tsx} and libs/shared/src/**\/*.ts:
 *
 *   1. Module boundary violations (ADR-001): a file outside
 *      services/app/src/modules/<X>/ (or inside a *different* module <Y>) imports
 *      something from services/app/src/modules/<X>/** other than <X>/index.ts.
 *      Resolves relative imports, `@/...` (tsconfig path alias), and
 *      `@estoque-saas/shared` subpaths.
 *
 *   2. Tenant isolation bypass (ADR-002): `platformPrisma` referenced anywhere
 *      other than its definition file (libs/shared/src/db/client.ts) or the
 *      `admin` module (services/app/src/modules/admin/**).
 *
 *   3. Direct PrismaClient instantiation (ADR-002/SOLID-DIP): `new PrismaClient(`
 *      outside libs/shared/src/db/client.ts.
 *
 *   4. Payment gateway leakage (ADR-004): an import of a known payment-SDK
 *      package name (pagbank/pagseguro/mercadopago/asaas) from anywhere other
 *      than libs/shared/src/payments/providers/pagbank.ts.
 *
 * Usage:
 *   node Claude-Production-Grade-Suite/code-reviewer/check-module-boundaries.js
 *   node Claude-Production-Grade-Suite/code-reviewer/check-module-boundaries.js --json
 *
 * Exit code: 0 if no violations, 1 if any violation found (CI-friendly).
 *
 * Wiring into CI: add as an `npm run lint:boundaries` script in
 * services/app/package.json, run alongside `eslint`/`tsc` in the pipeline. This
 * script is a stopgap that requires zero extra devDependencies; if the team later
 * adopts `eslint-plugin-boundaries`, the equivalent ESLint rule can replace it —
 * keep whichever is actually wired into CI, don't run both forever.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_SRC = path.join(REPO_ROOT, "services", "app", "src");
const MODULES_DIR = path.join(APP_SRC, "modules");
const SHARED_SRC = path.join(REPO_ROOT, "libs", "shared", "src");
const DB_CLIENT_FILE = path.join(SHARED_SRC, "db", "client.ts");
const PAGBANK_PROVIDER_FILE = path.join(SHARED_SRC, "payments", "providers", "pagbank.ts");

const PAYMENT_SDK_NAMES = [/pagbank/i, /pagseguro/i, /mercadopago/i, /mercado-pago/i, /asaas/i];

// Infra endpoints that legitimately probe DB connectivity (e.g. `SELECT 1`) without
// touching tenant data — not a tenant-isolation bypass, so exempt from the
// platformPrisma check. Keep this list narrow and explicit; do not widen it to
// exempt anything that touches real tenant tables.
const PLATFORM_PRISMA_ALLOWED_FILES = [
  path.join(APP_SRC, "app", "api", "healthz", "route.ts"),
  path.join(APP_SRC, "app", "api", "readyz", "route.ts"),
];

const jsonMode = process.argv.includes("--json");

/** Recursively collect .ts/.tsx source files under a root, skipping node_modules/.next/dist. */
function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Extract import/export/require specifiers from a file's source text. */
function extractSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /import\s+(?:[\s\S]*?from\s+)?["']([^"']+)["']/g,
    /export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /import\(\s*["']([^"']+)["']\s*\)/g, // dynamic import()
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) {
      specifiers.push(m[1]);
    }
  }
  return specifiers;
}

/** Resolve a module specifier to an absolute file path, or null if it's an external package. */
function resolveSpecifier(specifier, fromFile) {
  let base;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier === "@estoque-saas/shared" || specifier.startsWith("@estoque-saas/shared/")) {
    const sub = specifier === "@estoque-saas/shared" ? "" : specifier.slice("@estoque-saas/shared/".length);
    base = sub ? path.join(SHARED_SRC, sub) : path.join(SHARED_SRC, "index.ts");
  } else if (specifier.startsWith("@/")) {
    base = path.join(APP_SRC, specifier.slice(2));
  } else {
    return null; // external package (npm) or unresolvable alias — not our concern here
  }
  return tryResolveFile(base);
}

/** Given a base path with no/partial extension, try common resolutions (file.ts, file/index.ts, etc). */
function tryResolveFile(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return base; // best-effort — return the un-verified base so downstream checks can still reason about intent
}

/** Given an absolute file path under services/app/src/modules, return the module name, else null. */
function moduleOf(absPath) {
  const rel = path.relative(MODULES_DIR, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const [name] = rel.split(path.sep);
  return name || null;
}

function main() {
  const files = [...walk(APP_SRC), ...walk(SHARED_SRC)];
  const violations = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const fileModule = moduleOf(file);

    // --- Check 1: module boundary violations ---
    for (const spec of extractSpecifiers(source)) {
      const resolved = resolveSpecifier(spec, file);
      if (!resolved) continue;
      const targetModule = moduleOf(resolved);
      if (!targetModule) continue;
      if (fileModule === targetModule) continue; // intra-module import — fine

      const targetModuleIndex = path.join(MODULES_DIR, targetModule, "index.ts");
      const isIndexImport = path.resolve(resolved) === path.resolve(targetModuleIndex);
      if (!isIndexImport) {
        violations.push({
          rule: "module-boundary",
          severity: "Critical",
          file: relOut(file),
          detail: `imports "${spec}" which resolves into module "${targetModule}" internals (${relOut(resolved)}) instead of its index.ts — ADR-001`,
        });
      }
    }

    // --- Check 2: platformPrisma usage outside allowed locations ---
    if (/\bplatformPrisma\b/.test(source)) {
      const allowed =
        path.resolve(file) === path.resolve(DB_CLIENT_FILE) ||
        fileModule === "admin" ||
        PLATFORM_PRISMA_ALLOWED_FILES.some((f) => path.resolve(file) === path.resolve(f));
      if (!allowed) {
        violations.push({
          rule: "tenant-isolation-bypass",
          severity: "Critical",
          file: relOut(file),
          detail: "references platformPrisma outside libs/shared/src/db/client.ts or the admin module — bypasses RLS tenant scoping (ADR-002)",
        });
      }
    }

    // --- Check 3: direct PrismaClient instantiation ---
    if (/\bnew\s+PrismaClient\s*\(/.test(source) && path.resolve(file) !== path.resolve(DB_CLIENT_FILE)) {
      violations.push({
        rule: "direct-prisma-instantiation",
        severity: "High",
        file: relOut(file),
        detail: "instantiates `new PrismaClient()` directly instead of using withTenant()/platformPrisma from libs/shared/src/db/client.ts (ADR-002, DIP)",
      });
    }

    // --- Check 4: payment SDK leakage outside the PagBank provider file ---
    if (path.resolve(file) !== path.resolve(PAGBANK_PROVIDER_FILE)) {
      for (const spec of extractSpecifiers(source)) {
        if (PAYMENT_SDK_NAMES.some((re) => re.test(spec))) {
          violations.push({
            rule: "payment-provider-bypass",
            severity: "Critical",
            file: relOut(file),
            detail: `imports "${spec}" — payment gateway SDKs must only be referenced from libs/shared/src/payments/providers/pagbank.ts (ADR-004)`,
          });
        }
      }
    }
  }

  report(violations, files.length);
}

function relOut(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function report(violations, filesScanned) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ filesScanned, violationCount: violations.length, violations }, null, 2) + "\n");
  } else {
    console.log(`check-module-boundaries: scanned ${filesScanned} files.`);
    if (violations.length === 0) {
      console.log("No violations found.");
    } else {
      console.log(`${violations.length} violation(s) found:\n`);
      for (const v of violations) {
        console.log(`  [${v.severity}] ${v.rule} — ${v.file}`);
        console.log(`    ${v.detail}\n`);
      }
    }
  }
  process.exit(violations.length > 0 ? 1 : 0);
}

main();
