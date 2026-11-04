// Community Board server: members, issues, and tasks.
// Uses only built-in Node modules (Node 22.13+ for node:sqlite).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const db = new DatabaseSync(path.join(__dirname, "community.db"));

// ---------- Schema ----------
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS members (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS issues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date  TEXT,
    created_by  INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A task cannot exist without an issue: issue_id is required,
  -- and deleting an issue deletes its tasks.
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed example data the first time the app runs.
if (db.prepare("SELECT COUNT(*) AS n FROM members").get().n === 0) {
  const addMember = db.prepare("INSERT INTO members (name) VALUES (?)");
  const susan = addMember.run("Susan").lastInsertRowid;
  const joey = addMember.run("Joey").lastInsertRowid;
  const maria = addMember.run("Maria").lastInsertRowid;

  const issue = db
    .prepare("INSERT INTO issues (title, description, event_date, created_by) VALUES (?, ?, ?, ?)")
    .run("Potluck", "Neighborhood potluck at the park pavilion. Bring a dish to share!", "2026-11-21", susan)
    .lastInsertRowid;

  const addTask = db.prepare("INSERT INTO tasks (issue_id, member_id, description) VALUES (?, ?, ?)");
  addTask.run(issue, joey, "Bringing pizza");
  addTask.run(issue, susan, "Bringing drinks");
  addTask.run(issue, maria, "Bringing paper plates and napkins");
}

// ---------- Queries ----------
const q = {
  listMembers: db.prepare(`
    SELECT m.id, m.name, m.created_at, COUNT(t.id) AS task_count
    FROM members m LEFT JOIN tasks t ON t.member_id = m.id
    GROUP BY m.id ORDER BY m.name`),
  getMember: db.prepare("SELECT * FROM members WHERE id = ?"),
  addMember: db.prepare("INSERT INTO members (name) VALUES (?)"),
  deleteMember: db.prepare("DELETE FROM members WHERE id = ?"),
  memberTaskCount: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE member_id = ?"),

  listIssues: db.prepare(`
    SELECT i.*, m.name AS created_by_name,
           COUNT(t.id) AS task_count,
           COALESCE(SUM(t.done), 0) AS done_count
    FROM issues i
    LEFT JOIN members m ON m.id = i.created_by
    LEFT JOIN tasks t ON t.issue_id = i.id
    GROUP BY i.id ORDER BY i.created_at DESC, i.id DESC`),
  getIssue: db.prepare(`
    SELECT i.*, m.name AS created_by_name
    FROM issues i LEFT JOIN members m ON m.id = i.created_by
    WHERE i.id = ?`),
  addIssue: db.prepare("INSERT INTO issues (title, description, event_date, created_by) VALUES (?, ?, ?, ?)"),
  updateIssue: db.prepare("UPDATE issues SET title = ?, description = ?, event_date = ?, created_by = ? WHERE id = ?"),
  deleteIssue: db.prepare("DELETE FROM issues WHERE id = ?"),

  tasksForIssue: db.prepare(`
    SELECT t.*, m.name AS member_name
    FROM tasks t JOIN members m ON m.id = t.member_id
    WHERE t.issue_id = ? ORDER BY t.id`),
  tasksForMember: db.prepare(`
    SELECT t.*, i.title AS issue_title
    FROM tasks t JOIN issues i ON i.id = t.issue_id
    WHERE t.member_id = ? ORDER BY t.id`),
  getTask: db.prepare("SELECT * FROM tasks WHERE id = ?"),
  addTask: db.prepare("INSERT INTO tasks (issue_id, member_id, description) VALUES (?, ?, ?)"),
  updateTask: db.prepare("UPDATE tasks SET member_id = ?, description = ?, done = ? WHERE id = ?"),
  deleteTask: db.prepare("DELETE FROM tasks WHERE id = ?"),
};

// ---------- Helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
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

function memberId(value, { required = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new HttpError(400, "A member is required");
    return null;
  }
  const id = Number(value);
  if (!q.getMember.get(id)) throw new HttpError(400, "That member does not exist");
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

// ---------- API routes ----------
async function handleApi(req, res, parts) {
  const [resource, idStr, sub] = parts;
  const id = idStr ? Number(idStr) : null;
  const m = req.method;

  // Members
  if (resource === "members") {
    if (!id && m === "GET") return send(res, 200, q.listMembers.all());
    if (!id && m === "POST") {
      const { name } = await readBody(req);
      try {
        const newId = q.addMember.run(text(name, "Name", { max: 60 })).lastInsertRowid;
        return send(res, 201, q.getMember.get(newId));
      } catch (e) {
        if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "A member with that name already exists");
        throw e;
      }
    }
    if (id && !sub && m === "GET") {
      const member = mustFind(q.getMember, id, "Member");
      return send(res, 200, { ...member, tasks: q.tasksForMember.all(id) });
    }
    if (id && !sub && m === "DELETE") {
      mustFind(q.getMember, id, "Member");
      if (q.memberTaskCount.get(id).n > 0)
        throw new HttpError(409, "This member still has tasks. Reassign or delete their tasks first.");
      q.deleteMember.run(id);
      return send(res, 204);
    }
  }

  // Issues
  if (resource === "issues") {
    if (!id && m === "GET") return send(res, 200, q.listIssues.all());
    if (!id && m === "POST") {
      const b = await readBody(req);
      const newId = q.addIssue.run(
        text(b.title, "Title", { max: 120 }),
        text(b.description, "Description", { required: false, max: 2000 }),
        dateOrNull(b.event_date),
        memberId(b.created_by, { required: false })
      ).lastInsertRowid;
      return send(res, 201, q.getIssue.get(newId));
    }
    if (id && !sub && m === "GET") {
      const issue = mustFind(q.getIssue, id, "Issue");
      return send(res, 200, { ...issue, tasks: q.tasksForIssue.all(id) });
    }
    if (id && !sub && m === "PUT") {
      mustFind(q.getIssue, id, "Issue");
      const b = await readBody(req);
      q.updateIssue.run(
        text(b.title, "Title", { max: 120 }),
        text(b.description, "Description", { required: false, max: 2000 }),
        dateOrNull(b.event_date),
        memberId(b.created_by, { required: false }),
        id
      );
      return send(res, 200, q.getIssue.get(id));
    }
    if (id && !sub && m === "DELETE") {
      mustFind(q.getIssue, id, "Issue");
      q.deleteIssue.run(id); // tasks are removed by ON DELETE CASCADE
      return send(res, 204);
    }
    // Tasks are always created under an issue.
    if (id && sub === "tasks" && m === "POST") {
      mustFind(q.getIssue, id, "Issue");
      const b = await readBody(req);
      const newId = q.addTask.run(id, memberId(b.member_id), text(b.description, "Task", { max: 200 }))
        .lastInsertRowid;
      return send(res, 201, q.getTask.get(newId));
    }
  }

  // Tasks
  if (resource === "tasks" && id) {
    const task = mustFind(q.getTask, id, "Task");
    if (m === "PATCH") {
      const b = await readBody(req);
      q.updateTask.run(
        b.member_id !== undefined ? memberId(b.member_id) : task.member_id,
        b.description !== undefined ? text(b.description, "Task", { max: 200 }) : task.description,
        b.done !== undefined ? (b.done ? 1 : 0) : task.done,
        id
      );
      return send(res, 200, q.getTask.get(id));
    }
    if (m === "DELETE") {
      q.deleteTask.run(id);
      return send(res, 204);
    }
  }

  throw new HttpError(404, "Not found");
}

// ---------- Static files ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "Forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths fall back to the app shell.
      return fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, html) => {
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
