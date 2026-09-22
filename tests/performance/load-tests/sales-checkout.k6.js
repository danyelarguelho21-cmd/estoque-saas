// Load test: checkout flow — POST /api/sales, the write-heavy critical path (debits stock,
// applies FEFO, writes audit log — the most transactionally expensive endpoint in the system).
import http from "k6/http";
import { check, sleep } from "k6";
import { WRITE_HEAVY_THRESHOLDS } from "../thresholds.js";

export const options = {
  scenarios: {
    checkout_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "3m", target: 40 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: WRITE_HEAVY_THRESHOLDS,
};

const BASE_URL = __ENV.TEST_BASE_URL || "http://localhost:3100";
const SESSION_COOKIE = __ENV.LOAD_TEST_SESSION_COOKIE;
const STORE_ID = __ENV.LOAD_TEST_STORE_ID;
const PRODUCT_IDS = (__ENV.LOAD_TEST_PRODUCT_IDS || "").split(",").filter(Boolean);

export function setup() {
  if (!SESSION_COOKIE || !STORE_ID || PRODUCT_IDS.length === 0) {
    throw new Error(
      "LOAD_TEST_SESSION_COOKIE, LOAD_TEST_STORE_ID and LOAD_TEST_PRODUCT_IDS env vars required — see test-plan.md",
    );
  }
}

export default function () {
  const productId = PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
  const payload = JSON.stringify({
    storeId: STORE_ID,
    items: [{ productId, quantity: 1 + Math.floor(Math.random() * 3), unitPriceCents: 1990 }],
  });

  const res = http.post(`${BASE_URL}/api/sales`, payload, {
    headers: { cookie: SESSION_COOKIE, "content-type": "application/json" },
  });

  check(res, {
    "status is 201 or 409 (insufficient stock is a valid outcome under load)": (r) => r.status === 201 || r.status === 409,
  });

  sleep(Math.random() * 2);
}
