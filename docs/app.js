// Community Board front end: a small hash-routed single-page app.
// Talks to the API at self.API_BASE (see config.js).
const app = document.getElementById("app");
const API_CACHE = "community-board-api"; // must match sw.js

// ---------- Session ----------
let token = localStorage.getItem("cb_token");
let me = JSON.parse(localStorage.getItem("cb_me") || "null");

function saveSession(t, member) {
  token = t;
  me = member;
  localStorage.setItem("cb_token", t);
  localStorage.setItem("cb_me", JSON.stringify(member));
}

function clearSession() {
  token = null;
  me = null;
  localStorage.removeItem("cb_token");
  localStorage.removeItem("cb_me");
  if ("caches" in window) caches.delete(API_CACHE); // don't leave one member's data for the next
}

// ---------- Utilities ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  // Render's free plan can take ~60s to wake up; give up after 90s instead of hanging forever.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 90000);
  try {
    res = await fetch(`${self.API_BASE}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: timeout.signal,
    });
  } catch {
    throw new Error("Can't reach the server. It may be starting up or down. Try again in a minute.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 502 || res.status === 503) throw new Error("The server is starting up or unavailable. Try again in a minute.");
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !path.startsWith("/auth/")) {
    clearSession();
    location.hash = "#/login";
    throw new Error("Your session ended. Please log in again.");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// Server timestamps are UTC "YYYY-MM-DD HH:MM:SS".
const utc = (s) => new Date(s.replace(" ", "T") + "Z");
const formatTime = (s) => utc(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const initials = (name) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function memberOptions(members, selectedId, placeholder = "Choose a member") {
  return (
    `<option value="" disabled ${selectedId ? "" : "selected"}>${placeholder}</option>` +
    members.map((m) => `<option value="${m.id}" ${m.id === selectedId ? "selected" : ""}>${esc(m.name)}</option>`).join("")
  );
}

// ---------- Modal ----------
const modal = document.getElementById("modal");
const modalForm = document.getElementById("modal-form");
let modalSubmit = null;

function openModal({ title, body, submitLabel = "Save", danger = false, onSubmit }) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = body;
  document.getElementById("modal-error").textContent = "";
  const submit = document.getElementById("modal-submit");
  submit.textContent = submitLabel;
  submit.className = `btn ${danger ? "danger" : "primary"}`;
  modalSubmit = onSubmit;
  modal.showModal();
  modal.querySelector("input, textarea, select")?.focus();
}

modalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(modalForm));
  try {
    await modalSubmit(values);
    modal.close();
  } catch (err) {
    document.getElementById("modal-error").textContent = err.message;
  }
});
document.getElementById("modal-cancel").addEventListener("click", () => modal.close());

function confirmAction(title, message, onConfirm) {
  openModal({ title, body: `<p>${esc(message)}</p>`, submitLabel: "Delete", danger: true, onSubmit: onConfirm });
}

// ---------- Login & sign up ----------
function authView(mode) {
  const isLogin = mode === "login";
  app.innerHTML = `
    <section class="neu panel auth">
      <h1>${isLogin ? "Welcome back" : "Join the community"}</h1>
      <p class="desc">${isLogin ? "Log in to see what's happening." : "Create your member profile."}</p>
      <form id="auth-form">
        ${
          isLogin
            ? ""
            : `<label for="a-name">Name</label>
               <input id="a-name" name="name" required maxlength="60" autocomplete="name" placeholder="e.g. Susan" />`
        }
        <label for="a-email">Email</label>
        <input id="a-email" name="email" type="email" required maxlength="120" autocomplete="email" placeholder="you@example.com" />
        ${
          isLogin
            ? ""
            : `<label for="a-phone">Phone</label>
               <input id="a-phone" name="phone" type="tel" required maxlength="25" autocomplete="tel" placeholder="989-555-0100" />`
        }
        <label for="a-pass">Password</label>
        <input id="a-pass" name="password" type="password" required ${isLogin ? "" : 'minlength="8"'} autocomplete="${isLogin ? "current-password" : "new-password"}" placeholder="${isLogin ? "" : "At least 8 characters"}" />
        <p class="form-error" id="auth-error"></p>
        <button class="btn primary wide" type="submit">${isLogin ? "Log in" : "Create account"}</button>
      </form>
      <p class="switch">
        ${isLogin ? `New here? <a href="#/register">Create an account</a>` : `Already a member? <a href="#/login">Log in</a>`}
      </p>
      ${isLogin ? `<p class="hint">Demo login: <strong>susan@example.com</strong> / <strong>password123</strong></p>` : ""}
    </section>`;

  const form = document.getElementById("auth-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    const label = btn.textContent;
    const errorEl = document.getElementById("auth-error");
    btn.disabled = true;
    btn.textContent = isLogin ? "Logging in…" : "Creating account…";
    errorEl.textContent = "";
    const slow = setTimeout(() => (errorEl.textContent = "Waking up the server… this can take up to a minute."), 4000);
    try {
      const { token: t, member } = await api(`/auth/${mode}`, { method: "POST", body: Object.fromEntries(new FormData(form)) });
      saveSession(t, member);
      toast(isLogin ? `Welcome back, ${member.name}` : `Welcome, ${member.name}!`);
      location.hash = "#/issues";
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      clearTimeout(slow);
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

document.getElementById("logout").onclick = async () => {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  clearSession();
  toast("Logged out");
  location.hash = "#/login";
};

// ---------- Issues ----------
async function issuesView() {
  const issues = await api("/issues");
  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Issues</h1>
        <p>Everything happening in the community.</p>
      </div>
      <button class="btn primary" id="new-issue">+ New issue</button>
    </div>
    ${
      issues.length
        ? `<div class="grid">${issues.map(issueCard).join("")}</div>`
        : `<div class="neu empty">No issues yet. Start one, like a potluck or a cleanup day.</div>`
    }`;
  document.getElementById("new-issue").onclick = () => issueForm();
}

function issueCard(i) {
  const pct = i.task_count ? Math.round((i.done_count / i.task_count) * 100) : 0;
  return `
    <a class="neu card" href="#/issues/${i.id}">
      <h3>${esc(i.title)}</h3>
      <p class="desc">${esc(i.description) || "<em>No description</em>"}</p>
      <div class="meta">
        ${i.event_date ? `<span class="chip">📅 ${formatDate(i.event_date)}</span>` : ""}
        <span class="chip">👤 ${i.created_by === me.id ? "You" : esc(i.created_by_name)}</span>
        <span class="chip">✅ ${i.done_count}/${i.task_count} tasks</span>
      </div>
      <div class="progress"><span style="width:${pct}%"></span></div>
    </a>`;
}

function issueForm(issue) {
  openModal({
    title: issue ? "Edit issue" : "New issue",
    submitLabel: issue ? "Save changes" : "Create issue",
    body: `
      <label for="f-title">Title</label>
      <input id="f-title" name="title" required maxlength="120" placeholder="e.g. Potluck" value="${esc(issue?.title)}" />
      <label for="f-desc">Description</label>
      <textarea id="f-desc" name="description" maxlength="2000" placeholder="What's it about?">${esc(issue?.description)}</textarea>
      <label for="f-date">Date (optional)</label>
      <input id="f-date" name="event_date" type="date" value="${esc(issue?.event_date)}" />`,
    onSubmit: async (v) => {
      if (issue) {
        await api(`/issues/${issue.id}`, { method: "PUT", body: v });
        toast("Issue updated");
        route();
      } else {
        const created = await api("/issues", { method: "POST", body: v });
        toast("Issue created");
        location.hash = `#/issues/${created.id}`;
      }
    },
  });
}

// Which tasks have their comments expanded, so re-rendering keeps them open.
const openComments = new Set();

async function issueDetailView(id) {
  const [issue, members] = await Promise.all([api(`/issues/${id}`), api("/members")]);
  const done = issue.tasks.filter((t) => t.done).length;
  const pct = issue.tasks.length ? Math.round((done / issue.tasks.length) * 100) : 0;
  const mine = issue.created_by === me.id;

  app.innerHTML = `
    <a class="back" href="#/issues">← All issues</a>
    <section class="neu detail">
      <div class="page-head" style="margin-bottom:8px">
        <h1>${esc(issue.title)}</h1>
        ${
          mine
            ? `<div class="detail-actions">
                 <button class="btn small" data-act="edit-issue">Edit</button>
                 <button class="btn small danger" data-act="delete-issue">Delete</button>
               </div>`
            : ""
        }
      </div>
      <div class="meta" style="margin-bottom:14px">
        ${issue.event_date ? `<span class="chip">📅 ${formatDate(issue.event_date)}</span>` : ""}
        <span class="chip">👤 Organized by ${mine ? "you" : esc(issue.created_by_name)}</span>
        <span class="chip">✅ ${done}/${issue.tasks.length} done</span>
      </div>
      ${issue.description ? `<p class="desc">${esc(issue.description)}</p>` : ""}
      <div class="progress"><span style="width:${pct}%"></span></div>
    </section>

    <section class="neu panel">
      <h2>Tasks</h2>
      <form class="add-task" id="add-task">
        <select name="member_id" required aria-label="Assign to">${memberOptions(members, null, "Assign to…")}</select>
        <input name="description" required maxlength="200" placeholder="What's the task? e.g. Bringing pizza" aria-label="Task" />
        <button class="btn primary" type="submit">Add task</button>
      </form>
      ${
        issue.tasks.length
          ? `<ul class="task-list">${issue.tasks.map(taskRow).join("")}</ul>`
          : `<p class="desc">No tasks yet. Add the first one above.</p>`
      }
    </section>`;

  const findTask = (el) => issue.tasks.find((t) => t.id === Number(el.closest("[data-task]").dataset.task));
  const findComment = (el) => {
    const cid = Number(el.closest("[data-comment]").dataset.comment);
    return issue.tasks.flatMap((t) => t.comments).find((c) => c.id === cid);
  };

  const addForm = document.getElementById("add-task");
  addForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/issues/${issue.id}/tasks`, { method: "POST", body: Object.fromEntries(new FormData(addForm)) });
      toast("Task added");
      await route();
      document.querySelector("#add-task input")?.focus();
    } catch (err) {
      toast(err.message, true);
    }
  };

  app.querySelectorAll("details[data-task]").forEach((d) => {
    d.ontoggle = () => (d.open ? openComments.add(Number(d.dataset.task)) : openComments.delete(Number(d.dataset.task)));
  });

  app.querySelectorAll(".check").forEach((box) => {
    box.onchange = async () => {
      try {
        await api(`/tasks/${findTask(box).id}`, { method: "PATCH", body: { done: box.checked } });
        route();
      } catch (err) {
        box.checked = !box.checked;
        toast(err.message, true);
      }
    };
  });

  app.querySelectorAll("form.add-comment").forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const task = findTask(form);
      try {
        await api(`/tasks/${task.id}/comments`, { method: "POST", body: Object.fromEntries(new FormData(form)) });
        openComments.add(task.id);
        await route();
        document.querySelector(`details[data-task="${task.id}"] .add-comment input`)?.focus();
      } catch (err) {
        toast(err.message, true);
      }
    };
  });

  app.onclick = (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === "edit-issue") return issueForm(issue);
    if (act === "delete-issue")
      return confirmAction("Delete issue?", `"${issue.title}" and all ${issue.tasks.length} of its tasks will be removed.`, async () => {
        await api(`/issues/${issue.id}`, { method: "DELETE" });
        toast("Issue deleted");
        location.hash = "#/issues";
      });

    if (act === "edit-task") {
      const task = findTask(btn);
      return openModal({
        title: "Edit task",
        body: `
          <label for="t-member">Assigned to</label>
          <select id="t-member" name="member_id" required>${memberOptions(members, task.member_id)}</select>
          <label for="t-desc">Task</label>
          <input id="t-desc" name="description" required maxlength="200" value="${esc(task.description)}" />`,
        onSubmit: async (v) => {
          await api(`/tasks/${task.id}`, { method: "PATCH", body: v });
          toast("Task updated");
          route();
        },
      });
    }
    if (act === "delete-task") {
      const task = findTask(btn);
      return confirmAction("Delete task?", `${task.member_name}: ${task.description}`, async () => {
        await api(`/tasks/${task.id}`, { method: "DELETE" });
        toast("Task deleted");
        route();
      });
    }

    if (act === "edit-comment") {
      const c = findComment(btn);
      return openModal({
        title: "Edit comment",
        body: `<label for="c-body">Comment</label>
               <textarea id="c-body" name="body" required maxlength="1000">${esc(c.body)}</textarea>`,
        onSubmit: async (v) => {
          await api(`/comments/${c.id}`, { method: "PATCH", body: v });
          toast("Comment updated");
          route();
        },
      });
    }
    if (act === "delete-comment") {
      const c = findComment(btn);
      return confirmAction("Delete comment?", c.body, async () => {
        await api(`/comments/${c.id}`, { method: "DELETE" });
        toast("Comment deleted");
        route();
      });
    }
  };
}

function taskRow(t) {
  const mine = t.created_by === me.id;
  const n = t.comments.length;
  return `
    <li class="task-item" data-task="${t.id}">
      <div class="task ${t.done ? "done" : ""}">
        <input type="checkbox" class="check" ${t.done ? "checked" : ""} ${mine ? "" : "disabled"}
               aria-label="Mark done" title="${mine ? "Mark done" : `Only ${esc(t.created_by_name)} can update this task`}" />
        <span class="task-text">
          <a href="#/members/${t.member_id}"><strong>${esc(t.member_name)}</strong></a> — ${esc(t.description)}
          <small class="by">added by ${mine ? "you" : esc(t.created_by_name)}</small>
        </span>
        ${
          mine
            ? `<button class="icon-btn" data-act="edit-task" title="Edit task">✎</button>
               <button class="icon-btn" data-act="delete-task" title="Delete task">✕</button>`
            : ""
        }
      </div>
      <details class="comments" data-task="${t.id}" ${openComments.has(t.id) ? "open" : ""}>
        <summary>💬 ${n} ${n === 1 ? "comment" : "comments"}</summary>
        ${n ? `<ul class="comment-list">${t.comments.map(commentRow).join("")}</ul>` : ""}
        <form class="add-comment">
          <input name="body" required maxlength="1000" placeholder="Write a comment…" aria-label="Comment" />
          <button class="btn small primary" type="submit">Post</button>
        </form>
      </details>
    </li>`;
}

function commentRow(c) {
  const mine = c.member_id === me.id;
  return `
    <li class="comment" data-comment="${c.id}">
      <div class="comment-head">
        <a href="#/members/${c.member_id}"><strong>${mine ? "You" : esc(c.member_name)}</strong></a>
        <small>${formatTime(c.created_at)}${c.updated_at ? " · edited" : ""}</small>
        ${
          mine
            ? `<span class="comment-actions">
                 <button class="icon-btn" data-act="edit-comment" title="Edit comment">✎</button>
                 <button class="icon-btn" data-act="delete-comment" title="Delete comment">✕</button>
               </span>`
            : ""
        }
      </div>
      <p>${esc(c.body)}</p>
    </li>`;
}

// ---------- Members ----------
async function membersView() {
  const members = await api("/members");
  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Members</h1>
        <p>${members.length} ${members.length === 1 ? "person" : "people"} in the community.</p>
      </div>
    </div>
    <div class="grid">${members.map(memberCard).join("")}</div>`;
}

function memberCard(m) {
  return `
    <div class="neu card">
      <div class="member-row">
        <span class="avatar">${esc(initials(m.name))}</span>
        <div>
          <h3><a href="#/members/${m.id}">${esc(m.name)}</a>${m.id === me.id ? ` <span class="you">you</span>` : ""}</h3>
          <span class="desc">${m.task_count} ${m.task_count === 1 ? "task" : "tasks"}</span>
        </div>
      </div>
      ${contactLines(m)}
    </div>`;
}

const contactLines = (m) => `
  <div class="contact">
    <a href="mailto:${esc(m.email)}">✉️ ${esc(m.email)}</a>
    <a href="tel:${esc(m.phone.replace(/[^0-9+]/g, ""))}">📞 ${esc(m.phone)}</a>
  </div>`;

async function memberDetailView(id) {
  const m = await api(`/members/${id}`);
  const isMe = m.id === me.id;
  const byIssue = new Map();
  for (const t of m.tasks) {
    if (!byIssue.has(t.issue_id)) byIssue.set(t.issue_id, { title: t.issue_title, tasks: [] });
    byIssue.get(t.issue_id).tasks.push(t);
  }

  app.innerHTML = `
    ${isMe ? "" : `<a class="back" href="#/members">← All members</a>`}
    <section class="neu detail">
      <div class="page-head" style="margin-bottom:0">
        <div class="member-row">
          <span class="avatar">${esc(initials(m.name))}</span>
          <div>
            <h1 style="margin:0">${esc(m.name)}${isMe ? ` <span class="you">you</span>` : ""}</h1>
            <span class="desc">Member since ${utc(m.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        ${isMe ? `<button class="btn small" id="edit-profile">Edit profile</button>` : ""}
      </div>
      ${contactLines(m)}
    </section>
    <section class="neu panel">
      <h2>${isMe ? "Your" : `${esc(m.name)}'s`} tasks</h2>
      ${
        byIssue.size
          ? [...byIssue.entries()]
              .map(
                ([issueId, g]) => `
                <h3 style="margin:18px 0 8px"><a href="#/issues/${issueId}">${esc(g.title)}</a></h3>
                <ul class="task-list">
                  ${g.tasks
                    .map((t) => `<li class="task ${t.done ? "done" : ""}"><span class="task-text">${t.done ? "✅" : "⬜"} ${esc(t.description)}</span></li>`)
                    .join("")}
                </ul>`
              )
              .join("")
          : `<p class="desc">No tasks assigned yet.</p>`
      }
    </section>`;

  if (isMe) document.getElementById("edit-profile").onclick = () => profileForm(m);
}

function profileForm(m) {
  openModal({
    title: "Edit profile",
    body: `
      <label for="p-name">Name</label>
      <input id="p-name" name="name" required maxlength="60" value="${esc(m.name)}" />
      <label for="p-email">Email (used to log in)</label>
      <input id="p-email" name="email" type="email" required maxlength="120" value="${esc(m.email)}" />
      <label for="p-phone">Phone</label>
      <input id="p-phone" name="phone" type="tel" required maxlength="25" value="${esc(m.phone)}" />
      <label for="p-new">New password (leave blank to keep current)</label>
      <input id="p-new" name="new_password" type="password" minlength="8" autocomplete="new-password" />
      <label for="p-cur">Current password (only needed to change password)</label>
      <input id="p-cur" name="current_password" type="password" autocomplete="current-password" />`,
    onSubmit: async (v) => {
      const updated = await api(`/members/${m.id}`, { method: "PUT", body: v });
      saveSession(token, updated);
      toast("Profile updated");
      route();
    },
  });
}

// ---------- Router ----------
async function route() {
  const [, section = "issues", id] = location.hash.replace(/^#/, "").split("/");
  const loggedIn = Boolean(token && me);
  document.getElementById("nav").hidden = !loggedIn;
  app.onclick = null;

  if (!loggedIn) {
    if (section !== "register" && section !== "login") return (location.hash = "#/login");
    return authView(section);
  }
  if (section === "login" || section === "register") return (location.hash = "#/issues");

  const navSection = section === "members" && Number(id) === me.id ? "profile" : section;
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === navSection));

  // Render's free plan sleeps; the first request can take a while.
  const slow = setTimeout(() => {
    if (!app.firstElementChild || app.textContent.trim() === "Loading…")
      app.innerHTML = `<div class="neu empty">Waking up the server… this can take up to a minute on the first visit.</div>`;
  }, 3000);
  try {
    if (section === "profile") return await memberDetailView(me.id);
    if (section === "members") return id ? await memberDetailView(id) : await membersView();
    return id ? await issueDetailView(id) : await issuesView();
  } catch (err) {
    if (token) app.innerHTML = `<div class="neu empty">${esc(err.message)}<br /><br /><a href="#/issues">Back to issues</a></div>`;
  } finally {
    clearTimeout(slow);
  }
}

window.addEventListener("hashchange", route);
// Pick up changes other members made while this tab was in the background.
window.addEventListener("focus", () => {
  if (!modal.open && token && !document.activeElement?.matches("input, textarea, select")) route();
});

// Refresh the logged-in member's details, then draw the page.
(async () => {
  if (token) {
    try {
      saveSession(token, await api("/me"));
    } catch {
      /* offline: keep the saved profile; a real 401 already cleared the session */
    }
  }
  route();
})();
