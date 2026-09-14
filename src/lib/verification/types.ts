/** Shape of `verification_runs.results_json`. Shown in the dashboard as-is. */

export type CheckId = "endpoint_match" | "injection_scan" | "ssl" | "domain_match" | "expiry";

export type CheckDetail = {
  /** What was checked, e.g. "POST /contact" or a URL. */
  subject: string;
  passed: boolean;
  message: string;
  note?: string;
};

export type CheckResult = {
  id: CheckId;
  label: string;
  passed: boolean;
  message: string;
  details: CheckDetail[];
};

export type VerificationResults = {
  checks: CheckResult[];
};
