// Reads and writes data.json, holding the single approver record and the request rows.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

const FILE = new URL('../data.json', import.meta.url);

const data = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, 'utf8'))
  : { approver: null, pendingEnroll: null, requests: {} };

function save() {
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getApprover() {
  if (!data.approver) return null;
  const { slackUserId, credentialId, publicKey, counter } = data.approver;
  return {
    slackUserId,
    credential: {
      id: credentialId,
      publicKey: isoBase64URL.toBuffer(publicKey),
      counter,
    },
  };
}

export function setApprover(slackUserId, credential) {
  data.approver = {
    slackUserId,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
  };
  save();
}

export function setApproverCounter(counter) {
  data.approver.counter = counter;
  save();
}

export function getPendingEnroll() {
  return data.pendingEnroll;
}

export function setPendingEnroll(slackUserId, challenge) {
  data.pendingEnroll = { slackUserId, challenge };
  save();
}

export function clearPendingEnroll() {
  data.pendingEnroll = null;
  save();
}

export function createRequest({ requesterId, originChannel, details }) {
  const id = randomUUID();
  data.requests[id] = {
    id,
    requesterId,
    originChannel,
    details,
    status: 'pending',
    dmChannel: null,
    dmTs: null,
    decision: null,
    challenge: null,
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  save();
  return data.requests[id];
}

export function getRequest(id) {
  return data.requests[id] ?? null;
}

export function updateRequest(id, patch) {
  Object.assign(data.requests[id], patch);
  save();
  return data.requests[id];
}
