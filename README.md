# OmniRoute on Render

Deploys [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (free AI gateway) to Render using the official Docker image.

## Deploy
1. Push this folder to a new GitHub repo.
2. In Render: **New → Blueprint** → pick the repo → **Apply**.
3. When prompted, set:
   - `INITIAL_PASSWORD` – your dashboard login password
   - `PUBLIC_URL` – optional. Only if you use a custom domain (e.g. `https://omin.runhost.bond`).
     Leave blank and the app auto-uses your `https://xxxx.onrender.com` address.
4. Open `https://<your-service>.onrender.com` and log in.

## Use it
OpenAI-compatible endpoint: `https://<your-service>.onrender.com/v1`
Create an API key in the dashboard, add providers, then point Claude Code / Cursor / Cline etc. at that URL.

## Free plan notes
This repo is set to Render's **free** plan:
- No persistent disk: settings, providers and API keys reset on restart, sleep or redeploy.
- Sleeps after 15 min idle; first request takes ~1 min to wake.
- 512 MB RAM, so heavy use may cause restarts.

To keep your data, switch to `plan: starter` and add a disk mounted at `/app/data`.

## Domain auto-detect
`render-start.sh` runs before OmniRoute and sets `OMNIROUTE_PUBLIC_BASE_URL`, `NEXT_PUBLIC_BASE_URL`
and `AUTH_COOKIE_SECURE` automatically from `PUBLIC_URL` or Render's `RENDER_EXTERNAL_URL`.
No `.env` editing needed. Check the Render **Logs** tab for `[render-start] Public URL: ...`.

## "Bootstrap token" screen
If OmniRoute asks for a one-time bootstrap token, open Render → your service → **Logs**,
search for `bootstrap`, copy the token and paste it into the page.
