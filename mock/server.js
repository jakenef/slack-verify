// Zero-dependency mock of every endpoint in CONTRACT.md, plus static serving of public/.
// For frontend work only. Delete once src/ serves the real routes.
//
//   node mock/server.js            → http://localhost:3939
//   open http://localhost:3939/admin                 (signed out → passkey sign-in)
//   open http://localhost:3939/approve/demo          (pending check for Jane, enrolled)
//   open http://localhost:3939/approve/unenrolled    (pending check for Marcus, no passkey)
//   open http://localhost:3939/approve/used          (already decided)
//   open http://localhost:3939/approve/expired
//   open http://localhost:3939/approve/nope          (not found)
//   open http://localhost:3939/enroll/demo           (enrol link for Marcus)
//
// Env: PORT, MOCK_RP_ID (default localhost), MOCK_SETUP=1 (start with no users → first-admin flow),
//      MOCK_SIGNED_IN=1 (skip the admin sign-in screen).
//
// Passkey ceremonies: the mock returns real-shaped options for rp.id = "localhost", so
// the browser prompt actually appears on localhost. Verification is faked (always ok).
// To test on a phone, use a tunnel with a stable hostname and set MOCK_RP_ID.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3939);
const RP_ID = process.env.MOCK_RP_ID || "localhost";
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const ago = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();
const ahead = (min) => new Date(Date.now() + min * 60 * 1000).toISOString();
const id = (prefix) => prefix + "_" + crypto.randomBytes(4).toString("hex");

// Slack workspace directory (what the add-user search reads).
const members = [
  { id: "U01JANE", name: "Jane Doe", avatar: "https://i.pravatar.cc/96?img=47" },
  { id: "U02SAM", name: "Sam Lee", avatar: "https://i.pravatar.cc/96?img=12" },
  { id: "U03PRIYA", name: "Priya Patel", avatar: "https://i.pravatar.cc/96?img=32" },
  { id: "U04MARCUS", name: "Marcus Chen", avatar: "https://i.pravatar.cc/96?img=68" },
  { id: "U05AISHA", name: "Aisha Okafor", avatar: "https://i.pravatar.cc/96?img=25" },
  { id: "U06TOM", name: "Tom Becker", avatar: "https://i.pravatar.cc/96?img=59" },
  { id: "U07LENA", name: "Lena Fischer", avatar: "https://i.pravatar.cc/96?img=44" },
  { id: "U08DIEGO", name: "Diego Alvarez", avatar: "https://i.pravatar.cc/96?img=15" },
];
const member = (mid) => members.find((m) => m.id === mid);

// Configured users. Keyed by Slack ID.
let users = process.env.MOCK_SETUP
  ? {}
  : {
      U01JANE: { ...member("U01JANE"), role: "admin", passkeys: [{ id: "pk_a1", label: "iPhone", createdAt: ago(60 * 24 * 12) }, { id: "pk_a2", label: "MacBook", createdAt: ago(60 * 24 * 3) }], lastVerifiedAt: ago(35) },
      U03PRIYA: { ...member("U03PRIYA"), role: "approver", passkeys: [{ id: "pk_b1", label: "Pixel 9", createdAt: ago(60 * 24 * 8) }], lastVerifiedAt: ago(60 * 26) },
      U04MARCUS: { ...member("U04MARCUS"), role: "member", passkeys: [], lastVerifiedAt: null },
      U02SAM: { ...member("U02SAM"), role: "member", passkeys: [{ id: "pk_c1", label: "iPhone", createdAt: ago(60 * 24 * 1) }], lastVerifiedAt: null },
    };
const pub = (u) => u && { id: u.id, name: u.name, avatar: u.avatar, role: u.role };
const setupMode = () => !Object.values(users).some((u) => u.role === "admin" && u.passkeys.length);

// Admin session. One global flag is enough for a mock.
let signedInAs = process.env.MOCK_SIGNED_IN ? "U01JANE" : null;

// Identity-check requests.
const requests = {
  demo: { id: "req_01HZX4", subjectId: "U01JANE", requestedBy: member("U02SAM"), reason: "Confirming the wire instructions you sent me", channel: { name: "#finance" }, createdAt: ago(4), expiresAt: ahead(11), status: "pending" },
  unenrolled: { id: "req_01HZX5", subjectId: "U04MARCUS", requestedBy: member("U03PRIYA"), reason: "", channel: null, createdAt: ago(1), expiresAt: ahead(14), status: "pending" },
  used: { id: "req_01HZX3", subjectId: "U03PRIYA", requestedBy: member("U01JANE"), reason: "MFA reset request", channel: { name: "#it-help" }, createdAt: ago(180), expiresAt: ago(165), status: "confirmed" },
};

// Enrol links.
const enrolTokens = { demo: { userId: "U04MARCUS", expiresAt: ahead(60), used: false } };

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
    rp: { name: "Vouch (mock)", id: RP_ID },
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
function addPasskey(user, label) {
  const pk = { id: id("pk"), label: label || "Passkey", createdAt: new Date().toISOString() };
  user.passkeys.push(pk);
  return pk;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const log = (extra = "") => console.log(`${req.method} ${p} ${extra}`);

  // Pages
  if (req.method === "GET" && p === "/admin") { log(); return serveFile(res, path.join(PUBLIC_DIR, "admin.html")); }
  if (req.method === "GET" && /^\/approve\/[^/]+$/.test(p)) { log(); return serveFile(res, path.join(PUBLIC_DIR, "approve.html")); }
  if (req.method === "GET" && /^\/enroll\/[^/]+$/.test(p)) { log(); return serveFile(res, path.join(PUBLIC_DIR, "enroll.html")); }
  if (req.method === "GET" && p === "/") { res.writeHead(302, { Location: "/admin" }); return res.end(); }

  // Admin session
  if (p === "/api/admin/me") { log(signedInAs || "-"); return json(res, 200, { user: pub(users[signedInAs]) || null, setup: setupMode() }); }
  if (req.method === "POST" && p === "/api/admin/login/options") { log(); return json(res, 200, authenticationOptions()); }
  if (req.method === "POST" && p === "/api/admin/login/verify") {
    const { credential } = await readBody(req);
    if (!credential) return error(res, 400, "verification_failed", "No credential in body");
    const admin = Object.values(users).find((u) => u.role === "admin" && u.passkeys.length);
    log(admin ? admin.id : "no admin");
    if (!admin) return error(res, 403, "forbidden", "That passkey doesn't belong to an admin.");
    signedInAs = admin.id;
    return json(res, 200, { ok: true, user: pub(admin) });
  }
  if (req.method === "POST" && p === "/api/admin/logout") { log(); signedInAs = null; return json(res, 200, { ok: true }); }

  // Users (gated unless setup mode)
  if (p === "/api/members" || p.startsWith("/api/users")) {
    if (!signedInAs && !setupMode()) { log("401"); return error(res, 401, "unauthorized", "Sign in to manage users."); }
  }
  if (req.method === "GET" && p === "/api/members") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    log(q);
    return json(res, 200, { members: members.filter((m) => !q || m.name.toLowerCase().includes(q)) });
  }
  if (req.method === "GET" && p === "/api/users") { log(); return json(res, 200, { users: Object.values(users) }); }
  if (req.method === "POST" && p === "/api/users") {
    const { userId, role } = await readBody(req);
    log(`${userId} ${role}`);
    const m = member(userId);
    if (!m) return error(res, 404, "not_found", "Unknown workspace member");
    if (users[userId]) return error(res, 409, "already_added", `${m.name} is already configured.`);
    if (!["admin", "approver", "member"].includes(role)) return error(res, 400, "verification_failed", "Bad role");
    users[userId] = { ...m, role, passkeys: [], lastVerifiedAt: null };
    return json(res, 200, { user: users[userId] });
  }
  const um = p.match(/^\/api\/users\/([^/]+)(?:\/(passkeys\/([^/]+)|enroll-link|enroll\/(options|verify)))?$/);
  if (um) {
    const [, uid, sub, pkId, step] = um;
    const u = users[uid];
    log(uid + (sub ? " " + sub : ""));
    if (!u) return error(res, 404, "not_found", "That user isn't configured.");
    if (!sub && req.method === "PATCH") {
      const { role } = await readBody(req);
      if (!["admin", "approver", "member"].includes(role)) return error(res, 400, "verification_failed", "Bad role");
      u.role = role;
      return json(res, 200, { user: u });
    }
    if (!sub && req.method === "DELETE") { delete users[uid]; return json(res, 200, { ok: true }); }
    if (pkId && req.method === "DELETE") { u.passkeys = u.passkeys.filter((k) => k.id !== pkId); return json(res, 200, { ok: true }); }
    if (sub === "enroll-link" && req.method === "POST") {
      const token = "enroll-" + crypto.randomBytes(3).toString("hex");
      enrolTokens[token] = { userId: uid, expiresAt: ahead(60), used: false };
      console.log(`  (mock) would DM ${u.name}: http://localhost:${PORT}/enroll/${token}`);
      return json(res, 200, { ok: true });
    }
    if (step === "options" && req.method === "POST") {
      if (!setupMode() && signedInAs !== uid) return error(res, 403, "forbidden", "You can only enrol your own device here.");
      return json(res, 200, registrationOptions(u));
    }
    if (step === "verify" && req.method === "POST") {
      const { credential, label } = await readBody(req);
      if (!credential) return error(res, 400, "verification_failed", "No credential in body");
      const pk = addPasskey(u, label);
      if (setupMode() === false && !signedInAs) signedInAs = uid; // first admin just enrolled
      return json(res, 200, { ok: true, passkey: pk });
    }
  }

  // Enrol link
  const em = p.match(/^\/api\/enroll\/([^/]+)(?:\/(options|verify))?$/);
  if (em) {
    const [, token, step] = em;
    log(token);
    const t = enrolTokens[token];
    if (!t) return error(res, 404, "not_found", "This enrolment link is not valid.");
    if (t.used) return error(res, 410, "used", "This enrolment link was already used.");
    if (new Date(t.expiresAt) < new Date()) return error(res, 410, "expired", "This enrolment link has expired. Ask an admin to send a new one.");
    const u = users[t.userId];
    if (!u) return error(res, 404, "not_found", "That user is no longer configured.");
    if (!step && req.method === "GET") return json(res, 200, { user: pub(u), expiresAt: t.expiresAt });
    if (step === "options" && req.method === "POST") return json(res, 200, registrationOptions(u));
    if (step === "verify" && req.method === "POST") {
      const { credential, label } = await readBody(req);
      if (!credential) return error(res, 400, "verification_failed", "No credential in body");
      t.used = true;
      return json(res, 200, { ok: true, passkey: addPasskey(u, label) });
    }
  }

  // Identity check
  const m = p.match(/^\/api\/(request|approve)\/([^/]+)(?:\/(options|verify))?$/);
  if (m) {
    const [, kind, token, step] = m;
    log(token);
    if (token === "expired") return error(res, 410, "expired", "This link has expired. Ask the requester to run the command again.");
    const r = requests[token];
    if (!r) return error(res, 404, "not_found", "This link is not valid.");
    const subject = users[r.subjectId];
    const view = { id: r.id, subject: pub(subject), requestedBy: r.requestedBy, reason: r.reason, channel: r.channel, createdAt: r.createdAt, expiresAt: r.expiresAt, status: r.status };
    if (kind === "request" && req.method === "GET") return json(res, 200, { request: view, subjectEnrolled: !!subject?.passkeys.length });
    if (r.status !== "pending") return error(res, 409, "used", `This check was already ${r.status}.`);
    if (!subject?.passkeys.length) return error(res, 409, "not_enrolled", "You don't have a passkey yet.");
    if (kind === "approve" && step === "options" && req.method === "POST") {
      const { decision } = await readBody(req);
      if (!["confirm", "deny"].includes(decision)) return error(res, 400, "verification_failed", "Bad decision");
      // Real server: allowCredentials = subject's passkey IDs. The mock leaves it empty so the
      // passkey you actually created on this device is offered.
      return json(res, 200, authenticationOptions());
    }
    if (kind === "approve" && step === "verify" && req.method === "POST") {
      const { decision, credential } = await readBody(req);
      if (!["confirm", "deny"].includes(decision)) return error(res, 400, "verification_failed", "Bad decision");
      if (!credential) return error(res, 400, "verification_failed", "No credential in body");
      r.status = decision === "confirm" ? "confirmed" : "denied";
      subject.lastVerifiedAt = new Date().toISOString();
      return json(res, 200, { ok: true, receipt: { id: id("rcpt"), decision: r.status, subject: { name: subject.name }, at: subject.lastVerifiedAt } });
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
  console.log(`mock server on http://localhost:${PORT}  (rp.id = ${RP_ID}${process.env.MOCK_SETUP ? ", setup mode" : ""}${signedInAs ? ", signed in" : ""})`);
  console.log(`  admin:    http://localhost:${PORT}/admin`);
  console.log(`  approve:  http://localhost:${PORT}/approve/demo   (also /unenrolled, /used, /expired, /nope)`);
  console.log(`  enroll:   http://localhost:${PORT}/enroll/demo`);
});
