# Community Board

A community app with **members**, **issues**, and **tasks**, styled with glassmorphism.

- **Member**: a person in the community (e.g. Susan).
- **Issue**: something happening (e.g. Potluck). Everyone can see every issue.
- **Task**: one member's job for one issue (e.g. Joey is bringing pizza).
  One issue has many tasks. A task can't exist without an issue: deleting an issue deletes its tasks.

## Run it

Requires Node.js 22.13 or newer. There are no packages to install.

```
npm start
```

Then open http://localhost:3000. Data is stored in `community.db` (SQLite), created on first run with a sample potluck.
To start over, stop the server and delete `community.db`.

## Deploy to Render

1. Push this folder to a GitHub repo.
2. On render.com, choose **New → Blueprint** and pick the repo. Render reads `render.yaml`.
3. Click **Apply**. The app will be live at `https://community-board-xxxx.onrender.com`.

On Render's free plan the database file resets when the server restarts or goes to sleep.

## Database

```
members (id, name UNIQUE, created_at)
issues  (id, title, description, event_date, created_by -> members, created_at)
tasks   (id, issue_id NOT NULL -> issues ON DELETE CASCADE,
         member_id NOT NULL -> members, description, done, created_at)
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/members` | List / add members |
| GET / DELETE | `/api/members/:id` | Member with their tasks / remove (blocked if they still have tasks) |
| GET / POST | `/api/issues` | List / create issues |
| GET / PUT / DELETE | `/api/issues/:id` | Issue with its tasks / edit / delete |
| POST | `/api/issues/:id/tasks` | Add a task to an issue (the only way to create a task) |
| PATCH / DELETE | `/api/tasks/:id` | Edit, reassign, or mark done / delete |
