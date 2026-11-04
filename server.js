// Community Board API: members (with logins), issues, tasks, and comments.
// Uses only built-in Node modules (Node 22.13+ for node:sqlite).
//
// Ownership rules (enforced here, not just hidden in the UI):
// - A member can only edit their own profile.
// - Issues, tasks, and comments can only be edited or deleted by the member who created them.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, "docs"); // same files GitHub Pages serves
const SESSION_DAYS = 30;
const db = new DatabaseSync(path.join(__dirname, "community.db"));

// ---------- Schema ----------
// An older version of this app had members without logins. Start fresh if we find that schema.
const memberCols = db.prepare("PRAGMA table_info(members)").all().map((c) => c.name);
if (memberCols.length && !memberCols.includes("password_hash")) {
  db.exec("DROP TABLE IF EXISTS comments; DROP TABLE IF EXISTS tasks; DROP TABLE IF EXISTS issues; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS members;");
}

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS members (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS issues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date  TEXT,
    created_by  INTEGER NOT NULL REFERENCES members(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A task belongs to an issue and is assigned to one member.
  -- created_by is the task's owner (the only one who can change it).
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    created_by  INTEGER NOT NULL REFERENCES members(id),
    description TEXT NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Comments are on tasks only.
  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    member_id  INTEGER NOT NULL REFERENCES members(id),
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );
`);

// ---------- Passwords & sessions ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

// ---------- Seed data ----------
// Runs whenever the database is empty (including after Render's free plan wipes it),
// so the demo login below always works.
if (db.prepare("SELECT COUNT(*) AS n FROM members").get().n === 0) {
  const addMember = db.prepare("INSERT INTO members (name, email, phone, password_hash) VALUES (?, ?, ?, ?)");
  const susan = addMember.run("Susan", "susan@example.com", "989-555-0101", hashPassword("password123")).lastInsertRowid;
  const joey = addMember.run("Joey", "joey@example.com", "989-555-0102", hashPassword("password123")).lastInsertRowid;
  const maria = addMember.run("Maria", "maria@example.com", "989-555-0103", hashPassword("password123")).lastInsertRowid;

  const issue = db
    .prepare("INSERT INTO issues (title, description, event_date, created_by) VALUES (?, ?, ?, ?)")
    .run("Potluck", "Neighborhood potluck at the park pavilion. Bring a dish to share!", "2026-11-21", susan)
    .lastInsertRowid;

  const addTask = db.prepare("INSERT INTO tasks (issue_id, member_id, created_by, description) VALUES (?, ?, ?, ?)");
  const pizza = addTask.run(issue, joey, joey, "Bringing pizza").lastInsertRowid;
  addTask.run(issue, susan, susan, "Bringing drinks");
  addTask.run(issue, maria, susan, "Bringing paper plates and napkins");

  const addComment = db.prepare("INSERT INTO comments (task_id, member_id, body) VALUES (?, ?, ?)");
  addComment.run(pizza, susan, "Can you get one veggie pizza too?");
  addComment.run(pizza, joey, "Sure, I'll grab a veggie one.");
}

// ---------- Queries ----------
const MEMBER_FIELDS = "id, name, email, phone, created_at"; // never expose password_hash
const q = {
  listMembers: db.prepare(`
    SELECT m.id, m.name, m.email, m.phone, m.created_at, COUNT(t.id) AS task_count
    FROM members m LEFT JOIN tasks t ON t.member_id = m.id
    GROUP BY m.id ORDER BY m.name`),
  getMember: db.prepare(`SELECT ${MEMBER_FIELDS} FROM members WHERE id = ?`),
  getMemberAuth: db.prepare("SELECT * FROM members WHERE id = ?"),
  getMemberByEmail: db.prepare("SELECT * FROM members WHERE email = ?"),
  addMember: db.prepare("INSERT INTO members (name, email, phone, password_hash) VALUES (?, ?, ?, ?)"),
  updateMember: db.prepare("UPDATE members SET name = ?, email = ?, phone = ?, password_hash = ? WHERE id = ?"),

  addSession: db.prepare("INSERT INTO sessions (token, member_id) VALUES (?, ?)"),
  getSession: db.prepare(`SELECT member_id FROM sessions WHERE token = ? AND created_at > datetime('now', '-${SESSION_DAYS} days')`),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  pruneSessions: db.prepare(`DELETE FROM sessions WHERE created_at <= datetime('now', '-${SESSION_DAYS} days')`),

  listIssues: db.prepare(`
    SELECT i.*, m.name AS created_by_name,
           COUNT(t.id) AS task_count,
           COALESCE(SUM(t.done), 0) AS done_count
    FROM issues i
    JOIN members m ON m.id = i.created_by
    LEFT JOIN tasks t ON t.issue_id = i.id
    GROUP BY i.id ORDER BY i.created_at DESC, i.id DESC`),
  getIssue: db.prepare(`
    SELECT i.*, m.name AS created_by_name
    FROM issues i JOIN members m ON m.id = i.created_by
    WHERE i.id = ?`),
  addIssue: db.prepare("INSERT INTO issues (title, description, event_date, created_by) VALUES (?, ?, ?, ?)"),
  updateIssue: db.prepare("UPDATE issues SET title = ?, description = ?, event_date = ? WHERE id = ?"),
  deleteIssue: db.prepare("DELETE FROM issues WHERE id = ?"),

  tasksForIssue: db.prepare(`
    SELECT t.*, m.name AS member_name, c.name AS created_by_name
    FROM tasks t
    JOIN members m ON m.id = t.member_id
    JOIN members c ON c.id = t.created_by
    WHERE t.issue_id = ? ORDER BY t.id`),
  tasksForMember: db.prepare(`
    SELECT t.*, i.title AS issue_title
    FROM tasks t JOIN issues i ON i.id = t.issue_id
    WHERE t.member_id = ? ORDER BY t.id`),
  getTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
  addTask: db.prepare("INSERT INTO tasks (issue_id, member_id, created_by, description) VALUES (?, ?, ?, ?)"),
  updateTask: db.prepare("UPDATE tasks SET member_id = ?, description = ?, done = ? WHERE id = ?"),
  deleteTask: db.prepare("DELETE FROM tasks WHERE id = ?"),

  commentsForIssue: db.prepare(`
    SELECT c.*, m.name AS member_name
    FROM comments c
    JOIN members m ON m.id = c.member_id
    JOIN tasks t ON t.id = c.task_id
    WHERE t.issue_id = ? ORDER BY c.id`),
  getComment: db.prepare("SELECT * FROM comments WHERE id = ?"),
  addComment: db.prepare("INSERT INTO comments (task_id, member_id, body) VALUES (?, ?, ?)"),
  updateComment: db.prepare("UPDATE comments SET body = ?, updated_at = datetime('now') WHERE id = ?"),
  deleteComment: db.prepare("DELETE FROM comments WHERE id = ?"),
};

// ---------- Helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CORS = {
  // The front end is hosted on GitHub Pages (a different origin), so allow cross-origin calls.
  // Logins use a bearer token, not cookies, so "*" is safe here.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new HttpError(413, "Request too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "Invalid JSON"));
      }
    });
  });
}

function text(value, field, { required = true, max = 500 } = {}) {
  const s = typeof value === "string" ? value.trim() : "";
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  return s;
}

function email(value) {
  const s = text(value, "Email", { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, "Enter a valid email address");
  return s;
}

function phone(value) {
  const s = text(value, "Phone", { max: 25 });
  if (!/^[0-9+()\-.\s]{7,25}$/.test(s) || (s.match(/\d/g) || []).length < 7)
    throw new HttpError(400, "Enter a valid phone number");
  return s;
}

function password(value) {
  if (typeof value !== "string" || value.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  if (value.length > 200) throw new HttpError(400, "Password is too long");
  return value;
}

function memberId(value) {
  const id = Number(value);
  if (!value || !q.getMember.get(id)) throw new HttpError(400, "Choose a member");
  return id;
}

function dateOrNull(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Date must be YYYY-MM-DD");
  return value;
}

function mustFind(stmt, id, label) {
  const row = stmt.get(id);
  if (!row) throw new HttpError(404, `${label} not found`);
  return row;
}

function mustOwn(ownerId, me, what) {
  if (ownerId !== me.id) throw new HttpError(403, `Only the member who created this ${what} can change it`);
}

function uniqueEmail(fn) {
  try {
    return fn();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "An account with that email already exists");
    throw e;
  }
}

function startSession(memberRowId) {
  const token = crypto.randomBytes(32).toString("hex");
  q.pruneSessions.run();
  q.addSession.run(token, memberRowId);
  return { token, member: q.getMember.get(memberRowId) };
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function currentMember(req) {
  const token = bearer(req);
  const session = token && q.getSession.get(token);
  if (!session) throw new HttpError(401, "Please log in");
  return q.getMember.get(session.member_id);
}

// ---------- API routes ----------
async function handleApi(req, res, parts) {
  const [resource, idStr, sub] = parts;
  const id = idStr && /^\d+$/.test(idStr) ? Number(idStr) : null;
  const m = req.method;

  // Public routes
  if (resource === "health" && m === "GET") return send(res, 200, { ok: true });

  if (resource === "auth" && idStr === "register" && m === "POST") {
    const b = await readBody(req);
    const newId = uniqueEmail(() =>
      q.addMember.run(text(b.name, "Name", { max: 60 }), email(b.email), phone(b.phone), hashPassword(password(b.password)))
        .lastInsertRowid
    );
    return send(res, 201, startSession(newId));
  }

  if (resource === "auth" && idStr === "login" && m === "POST") {
    const b = await readBody(req);
    const row = typeof b.email === "string" && q.getMemberByEmail.get(b.email.trim().toLowerCase());
    if (!row || typeof b.password !== "string" || !checkPassword(b.password, row.password_hash))
      throw new HttpError(401, "Wrong email or password");
    return send(res, 200, startSession(row.id));
  }

  // Everything below requires a logged-in member.
  const me = currentMember(req);

  if (resource === "auth" && idStr === "logout" && m === "POST") {
    q.deleteSession.run(bearer(req));
    return send(res, 204);
  }

  if (resource === "me" && m === "GET") return send(res, 200, me);

  // Members
  if (resource === "members") {
    if (!idStr && m === "GET") return send(res, 200, q.listMembers.all());
    if (id && m === "GET") {
      const member = mustFind(q.getMember, id, "Member");
      return send(res, 200, { ...member, tasks: q.tasksForMember.all(id) });
    }
    if (id && m === "PUT") {
      if (id !== me.id) throw new HttpError(403, "You can only edit your own profile");
      const b = await readBody(req);
      const row = q.getMemberAuth.get(id);
      let hash = row.password_hash;
      if (b.new_password) {
        if (typeof b.current_password !== "string" || !checkPassword(b.current_password, row.password_hash))
          throw new HttpError(400, "Current password is incorrect");
        hash = hashPassword(password(b.new_password));
      }
      uniqueEmail(() => q.updateMember.run(text(b.name, "Name", { max: 60 }), email(b.email), phone(b.phone), hash, id));
      return send(res, 200, q.getMember.get(id));
    }
  }

  // Issues
  if (resource === "issues") {
    if (!idStr && m === "GET") return send(res, 200, q.listIssues.all());
    if (!idStr && m === "POST") {
      const b = await readBody(req);
      const newId = q.addIssue.run(
        text(b.title, "Title", { max: 120 }),
        text(b.description, "Description", { required: false, max: 2000 }),
        dateOrNull(b.event_date),
        me.id
      ).lastInsertRowid;
      return send(res, 201, q.getIssue.get(newId));
    }
    if (id && !sub && m === "GET") {
      const issue = mustFind(q.getIssue, id, "Issue");
      const comments = q.commentsForIssue.all(id);
      const tasks = q.tasksForIssue.all(id).map((t) => ({ ...t, comments: comments.filter((c) => c.task_id === t.id) }));
      return send(res, 200, { ...issue, tasks });
    }
    if (id && !sub && m === "PUT") {
      mustOwn(mustFind(q.getIssue, id, "Issue").created_by, me, "issue");
      const b = await readBody(req);
      q.updateIssue.run(
        text(b.title, "Title", { max: 120 }),
        text(b.description, "Description", { required: false, max: 2000 }),
        dateOrNull(b.event_date),
        id
      );
      return send(res, 200, q.getIssue.get(id));
    }
    if (id && !sub && m === "DELETE") {
      mustOwn(mustFind(q.getIssue, id, "Issue").created_by, me, "issue");
      q.deleteIssue.run(id); // its tasks and their comments go too (ON DELETE CASCADE)
      return send(res, 204);
    }
    // Any member can add a task to any issue; they become the task's owner.
    if (id && sub === "tasks" && m === "POST") {
      mustFind(q.getIssue, id, "Issue");
      const b = await readBody(req);
      const newId = q.addTask.run(id, memberId(b.member_id), me.id, text(b.description, "Task", { max: 200 })).lastInsertRowid;
      return send(res, 201, q.getTask.get(newId));
    }
  }

  // Tasks
  if (resource === "tasks" && id) {
    const task = mustFind(q.getTask, id, "Task");
    if (!sub && m === "PATCH") {
      mustOwn(task.created_by, me, "task");
      const b = await readBody(req);
      q.updateTask.run(
        b.member_id !== undefined ? memberId(b.member_id) : task.member_id,
        b.description !== undefined ? text(b.description, "Task", { max: 200 }) : task.description,
        b.done !== undefined ? (b.done ? 1 : 0) : task.done,
        id
      );
      return send(res, 200, q.getTask.get(id));
    }
    if (!sub && m === "DELETE") {
      mustOwn(task.created_by, me, "task");
      q.deleteTask.run(id);
      return send(res, 204);
    }
    // Any member can comment on any task.
    if (sub === "comments" && m === "POST") {
      const b = await readBody(req);
      const newId = q.addComment.run(id, me.id, text(b.body, "Comment", { max: 1000 })).lastInsertRowid;
      return send(res, 201, q.getComment.get(newId));
    }
  }

  // Comments
  if (resource === "comments" && id) {
    const comment = mustFind(q.getComment, id, "Comment");
    mustOwn(comment.member_id, me, "comment");
    if (m === "PATCH") {
      const b = await readBody(req);
      q.updateComment.run(text(b.body, "Comment", { max: 1000 }), id);
      return send(res, 200, q.getComment.get(id));
    }
    if (m === "DELETE") {
      q.deleteComment.run(id);
      return send(res, 204);
    }
  }

  throw new HttpError(404, "Not found");
}

// ---------- Static files (for running locally) ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(STATIC_DIR, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths fall back to the app shell.
      return fs.readFile(path.join(STATIC_DIR, "index.html"), (e2, html) => {
        res.writeHead(e2 ? 404 : 200, { "Content-Type": MIME[".html"] });
        res.end(e2 ? "Not found" : html);
      });
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------- Server ----------
http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS);
        return res.end();
      }
      try {
        await handleApi(req, res, pathname.slice(5).split("/").filter(Boolean));
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error(e);
        send(res, status, { error: status === 500 ? "Server error" : e.message });
      }
    } else {
      serveStatic(req, res, decodeURIComponent(pathname));
    }
  })
  .listen(PORT, () => console.log(`Community Board running at http://localhost:${PORT}`));
