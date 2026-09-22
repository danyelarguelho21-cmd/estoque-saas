// Load test: "user browsing products" — GET /api/products, the highest-traffic read endpoint
// (every screen that shows stock/catalog data hits it, directly or via search/filters).
import http from "k6/http";
import { check, sleep } from "k6";
import { STANDARD_THRESHOLDS } from "../thresholds.js";

export const options = {
  scenarios: {
    sustained_browsing: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "2m", target: 100 },
        { duration: "5m", target: 100 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: STANDARD_THRESHOLDS,
};

const BASE_URL = __ENV.TEST_BASE_URL || "http://localhost:3100";
const SESSION_COOKIE = __ENV.LOAD_TEST_SESSION_COOKIE; // seeded by a setup script per test-plan.md

const SEARCH_TERMS = ["arroz", "feijao", "leite", "", "sabao", "detergente"];

export function setup() {
  if (!SESSION_COOKIE) {
    // Fail loudly rather than silently running unauthenticated (which would just measure 401s).
    throw new Error("LOAD_TEST_SESSION_COOKIE env var required — see test-plan.md Environment Requirements");
  }
}

export default function () {
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
  const url = term ? `${BASE_URL}/api/products?search=${encodeURIComponent(term)}&limit=20` : `${BASE_URL}/api/products?limit=20`;

  const res = http.get(url, { headers: { cookie: SESSION_COOKIE } });

  check(res, {
    "status is 200": (r) => r.status === 200,
    "has items array": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).items);
      } catch {
        return false;
      }
    },
  });

  sleep(Math.random() * 3); // realistic think-time, not a fixed hammering rate
}
