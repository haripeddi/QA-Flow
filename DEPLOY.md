# Deploying QA Flow

QA Flow needs a long-lived Node process that can spawn `python3` and Chromium.
Vercel's serverless runtime can't do that, so the deployment splits in two:

| Piece | Where | Why |
| ----- | ----- | --- |
| React frontend (`frontend/`) | **Vercel** | Static SPA, free, fast, gives you the public URL |
| Node backend (`backend/` + `bpmn/`) | **Render** (Docker) | Long-lived server, persistent disk, Python + Chromium baked in |

Both deploy automatically from the same GitHub repository on every push to `main`.

---

## 0. One-time prep (local)

```bash
cd "/Users/hari.peddi/QA Flow"
git add .
git commit -m "Add deployment configuration"
# Create an empty repo on GitHub (no README/license), then:
git remote add origin git@github.com:<your-user>/qa-flow.git
git branch -M main
git push -u origin main
```

---

## 1. Deploy the backend on Render (~5 minutes)

1. Sign in at [render.com](https://render.com) with your GitHub account.
2. **New +** → **Blueprint**.
3. Pick your `qa-flow` repository. Render will detect `render.yaml`.
4. Confirm the service: `qa-flow-backend`, Docker runtime, Starter plan ($7/mo — Free 512 MB can OOM Chrome).
5. Click **Apply**. First build takes ~3–4 minutes (it pulls the Playwright base image).
6. When it goes green, copy the URL — looks like `https://qa-flow-backend.onrender.com`.
7. Verify: `curl https://qa-flow-backend.onrender.com/api/health` should return `{"ok":true}`.

The `render.yaml` already provisions a **1 GB persistent disk** mounted at `/data`,
so run history and screenshots survive redeploys. BPMN process files (`bpmn/*.bpmn`,
`bpmn/tags/*.json`) live in git and ship with the image.

---

## 2. Deploy the frontend on Vercel (~2 minutes)

1. Sign in at [vercel.com](https://vercel.com) with your GitHub account.
2. **Add New…** → **Project** → import your `qa-flow` repo.
3. **Configure Project**:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `dist` (default)
4. Open **Environment Variables** and add:
   - `VITE_API_BASE_URL` = `https://qa-flow-backend.onrender.com` (your Render URL from step 1)
5. Click **Deploy**. You'll get a URL like `https://qa-flow-<hash>.vercel.app`.

---

## 3. Lock down CORS (recommended)

By default the backend allows any origin. Once you have the Vercel URL:

1. Back on Render → your service → **Environment** → add:
   - `ALLOWED_ORIGIN` = `https://qa-flow-<hash>.vercel.app`
   (Or comma-separate multiple: `https://app.example.com,https://staging.example.com`.
   Regex patterns are supported with `/.../` wrappers.)
2. Render redeploys automatically.

---

## 4. Future updates

Every `git push origin main`:
- Vercel rebuilds the frontend in ~30 seconds
- Render rebuilds the backend Docker image in ~2–3 minutes

No manual steps. Add/edit BPMN flows in the UI → click **Save** → use git from your
machine to commit the updated files under `bpmn/` if you want them in the deployed
image. (Saves from the UI only persist on the running server's disk; commit them
to keep them in version control.)

---

## Caveats running in the cloud

- **Browser/Playwright tests on Google.com**: cloud IPs trigger bot detection
  more often than your laptop. Your own apps and HTTP/Python tests are unaffected.
- **Render Free tier**: spins down after 15 min of inactivity and cold-starts take
  ~30 s. Starter plan ($7/mo) stays warm and gives you the RAM Chrome needs.
- **Single backend instance**: run state is held in memory. If you scale to
  multiple replicas, in-flight runs would not be visible across instances. Single
  instance is fine for a team of engineers running tests interactively.
