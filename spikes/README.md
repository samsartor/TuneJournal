# Milestone 0 spikes: manual test guide

The spike pages live inside the app, under `/spike` (`app/src/routes/spike/`, helpers in
`app/src/lib/spike/`). They're there rather than in this folder because the Web Share Target needs
the app's manifest and service worker. M4 moved the share target into the app proper
(`app/src/lib/integrations/share-target.ts`, landing on `/shared`), and `/spike/share` now just
forwards there. The other spike pages still work and can be deleted once the manual tests below
are done; keep the `share_target` block in the manifest and the service worker's share-target
`if` block, which are production code now.

Results so far are recorded in `PLAN.md` §7. This file covers the parts that need you: Google
credentials, an Android phone, and your ears.

```sh
cd app
npm run dev          # http://localhost:5173/spike
```

---

## 1. Google Cloud setup (for `/spike/drive`)

You need three values. Either paste them into the app at runtime, in **Settings → Google
Drive** (no rebuild needed), or put them in `app/.env` (copy `app/.env.example`) before building:

| Settings field | `.env` variable | What it is |
|---|---|---|
| OAuth client ID | `PUBLIC_GOOGLE_CLIENT_ID` | OAuth 2.0 *Web application* client ID (`….apps.googleusercontent.com`) |
| API key | `PUBLIC_GOOGLE_API_KEY` | Browser API key, used by the Picker |
| App ID (project number) | `PUBLIC_GOOGLE_APP_ID` | The Cloud **project number** (digits, not the project ID) |

Values pasted in Settings are saved on that device only (localStorage, never in the synced
library), so set them on each device. They take precedence over the `.env` values, which stay as
the defaults. Settings shows the page's origin to add to the OAuth client (step 4), and a **Test
connection** button that signs in and lists the app's Drive folder. `/spike/drive` uses the same
settings.

The `.env` values end up in the client bundle. That's expected: they're public identifiers,
locked down by origin restrictions, not secrets.

Steps (console.cloud.google.com; Google moved OAuth settings under **Google Auth Platform** in
2025, and older consoles call the same pages "OAuth consent screen" and "Credentials"):

1. **Create a project.** Project picker → *New project* → name it `TuneJournal`. Then open
   *Dashboard* (or *IAM & Admin → Settings*) and copy the **Project number**. That's the app ID
   (`PUBLIC_GOOGLE_APP_ID`).
2. **Enable APIs.** *APIs & Services → Library*, then enable **Google Drive API** and **Google
   Picker API**.
3. **Consent screen.** *Google Auth Platform → Get started* (or *OAuth consent screen*):
   - App name `TuneJournal`, your email as the support and developer contact.
   - Audience: **External**. Leave it in **Testing** and add your own Google account under
     *Audience → Test users*.
   - *Data access → Add or remove scopes*: add `.../auth/drive.file` ("See, edit, create and
     delete only the specific Google Drive files you use with this app"). It's non-sensitive,
     so publishing to production later needs no Google verification.
4. **OAuth client.** *Google Auth Platform → Clients → Create client* (or *Credentials → Create
   credentials → OAuth client ID*):
   - Type: **Web application**, name `TuneJournal web`.
   - **Authorized JavaScript origins**, with no paths and no trailing slashes (Settings → Google
     Drive shows the origin you're on):
     - `http://localhost:5173`
     - `http://localhost:4173` (`npm run preview`)
     - the HTTPS origin you'll use for phone testing (§3), e.g. `https://<machine>.<tailnet>.ts.net`
     - the future deploy origin, e.g. `https://tunejournal.pages.dev` (it can be added later)
   - **Authorized redirect URIs**: leave empty. The GIS token client uses a popup, not redirects.
   - Copy the client ID into Settings → Google Drive, or `PUBLIC_GOOGLE_CLIENT_ID`.
   - Origin changes can take a few minutes to apply. Until then you'll get
     `origin_mismatch` / `idpiframe_initialization_failed`.
5. **API key.** *APIs & Services → Credentials → Create credentials → API key*, then *Edit*:
   - *Application restrictions*: **Websites**, and add the same origins as above with a path
     wildcard, e.g. `http://localhost:5173/*`.
   - *API restrictions*: **Restrict key**, allowing only **Google Picker API**.
   - Copy it into Settings → Google Drive, or `PUBLIC_GOOGLE_API_KEY`.
6. In Settings → Google Drive, press **Save**, then **Test connection**. (With `.env` instead,
   restart `npm run dev`: env vars are inlined when the dev server or build starts.)

### Test (`/spike/drive`)

1. Put a short m4a in your Drive, e.g. a Pixel Recorder file synced to Drive, or any m4a or mp3.
2. **Sign in (drive.file)** opens a popup. Pick your test account and grant access. The page
   shows when the token expires (about 1 h).
3. **Pick an audio file** opens the Picker. Choose the file. The log should show:
   `picked …` → `downloaded N bytes` → `stored in opfs as drive/…` → an `<audio>` player appears.
   Play it.
4. **Upload to TuneJournal/** with no file chosen uploads a small text file. Choose a local
   audio file first to test a real one. Check in drive.google.com that a `TuneJournal` folder
   now exists and contains the file. Run it twice to confirm the folder is reused, not duplicated.
5. Optional: open `/spike/speed`. The Drive file is listed under "From OPFS".

### Test the app's Drive flows (M4)

The spike page tests the raw API calls; these test what M4 built on them. With the same settings:

1. **Settings → Google Drive → Connect Google Drive.** It should show "Connected on this device".
2. On a tune with no recordings, **Google Drive** in the import panel opens the Picker. Pick an
   audio file: a clip appears, shows "Downloading…" briefly, then plays from the cache.
3. **Upload a file** on another tune. With Drive connected it's backed up in the background (no
   "Not backed up" badge after a moment, and a file in `TuneJournal/` in Drive). Disconnect, upload
   again, and check the badge appears; then reconnect and use the clip's ⋯ → **Back up to Drive**.
4. On a **second device** linked to the same library (Settings → Link a device), with Drive
   connected there too, play both clips. They should download from Drive on first play, then play
   offline once **Keep offline** (⤓) is on.
5. Wait for the token to expire (about an hour, or clear `sessionStorage`) and play an uncached
   Drive clip: it should ask Google for a new token, usually without the consent screen.

Record the outcome, or paste the log, in PLAN.md §7. Things worth noting:
- whether the popup was blocked (it has to come from a click, which it does here)
- how a second sign-in behaves after the token expires: is it silent or a full prompt?
- the m4a's `blob.type`. Drive sometimes serves `audio/x-m4a` or `application/octet-stream`.
  The page falls back to the Picker's MIME type.

---

## 2. Web Share Target from Pixel Recorder (`/shared`)

Needs Android Chrome, an **installed** PWA, and an **HTTPS** origin (localhost over USB doesn't
count for installation).

### Get an HTTPS origin (pick one)

- **Tailscale Funnel** (stable URL, recommended if you use Tailscale):
  ```sh
  cd app && npm run build && npx vite preview --host 127.0.0.1 --port 4173
  # In another terminal:
  tailscale funnel 4173          # → https://<machine>.<tailnet>.ts.net
  ```
- **cloudflared quick tunnel** (no account needed; the URL changes on every run, so it's awkward
  for the Google OAuth origin):
  ```sh
  cd app && npm run build
  __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.trycloudflare.com npx vite preview --host 127.0.0.1 --port 4173
  cloudflared tunnel --url http://127.0.0.1:4173
  ```
- **Cloudflare Pages preview:** `npx wrangler pages deploy app/build --project-name tunejournal --branch spike`.
  This needs your Cloudflare account, so it's your call.

Use `vite preview` on a fresh build rather than `npm run dev` for this. It's closer to
production, and the service worker precaches the real shell. `npm run dev` also works now
(module service workers are fine in Chrome), and you'd add `--host 127.0.0.1` and the same
allowed-hosts variable, but HMR over a tunnel is flaky. Vite rejects unknown `Host` headers, so
for Funnel add `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.ts.net` as well.

### Test

1. On the phone, open `https://…/` in Chrome. Menu → **Install app** (or *Add to
   Home screen → Install*). It must be a real install (WebAPK), not a shortcut: launched from the
   home screen icon, it opens without Chrome's address bar.
2. Open **Pixel Recorder** → a recording → **Share** → choose **Audio** (the m4a), not *Link* or
   *Transcript* → pick **TuneJournal** in the share sheet.
   - If TuneJournal isn't in the sheet, the WebAPK may predate the `share_target` entry.
     Uninstall and reinstall the app.
3. The app should open on **Shared recording** (`/shared?received=1`) with the file listed and
   playable. Attach it to a tune (search) or **New tune**; it should then play from the tune's
   recordings, marked "Not backed up" unless Drive is connected. Also try sharing a **Link** from
   Recorder (or a YouTube video from the YouTube app): it's listed with the detected provider and
   attaches the same way. Note what Recorder puts in the title and text.
4. Turn on airplane mode, reopen the app and check the shared file still plays offline.
5. Record the result in PLAN.md §7: the file name and type the page shows (`audio/mp4`?
   `audio/x-m4a`?), and the size.

An app installed before M4 has the spike's `spike/share-target` action in its WebAPK; that's
still accepted, but reinstall to pick up the new one.

Already verified on desktop Chromium (headless, and in `app/e2e/recordings.test.ts`): a multipart
POST navigation to `/share-target` is caught by the service worker, the file is stored in the audio
cache, the page is redirected (303) to `/shared`, and attaching and playing it work. The Android
share sheet itself is the untested part.

---

## 3. Slow-down listening test (`/spike/speed`)

1. Open `/spike/speed` on **desktop Chrome** and on **Android Chrome** (via the HTTPS origin
   above, or the installed app).
2. Load a real tune recording: a file input, or a file already in OPFS from the Drive or Share
   spikes. Use something with ornaments (cuts, rolls) and a steady pulse. Try both a Recorder
   m4a and a commercial mp3 or m4a.
3. Turn **loop** on and listen at **50%, 60%, 75%, 90%** with **preservesPitch** on. Toggle it
   off now and then to compare against the tape-style pitch drop.
4. For each, write down: *usable for learning? / warbly / smeared ornaments / phasey / clicks at
   the loop point*.
5. Paste the JSON at the bottom of the page (it shows support flags and the user agent) together
   with your notes into PLAN.md §7.

---

## 4. YouTube and Automerge (optional re-checks)

These are already confirmed headlessly (PLAN.md §7). If you want to see them yourself:
- `/spike/youtube`: paste a tune video URL, set start/end, turn loop on, and step the speed with
  −5%/+5%. "Probe" lists what the player reports for each 0.05 step.
- `/spike/sync`: *Create doc* in one browser, then open the URL shown (with `?doc=…`) in another
  browser or a private window and press *Bump* on either side.
