// Express routes that serve the setup and approval pages and handle their enroll/verify requests.

import { Router } from 'express';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as webauthn from './webauthn.js';
import { postReceipt, listUsers } from './slack.js';

const router = Router();
const testPage = fileURLToPath(new URL('../public/test.html', import.meta.url));

router.get('/setup', (req, res) => res.sendFile(testPage));
router.get('/r/:id', (req, res) => res.sendFile(testPage));

router.get('/api/request/:id', (req, res) => {
  const request = store.getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  res.json({
    id: request.id,
    details: request.details,
    requesterId: request.requesterId,
    status: request.status,
    decision: request.decision,
  });
});

router.get('/api/slack/users', async (req, res) => {
  res.json(await listUsers());
});

router.post('/api/enroll/options', async (req, res) => {
  const { slackUserId } = req.body;
  if (!slackUserId) return res.status(400).json({ error: 'slackUserId is required' });

  const options = await webauthn.enrollOptions(slackUserId);
  store.setPendingEnroll(slackUserId, options.challenge);
  res.json(options);
});

router.post('/api/enroll/verify', async (req, res) => {
  const pending = store.getPendingEnroll();
  if (!pending) return res.status(400).json({ error: 'No enrollment in progress' });

  const credential = await webauthn.verifyEnroll(req.body.response, pending.challenge);
  store.setApprover(pending.slackUserId, credential);
  store.clearPendingEnroll();

  res.json({ ok: true, slackUserId: pending.slackUserId });
});

router.post('/api/decision/options', async (req, res) => {
  const { requestId, decision } = req.body;
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "reject"' });
  }

  const request = store.getRequest(requestId);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'Already decided', decision: request.decision });
  }

  const approver = store.getApprover();
  if (!approver) return res.status(400).json({ error: 'No approver enrolled' });

  // Record the decision before issuing the challenge, so the signature is bound to this
  // request and this choice rather than proving only that a fingerprint happened.
  const options = await webauthn.decisionOptions(approver.credential);
  store.updateRequest(requestId, { decision, challenge: options.challenge });

  res.json(options);
});

router.post('/api/decision/verify', async (req, res) => {
  const { requestId, response } = req.body;

  const request = store.getRequest(requestId);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'Already decided', decision: request.decision });
  }
  if (!request.challenge) return res.status(400).json({ error: 'No decision in progress' });

  const approver = store.getApprover();
  const newCounter = await webauthn.verifyDecision(
    response,
    request.challenge,
    approver.credential,
  );
  store.setApproverCounter(newCounter);

  const decided = store.updateRequest(requestId, {
    status: 'decided',
    decidedAt: new Date().toISOString(),
    challenge: null,
  });

  await postReceipt(decided);

  res.json({ ok: true, decision: decided.decision, receiptId: decided.id });
});

export default router;
