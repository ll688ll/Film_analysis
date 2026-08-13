# Analysis History Expansion — Design

Status: implemented in v1.2.0
Scope: projects (folders), full analysis save, resume a saved study, ROI/result persistence

## 1. Problem

Before v1.2.0, `POST /api/analysis/{session_id}/save` wrote a row holding only the
calibration *inputs*: `channel`, `a`, `b`, `c`, `dpi`, the colormap range, and free-text
notes. Everything that made the analysis reproducible lived somewhere else and was lost:

| What | Where it lived | Why it was lost |
|------|----------------|-----------------|
| Film image | `uploads/{user_id}/{uuid}.tif` on disk | No endpoint served or reopened it; the file was never claimed by the saved record |
| Decoded pixels / dose map | `app.state.image_cache` (in-memory) | Evicted after `IMAGE_CACHE_TTL_MINUTES` (30), and on every backend restart |
| ROI geometry and statistics | React state in `AnalysisPage` | `roi_measurements` rows were never inserted, so CSV export always produced a header-only file |
| Calibration provenance | `calibration_profiles` (mutable) | `PUT /api/profiles/{id}` rewrites channel params; `DELETE` cascades and nulls the FK |

The practical consequence: 30 minutes after saving, a "saved analysis" was a row of
numbers that could not be viewed, re-measured, or continued.

## 2. Goals

1. A saved analysis owns its film data — the scan is retrievable indefinitely.
2. A saved analysis carries an immutable snapshot of the calibration that produced it.
3. Analyses are organized into user-defined projects.
4. A saved analysis can be reopened on the Film Analysis page and continued, then either
   updated in place or forked into a new record.
5. ROI geometry, ROI options, and computed statistics are persisted (making CSV export real).

Explicitly out of scope: nested folders, thumbnails, sharing between users, versioned
history of a single analysis beyond "save as new".

## 3. Data model

### 3.1 New table: `projects`

Modeled on `calibration_profiles`, which already establishes the per-user named-entity
pattern in this codebase.

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | |
| `user_id` | int FK `users.id` ON DELETE CASCADE | |
| `name` | varchar(100) | `UNIQUE(user_id, name)` |
| `description` | text | default `""` |
| `created_at` / `updated_at` | timestamptz | `updated_at` has `onupdate` |

Projects are **flat** — one level, no nesting. An analysis with `project_id IS NULL` is
"Unfiled". Deleting a project unfiles its analyses; it never deletes analyses.

### 3.2 Extended `analysis_sessions`

| New column | Type | Purpose |
|------------|------|---------|
| `project_id` | int FK `projects.id` ON DELETE SET NULL | Folder membership |
| `image_width`, `image_height`, `image_channels` | int | Restore `imageInfo` without decoding the file |
| `colormap` | varchar(20) default `'jet'` | Display state |
| `profile_snapshot` | JSON | Immutable calibration provenance (§3.4) |
| `updated_at` | timestamptz | Set when an existing analysis is overwritten |

`stored_filepath` changes meaning: it now points at a file the record **owns** under
`uploads/{user_id}/saved/`, not at the transient upload (§4).

### 3.3 Extended `roi_measurements`

Adds the fields the ROI endpoint already computed but had nowhere to store:
`pixel_count`, `trim_enabled`, `trim_percent`, `corner_cut_enabled`, `corner_cut_mm`.

Note the naming seam: `FilmAnalyzer.get_roi_stats` returns `max/min/mean/std/cv`, while the
columns are `dose_max/dose_min/...`. The save handler maps between them; non-finite values
(`flatness` is `inf` when the ROI minimum is ~0) are stored as NULL.

### 3.4 Profile snapshot

Written server-side at save time, never updated afterwards:

```json
{
  "profile_name": "EBT3 batch A",
  "note": "scanned 2026-05-02",
  "primary_channel": "Red",
  "channels": [{"channel": "Red", "a": 0.31, "b": 1.02, "c": -1.11, "r_squared": 0.9993}],
  "calibration_points": [{"dose": 0.0, "red_pct": 55.1, "green_pct": 48.2, "blue_pct": 30.0}],
  "snapshot_at": "2026-08-13T10:04:11+00:00"
}
```

When no profile is selected (hand-entered coefficients) or the profile has since been
deleted, a minimal snapshot records the applied `{channel, a, b, c}` so the math behind the
dose map is always recoverable.

`profile_id` is kept alongside the snapshot as a live convenience link. The two can
disagree — the profile may have been edited since — and **the snapshot wins** for display
and for restoring coefficients.

## 4. File ownership

- **Copy on save.** Saving copies the upload to
  `uploads/{user_id}/saved/{new_uuid}{suffix}` and stores that path.
  Copy rather than move so the live cache entry's `file_path` stays valid, and so each
  "Save as New" gets an independent file — deleting one analysis can never break another.
- **Overwrite save** keeps the existing file; the image is immutable, only metadata and ROI
  change.
- **Delete** removes the physical file only when it lives under the user's `saved/`
  directory *and* no other `analysis_sessions` row references the same path.
- **Orphan sweep** runs once at startup: files sitting directly in `uploads/{user_id}/`
  (never claimed by a save), older than 24 hours, not referenced by any row, are deleted.
  Files under `saved/` are never swept.

Implemented in `backend/app/services/analysis_files.py`.

## 5. API

### Projects — `backend/app/routers/projects.py`

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/projects` | includes `analysis_count` per project |
| POST | `/api/projects` | 409 on duplicate name |
| PUT | `/api/projects/{id}` | 409 on duplicate name |
| DELETE | `/api/projects/{id}` | unfiles analyses first, then deletes |

### Saved analyses — `backend/app/routers/analysis.py`

All persisted-analysis routes live under the literal segment `/analysis/saved/` with an
`int`-typed id. Two reasons: `GET /api/analysis/history` is declared *after* the
parametric `/{session_id}/...` routes, so a bare `GET /analysis/{id}` would shadow it; and
typing the id as `int` turns junk input into a clean 422 instead of the 500 the old
`int(session_id)` in export produced.

| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/analysis/saved/{id}` | full restore payload |
| POST | `/api/analysis/saved/{id}/open` | rehydrate into a fresh cache session; 410 if the file is gone |
| PATCH | `/api/analysis/saved/{id}` | `{notes?, project_id?}` — `project_id: null` unfiles |
| DELETE | `/api/analysis/saved/{id}` | row + owned file |
| GET | `/api/analysis/saved/{id}/file` | download the original scan under its real name |
| GET | `/api/analysis/saved/{id}/export` | CSV of ROI measurements (replaces `GET /{session_id}/export`) |

`POST /api/analysis/{session_id}/save` gains `cmap_min`, `cmap_max` (now client-supplied,
so a display-range change after calibration is captured), `colormap`, `project_id`,
`analysis_id` (present ⇒ overwrite that record), `roi`, and `stats`.

### Identifier spaces

Two different ids are both called "session id" in this codebase:

- **Cache UUID** — `POST /upload` and `POST /saved/{id}/open` return it; used by
  `/preview`, `/calibrate`, `/dose-data`, `/roi`, `/save`. Transient, TTL-bound.
- **Database int** — `analysis_sessions.id`; used by everything under `/analysis/saved/`.

## 6. Resume flow

```
HistoryPage                    Backend                        AnalysisPage
    │                             │                                │
    ├─ POST /saved/{id}/open ────>│                                │
    │                             ├─ load_image(stored_filepath)   │
    │                             ├─ put_cache_entry(new uuid)     │
    │<── {session_id, ...detail} ─┤                                │
    │                                                              │
    ├─ setPendingRestore(payload) ────────────────────────────────>│
    ├─ navigate("/")                                               │
    │                                                    restoreFromSaved:
    │                                                      GET /preview
    │                                                      POST /calibrate
    │                                                      apply ROI + stats
```

The handoff uses a module-level singleton (`frontend/src/api/analysisTransfer.ts`), the
same pattern as the existing `imageSession.ts` cross-tab image handoff. This works because
`ProtectedTabs` keeps all pages mounted; navigation only toggles visibility.

`/open` deliberately does **not** compute the dose map. The frontend re-runs the normal
`/calibrate` call with the snapshot coefficients, so there is exactly one code path that
produces a dose map.

Ordering matters on restore: `ImageCanvas` clears its ROI when a new preview image loads,
so the ROI is applied only after calibration resolves, via a version-counter prop rather
than a plain value prop (idempotent, survives re-renders).

## 7. Save semantics after resume

A resumed analysis shows two buttons:

- **Update Saved** — sends `analysis_id`; replaces metadata and the ROI row, keeps the id,
  the file, and `created_at`; sets `updated_at`.
- **Save as New** — omits `analysis_id`; copies the film file again and creates an
  independent record, for comparing variations of one study.

Uploading a new image clears the resumed-analysis link, so the next save is always a new
record.

**An update preserves the existing snapshot** unless the profile selection or the applied
coefficients actually changed. Without this rule, reopening a study and re-saving it after
moving an ROI would attach whatever state the profile happens to be in *now* — a
calibration that never produced those results. Re-snapshotting still happens when the user
genuinely recalibrates before saving.

## 8. Migrations

The project has no Alembic setup (the dependency is present, the directory is not) and the
schema has always come from `Base.metadata.create_all`, which cannot alter existing tables.
Rather than introduce Alembic ceremony for a single-user tool, `backend/app/migrations.py`
holds an idempotent list of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements executed
in the lifespan immediately after `create_all`, in the same transaction.

- Fresh database: `create_all` builds everything, the ALTERs are no-ops.
- Existing database: `create_all` adds `projects`, the ALTERs patch the two older tables.
- Tests: the statements are Postgres-specific and skipped on any other dialect; the SQLite
  fixture gets a complete schema from `create_all`.

Adding a column later means appending one line to that list.

## 9. Edge cases

| Situation | Behavior |
|-----------|----------|
| Profile edited after save | Snapshot retains the original coefficients; restore uses the snapshot |
| Profile deleted after save | FK nulls; history shows the snapshot name marked deleted; reopening still works |
| Film file missing on disk | `/open` returns 410; history greys the Open button via `has_file` |
| Cache expired before save | 404 surfaced as "session expired", distinct from a generic failure |
| `flatness = inf` | Stored as NULL |
| Two analyses sharing a file | Delete only removes the file when no other row references it |
| SQLite in tests doesn't enforce `ON DELETE SET NULL` | Project delete unfiles with an explicit UPDATE |

## 10. Files

Backend: `models.py`, `migrations.py`, `routers/projects.py`, `routers/analysis.py`,
`services/analysis_files.py`, `main.py`, `config.py`.

Frontend: `api/analysisTransfer.ts`, `analysis/AnalysisPage.tsx`,
`analysis/CalibrationPanel.tsx`, `analysis/ImageCanvas.tsx`, `history/HistoryPage.tsx`,
`components/Layout.tsx`.
