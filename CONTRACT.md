# Frontend ↔ backend contract

The pages in `public/` talk to the server only through the endpoints below. Everything
in `src/` is the backend's; everything in `public/` is the frontend's. If either side
needs to change this file, do it in a PR so the other side sees it.

`mock/server.js` fakes every endpoint here so the pages can be built and tested on a
phone before the real routes exist. Run `node mock/server.js` (no dependencies).

## Pages (served by Express as static files)

| Route | File | Notes |
| --- | --- | --- |
| `GET /setup` | `public/setup.html` | Approver enrolment. |
| `GET /approve/:token` | `public/approve.html` | Same file for every token; the page reads the token from the URL. |
| `GET /client.js`, `GET /styles.css` | `public/*` | Shared browser code and styles. |

The page reads `location.pathname.split("/").pop()` to get the token. The server does
not need to inject anything into the HTML.

## JSON endpoints

All responses are JSON. Errors use `{ "error": "<code>", "message": "<human text>" }`
with a 4xx status. Error codes the pages handle: `not_found`, `expired`, `used`,
`no_approver`, `not_enrolled`, `verification_failed`.

### Setup

`GET /api/members` → `{ "members": [{ "id": "U0123", "name": "Jane Doe", "avatar": "https://…" }] }`
Workspace members for the picker.

`GET /api/approver` → `{ "approver": { "id": "U0123", "name": "Jane Doe", "enrolled": true } | null }`
Who is currently the approver and whether a passkey is on file.

`POST /api/enroll/options` body `{ "userId": "U0123" }`
→ SimpleWebAuthn `PublicKeyCredentialCreationOptionsJSON` (what `generateRegistrationOptions` returns).

`POST /api/enroll/verify` body `{ "userId": "U0123", "credential": <RegistrationResponseJSON> }`
→ `{ "ok": true, "approver": { "id", "name", "enrolled": true } }`
Sets this user as the single approver and stores the public key.

### Approval

`GET /api/request/:token` →
```json
{
  "request": {
    "id": "req_01…",
    "requester": { "id": "U0456", "name": "Sam Lee", "avatar": "https://…" },
    "details": { "summary": "Wire $12,400 to Acme", "fields": [{ "label": "Amount", "value": "$12,400" }, …] },
    "createdAt": "2026-09-17T20:30:00Z",
    "status": "pending" | "approved" | "rejected"
  },
  "approver": { "id": "U0123", "name": "Jane Doe", "enrolled": true }
}
```
`details.fields` is an ordered list the page renders as-is, so the backend controls
which fields exist. `summary` is the one-line headline.

`POST /api/approve/:token/options` body `{ "decision": "approve" | "reject" }`
→ SimpleWebAuthn `PublicKeyCredentialRequestOptionsJSON` (from `generateAuthenticationOptions`).
The server binds the challenge to the decision so it cannot be swapped.

`POST /api/approve/:token/verify` body `{ "decision": "approve" | "reject", "credential": <AuthenticationResponseJSON> }`
→ `{ "ok": true, "receipt": { "id": "rcpt_…", "decision": "approved" | "rejected", "approver": { "name" }, "at": "2026-09-17T20:31:05Z" } }`

If the approver has no passkey on file when the approval page loads (`approver.enrolled === false`),
the page runs the enrol ceremony first using the setup endpoints, then continues.

## Browser library

The pages use `@simplewebauthn/browser` (`startRegistration`, `startAuthentication`)
loaded from a CDN, so the JSON the browser sends is exactly what
`@simplewebauthn/server`'s `verifyRegistrationResponse` / `verifyAuthenticationResponse`
expect. No translation layer on either side.

## Things the pages already handle

- Slack's in-app browser: detected from the user agent; the page shows an "Open in Safari"
  screen instead of attempting a passkey.
- Token states: `not_found`, `expired`, `used` each get their own screen.
- No approver enrolled: the approval page explains and links to `/setup`.
