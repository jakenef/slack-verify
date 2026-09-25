// Browser-side passkey calls shared by both pages: fetch a challenge, hand it to the device, post back the result.

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@14.0.0/+esm';

export async function getJSON(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error ?? res.status), { data: json });
  return json;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error ?? res.status), { data: json, status: res.status });
  return json;
}

export async function enroll(slackUserId) {
  const optionsJSON = await post('/api/enroll/options', { slackUserId });
  const response = await startRegistration({ optionsJSON });
  return post('/api/enroll/verify', { response });
}

export async function decide(requestId, decision) {
  const optionsJSON = await post('/api/decision/options', { requestId, decision });
  const response = await startAuthentication({ optionsJSON });
  return post('/api/decision/verify', { requestId, response });
}

// Slack's in-app browser can't show the passkey prompt, so tell the person to open the page elsewhere.
export function passkeyBlocker() {
  if (/Slack/i.test(navigator.userAgent)) return 'slack';
  if (!browserSupportsWebAuthn()) return 'unsupported';
  return null;
}

export function showBlocker(el, kind) {
  el.hidden = false;
  el.innerHTML =
    kind === 'slack'
      ? '<p>Slack’s built-in browser can’t use Face ID or passkeys. Open this page in Safari or Chrome.</p><button type="button">Copy link</button>'
      : '<p>This browser doesn’t support passkeys. Open this page in Safari or Chrome.</p>';

  el.querySelector('button')?.addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(location.href);
    e.target.textContent = 'Link copied';
  });
}

export function explain(err) {
  if (err.name === 'NotAllowedError') return 'Confirmation was cancelled or timed out. Try again.';
  if (err.name === 'InvalidStateError') return 'This phone is already enrolled.';
  return err.message;
}
