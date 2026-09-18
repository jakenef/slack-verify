// Everything Slack: the /verify-id command, the request form, the DM to the approver, and the final receipt.

import bolt from '@slack/bolt';
import { config } from './config.js';
import * as store from './store.js';

export const app = new bolt.App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
});

app.command('/verify-id', async ({ ack, body, client }) => {
  await ack();

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'verify_request',
      // view_submission does not carry the originating channel, so smuggle it through.
      private_metadata: body.channel_id,
      title: { type: 'plain_text', text: 'Verify' },
      submit: { type: 'plain_text', text: 'Send for approval' },
      blocks: [
        {
          type: 'input',
          block_id: 'details',
          label: { type: 'plain_text', text: 'What needs verifying?' },
          element: {
            type: 'plain_text_input',
            action_id: 'value',
            multiline: true,
            placeholder: { type: 'plain_text', text: '$48,000 wire to Acme Corp' },
          },
        },
      ],
    },
  });
});

app.view('verify_request', async ({ ack, body, view, client }) => {
  await ack();

  const requesterId = body.user.id;
  const originChannel = view.private_metadata;
  const details = view.state.values.details.value.value;

  const approver = store.getApprover();

  if (!approver) {
    await client.chat.postMessage({
      channel: requesterId,
      text: 'No approver is enrolled yet. Open /setup to enroll one, then try again.',
    });
    return;
  }

  const request = store.createRequest({ requesterId, originChannel, details });

  const dm = await client.chat.postMessage({
    channel: approver.slackUserId,
    text: `Verification request from <@${requesterId}>`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Verification request*\nFrom <@${requesterId}>\n\n${details}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            style: 'primary',
            text: { type: 'plain_text', text: 'Review request' },
            url: `${config.publicUrl}/r/${request.id}`,
          },
        ],
      },
    ],
  });

  store.updateRequest(request.id, { dmChannel: dm.channel, dmTs: dm.ts });
});

export async function postReceipt(request) {
  const approver = store.getApprover();
  const verdict = request.decision === 'approve' ? 'Approved' : 'Rejected';
  const epoch = Math.floor(new Date(request.decidedAt).getTime() / 1000);

  const receipt = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${verdict}*` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Request*\n${request.details}` },
        { type: 'mrkdwn', text: `*Requested by*\n<@${request.requesterId}>` },
        { type: 'mrkdwn', text: `*Approver*\n<@${approver.slackUserId}>` },
        {
          type: 'mrkdwn',
          text: `*Decided*\n<!date^${epoch}^{date_short_pretty} at {time}|${request.decidedAt}>`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Receipt \`${request.id}\` · confirmed with a device passkey`,
        },
      ],
    },
  ];

  await app.client.chat.update({
    channel: request.dmChannel,
    ts: request.dmTs,
    text: `${verdict}: ${request.details}`,
    blocks: receipt,
  });

  const message = { text: `${verdict}: ${request.details}`, blocks: receipt };

  try {
    await app.client.chat.postMessage({ channel: request.originChannel, ...message });
  } catch (err) {
    if (err.data?.error !== 'channel_not_found') throw err;
    // The command was run in a DM the bot has no access to, so send the receipt to the requester.
    await app.client.chat.postMessage({ channel: request.requesterId, ...message });
  }
}

export async function listUsers() {
  const { members } = await app.client.users.list({ limit: 200 });
  return members
    .filter((m) => !m.is_bot && !m.deleted && m.id !== 'USLACKBOT')
    .map((m) => ({ id: m.id, name: m.profile?.real_name || m.name }));
}
