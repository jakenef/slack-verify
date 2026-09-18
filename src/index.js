// Starts the Bolt Socket Mode app and the Express server together in one process.

import express from 'express';
import { config } from './config.js';
import { app as slackApp } from './slack.js';
import router from './routes.js';

const server = express();
server.use(express.json());
server.use(router);

server.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

await slackApp.start();
console.log('Bolt connected to Slack over Socket Mode');

server.listen(config.port, () => {
  console.log(`Pages served at ${config.publicUrl}`);
});
