# Radiation Film Analysis Tool

A web-based application for analyzing radiochromic film dosimetry scans. Converts scanned film images into dose maps using rational function calibration, with interactive visualization and ROI analysis.

Originally built as a desktop tkinter application (`main.py`), now extended with a full web stack: React frontend + FastAPI backend + PostgreSQL, deployable via Docker Compose.

## Features

- **User management** — Register/login with JWT authentication; all data is isolated per user account
- **Calibration wizard** — Upload calibration film scans, select ROI regions at known dose levels, fit rational function curves (Red/Green/Blue channels), and save reusable calibration profiles
- **Film analysis** — Upload irradiated film scans, apply a calibration profile to generate dose maps, interactively explore dose values with cursor readout
- **ROI tools** — Rectangle, Circle, and Ring ROI shapes with drag, resize, and rotation; computes dose statistics (mean, min, max, std, CV, DUR, flatness) with physical dimensions (mm)
- **Interactive dose map** — Client-side Canvas rendering with selectable colormaps (jet, viridis, hot), adjustable dose range, and real-time cursor dose readout
- **History** — Browse and review saved analysis sessions
- **CSV export** — Export ROI measurement data
- **Legacy import** — Import calibration profiles from the desktop app's `calibration_config.json`

## Calibration Model

The calibration uses a rational function model:

- **Forward model** (curve fitting): `Color% = a + b / (Dose - c)`
- **Inverse model** (dose calculation): `Dose = b / (Color% - a) + c`

Where `Color% = pixel_value / 255.0` (0–1 range). Curves are fitted independently for Red, Green, and Blue channels using `scipy.optimize.curve_fit`.

## Architecture

```
┌─────────────┐       ┌──────────────┐       ┌──────────────┐
│   Nginx     │──────>│   FastAPI     │──────>│  PostgreSQL  │
│  (port 80)  │       │  (port 8000)  │       │  (port 5432) │
│  SPA + proxy│       │  REST API     │       │  User data   │
└─────────────┘       └──────────────┘       └──────────────┘
```

**Backend** (Python 3.11):
- FastAPI with async SQLAlchemy 2.0 + asyncpg
- JWT authentication (python-jose + passlib/bcrypt)
- NumPy/SciPy/Pillow for image processing and curve fitting
- In-memory image cache with TTL-based cleanup

**Frontend** (TypeScript):
- React 18 + React Router + Vite
- Tailwind CSS for styling
- react-konva for canvas-based image display and ROI interaction
- Plotly.js for calibration curve charts
- Client-side dose map rendering with Canvas API
- Axios with JWT interceptor

**Database** (PostgreSQL 16):
- Users, calibration profiles, channel parameters, calibration points, analysis sessions, ROI measurements

## Project Structure

```
Film_analysis/
├── main.py                    # Original desktop tkinter app (standalone)
├── calibration_config.json    # Desktop app calibration data
├── docker-compose.yml         # Docker Compose orchestration
├── .env.example               # Environment variable template
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py            # FastAPI app entry point, CORS, lifespan
│       ├── config.py          # Settings (env vars)
│       ├── database.py        # Async SQLAlchemy engine + session
│       ├── models.py          # ORM models (User, CalibrationProfile, etc.)
│       ├── schemas.py         # Pydantic request/response schemas
│       ├── auth.py            # Password hashing + JWT token creation
│       ├── dependencies.py    # get_current_user dependency
│       ├── routers/
│       │   ├── auth_router.py # POST /register, /login, GET /me
│       │   ├── profiles.py    # CRUD for calibration profiles
│       │   ├── analysis.py    # Upload, calibrate, dose map, ROI, save, export
│       │   └── wizard.py      # Calibration wizard workflow
│       └── services/
│           ├── film_analyzer.py   # Dose calculation, ROI mask, statistics
│           ├── calibration.py     # Color extraction, curve fitting
│           └── image_utils.py     # Image loading, preview generation
│
├── backend/tests/
│   ├── conftest.py            # Async test fixtures (SQLite test DB)
│   ├── test_auth.py           # Authentication tests (10 tests)
│   ├── test_services.py       # Service layer tests (24 tests)
│   ├── test_analysis.py       # Analysis endpoint tests (13 tests)
│   └── test_wizard.py         # Wizard endpoint tests (8 tests)
│
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── src/
│       ├── main.tsx           # App entry point
│       ├── App.tsx            # Routes and context providers
│       ├── api/client.ts      # Axios instance with JWT interceptor
│       ├── auth/              # Login, Register pages, AuthContext
│       ├── analysis/          # Analysis page, ImageCanvas, ROI, dose map
│       │   ├── AnalysisPage.tsx
│       │   ├── ImageCanvas.tsx
│       │   ├── CalibrationPanel.tsx
│       │   ├── StatsPanel.tsx
│       │   ├── ROIControls.tsx
│       │   ├── colormaps.ts
│       │   └── useDoseMap.ts
│       ├── wizard/            # Calibration wizard page
│       │   ├── WizardPage.tsx
│       │   ├── WizardCanvas.tsx
│       │   └── CurveChart.tsx
│       ├── history/           # Analysis history page
│       └── components/        # Layout, ProtectedRoute, ProtectedTabs
│
└── test/
    └── CAL_007.tif            # Sample calibration film scan
```

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

### Quick Start

1. **Clone and configure environment:**

   ```bash
   cp .env.example .env
   # Edit .env and set a strong SECRET_KEY for production
   ```

2. **Build and start all services:**

   ```bash
   docker compose up --build
   ```

3. **Access the application:**
   - Web UI: http://localhost
   - API docs: http://localhost:8000/docs

4. **Create an account** via the Register page, then log in.

### Local Development (without Docker)

**Backend:**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate    # or .venv\Scripts\activate on Windows
pip install -r requirements.txt

# Set environment variables
export DATABASE_URL="postgresql+asyncpg://filmuser:filmpass@localhost:5432/filmanalysis"
export SECRET_KEY="dev-secret-key"

uvicorn app.main:app --reload --port 8000
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `http://localhost:8000`.

### Running Tests

```bash
cd backend
pip install -r requirements.txt
pytest -v
```

Tests use an in-memory SQLite database (via aiosqlite) so no PostgreSQL instance is needed.

## API Reference

All endpoints are prefixed with `/api`. Protected endpoints require a `Bearer` token in the `Authorization` header.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account (returns JWT) |
| POST | `/api/auth/login` | Login (returns JWT) |
| GET | `/api/auth/me` | Get current user info |

### Calibration Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/profiles` | List user's calibration profiles |
| POST | `/api/profiles` | Create a new profile |
| GET | `/api/profiles/{id}` | Get profile details |
| PUT | `/api/profiles/{id}` | Update a profile |
| DELETE | `/api/profiles/{id}` | Delete a profile |
| POST | `/api/profiles/import` | Import from legacy JSON format |

### Calibration Wizard

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/wizard/upload-image` | Upload calibration film image |
| POST | `/api/wizard/extract-point` | Extract color percentages from ROI |
| POST | `/api/wizard/fit-curves` | Fit calibration curves (min 3 points) |
| POST | `/api/wizard/save-profile` | Save fitted profile to database |

### Film Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analysis/upload` | Upload film scan for analysis |
| GET | `/api/analysis/{id}/preview` | Get film image preview (JPEG) |
| POST | `/api/analysis/{id}/calibrate` | Apply calibration, generate dose map |
| GET | `/api/analysis/{id}/dose-preview` | Get dose map as PNG image |
| GET | `/api/analysis/{id}/dose-data` | Get dose map as binary Float32 array |
| POST | `/api/analysis/{id}/roi` | Compute ROI statistics |
| POST | `/api/analysis/{id}/save` | Save analysis session |
| GET | `/api/analysis/history` | List saved analysis sessions |
| GET | `/api/analysis/{id}/export` | Export ROI measurements as CSV |

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Service health check |

## Configuration

Environment variables (set in `.env` or system environment):

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `change-me-in-production` | JWT signing key |
| `DATABASE_URL` | `postgresql+asyncpg://...` | Database connection string |
| `UPLOAD_DIR` | `uploads` | File upload directory |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | JWT token expiry (24 hours) |
| `MAX_UPLOAD_SIZE_MB` | `200` | Maximum upload file size |
| `IMAGE_CACHE_TTL_MINUTES` | `30` | In-memory image cache TTL |

## Desktop Application

The original standalone desktop app is preserved in `main.py`. Run it directly:

```bash
pip install numpy scipy Pillow matplotlib
python main.py
```

It provides the same calibration and analysis functionality via a tkinter GUI, with calibration data stored locally in `calibration_config.json`.

## Supported File Formats

- TIFF (`.tif`, `.tiff`) — recommended for radiochromic film scans
- PNG (`.png`)
- JPEG (`.jpg`, `.jpeg`)

Maximum upload size: 200 MB (configurable).
