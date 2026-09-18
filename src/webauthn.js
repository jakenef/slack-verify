// The passkey ceremonies: generating challenges and verifying what the phone signs back.

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { config } from './config.js';

// Forces a real biometric or PIN rather than mere device presence — the whole point of the product.
const USER_VERIFICATION = 'required';

export function enrollOptions(slackUserId) {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: slackUserId,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: USER_VERIFICATION,
    },
  });
}

export async function verifyEnroll(response, expectedChallenge) {
  const { verified, registrationInfo } = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.publicUrl,
    expectedRPID: config.rpId,
    requireUserVerification: true,
  });

  if (!verified) throw new Error('Enrollment failed verification');
  return registrationInfo.credential;
}

export function decisionOptions(credential) {
  return generateAuthenticationOptions({
    rpID: config.rpId,
    allowCredentials: [{ id: credential.id }],
    userVerification: USER_VERIFICATION,
  });
}

export async function verifyDecision(response, expectedChallenge, credential) {
  const { verified, authenticationInfo } = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.publicUrl,
    expectedRPID: config.rpId,
    credential,
    requireUserVerification: true,
  });

  if (!verified) throw new Error('Signature failed verification');
  return authenticationInfo.newCounter;
}
