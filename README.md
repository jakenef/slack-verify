# Tonight's MVP

Build one complete workflow for identity verification. One employee creates the request in Slack. One designated approver reviews it on their phone and confirms a decision with the device passkey or biometric prompt. Slack then shows the final result and receipt. The product does not move money or detect deepfakes.

## Core user flow

1. The requester types /verify-id in Slack and opens a short form.
2. The request is routed automatically to the single designated approver.
3. The approver receives a direct message with a secure Review request link.
4. The mobile page shows the exact request details and who submitted them.
5. The approver chooses Approve or Reject, then confirms with a passkey or biometric prompt.
6. Slack returns a final receipt showing the decision, exact details, approver, time, and receipt ID.

## How it works

One program does everything: it talks to Slack and serves the web pages. Slack itself holds only configuration — app name, permissions, the /verify-id command — never code.

Stack: Node (plain JavaScript), Slack Bolt, Express, SimpleWebAuthn, and a JSON file for storage.

Slack connection uses Socket Mode, so the Slack half needs no public URL. The pages still do, so tunnel or deploy.

## Surfaces

- **Slack form** — rendered by Slack. Request details only, no approver picker.
- **Setup page** — the approver opens it on their own phone, picks themselves from the workspace member list, and taps Enroll. Writes the single approver record. Most recent visitor wins. URL is guessable; acceptable for the demo.
- **Approval page** — shows the request details and submitter. Enrolls the device first if no key is on file. Approve/Reject, then the passkey prompt.

## Data

- **approver** — one record: Slack user ID and device public key.
- **requests** — one row each: requester, details, status, receipt ID.

## Server flow

1. `/verify-id` opens the modal.
2. On submit, save the request and DM the approver a link. One random ID is the database key, the URL, and the receipt number.
3. The approval page verifies the signature against the stored public key and records the decision.
4. Update the DM and post the receipt back to Slack.

## Constraints

- Biometrics never leave the approver's device. The server stores only a public key.
- Biometrics cannot run inside Slack. Block Kit has no JavaScript, so the passkey prompt must happen on a real browser page.
- Slack's in-app browser may not support passkeys. Detect it, prompt "Open in Safari," and test on a real phone early.
- WebAuthn is pinned to the domain. A rotating tunnel URL invalidates enrolled passkeys, so use a stable domain.
- If `/verify-id` runs before anyone has enrolled, reply with a private message that no approver is configured.
