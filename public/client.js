// Browser-side passkey calls shared by both pages: fetch a challenge, hand it to the device, post back the result.
// Uses @simplewebauthn/browser so the JSON we send is exactly what @simplewebauthn/server verifies.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "https://esm.sh/@simplewebauthn/browser@13";

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** JSON fetch that turns { error, message } bodies into ApiError. */
export async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new ApiError(data.error || "http_" + res.status, data.message || res.statusText, res.status);
  return data;
}

/** Slack's in-app browser cannot run passkeys. Detect it before rendering anything interactive. */
export function inSlackWebview() {
  const ua = navigator.userAgent || "";
  return /Slack/i.test(ua) || /\bwv\b/.test(ua) && /Android/i.test(ua);
}

export function passkeysSupported() {
  return browserSupportsWebAuthn();
}

/** Register this device's passkey for a user. Returns the server's response. */
export async function enroll(userId) {
  const options = await api("/api/enroll/options", { userId });
  const credential = await startRegistration({ optionsJSON: options });
  return api("/api/enroll/verify", { userId, credential });
}

/** Sign a decision with the enrolled passkey. Returns { ok, receipt }. */
export async function decide(token, decision) {
  const options = await api(`/api/approve/${token}/options`, { decision });
  const credential = await startAuthentication({ optionsJSON: options });
  return api(`/api/approve/${token}/verify`, { decision, credential });
}

/** Show exactly one [data-state] section. */
export function showState(name, patch = {}) {
  document.querySelectorAll("[data-state]").forEach((el) => {
    if (el.dataset.state === name) el.setAttribute("data-active", "");
    else el.removeAttribute("data-active");
  });
  for (const [sel, text] of Object.entries(patch)) {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  }
}

/** Human message for a failed ceremony (user cancelled, no authenticator, etc.). */
export function ceremonyMessage(err) {
  if (err instanceof ApiError) return err.message;
  if (err?.name === "NotAllowedError") return "The passkey prompt was cancelled or timed out. Try again.";
  if (err?.name === "InvalidStateError") return "This device already has a passkey for this account.";
  if (err?.name === "SecurityError") return "This page's domain does not match the passkey. Open the link from Slack again.";
  return err?.message || "Something went wrong.";
}

export function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
