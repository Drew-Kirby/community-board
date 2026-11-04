# Community Board (MVP)

A community app with **members**, **issues**, and **tasks**, styled with glassmorphism.

- **Member**: a person in the community (e.g. Susan).
- **Issue**: something happening (e.g. Potluck). Everyone can see every issue.
- **Task**: one member's job for one issue (e.g. Joey is bringing pizza).
  One issue has many tasks. A task can't exist without an issue: deleting an issue deletes its tasks.

## Run it

Open `index.html` in any modern browser (double-click it). Nothing to install.

The whole app (page, styles, logic, and database) is in that one file.

## Database

Data is saved in the browser's `localStorage`, so it stays after you close the tab.
It starts with a sample potluck. The tables and rules:

```
members (id, name UNIQUE, created_at)
issues  (id, title, description, event_date, created_by -> members, created_at)
tasks   (id, issue_id REQUIRED -> issues, member_id REQUIRED -> members, description, done, created_at)
```

- A task must belong to an existing issue and an existing member.
- Deleting an issue deletes its tasks.
- A member who still has tasks can't be removed.

Because the data lives in each browser, every visitor has their own copy (this is an MVP limit).

## Deploy (GitHub Pages)

Push this folder to a GitHub repo, then go to **Settings → Pages**, set the source to
**Deploy from a branch**, branch **main**, folder **/ (root)**. The site will be at
`https://YOUR-USERNAME.github.io/REPO-NAME/`.
