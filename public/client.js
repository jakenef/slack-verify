// Browser-side code shared by all pages: JSON fetch, passkey ceremonies, state switching.
// Uses @simplewebauthn/browser so the JSON we send is exactly what @simplewebauthn/server verifies.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "https://esm.sh/@simplewebauthn/browser@13";

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** JSON fetch that turns { error, message } bodies into ApiError. Pass a method for PATCH/DELETE. */
export async function api(path, body, method) {
  method = method || (body === undefined ? "GET" : "POST");
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new ApiError(data.error || "http_" + res.status, data.message || res.statusText, res.status);
  return data;
}

/** Slack's in-app browser cannot run passkeys. Detect it before rendering anything interactive. */
export function inSlackWebview() {
  const ua = navigator.userAgent || "";
  return /Slack/i.test(ua) || (/\bwv\b/.test(ua) && /Android/i.test(ua));
}

export function passkeysSupported() {
  return browserSupportsWebAuthn();
}

/** A short name for the device the passkey is being created on, used as the passkey label. */
export function deviceLabel() {
  const ua = navigator.userAgent || "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

/** Create a passkey on this device via an enrol link token. Returns { ok, passkey }. */
export async function enrollWithToken(token) {
  const options = await api(`/api/enroll/${token}/options`, {});
  const credential = await startRegistration({ optionsJSON: options });
  return api(`/api/enroll/${token}/verify`, { credential, label: deviceLabel() });
}

/** Admin enrolling the device they are sitting at, for their own user record. */
export async function enrollSelf(userId) {
  const options = await api(`/api/users/${userId}/enroll/options`, {});
  const credential = await startRegistration({ optionsJSON: options });
  return api(`/api/users/${userId}/enroll/verify`, { credential, label: deviceLabel() });
}

/** Admin passkey sign-in. Returns { ok, user }. */
export async function adminLogin() {
  const options = await api("/api/admin/login/options", {});
  const credential = await startAuthentication({ optionsJSON: options });
  return api("/api/admin/login/verify", { credential });
}

/** Sign an identity-check decision ("confirm" | "deny") with the subject's passkey. Returns { ok, receipt }. */
export async function decide(token, decision) {
  const options = await api(`/api/approve/${token}/options`, { decision });
  const credential = await startAuthentication({ optionsJSON: options });
  return api(`/api/approve/${token}/verify`, { decision, credential });
}

/** Show exactly one [data-state] section, optionally setting text content by selector. */
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
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** "3 min ago", "2 days ago", "just now". */
export function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Tiny element builder: el("div", { className: "row" }, child1, "text"). */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

export const ROLES = [
  { id: "admin", label: "Admin", hint: "Can open this page and manage users." },
  { id: "approver", label: "Approver", hint: "Can be asked to verify and approve." },
  { id: "member", label: "Member", hint: "Can be asked to verify their identity." },
];
