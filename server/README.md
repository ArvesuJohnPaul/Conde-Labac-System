# Conde Labac MIS — Database & API Setup (Windows)

This turns the localStorage prototype into a real client → API → PostgreSQL/PostGIS
system. Do these **once**, in order. Every command runs in **PowerShell**.

---

## 1. Install PostgreSQL + PostGIS

1. Download the **PostgreSQL 16** installer (EDB) from
   <https://www.postgresql.org/download/windows/>.
2. Run it. When asked for the **superuser (`postgres`) password**, pick one and
   **write it down** — you'll need it below.
3. At the end, the installer offers **Stack Builder**. Launch it, and under
   _Spatial Extensions_ tick **PostGIS 3.x Bundle** → install. (You can re-run
   Stack Builder later from the Start menu if you skipped it.)

Verify PostgreSQL is on your PATH:

```powershell
psql --version
```

If `psql` isn't found, add `C:\Program Files\PostgreSQL\16\bin` to your PATH and
reopen PowerShell.

## 2. Install Node.js

Download the **LTS** installer from <https://nodejs.org/> and run it. Verify:

```powershell
node --version
npm --version
```

## 3. Create the database and load the schema

```powershell
# from the project root: "Conde Labac System"
createdb -U postgres conde_labac
psql -U postgres -d conde_labac -f db/schema.sql
psql -U postgres -d conde_labac -f db/seed.sql
```

Each command will prompt for the `postgres` password from step 1. If you see
`CREATE EXTENSION`, `CREATE TABLE`, … with no errors, the schema is loaded.

Quick sanity check that PostGIS is active:

```powershell
psql -U postgres -d conde_labac -c "SELECT postgis_version();"
```

## 4. Configure and start the API server

```powershell
cd server
npm install
Copy-Item .env.example .env
```

Open `server/.env` and set `PGPASSWORD` to your `postgres` password. Then:

```powershell
npm start
```

You should see: `Conde Labac MIS server running → http://localhost:3000`

## 5. Verify it all connects

Open these in a browser (or use the PowerShell calls):

```powershell
# DB + PostGIS reachable through the API:
Invoke-RestMethod http://localhost:3000/api/health

# The two seeded residents come back:
Invoke-RestMethod http://localhost:3000/api/residents
```

`/api/health` returning `{ ok: true, postgis: "3.x" }` means all three tiers are
talking. **The app itself is now served at <http://localhost:3000>** (the server
serves your existing `index.html` too), so from now on open the site there — not
by double-clicking the HTML file — otherwise the frontend's `fetch('/api/...')`
calls have no server to reach.

---

## What's here

| File                   | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `../db/schema.sql`     | All tables (PostGIS geometry, indexes, `resident_view`)  |
| `../db/seed.sql`       | Puroks 1–5, an admin user, sample household/residents    |
| `server.js`            | Express app; serves `/api/*` **and** the static site     |
| `db.js`                | Shared connection pool (`pg`)                            |
| `routes/residents.js`  | GET/POST/PUT/DELETE residents                            |
| `routes/households.js` | GET/POST households                                      |
| `routes/gis.js`        | `GET /state` + building tags, custom features, OSM edits |

## API quick reference

| Method | Path                          | Does                                       |
| ------ | ----------------------------- | ------------------------------------------ |
| GET    | `/api/health`                 | DB + PostGIS check                         |
| GET    | `/api/residents`              | list residents (age derived, purok joined) |
| POST   | `/api/residents`              | add resident                               |
| PUT    | `/api/residents/:id`          | edit resident                              |
| DELETE | `/api/residents/:id`          | archive resident (soft delete)             |
| GET    | `/api/households`             | list households                            |
| POST   | `/api/households`             | add household                              |
| GET    | `/api/gis/state`              | whole map state in one call                |
| PUT    | `/api/gis/building-tags/:key` | tag a building                             |
| POST   | `/api/gis/custom-buildings`   | save a drawn building                      |
| POST   | `/api/gis/features`           | save a road/vegetation/hazard/…            |
| POST   | `/api/gis/osm-edits`          | tombstone/override an OSM feature          |

Next step (separate from this setup): rewiring `residency.js` and `gis-map.js`
to call these endpoints instead of `localStorage`.
