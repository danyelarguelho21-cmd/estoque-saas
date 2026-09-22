// Shared k6 threshold definitions. Every scenario script imports these instead of redefining
// its own numbers, so a change to the SLA only needs one edit.
//
// Sourced from docs/architecture/ — the architecture docs do not (yet) state explicit latency
// NFRs, so these are QA-proposed defaults for a PME-facing, non-real-time SaaS (per
// design-principles.md: "sem requisito de tempo real forte"). Flagged in test-plan.md risk
// register for the Solution Architect / SRE to confirm or override during HARDEN.
export const STANDARD_THRESHOLDS = {
  http_req_duration: ["p(95)<500", "p(99)<1200"],
  http_req_failed: ["rate<0.01"],
};

export const WRITE_HEAVY_THRESHOLDS = {
  http_req_duration: ["p(95)<800", "p(99)<2000"],
  http_req_failed: ["rate<0.01"],
};

export const DASHBOARD_THRESHOLDS = {
  // Analytics aggregation endpoints are allowed more headroom than transactional writes.
  http_req_duration: ["p(95)<1500", "p(99)<3000"],
  http_req_failed: ["rate<0.01"],
};
