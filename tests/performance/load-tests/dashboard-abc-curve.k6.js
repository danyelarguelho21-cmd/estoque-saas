// Load test: GET /api/dashboard/abc-curve — the heaviest read-aggregation endpoint (scans sales
// history and groups/cumulates), exercised on every admin dashboard load.
import http from "k6/http";
import { check, sleep } from "k6";
import { DASHBOARD_THRESHOLDS } from "../thresholds.js";

export const options = {
  scenarios: {
    dashboard_polling: {
      executor: "constant-vus",
      vus: 15,
      duration: "3m",
    },
  },
  thresholds: DASHBOARD_THRESHOLDS,
};

const BASE_URL = __ENV.TEST_BASE_URL || "http://localhost:3100";
const SESSION_COOKIE = __ENV.LOAD_TEST_SESSION_COOKIE;

export function setup() {
  if (!SESSION_COOKIE) {
    throw new Error("LOAD_TEST_SESSION_COOKIE env var required — see test-plan.md");
  }
}

export default function () {
  const metric = Math.random() > 0.5 ? "revenue" : "quantity";
  const res = http.get(`${BASE_URL}/api/dashboard/abc-curve?metric=${metric}`, {
    headers: { cookie: SESSION_COOKIE },
  });

  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(2 + Math.random() * 3);
}
