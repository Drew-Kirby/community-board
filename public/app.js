// Community Board front end: a small hash-routed single-page app.
const app = document.getElementById("app");

// ---------- Utilities ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

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

function memberOptions(members, selectedId, { allowNone = false, placeholder = "Choose a member" } = {}) {
  return (
    (allowNone ? `<option value="">— None —</option>` : `<option value="" disabled ${selectedId ? "" : "selected"}>${placeholder}</option>`) +
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

// ---------- Views ----------
async function issuesView() {
  const issues = await api("/issues");
  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Issues</h1>
        <p>Everything happening in the community. Everyone can see every issue.</p>
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
        ${i.created_by_name ? `<span class="chip">👤 ${esc(i.created_by_name)}</span>` : ""}
        <span class="chip">✅ ${i.done_count}/${i.task_count} tasks</span>
      </div>
      <div class="progress"><span style="width:${pct}%"></span></div>
    </a>`;
}

async function issueForm(issue) {
  const members = await api("/members");
  openModal({
    title: issue ? "Edit issue" : "New issue",
    submitLabel: issue ? "Save changes" : "Create issue",
    body: `
      <label for="f-title">Title</label>
      <input id="f-title" name="title" required maxlength="120" placeholder="e.g. Potluck" value="${esc(issue?.title)}" />
      <label for="f-desc">Description</label>
      <textarea id="f-desc" name="description" maxlength="2000" placeholder="What's it about?">${esc(issue?.description)}</textarea>
      <label for="f-date">Date (optional)</label>
      <input id="f-date" name="event_date" type="date" value="${esc(issue?.event_date)}" />
      <label for="f-by">Organizer (optional)</label>
      <select id="f-by" name="created_by">${memberOptions(members, issue?.created_by, { allowNone: true })}</select>`,
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

async function issueDetailView(id) {
  const [issue, members] = await Promise.all([api(`/issues/${id}`), api("/members")]);
  const done = issue.tasks.filter((t) => t.done).length;
  const pct = issue.tasks.length ? Math.round((done / issue.tasks.length) * 100) : 0;

  app.innerHTML = `
    <a class="back" href="#/issues">← All issues</a>
    <section class="neu detail">
      <div class="page-head" style="margin-bottom:8px">
        <h1>${esc(issue.title)}</h1>
        <div class="detail-actions">
          <button class="btn small" id="edit-issue">Edit</button>
          <button class="btn small danger" id="delete-issue">Delete</button>
        </div>
      </div>
      <div class="meta" style="margin-bottom:14px">
        ${issue.event_date ? `<span class="chip">📅 ${formatDate(issue.event_date)}</span>` : ""}
        ${issue.created_by_name ? `<span class="chip">👤 Organized by ${esc(issue.created_by_name)}</span>` : ""}
        <span class="chip">✅ ${done}/${issue.tasks.length} done</span>
      </div>
      ${issue.description ? `<p class="desc">${esc(issue.description)}</p>` : ""}
      <div class="progress"><span style="width:${pct}%"></span></div>
    </section>

    <section class="neu panel">
      <h2>Tasks</h2>
      ${
        members.length
          ? `<form class="add-task" id="add-task">
               <select name="member_id" required aria-label="Member">${memberOptions(members, null, { placeholder: "Who?" })}</select>
               <input name="description" required maxlength="200" placeholder="What are they doing? e.g. Bringing pizza" aria-label="Task" />
               <button class="btn primary" type="submit">Add task</button>
             </form>`
          : `<p class="desc">Add a <a href="#/members">member</a> first, then you can assign tasks.</p>`
      }
      ${
        issue.tasks.length
          ? `<ul class="task-list">${issue.tasks.map(taskRow).join("")}</ul>`
          : `<p class="desc">No tasks yet. Add the first one above.</p>`
      }
    </section>`;

  document.getElementById("edit-issue").onclick = () => issueForm(issue);
  document.getElementById("delete-issue").onclick = () =>
    confirmAction("Delete issue?", `"${issue.title}" and all ${issue.tasks.length} of its tasks will be removed.`, async () => {
      await api(`/issues/${issue.id}`, { method: "DELETE" });
      toast("Issue deleted");
      location.hash = "#/issues";
    });

  const addForm = document.getElementById("add-task");
  if (addForm) {
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
  }

  app.querySelectorAll(".task").forEach((li) => {
    const task = issue.tasks.find((t) => t.id === Number(li.dataset.id));
    li.querySelector(".check").onchange = async (e) => {
      try {
        await api(`/tasks/${task.id}`, { method: "PATCH", body: { done: e.target.checked } });
        route();
      } catch (err) {
        toast(err.message, true);
      }
    };
    li.querySelector("[data-act=edit]").onclick = () =>
      openModal({
        title: "Edit task",
        body: `
          <label for="t-member">Member</label>
          <select id="t-member" name="member_id" required>${memberOptions(members, task.member_id)}</select>
          <label for="t-desc">Task</label>
          <input id="t-desc" name="description" required maxlength="200" value="${esc(task.description)}" />`,
        onSubmit: async (v) => {
          await api(`/tasks/${task.id}`, { method: "PATCH", body: v });
          toast("Task updated");
          route();
        },
      });
    li.querySelector("[data-act=delete]").onclick = () =>
      confirmAction("Delete task?", `${task.member_name}: ${task.description}`, async () => {
        await api(`/tasks/${task.id}`, { method: "DELETE" });
        toast("Task deleted");
        route();
      });
  });
}

function taskRow(t) {
  return `
    <li class="task ${t.done ? "done" : ""}" data-id="${t.id}">
      <input type="checkbox" class="check" ${t.done ? "checked" : ""} aria-label="Mark done" />
      <span class="task-text"><a href="#/members/${t.member_id}"><strong>${esc(t.member_name)}</strong></a> — ${esc(t.description)}</span>
      <button class="icon-btn" data-act="edit" title="Edit task">✎</button>
      <button class="icon-btn" data-act="delete" title="Delete task">✕</button>
    </li>`;
}

async function membersView() {
  const members = await api("/members");
  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Members</h1>
        <p>${members.length} ${members.length === 1 ? "person" : "people"} in the community.</p>
      </div>
      <button class="btn primary" id="new-member">+ Add member</button>
    </div>
    ${
      members.length
        ? `<div class="grid">${members
            .map(
              (m) => `
              <a class="neu card member-row" href="#/members/${m.id}">
                <span class="avatar">${esc(initials(m.name))}</span>
                <div>
                  <h3>${esc(m.name)}</h3>
                  <span class="desc">${m.task_count} ${m.task_count === 1 ? "task" : "tasks"}</span>
                </div>
              </a>`
            )
            .join("")}</div>`
        : `<div class="neu empty">No members yet.</div>`
    }`;

  document.getElementById("new-member").onclick = () =>
    openModal({
      title: "Add member",
      submitLabel: "Add",
      body: `<label for="m-name">Name</label><input id="m-name" name="name" required maxlength="60" placeholder="e.g. Susan" />`,
      onSubmit: async (v) => {
        await api("/members", { method: "POST", body: v });
        toast(`${v.name.trim()} joined the community`);
        route();
      },
    });
}

async function memberDetailView(id) {
  const m = await api(`/members/${id}`);
  // Group tasks by issue
  const byIssue = new Map();
  for (const t of m.tasks) {
    if (!byIssue.has(t.issue_id)) byIssue.set(t.issue_id, { title: t.issue_title, tasks: [] });
    byIssue.get(t.issue_id).tasks.push(t);
  }

  app.innerHTML = `
    <a class="back" href="#/members">← All members</a>
    <section class="neu detail">
      <div class="page-head" style="margin-bottom:0">
        <div class="member-row">
          <span class="avatar">${esc(initials(m.name))}</span>
          <div>
            <h1 style="margin:0">${esc(m.name)}</h1>
            <span class="desc">Member since ${new Date(m.created_at + "Z").toLocaleDateString()}</span>
          </div>
        </div>
        <button class="btn small danger" id="delete-member">Remove member</button>
      </div>
    </section>
    <section class="neu panel">
      <h2>${esc(m.name)}'s tasks</h2>
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
          : `<p class="desc">No tasks yet. Open an issue to assign one.</p>`
      }
    </section>`;

  document.getElementById("delete-member").onclick = () =>
    confirmAction("Remove member?", `${m.name} will be removed from the community.`, async () => {
      await api(`/members/${m.id}`, { method: "DELETE" });
      toast("Member removed");
      location.hash = "#/members";
    });
}

// ---------- Router ----------
async function route() {
  const [, section = "issues", id] = location.hash.replace(/^#/, "").split("/");
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
  try {
    if (section === "members") return id ? await memberDetailView(id) : await membersView();
    return id ? await issueDetailView(id) : await issuesView();
  } catch (err) {
    app.innerHTML = `<div class="neu empty">${esc(err.message)}<br /><br /><a href="#/issues">Back to issues</a></div>`;
  }
}

window.addEventListener("hashchange", route);
// Pick up changes other community members made while this tab was in the background.
window.addEventListener("focus", () => { if (!modal.open) route(); });
route();
