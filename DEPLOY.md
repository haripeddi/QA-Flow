# Deploying QA Flow (free tier)

QA Flow needs a long-lived Node process that can spawn `python3` and Chromium.
Vercel's serverless runtime can't do that, so the deployment splits in two:

| Piece | Where | Why |
| ----- | ----- | --- |
| React frontend (`frontend/`) | **Vercel** (free) | Static SPA, gives you the public URL |
| Node backend (`backend/` + `bpmn/`) | **Hugging Face Spaces** (free, Docker SDK) | 16 GB RAM free — actually enough for Chrome + Python + Node together |

Both deploy automatically from git pushes.

---

## Heads-up before you start

- HF Spaces **free tier is public** — anyone with the URL can use your backend.
  That's fine for a demo. Private Spaces are paid.
- HF Spaces free tier has **no persistent disk** — BPMN flows (`bpmn/*.bpmn`) live
  in git and survive, but run history (`runs.json`) and screenshots reset when the
  Space rebuilds.
- HF Spaces sleeps after **48 hours of no traffic** — first request after that
  takes ~30 seconds. Way less aggressive than Render Free's 15 minutes.

---

## 0. One-time prep (local)

You already have the local commit. Push it to GitHub:

```bash
cd "/Users/hari.peddi/QA Flow"
git branch -M main
git remote add origin https://github.com/haripeddi/QA-Flow.git
git push -u origin main
```

If GitHub prompts for credentials, use your username + a **personal access token**
(GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
→ Generate new, scope `repo`).

---

## 1. Create a Hugging Face account + token (~2 min)

1. Sign up at [huggingface.co](https://huggingface.co) (Google sign-in works).
2. Click your avatar → **Settings** → **Access Tokens** → **New token**.
   - Name: `qa-flow-push`
   - Role: **Write**
   - Click **Generate** and **copy** the token (starts with `hf_…`). You won't see it again.

---

## 2. Create the Space (~2 min)

1. Top-right **+** → **New Space**.
2. Fill in:
   - **Owner**: your username (e.g. `haripeddi`)
   - **Space name**: `qa-flow-backend`
   - **License**: MIT
   - **Select the Space SDK**: **Docker** → **Blank**
   - **Space hardware**: **CPU basic - 2 vCPU - 16 GB** (free)
   - **Visibility**: Public
3. Click **Create Space**. You'll land on an empty Space page.
4. Copy the Space URL — looks like `https://huggingface.co/spaces/haripeddi/qa-flow-backend`.

---

## 3. Push the code to the Space (~1 min + ~5–10 min build)

The Space is itself a git repository. Add it as a second remote and push:

```bash
cd "/Users/hari.peddi/QA Flow"
git remote add hf https://huggingface.co/spaces/haripeddi/qa-flow-backend
git push hf main
```

When prompted:
- **Username**: your HF username
- **Password**: paste the `hf_…` token from step 1

Go back to the Space page in your browser — the **Logs** tab will show:
1. `Building Docker image…` (downloads Playwright + Chrome base image, ~5–8 min the first time)
2. `Running on local URL: http://0.0.0.0:4000`
3. **App** tab turns active.

Your backend URL is `https://<username>-qa-flow-backend.hf.space` (lowercase, dashes).

Verify: open `https://<username>-qa-flow-backend.hf.space/api/health` in a tab —
should return `{"ok":true}`.

---

## 4. Deploy the frontend on Vercel (~2 min)

1. Go to [vercel.com](https://vercel.com) → Sign in with GitHub (authorize when asked).
2. **Add New…** → **Project** → import `QA-Flow`.
3. **Configure Project**:
   - **Framework Preset**: Vite (auto-detected)
   - **Root Directory**: click **Edit** → select `frontend` → Continue
4. Expand **Environment Variables** and add:
   - **Name**: `VITE_API_BASE_URL`
   - **Value**: paste the HF Space URL (e.g. `https://haripeddi-qa-flow-backend.hf.space`)
5. Click **Deploy**. Done in ~30 s. URL looks like `https://qa-flow-<hash>.vercel.app`.

---

## 5. Lock down CORS (recommended, ~1 min)

By default the backend allows any origin. Once you have the Vercel URL:

1. Open your HF Space → **Settings** → **Variables and secrets**.
2. **New variable** (not secret):
   - **Name**: `ALLOWED_ORIGIN`
   - **Value**: `https://qa-flow-<hash>.vercel.app` (your Vercel URL)
3. The Space rebuilds automatically (~1 min).

---

## 6. Future updates

| Change to push | Command |
| -------------- | ------- |
| Update both at once | `git push origin main && git push hf main` |
| Only frontend (UI tweaks) | `git push origin main` (Vercel rebuilds in 30 s) |
| Only backend (engine/workers) | `git push hf main` (HF rebuilds in 2–3 min, cached after first build) |

---

## Caveats running on free tier

- **Browser/Playwright on Google**: cloud IPs trigger bot detection more often.
  Your own apps and HTTP/Python tests are unaffected.
- **48-hour sleep**: first request wakes the Space in ~30 s — acceptable for a
  demo, annoying for active use. Paid HF hardware ($0.05/hr CPU upgrade) skips this.
- **Public by default**: the URL and backend logs are visible to anyone. Don't put
  secrets (API keys) in Python test code without using HF's encrypted "Secrets"
  (Settings → Variables and secrets → "New secret").
- **Run history resets on rebuild**: BPMN flows survive (in git) but past
  `runs.json` does not. Acceptable for QA — runs are usually short-lived state.
