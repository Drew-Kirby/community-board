# Community Board

A PWA where a community shares **member profiles** (phone, email), **issues**, **tasks** (assigned to a member), and **comments** (on tasks). Styled with neumorphism.

- **Front end** (`docs/`): static HTML/CSS/JS, hosted on GitHub Pages.
- **API** (`server.js`): Node + SQLite, hosted on Render.

**Demo login:** `susan@example.com` / `password123` (also `joey@example.com` and `maria@example.com`, same password)

## Rules

- Each member logs in with a unique email and a password (stored hashed with scrypt).
- Only you can edit your own profile.
- Whoever creates an issue, task, or comment owns it. Only the owner can edit or delete it, or mark the task done.
- Any member can add tasks to any issue and comment on any task.
- Deleting an issue deletes its tasks and their comments.

These rules are enforced by the server (it returns `403`), not just hidden in the UI.

## Run it locally

Requires Node.js 22.13 or newer. There are no packages to install.

```
npm start
```

Then open http://localhost:3000. Data is stored in `community.db`, created on first run with sample data. To start over, stop the server and delete `community.db`.

## Deploy

- **API:** Render reads `render.yaml` (Blueprint). Every push to `main` redeploys.
- **Front end:** GitHub repo → Settings → Pages → deploy from branch `main`, folder `/docs`.
- `docs/config.js` holds the Render URL the front end calls.

On Render's free plan the database resets when the server restarts or sleeps. The demo accounts are recreated automatically each time.

## Database

```
members  (id, name, email UNIQUE, phone, password_hash, created_at)
sessions (token, member_id -> members, created_at)
issues   (id, title, description, event_date, created_by -> members, created_at)
tasks    (id, issue_id -> issues ON DELETE CASCADE, member_id -> members (assignee),
          created_by -> members (owner), description, done, created_at)
comments (id, task_id -> tasks ON DELETE CASCADE, member_id -> members, body, created_at, updated_at)
```

## API

All routes except health, register, and login need `Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create account → `{ token, member }` |
| POST | `/api/auth/login` | Log in → `{ token, member }` |
| POST | `/api/auth/logout` | End session |
| GET | `/api/me` | Logged-in member |
| GET | `/api/members` | All members with contact info |
| GET / PUT | `/api/members/:id` | Profile with tasks / edit (own only) |
| GET / POST | `/api/issues` | List / create issues |
| GET / PUT / DELETE | `/api/issues/:id` | Issue with tasks and comments / edit / delete (owner only) |
| POST | `/api/issues/:id/tasks` | Add a task to an issue |
| PATCH / DELETE | `/api/tasks/:id` | Edit, reassign, mark done / delete (owner only) |
| POST | `/api/tasks/:id/comments` | Comment on a task |
| PATCH / DELETE | `/api/comments/:id` | Edit / delete (owner only) |
| GET | `/api/health` | Health check |
