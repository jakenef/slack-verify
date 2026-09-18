# Vouch — frontend ↔ backend contract

The pages in `public/` talk to the server only through the endpoints below. Everything
in `src/` is the backend's; everything in `public/` is the frontend's. If either side
needs to change this file, do it in a PR so the other side sees it.

`mock/server.js` fakes every endpoint here so the pages can be built and tested on a
phone before the real routes exist. Run `node mock/server.js` (no dependencies).

## The model

- **Users** are people in the org who have been added on the admin page. Each has a
  Slack user ID, a **role**, and zero or more **passkeys** (one per device they enrolled).
- The Slack slash command looks up a configured user and sends them a DM with a link to
  `/approve/:token`. Opening it and signing with their passkey proves that the person
  holding that device is the person on file. Nobody else can complete it.
- Passkeys are enrolled out of band, from a link the admin sends (`/enroll/:token`) or by
  the admin on their own device. The verification page never enrols, otherwise anyone who
  intercepted a verification link could enrol themselves as that user.

Roles: `"admin" | "approver" | "member"`. Only `admin` can open the admin page. The other
two are labels for the backend to use when routing; the pages only display them.

## Pages (served by Express as static files)

| Route | File | Notes |
| --- | --- | --- |
| `GET /admin` | `public/admin.html` | Manage users, roles, passkeys. Passkey sign-in. |
| `GET /enroll/:token` | `public/enroll.html` | One-time link a user opens on their own device to create a passkey. |
| `GET /approve/:token` | `public/approve.html` | The identity check the slash command sends. |
| `GET /client.js`, `GET /styles.css` | `public/*` | Shared browser code and styles. |

Pages read the token from `location.pathname.split("/").pop()`. The server does not
inject anything into the HTML.

## JSON endpoints

All responses are JSON. Errors use `{ "error": "<code>", "message": "<human text>" }`
with a 4xx status. Codes the pages handle: `unauthorized`, `forbidden`, `not_found`,
`expired`, `used`, `not_enrolled`, `already_added`, `verification_failed`.

Shared shape, used everywhere a user appears:

```json
{ "id": "U0123", "name": "Jane Doe", "avatar": "https://…", "role": "admin" }
```

### Admin session

The admin page signs in with a passkey; the server sets an HttpOnly session cookie.

`GET /api/admin/me` → `{ "user": <user> | null, "setup": false }`
`setup: true` means no admin has a passkey yet. In that state the page lets whoever
opens it add the first admin and enrol this device, and the `/api/users*` endpoints
accept requests without a session. The backend flips `setup` to `false` once one admin
passkey exists.

`POST /api/admin/login/options` → SimpleWebAuthn `PublicKeyCredentialRequestOptionsJSON`
with empty `allowCredentials` (discoverable credential; the server works out who signed).
`POST /api/admin/login/verify` body `{ "credential": <AuthenticationResponseJSON> }` → `{ "ok": true, "user": <user> }`
Fails with `forbidden` if the signer's role is not `admin`.
`POST /api/admin/logout` → `{ "ok": true }`

### Users (admin session required unless `setup`)

`GET /api/members?q=jan` → `{ "members": [{ "id", "name", "avatar" }] }`
Slack workspace directory for the add-user search. `q` is optional.

`GET /api/users` →
```json
{ "users": [{ "id": "U0123", "name": "Jane Doe", "avatar": "…", "role": "admin",
              "passkeys": [{ "id": "pk_…", "label": "iPhone", "createdAt": "2026-09-17T20:30:00Z" }],
              "lastVerifiedAt": "2026-09-17T21:00:00Z" | null }] }
```
`POST /api/users` body `{ "userId": "U0123", "role": "member" }` → `{ "user": <user with passkeys> }` (`already_added` if present)
`PATCH /api/users/:id` body `{ "role": "approver" }` → `{ "user": … }`
`DELETE /api/users/:id` → `{ "ok": true }` (removes their passkeys too)
`DELETE /api/users/:id/passkeys/:passkeyId` → `{ "ok": true }`

`POST /api/users/:id/enroll-link` → `{ "ok": true }`
Mints a one-time enrol token and DMs the user `/enroll/:token`. The token is never
returned to the browser.

`POST /api/users/:id/enroll/options` → `PublicKeyCredentialCreationOptionsJSON`
`POST /api/users/:id/enroll/verify` body `{ "credential": <RegistrationResponseJSON>, "label": "This Mac" }` → `{ "ok": true, "passkey": {…} }`
Only for the signed-in admin's own `:id` (or anyone during `setup`). This is how an
admin enrols the device they are sitting at.

### Enrol link

`GET /api/enroll/:token` → `{ "user": <user>, "expiresAt": "…" }` or `not_found` / `expired` / `used`
`POST /api/enroll/:token/options` → `PublicKeyCredentialCreationOptionsJSON`
`POST /api/enroll/:token/verify` body `{ "credential": <RegistrationResponseJSON>, "label": "iPhone" }` → `{ "ok": true, "passkey": {…} }`
The token is consumed on success.

### Identity check

`GET /api/request/:token` →
```json
{
  "request": {
    "id": "req_01…",
    "subject": <user>,
    "requestedBy": { "id": "U0456", "name": "Sam Lee", "avatar": "https://…" },
    "reason": "Confirming the wire instructions you sent",
    "channel": { "name": "#finance" } | null,
    "createdAt": "2026-09-17T20:30:00Z",
    "expiresAt": "2026-09-17T20:45:00Z",
    "status": "pending" | "confirmed" | "denied" | "expired"
  },
  "subjectEnrolled": true
}
```
`subject` is the user being verified. `requestedBy` is whoever ran the slash command.

`POST /api/approve/:token/options` body `{ "decision": "confirm" | "deny" }`
→ `PublicKeyCredentialRequestOptionsJSON` with `allowCredentials` set to the subject's passkeys.
The server binds the challenge to the decision so it cannot be swapped.
Fails with `not_enrolled` if the subject has no passkey.

`POST /api/approve/:token/verify` body `{ "decision": "confirm" | "deny", "credential": <AuthenticationResponseJSON> }`
→ `{ "ok": true, "receipt": { "id": "rcpt_…", "decision": "confirmed" | "denied", "subject": { "name" }, "at": "2026-09-17T20:31:05Z" } }`
Both decisions are signed, so a denial is also proof it came from the real person.

## Browser library

The pages use `@simplewebauthn/browser` (`startRegistration`, `startAuthentication`)
loaded from a CDN, so the JSON the browser sends is exactly what
`@simplewebauthn/server`'s `verifyRegistrationResponse` / `verifyAuthenticationResponse`
expect. No translation layer on either side.

## Things the pages already handle

- Slack's in-app browser: detected from the user agent; the page shows an "Open in Safari"
  screen instead of attempting a passkey.
- Token states: `not_found`, `expired`, `used` each get their own screen.
- Subject with no passkey: the verification page explains and tells them to ask an admin
  for an enrol link. It does not enrol.
- Admin page with no session: passkey sign-in screen. With `setup: true`: first-admin flow.
