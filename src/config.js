// Validates required environment variables at startup and exports them as one config object.

const required = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'PUBLIC_URL',
  'RP_ID',
  'RP_NAME',
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy them into .env, then run `npm start`.');
  process.exit(1);
}

export const config = {
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackAppToken: process.env.SLACK_APP_TOKEN,
  publicUrl: process.env.PUBLIC_URL,
  rpId: process.env.RP_ID,
  rpName: process.env.RP_NAME,
  port: Number(process.env.PORT ?? 3000),
};
