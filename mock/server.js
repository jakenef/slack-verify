// Zero-dependency mock of every endpoint in CONTRACT.md, plus static serving of public/.
// For frontend work only. Delete once src/ serves the real routes.
//
//   node mock/server.js            → http://localhost:3939
//   open http://localhost:3939/setup
//   open http://localhost:3939/approve/demo      (pending request)
//   open http://localhost:3939/approve/used      (already decided)
//   open http://localhost:3939/approve/expired
//   open http://localhost:3939/approve/nope      (not found)
//
// Passkey ceremonies: the mock returns real-shaped options for rp.id = "localhost", so
// the browser prompt actually appears on localhost. Verification is faked (always ok).
// To test on a phone, use a tunnel with a stable hostname and set MOCK_RP_ID / MOCK_ORIGIN.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3939);
const RP_ID = process.env.MOCK_RP_ID || "localhost";
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const members = [
  { id: "U01JANE", name: "Jane Doe", avatar: "https://i.pravatar.cc/96?img=47" },
  { id: "U02SAM", name: "Sam Lee", avatar: "https://i.pravatar.cc/96?img=12" },
  { id: "U03PRIYA", name: "Priya Patel", avatar: "https://i.pravatar.cc/96?img=32" },
  { id: "U04MARCUS", name: "Marcus Chen", avatar: "https://i.pravatar.cc/96?img=68" },
];

// State. Toggle `approver` to null to test the "no approver" screen.
let approver = { id: "U01JANE", name: "Jane Doe", enrolled: true };

const requests = {
  demo: {
    id: "req_01HZX4",
    requester: members[1],
    details: {
      summary: "Wire $12,400 to Acme Supply",
      fields: [
        { label: "Amount", value: "$12,400.00" },
        { label: "Payee", value: "Acme Supply Co." },
        { label: "Account", value: "•••• 4471" },
        { label: "Reason", value: "Q3 inventory restock, PO #8812" },
      ],
    },
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    status: "pending",
  },
  used: {
    id: "req_01HZX3",
    requester: members[2],
    details: { summary: "Reset MFA for priya@acme.com", fields: [{ label: "Account", value: "priya@acme.com" }] },
    createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    status: "approved",
  },
};

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function error(res, status, code, message) {
  json(res, status, { error: code, message });
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); }
    });
  });
}
function serveFile(res, file) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
  fs.readFile(file, (err, data) => {
    if (err) return error(res, 404, "not_found", "No such file");
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}

function registrationOptions(user) {
  return {
    rp: { name: "Slack Verify (mock)", id: RP_ID },
    user: { id: b64url(user.id), name: user.name.toLowerCase().replace(/\s+/g, "."), displayName: user.name },
    challenge: b64url(crypto.randomBytes(32)),
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  };
}
function authenticationOptions() {
  return {
    rpId: RP_ID,
    challenge: b64url(crypto.randomBytes(32)),
    timeout: 60000,
    userVerification: "required",
    allowCredentials: [],
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const log = (extra = "") => console.log(`${req.method} ${p} ${extra}`);

  // Pages
  if (req.method === "GET" && p === "/setup") { log(); return serveFile(res, path.join(PUBLIC_DIR, "setup.html")); }
  if (req.method === "GET" && /^\/approve\/[^/]+$/.test(p)) { log(); return serveFile(res, path.join(PUBLIC_DIR, "approve.html")); }
  if (req.method === "GET" && p === "/") { res.writeHead(302, { Location: "/approve/demo" }); return res.end(); }

  // Setup API
  if (req.method === "GET" && p === "/api/members") { log(); return json(res, 200, { members }); }
  if (req.method === "GET" && p === "/api/approver") { log(); return json(res, 200, { approver }); }
  if (req.method === "POST" && p === "/api/enroll/options") {
    const { userId } = await readBody(req);
    const user = members.find((m) => m.id === userId);
    log(userId);
    if (!user) return error(res, 404, "not_found", "Unknown member");
    return json(res, 200, registrationOptions(user));
  }
  if (req.method === "POST" && p === "/api/enroll/verify") {
    const { userId, credential } = await readBody(req);
    const user = members.find((m) => m.id === userId);
    log(`${userId} credential=${credential ? "present" : "missing"}`);
    if (!user) return error(res, 404, "not_found", "Unknown member");
    if (!credential) return error(res, 400, "verification_failed", "No credential in body");
    approver = { id: user.id, name: user.name, enrolled: true };
    return json(res, 200, { ok: true, approver });
  }

  // Approval API
  const m = p.match(/^\/api\/(request|approve)\/([^/]+)(?:\/(options|verify))?$/);
  if (m) {
    const [, kind, token, step] = m;
    log(token);
    if (token === "expired") return error(res, 410, "expired", "This link has expired. Ask the requester to resend.");
    const r = requests[token];
    if (!r) return error(res, 404, "not_found", "This link is not valid.");
    if (kind === "request" && req.method === "GET") return json(res, 200, { request: r, approver });
    if (!approver) return error(res, 409, "no_approver", "No approver is configured yet.");
    if (r.status !== "pending") return error(res, 409, "used", `This request was already ${r.status}.`);
    if (kind === "approve" && step === "options" && req.method === "POST") {
      if (!approver.enrolled) return error(res, 409, "not_enrolled", "The approver has no passkey on file.");
      return json(res, 200, authenticationOptions());
    }
    if (kind === "approve" && step === "verify" && req.method === "POST") {
      const { decision, credential } = await readBody(req);
      if (!["approve", "reject"].includes(decision)) return error(res, 400, "verification_failed", "Bad decision");
      if (!credential) return error(res, 400, "verification_failed", "No credential in body");
      r.status = decision === "approve" ? "approved" : "rejected";
      return json(res, 200, { ok: true, receipt: { id: "rcpt_" + crypto.randomBytes(4).toString("hex"), decision: r.status, approver: { name: approver.name }, at: new Date().toISOString() } });
    }
  }

  // Static
  if (req.method === "GET") {
    const file = path.normalize(path.join(PUBLIC_DIR, p));
    if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);
  }
  error(res, 404, "not_found", "No route");
});

server.listen(PORT, () => {
  console.log(`mock server on http://localhost:${PORT}  (rp.id = ${RP_ID})`);
  console.log(`  setup:    http://localhost:${PORT}/setup`);
  console.log(`  approve:  http://localhost:${PORT}/approve/demo   (also /used, /expired, /nope)`);
});
