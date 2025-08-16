# AI Muzon – MVP

A minimal, fast web app to discover and play AI-generated music from YouTube. Frontend is Create React App + TypeScript + Tailwind. Backend is Node.js + Express proxying the YouTube Data API v3 with simple in-memory persistence (replaceable with DB).

## Monorepo layout
- `/` CRA frontend (React + TS)
- `/server` Express backend

## Prerequisites
- Node.js 18+
- YouTube Data API v3 key

## Setup

1. Install frontend deps
```
npm install
```

2. Option B: Client-only (skip backend, call YouTube API directly)
```
cp .env.example .env
# edit .env and set REACT_APP_YOUTUBE_API_KEY=YOUR_YOUTUBE_DATA_API_KEY
npm start
# App at http://localhost:3000
```
If REACT_APP_YOUTUBE_API_KEY (or legacy REACT_APP_YT_API_KEY) is set, the app will call https://www.googleapis.com/youtube/v3/search?... directly from the browser. If it is NOT set, the app will automatically fall back to the backend proxy at /api/search (if the server is running and configured).

3. Option A: Use backend proxy (optional)
```
cd server
npm install
cp server/.env.example server/.env
# edit server/.env and set YOUTUBE_API_KEY
npm run start
# Server at http://localhost:4000
```

4. Run frontend (new terminal) if using backend proxy
```
npm start
# App at http://localhost:3000
```

The frontend will call YouTube directly when `REACT_APP_YOUTUBE_API_KEY` (or legacy `REACT_APP_YT_API_KEY`) is set. If it is missing, the app will fall back to the backend proxy (`/api/search`) provided the server is running and `YOUTUBE_API_KEY` is configured. This prevents crashes due to missing API keys and offers a safer default for development.

## Scripts
- Frontend
  - `npm start` – start CRA dev server
  - `npm test` – run tests
  - `npm run build` – production build
  - `npm run lint` – run ESLint on the frontend source (TypeScript + React)
  - `npm run lint:fix` – auto-fix lint issues where possible
- Backend
  - `npm run start` – start Express server

## Environment variables
- Frontend (CRA)
  - `REACT_APP_YOUTUBE_API_KEY` – Your YouTube Data API v3 key. When set, the frontend fetches directly from YouTube. When missing, it falls back to the backend proxy if available.
  - `REACT_APP_YT_API_KEY` – Legacy/compat variable (optional). If both are set, `REACT_APP_YOUTUBE_API_KEY` is used.
  - `REACT_APP_MAX_ALLOWED_AGE` (optional) – maximum allowed viewer age used by the client-side content filter (videos should be suitable for users below this age); defaults to `14`. 
- Backend (`server/.env`)
  - `PORT=4000`
  - `CORS_ORIGIN=http://localhost:3000`
  - `YOUTUBE_API_KEY=...` – Required if you want the frontend to work without `REACT_APP_YT_API_KEY` (proxy mode). Example provided in `server/.env.example`.
  - `CACHE_TTL_SECONDS=3600`
  - `MAX_ALLOWED_AGE=14` – maximum allowed viewer age used by the server-side filter (videos should be suitable for users below this age)
  - `DATABASE_URL="file:./dev.db"` (SQLite file for Prisma)

## Database (Prisma + SQLite)
- First time setup:
```
cd server
npx prisma generate
npx prisma migrate dev --name init
```
- This creates `server/dev.db` (SQLite) and generates the Prisma client.

## Compliance: YouTube Data API and Copyright

Your deployment can be legal if you follow these rules:

1. Using the YouTube Data API
   - Allowed: Fetch video metadata (title, thumbnail, channel, etc.) and embed YouTube videos using the official API (v3). 
   - Requirements:
     - Must use the official API. Do not scrape YouTube HTML.
     - Must display videos using YouTube’s player (IFrame or libraries that wrap it).
     - Do not hide the video to play audio only—this violates YouTube’s ToS.
     - Must show video attribution (title, channel, thumbnail) in the UI.

2. Playing Videos
   - Inline playback via the YouTube IFrame player or opening YouTube in a new tab is allowed.
   - Do not download or stream raw video/audio; only embed via the official player.

3. Content and Attribution
   - Do not claim music or AI videos as your own.
   - Rely on YouTube-hosted content and each video’s license (some may be copyrighted, some Creative Commons).
   - This app shows attribution on each card and in the player header (title + channel + thumbnail).

4. Hosting
   - Hosting on Vercel (or similar) is fine as long as you comply with the above rules.

✅ Key Takeaway
- Current setup uses client-side API calls (or backend proxy) + embedded YouTube player + curated categories. Do not bypass the YouTube player or download videos; that’s the main red flag.

## Notes

### Linting and code style
- ESLint is configured with a simple preset for React + TypeScript (CRA defaults). No custom rules required.
- Recommended workflow: run `npm run lint` and `npm run lint:fix` before commits.
- IDE integration: most IDEs (WebStorm/VSCode) auto-detect the `.eslintrc.json` at the project root. Enable ESLint in your IDE for real-time feedback.
- Favorites and recent searches are now persisted in SQLite via Prisma.
- The app embeds YouTube videos via the official iframe player (no downloads), complying with YouTube ToS.

### Kid-friendly filtering
- The app filters search results to be suitable for viewers below the configured maximum allowed age (default 14), avoiding violent, sexual, or explicit language content in titles, descriptions, or tags. It excludes videos flagged as age-restricted for under-18 audiences and can be tuned via `REACT_APP_MAX_ALLOWED_AGE` (client) and `MAX_ALLOWED_AGE` (server).

### New Category: AI Music
- Added an "AI Music" category aggregating queries: "ai music", "artificial intelligence music", and "AI-generated songs". Results are prioritized by high view counts and recent uploads.

## Roadmap
- Swap in real persistence (SQLite via Prisma or MongoDB)
- Favorites management UI
- Basic tests (RTL + Jest, Supertest for backend)
- Deploy: Vercel (frontend) + Render/Railway (backend)
