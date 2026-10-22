# TuneJournal — Plan

A local-first PWA for tracking folk tunes: what I can play, what I want to learn, and where I've
heard or recorded them. Part todo list, part spaced-repetition deck, part file store, part music
player.

> Status: M0–M6 are built (spikes, core list, sync, thesession.org, recordings and player,
> relations, shuffle); nothing is deployed yet. Only manual tests are pending: Google Drive with
> real credentials, the Android share sheet and the slow-down listening test
> (`spikes/README.md`). The M7 backend is deferred until it's needed, and M8 is for later. Sections
> marked **(decision)** are proposals to confirm; see
> [Decisions and open questions](#14-decisions-and-open-questions) at the end.

---

## 1. Goals and non-goals

**Goals**

- Works fully offline once loaded; every user action is a local write first.
- Syncs between my devices without an account system in v1.
- A static app servable from any CDN. No hard dependency on one hosting vendor.
- Adding a tune or attaching a recording takes a few taps, including on a phone.
- Rich [thesession.org](https://thesession.org) integration: search, autofill, sets, aliases.
- Recordings from many sources (Drive, Pixel Recorder, YouTube, uploads, Spotify links), trimmed
  without being re-encoded or copied.
- A shuffle/flashcard practice mode with tunable randomness.

**Non-goals for v1**

- Multi-user collaboration or sharing tunes with other people.
- Sheet music or ABC editing. ABC from thesession may be *displayed* later.
- Our own audio transcoding pipeline, except as a side effect of `yt-dlp` in the backend phase.
- Native apps. The PWA must be good enough on Android and desktop. iOS should work but isn't the
  main target.

---

## 2. Architecture overview

```
┌──────────────────────────── Browser (PWA) ─────────────────────────────┐
│  Svelte 5 UI                                                          │
│    │                                                                  │
│  Domain layer (pure TS: ops on the library doc, shuffle, merge, ...)  │
│    │                                                                  │
│  ┌─────────────┐  ┌─────────────────────┐  ┌──────────────────────┐   │
│  │ User state  │  │ Integration cache   │  │ Audio cache          │   │
│  │ (CRDT doc,  │  │ (IndexedDB, not     │  │ (OPFS blobs, keyed   │   │
│  │  IndexedDB) │  │  synced: thesession │  │  by source id, not   │   │
│  │             │  │  JSON, oEmbed, ...) │  │  synced)             │   │
│  └──────┬──────┘  └─────────────────────┘  └──────────────────────┘   │
│         │ sync (WebSocket)                                            │
│  Service worker: app shell precache + auto-update                     │
└─────────┼─────────────────────────────────────────────────────────────┘
          │
   ┌──────┴────────┐   direct from browser (CORS OK):     later, own backend (VPS):
   │ Sync relay    │   - thesession.org API               - automerge sync server
   │ (public, then │   - Google Drive API + Picker        - yt-dlp extraction
   │  self-hosted) │   - YouTube IFrame player            - Google Recorder proxy
   └───────────────┘                                      - S3-compatible asset store
```

Three separate kinds of local data, on purpose:

1. **User state**: the CRDT document. Small, synced, the source of truth. It holds only what
   the user created or chose: pieces, tags, practice log, links to sources, trim points.
2. **Integration cache**: data fetched from third parties (thesession tune JSON, sets, oEmbed
   titles and thumbnails). Not synced. Can be dropped and re-fetched at any time. This keeps the
   synced doc small and avoids storing thesession's data as if it were ours.
3. **Audio cache**: downloaded audio blobs in OPFS, keyed by source id, so recordings play
   offline. Not synced. Each device fetches from the original source on demand, with an
   optional "keep offline" toggle per recording.

---

## 3. Tech stack (decision)

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | |
| UI | Svelte 5 (runes) | |
| App framework | SvelteKit 3 + `adapter-static` (SPA fallback, `ssr = false`) | Gives routing and builds to plain static files. Kit 3 has no `svelte.config.js`: its config is passed to `sveltekit({...})` in `vite.config.ts`. `$lib` is now `#lib` (package.json subpath imports). |
| PWA | SvelteKit's native service worker (`src/service-worker/`) + a static `manifest.webmanifest` | Precached app shell and WASM. Prompt "Update available — reload" rather than a silent reload mid-practice. `@vite-pwa/sveltekit` was rejected: its peer deps only allow Kit 1–2. |
| User state | **Automerge** 3 + `@automerge/automerge-repo` **~2.5.x** | See §4. Needs `vite-plugin-wasm` and `build.target: 'esnext'` (for top-level await). The repo packages are pinned to 2.5.x because npm's `latest` tag points at a 2.6 alpha. |
| Local storage | `automerge-repo-storage-indexeddb`, OPFS for audio, a tiny IndexedDB wrapper for caches (`integrations/cache.ts`) | |
| Styling | Plain CSS with custom properties, or Tailwind | No component library. Mobile-first. |
| Audio UI | `<audio>` + wavesurfer.js (regions plugin) for trimming | YouTube uses the IFrame Player API behind the same player interface. |
| Search | In-memory, MiniSearch or plain filtering | A few thousand pieces at most. |
| Tests | Vitest (domain layer), Playwright (e2e, offline mode) | |
| Backend (later) | Hono on Node in Docker on the VPS | Hono also runs on Workers/Deno/Bun, so the light endpoints stay portable. Heavy ones (yt-dlp, headless Chrome) need a real server anyway. |
| Asset storage (later) | Any S3-compatible API (MinIO/Garage on VPS, R2, B2) | Abstracts over the vendor. |
| Static hosting | Cloudflare Pages *or* anything else | Use nothing Pages-specific beyond `_headers`/`_redirects`, which most static hosts support too. |

Notes on the SvelteKit 3 setup:
- Service-worker modules are `$app/service-worker` (`self`), `$app/manifest` (`immutable`,
  `assets`, `prerendered`) and `$app/env`. There is no `$service-worker` module.
- `version` from `$app/env` is `undefined` inside the service worker (Kit 3.1), so
  `vite.config.ts` defines `__BUILD_ID__` for the cache name instead.
- The service worker is registered automatically by Kit. It never calls `skipWaiting()` on
  its own; `src/lib/pwa/update.svelte.ts` posts `SKIP_WAITING` when the user accepts the toast.
- The static host must serve `index.html` for unknown paths. (`vite preview` renders deep links
  itself, so it hides a missing fallback.)
- `paths.relative` is `false`, because the service worker serves one cached shell for every route
  and `./_app/...` URLs would break under `/spike/share` and other nested paths. `vite preview`
  rendered relative paths before this change.
- Vite doesn't apply `define` to the service worker in dev, so `__BUILD_ID__` is read through
  `typeof` with a `'dev'` fallback. Before that fix the dev service worker failed to evaluate.
- Public build-time config goes in `src/env.ts` (`defineEnvVars`) and is imported from
  `$app/env/public`. The Google IDs are set up this way (`app/.env.example`).

---

## 4. Automerge vs Evolu

**Decided (2026-10-22): Automerge.** The M0 spike confirmed sync and offline WASM work. A
thin repository layer means the UI never touches the CRDT directly.

**Evolu**
- ➕ End-to-end encrypted by default. A public relay can't read the data. This is its best feature.
- ➕ SQLite with typed Kysely queries. Sort, filter, and many-to-many joins are natural.
- ➕ Account-less multi-device via a mnemonic.
- ➖ Last-write-wins per column only. That's fine here, but it means no CRDT lists. Ordering
  needs fractional indexes, which we'll want anyway.
- ➖ Smaller community. The API changed a lot across major versions. Its relay is
  Evolu-specific.
- ➖ SQLite-WASM + OPFS adds some weight and browser quirks, especially on iOS.

**Automerge**
- ➕ Mature and widely used. Automerge 3 fixed most of the old memory/performance complaints.
- ➕ The doc is plain JS objects, which work naturally with Svelte 5 `$state`/`$derived`.
- ➕ `automerge-repo` has a tiny self-hostable sync server (`automerge-repo-sync-server`) that
  fits on the VPS next to the other backend pieces later. It's portable and vendor-neutral.
- ➕ Full history and easy JSON export/import for backups.
- ➖ **No encryption** on the public relay (`sync.automerge.org`). The doc URL works as a
  bearer capability. This is acceptable for tune lists in the early phase. We move to a
  self-hosted relay once the backend exists.
- ➖ Schema migrations are hand-rolled (`schemaVersion` + migration functions on load).
- ➖ Filtering and sorting are in-memory. That's fine at our scale.

**When to choose Evolu instead:** if E2EE on third-party infrastructure is a hard requirement
from day one.

**Doc layout:** one `Library` doc per user holds everything, for a few thousand pieces at
most. The practice log is the only part that grows without bound. If it gets large, split it
into per-year `PracticeLog` docs referenced from the Library. Don't do that up front.

**Device pairing:** the first device creates the Library doc. Other devices join through a
"Link device" screen that shows the doc URL as a QR code or copyable string. Keep this behind
a `Storage` interface so we could later swap in an account and auth model, or Evolu.

---

## 5. Data model

All IDs are random (`nanoid`/UUIDv7). Timestamps are ISO strings or epoch ms. Everything is
optional unless noted. The shapes are designed around CRDT merge behaviour:

- **Sets of things are maps, not arrays.** For example, `tags: Record<string, true>`.
  Concurrent adds of the same tag then merge instead of duplicating.
- **Ordered things use fractional index keys** (`order: string`, e.g. `fractional-indexing`)
  inside maps, not array moves. Concurrent reorders resolve cleanly.
- **Deletes are soft** (`deletedAt`). This gives undo, and a stale device can't resurrect
  a piece by editing it.

```ts
type PieceKind = 'session' | 'set' | 'tune' | 'part';

interface Library {
  schemaVersion: number;
  pieces: Record<PieceId, Piece>;
  sources: Record<SourceId, Source>;       // shared by many clips across pieces
  links: Record<LinkId, Link>;             // many-to-many piece relations
  settings: Settings;                      // shuffle temps, default sort, etc. (synced)
}

interface Piece {
  id: PieceId;
  kind: PieceKind;                         // required; shown as Session/Set/Tune/Part
  title?: string;
  description?: string;                    // plain text/markdown
  tags: Record<string, true>;              // free-form; case-insensitive matching, stored as typed
  skill?: 1 | 2 | 3 | 4 | 5;               // undefined = unrated (default); 1 = never played … 5 = amazing
  key?: string;                            // usual key, e.g. "D major", "A dorian"; hidden for set/session
  firstNotes?: string;                     // ABC snippet of the opening, e.g. "A2 FA dAFA"; hidden for set/session
  favorite: boolean;
  clips: Record<ClipId, Clip>;             // recordings attached to this piece
  practice: PracticeEntry[];               // append-only (concurrent appends merge fine)
  external?: {                             // stable identity for dedupe/merge
    thesession?: { tuneId?: number; settingId?: number; setId?: number; sessionId?: number };
    folkfriend?: { id: string };
  };
  createdAt: number;
  modifiedAt: number;
  deletedAt?: number;
  mergedInto?: PieceId;                    // tombstone redirect after merge
}

interface Clip {                           // a (possibly trimmed) view onto a Source
  id: ClipId;
  sourceId: SourceId;
  order: string;                           // fractional index within the piece
  start?: number;                          // seconds; undefined = beginning
  end?: number;                            // seconds; undefined = end
  title?: string;                          // overrides source title
  key?: string;                            // key as played in this recording; overrides piece.key
  firstNotes?: string;                     // ABC opening as played here; overrides piece.firstNotes
  note?: string;
  addedAt: number;
}

type Provider =
  | 'upload' | 'gdrive' | 'grecorder' | 'youtube' | 'spotify'
  | 'thesession' | 'folkfriend' | 'url';

interface Source {                         // the underlying asset/link, never trimmed
  id: SourceId;
  provider: Provider;
  url: string;                             // canonical link; always openable as fallback
  externalId?: string;                     // Drive file id, YouTube video id, …
  title?: string;
  durationSec?: number;
  mime?: string;
  assetKey?: string;                       // backend/Drive blob key once stored by us
  addedAt: number;
}

interface Link {                           // parent "contains" child: session⊃set⊃tune⊃part
  id: LinkId;                              // = `${parentId}:${childId}` so concurrent identical adds dedupe
  parent: PieceId;
  child: PieceId;
  order: string;                           // position of child within parent
}

interface PracticeEntry {                 // only "Practiced" is logged; skipping persists nothing
  at: number;
  skillAfter?: 1 | 2 | 3 | 4 | 5;          // snapshot when skill was changed in the same action
  via?: 'card' | 'shuffle';
}
```

Notes:
- The hierarchy session ⊃ set ⊃ tune ⊃ part is conventional, not enforced. A link may join any
  two kinds, but the UI labels actions by the conventional child kind ("Add Set" on a Session).
- `Source` lives at the library level, so splitting or sharing a recording between pieces never
  duplicates the asset. Only the clip's `start`/`end` differ.
- **Key and first notes** exist at two levels, because one tune is often played in several
  keys. `piece.key`/`piece.firstNotes` hold the usual version, which is the one used for
  search, filter, and card display. `clip.key`/`clip.firstNotes` override them for a specific
  recording, and the player shows the clip's effective key. Both fields are hidden in the UI
  for sets and sessions; the data stays if the kind changes. Keys are stored normalized
  (tonic + mode) so they can be filtered, and are rendered like "D maj" or "A dor". The first
  notes are an ABC fragment. Display them as text at first; rendering them with abcjs comes
  later.
- Derived values like "last practiced", "times practiced", and "has recordings" are computed,
  never stored. A small memoized index layer rebuilds them on doc change.
- **Practice propagates upward at query time, not write time.** Practicing a Set logs an entry
  on the Set only. A piece's *effective* practice history combines its own entries with the
  entries of every ancestor, found by walking `Link`s from child to parent. The traversal keeps
  a visited set, because nothing enforces that links form a hierarchy and cycles are possible.
  "Last practiced" and "times practiced" on cards, sorting, and the shuffle's staleness factor
  all use the effective history. The detail view shows it with each inherited entry labelled
  "via <Set name>".
- **Parts inherit from their Tune.** If a Part has no `skill` or `key` of its own, it uses the
  value from its parent Tune. Inherited values appear muted, with a "from <Tune>" hint, and
  editing one gives the Part its own value. Filters, sorting, and the shuffle use the effective
  value. If a Part belongs to several Tunes, it inherits from the earliest-created one.
  - `firstNotes`, title, tags, favorite, and recordings are *not* inherited. A B part starts
    differently from the A part.
  - Only Part → Tune inherits attributes. Tunes don't inherit from Sets, and Sets don't
    inherit from Sessions. Practice history is different: it propagates up the whole graph
    (above).
- Data that is *suggested but not stored* goes in the integration cache, not the doc. One
  example is "thesession sets this tune appears in". The user can **promote** a suggestion
  into a real `set` piece plus links.

---

## 6. UI specification

### 6.0 Layout
- **Mobile:** the list fills the screen. The detail view is a full-screen route.
- **Desktop (wide viewport):** the list is on the left and the selected piece's detail view is in
  a pane on the right. The selection is reflected in the URL (`/piece/[id]`), so it can be
  linked and survives a reload. Edit still opens as a modal over both panes.
- **Shuffle** is always full-screen, on both mobile and desktop.

### 6.1 Main list
- One scrolling list of piece cards, virtualized if needed.
- **Mobile:** a floating (+) circle in the lower-left corner adds a piece. A shuffle circle sits
  next to it. The lower-left placement is deliberate and keeps the bottom-right free for the
  player bar.
- **Desktop:** an "Add +" button and a shuffle button sit above the list, next to the search bar.
- **Search bar:** matches title, plus thesession aliases from the cache. Later it also matches
  description and tags, with fuzzy matching.
- **Filter/sort controls** (a collapsible bar on mobile):
  - Filter by kind (default: Tunes), tags (any/all), skill range (including unrated), key,
    favorites only, has or lacks recordings, practiced within or not within N days.
  - Sort by title, created, modified, last practiced, times practiced, or skill. Each sort has
    an ascending/descending toggle.
  - The last-used filter and sort persist in synced `settings`.
- **Card contents:** a kind badge, title (or "Untitled tune" in muted text), the ★/☆ toggle,
  the key (tunes and parts), a tag chip row, skill dots (or "unrated"), "Last practiced 3 days
  ago", provider icons for attached recordings,
  a big **Practiced ✓** button, and an overflow menu (Edit, Merge…, Delete). Tapping the card
  opens the detail view.

### 6.2 Detail / Edit
- **Detail view:** the full description, tags, a skill slider, the practice history (most recent
  first), a recordings list with play controls, and related pieces (parents and children), each
  openable.
- **Edit modal:**
  - A kind dropdown (Session/Set/Tune/Part).
  - A title field with a 🔍 thesession search button.
  - Description, tags, skill (starts unrated, with a "clear rating" option), and favorite.
  - Key (a tonic + mode picker that also accepts free text) and first notes (ABC text). Both are
    hidden for sets and sessions.
  - External IDs, read-only with an unlink option.
- **Tag input:** a chip input. Typing filters existing tags, sorted by usage count. Enter or a
  comma accepts the highlighted suggestion, or creates the typed text as a new tag. The
  "Create 'xyz'" row is always present when the text is new.
- **Recordings section:** if there are no clips, a prominent import panel shows the source
  buttons (Drive, Recorder, YouTube, Upload, Link). Once clips exist it collapses to a small
  "+ Add recording". Clips can be dragged to reorder, removed, or trimmed.

### 6.3 Add flow
1. Tap (+). This creates a blank Tune immediately and opens Edit, so nothing is lost if the user
   navigates away. Empty pieces untouched for 60s could be auto-discarded, or just left.
2. Optionally press 🔍 next to the title to search thesession and pick a result. This fills the
   title, `external.thesession.tuneId`, and a type tag (Reel/Jig/Slip Jig/Hornpipe/Polka/…). It
   can also add the thesession link as a non-audio source. If the result has several settings,
   the user picks one, and that setting fills in `key` (from its `mode`, e.g. `Dmajor`) and
   `firstNotes` (the first bar or two of its ABC).
3. If that thesession tune already exists in the library, offer to open it instead, or to merge.

### 6.4 Relations: Add / Split / Merge
- **Add child:** the label depends on the parent's kind ("Add Set", "Add Tune", "Add Part"). It
  opens a picker with search over existing pieces and a "New …" option. It creates a `Link`.
- **Split:** "Split Part" on a tune, "Split Tune" on a set, and so on. It opens the trim editor on
  one of the piece's clips. The user selects a region, which creates a new child piece with a
  clip on the **same source** using the region's `start`/`end`, plus a link. The user can repeat
  this to split off several regions in sequence. Splitting with no region creates a blank child.
- **Suggested relations:** for a tune linked to thesession, show "Appears in sets…" from
  `/tunes/{id}/sets`. "Add to library" promotes a suggestion into a Set piece, matching or
  creating the other tunes.
- **Merge:** choose a survivor, then:
  - Union the tags, clips, links (re-pointed and deduped), practice logs (sorted), and
    external IDs.
  - Favorite becomes `a || b`. Skill becomes the max. Title, kind, and description come from
    the survivor, with a field-by-field picker in the confirm dialog.
  - The loser gets `mergedInto` and `deletedAt`. Lookups follow `mergedInto` chains, so a
    device that edited the loser offline still lands somewhere sensible.
  - **Auto-merge prompt:** when two live pieces share `external.thesession.tuneId`, show a
    non-blocking banner "2 pieces are the same thesession tune. Merge?"
  - **Manual merge:** from the overflow menu, "Merge with…" opens the piece picker.

### 6.5 Shuffle (flashcards)
- A full-screen view, top to bottom:
  - ⚙ settings at the top.
  - The piece: title, key, first notes, tags, and last practiced.
  - **A prominent player**:
    - A recording selector, defaulting to the first clip. It shows the clip's key when that
      differs from the piece's.
    - A large play/pause button.
    - A **speed control** that's easy to hit with one thumb: preset buttons (50/60/75/90/100%)
      plus fine ±5% steps.
    - A loop toggle and a scrubber.
  - Speed and loop stay set from one card to the next during a shuffle session, since you
    usually practise at one tempo.
  - The skill slider sits just above **Practiced →** / **Skip →** at the bottom.
- If the piece has no playable clips, the player area shows the link-out buttons or "No
  recordings" instead.
- **Settings** (synced):
  - Age, Skill, and Favorite temperature sliders.
  - Kind checkboxes (Tunes on by default; Parts, Sets, Sessions off).
  - A **skill range** filter (a two-handle 1–5 slider) that is separate from the Skill
    temperature. For example, setting it to 2–5 leaves out unlearned tunes. Unrated tunes count
    as 1 for this filter.
  - Optionally, "respect current list filter".
- **State:** a `shown` set lives only for the lifetime of the view.
  - **Practiced** logs a practice entry. If the slider moved, it also saves the skill.
  - **Skip** persists nothing. A change to the skill slider is still saved, because that's an
    explicit edit.
  - Either button adds the piece to `shown` and samples the next piece from the remaining
    candidates. When none are left, show "You've been through everything 🎉" with a restart
    option.

**Selection algorithm.** Each candidate gets three features normalized to `[0, 1]`:

- `A` (staleness) = `min(daysSinceLastPracticed / horizon, 1)`, using the *effective* practice
  history, which includes practice on ancestor sets and sessions (§5). A never-practiced piece
  gets `A = 1`. `horizon` defaults to 60 days.
- `S` (weakness) = `(5 - skill) / 4`, using the effective skill (Parts inherit it, §5). An
  unrated piece counts as skill 1, so `S = 1`.
- `F` (affinity) = `0.5·favorite + 0.5·min(log(1 + timesPracticed) / log(1 + capCount), 1)`

```
logit = A / T_age + S / T_skill + F / T_fav
p     = softmax(logits over remaining candidates)
```

Each temperature slider maps to `T ∈ [0.05, ∞)` on a log scale, with the top notch = ∞
(the factor is ignored). Low T makes that factor dominate, which prioritises stale, weak, or
loved pieces. High T makes it flat, so the pick is random. With all sliders at max, the
shuffle is uniform. The domain layer implements this as a pure function with an injectable
RNG, so it's unit-testable.

### 6.6 Player
- A global persistent mini-player bar shows the current clip and its piece, with play/pause,
  scrubbing within the clip bounds, **loop clip**, and **speed (0.5–1.0×, pitch-preserved)**.
  Loop and slow-down are the core features for learning tunes by ear. The same speed control
  appears here and in Shuffle (§6.5), with a preference for the default speed.
- **MVP time-stretching** uses the browser's built-in `playbackRate` + `preservesPitch`. It
  sounds acceptable down to about 0.5×.
- **Deferred:** a high-quality time-stretch/pitch-shift engine (e.g. a Rubber Band WASM build
  or an ML model in a worker), for better slow-down quality and **key transposition**. The
  adapter interface should leave room for `setPitchShift(semitones)` so this can be added
  later without UI changes. YouTube can't support it, because we have no access to its audio.
- A `PlayerAdapter` interface (`load(clip)`, `play`, `pause`, `seek`, `setRate`, `onTime`) has
  these implementations:
  - `HtmlAudioAdapter` plays blob or URL sources. It enforces `start`/`end` and uses
    `preservesPitch`.
  - `YouTubeAdapter` uses the IFrame Player API with `start`/`end` and `setPlaybackRate`.
    The M0 spike found that it honours arbitrary rates (every 0.05 step from 0.50 to 1.00), even
    though `getAvailablePlaybackRates()` only lists `[0.25, 0.5, 0.75, 1, …, 2]`. The same speed
    UI therefore works for both adapters. YouTube's own pitch correction applies, and we can't
    turn it off.
  - `LinkOutAdapter` (Spotify, thesession, unknown) opens the URL in a new tab.
- The **trim editor** uses wavesurfer.js with the regions plugin on file-backed sources. For
  YouTube it uses a simple dual-handle slider with time readout and preview, since we can't
  get a waveform.

### 6.7 Provider decoration
Each provider has an icon and colour accent on its clip rows and card icons. Links that open
outside the app show an ↗ affordance.

---

## 7. Integrations

Results of the M0 spike (2026-10-22, see §7.1 for evidence) and the planned approach:

| Source | Client-side? | Approach | Backend needed for |
|---|---|---|---|
| **thesession.org** | ✅ **confirmed**. All four endpoints send `ACAO: *` and were fetched from a page in headless Chromium | Client: `src/lib/integrations/thesession.ts` (fixtures + tests). Search `/tunes/search?q=` (honours `perpage`, results carry no aliases or settings). Details `/tunes/{id}` (type, aliases, `recordings` count, settings with `key` such as `Edorian` plus the ABC body). `/tunes/{id}/sets` is paged at a fixed 10 and ignores `perpage`; its entries are *settings*, so the tune id has to be parsed from the URL, and keys there are abbreviated (`Edor`). `/tunes/{id}/recordings` returns everything (197 for Cooley's) plus `recorded_with` counts. Cache in IndexedDB with a TTL, debounce search, throttle. | Nothing |
| **Google Drive** | ✅ CORS **confirmed** (the preflight for `files/{id}?alt=media` and for multipart upload allows `authorization` and reflects the origin). End-to-end is **pending manual test** (needs credentials) | Google Identity Services token client + Picker API, `drive.file` scope. That scope is non-sensitive, so the app needs no Google verification and sees only files the user picks or the app creates. Download with `files.get?alt=media` + bearer token → blob → OPFS cache. Upload with multipart into an app-created `TuneJournal/` folder. Spike: `/spike/drive`; setup steps in `spikes/README.md`. Config comes from `PUBLIC_GOOGLE_{CLIENT_ID,API_KEY,APP_ID}`. | Nothing. Tokens are short-lived, so a re-auth prompt is acceptable. |
| **Pixel Recorder** | ❌ API. ✅ the Share Target path works end-to-end in desktop Chromium; the Android share sheet is **pending manual test** | The only API is the unofficial cookie-based web API used by `google-recorder-cli`, which needs headless Chrome to refresh cookies. That's fragile and server-only. **v1 path:** the Recorder app's *Share* button sends the audio file to our PWA through the **Web Share Target API** (Android, installed PWA). Alternatively, the user saves to Drive and picks it there. The manifest `share_target` POSTs multipart to `/share-target` (M0's spike used `/spike/share-target`, which is still accepted). The service worker stores the files in the audio cache (OPFS, falling back to IndexedDB where `createWritable` is missing in the SW) with an inbox entry, and 303-redirects to the "Shared recording" page `/shared`. Text and URL shares are kept too. | Optional later: a proxy using `google-recorder-cli` on the VPS for browsing and bulk import |
| **YouTube** | ✅ **confirmed** for playback and oEmbed | IFrame player with clip start/end, our own loop (seek back to `start` on `end`), and `setPlaybackRate` with any 0.05 step (measured: 0.85 requested → media clock 0.87×). `youtube.com/oembed?format=json` reflects the request `Origin` in `ACAO`, so it works from the browser. noembed.com (`ACAO: *`) is the fallback. No offline playback. | `yt-dlp` → audio file → asset storage, for offline use and waveform trimming |
| **Spotify** | Link only. oEmbed ✅ **confirmed** (`ACAO: *`) | Open the URL. Title and thumbnail come from `open.spotify.com/oembed?url=` (also `iframe_url` for an optional embed). noembed doesn't support Spotify. Full playback would need Premium and the Web Playback SDK, so it's out of scope. | — |
| **folkfriend.app** | Link to the app only. Nothing to query | A Vue SPA. Search and tune data run in a local web worker (an offline index of thesession data), with no public API. Its tune IDs *are* thesession tune and setting IDs, and its tune page links to `thesession.org/tunes/{id}`. But `/tune` gets its `tuneID` as in-memory router params, so `folkfriend.app/tune?…` URLs aren't deep-linkable, and a reload shows "No tune loaded". Treat it as a plain link to `https://folkfriend.app/` with custom decoration. `external.thesession` already holds the identity, so `external.folkfriend` can be dropped. | — |
| **jigripper.com** | TBD (deferred) | Tune identification from a recording. It appears to run a model in the browser, so it might be embeddable or reusable client-side with no backend. Investigate post-MVP. | Possibly none |
| **Uploads** | ✅ local (OPFS write, read and `<audio>` playback confirmed) | Stored in OPFS immediately. For cross-device sync, **upload to the user's own Drive** (an app-created `TuneJournal/` folder through `drive.file`) until we run our own asset store. | Own S3 store later (optional) |

**Proposal: use Google Drive as the asset store in v1.** It removes the need for a backend for
file storage entirely. It also keeps the user's audio in the user's own account, which suits a
local-first app.

### 7.1 Integration spike (Milestone 0)
The spike pages are routes in the app under `/spike` (`app/src/routes/spike/`, helpers in
`app/src/lib/spike/`), because the Share Target needs the real manifest and service worker.
Manual steps are in `spikes/README.md`. Evidence comes from `curl -H 'Origin: https://example.com'`
and headless Chromium 154 (playwright-core driving the system browser) against the dev and
preview servers.

- [x] **thesession:** search, tune, sets and recordings from the browser. Confirmed: the
      `/spike/thesession?smoke` page fetched all four from headless Chromium (search 10 hits,
      tune 33 settings, sets total 2328, recordings 197), and curl shows `ACAO: *` and
      `ACAM: GET` on each. Typed client in `src/lib/integrations/thesession.ts`, with trimmed
      fixtures and tests in `fixtures/`.
      **Settings shape for autofill:** `settings[] = { id, url, key, abc, member, date }`.
      `key` is the tonic plus the full mode name (`Edorian`, `Eminor`, `F#minor`), and `abc` is
      the tune body only (no `X:`/`K:` header, `!` = line break), e.g.
      `|:D2|EBBA B2 EB|B2 AB dBAG|…`. One tune can have settings in several keys (Cooley's:
      29 Edor, 3 Emin, 1 Ddor). The client provides `parseKey()`, which normalizes full and
      abbreviated modes to `{tonic, mode}`, and `firstBars(abc, 2)` → `D2 | EBBA B2 EB | B2 AB dBAG`,
      which keeps a pickup bar without counting it. Settings carry no meter; it's implied by
      `type`, and set entries do include `meter`.
- [ ] **Drive:** GIS token flow + Picker + `alt=media` fetch of an m4a, then playback from a blob.
      *Pending manual test* (needs your Google credentials, see `spikes/README.md` §1). Ready:
      `/spike/drive` covers sign-in → pick → download → OPFS → `<audio>`, plus find-or-create of
      `TuneJournal/` and a multipart upload. CORS for the API calls is confirmed by preflight
      (`authorization` and `content-type` allowed, origin reflected).
- [ ] **Web Share Target:** share an m4a from Pixel Recorder into the installed PWA, receive it
      in the service worker and store it in OPFS. *Pending manual test on Android*
      (`spikes/README.md` §2). Everything except the OS share sheet is confirmed in headless
      Chromium: a multipart POST navigation to `/spike/share-target` → the service worker stores
      `test.m4a` (`audio/x-m4a`, 25 KiB) in OPFS → 303 → `/spike/share` lists it and it plays
      (duration 3 s). This works on both `vite preview` and the dev server. Normal service-worker
      behaviour is unaffected: offline reloads of `/`, `/spike/share` and `/spike/speed` all
      render, and GETs still take the existing path.
- [x] **YouTube:** IFrame clip playback with `start`/`end`/`setPlaybackRate`, and oEmbed CORS.
      Confirmed in headless Chromium on `/spike/youtube`:
      - `getAvailablePlaybackRates()` → `[0.25,0.5,0.75,1,1.25,1.5,1.75,2]`, but
        `setPlaybackRate` accepts every 0.05 step from 0.50 to 1.00 (`getPlaybackRate()` echoes
        each one), and the media clock really runs at the requested rate (0.85 → 0.87×
        measured). **So the speed UI can use 0.05 steps for YouTube too, not just presets.**
      - `end` only stops the first play, so loop is our own seek back to `start`.
      - oEmbed: `youtube.com/oembed` returns `ACAO: <request origin>` and fetches from the page.
        noembed.com has `ACAO: *` as a fallback.
- [x] **Spotify oEmbed CORS:** confirmed. `open.spotify.com/oembed` returns `ACAO: *` with
      `title`, `thumbnail_url` and `iframe_url`. noembed returns "no matching providers" for
      Spotify.
- [x] **folkfriend:** what's linkable, and what's queryable? Linkable: only the app root.
      Queryable: nothing. It's a client-side worker over bundled thesession data, it uses
      thesession tune and setting IDs, and its `/tune` view isn't URL-addressable. See the table.
      (jigripper is deferred to M8.)
- [ ] **`preservesPitch` slow-down quality** at 0.5–0.75× on Android Chrome and desktop, for m4a
      from Drive and Recorder. *Pending manual listening test* (`spikes/README.md` §3) on
      `/spike/speed`, which has presets of 50/60/75/90/100%, ±5% steps, loop and a
      preservesPitch toggle. Mechanically confirmed in Chromium: `preservesPitch` is unprefixed
      and true by default, `playbackRate = 0.5` plays at 0.46–0.5× wall-clock, and m4a (AAC)
      decodes. Caveats, from MDN and not tested here: Chrome throws for rates outside 0.0625–16×,
      and Firefox mutes audio outside 0.25–4×. Safari may need `webkitPreservesPitch`, so the
      adapter should set both (the spike does). How it sounds at 0.5–0.6× is exactly what the
      listening test is for. If it's poor, the M8 time-stretch engine moves up.
- [x] **Automerge** in the SvelteKit static build. WASM loads with the service worker offline,
      and two browsers sync through `sync.automerge.org`. Confirmed with two isolated headless
      Chromium contexts (separate storage) on `/spike/sync`: B opened A's new doc by URL in
      0.8–1.3 s, including page load. Alternating changes then propagated click-to-render in
      **130–275 ms** over two runs of five (about 200 ms and about 270 ms medians).
      Offline reload re-confirmed on the production build: the home page opens the Library
      from IndexedDB, so WASM loads from the precache.

**Exit decision (2026-10-22): no backend before Milestone 4.** Every v1 integration works from
the browser:
- thesession, YouTube oEmbed and Spotify oEmbed all have permissive CORS.
- Drive's REST endpoints accept bearer-token CORS requests, and GIS and the Picker are
  client-side by design.
- The Share Target covers Recorder without a server.
- The public relay syncs in 0.2–0.3 s.

The backend (§8) stays deferred until we want offline/waveform YouTube (`yt-dlp`), a private or
E2EE sync relay, or Recorder browsing. If the two pending manual tests fail, the fallbacks are
still client-side: Recorder → "Save to Drive" → Picker, and the M8 time-stretch engine for
quality. The only thing that would pull the backend forward is a Drive failure that a
client-side fix can't solve. That's unlikely, given the preflights.

---

## 8. Backend (deferred)

When it arrives, it's a single small service on the VPS, deployed with Docker Compose:

- `GET /` is not served here. The app stays on the static host.
- `/sync`: `automerge-repo` WebSocket sync server with file-system storage. This replaces the
  public relay.
- `/api/extract/youtube`: runs `yt-dlp` to extract audio (opus/m4a), stores it, and returns
  an `assetKey`. Results are cached by video ID. Runs as a job with progress events.
- `/api/recorder/*`: proxy over `google-recorder-cli` (list, download). Optional.
- `/api/assets/*`: presigned upload/download against an S3-compatible bucket (MinIO/Garage
  locally, or R2/B2).
- `/api/identify`: jigripper, if it needs server mediation.
- **Auth:** single-user at first, with a long random token pasted into app settings. Later,
  either "Sign in with Google" (we already use GIS) or a key derived from the Automerge doc.
- **Portability:** the Hono app has no vendor bindings. The S3 client is configured by env.
  `yt-dlp` and headless Chrome mean the heavy endpoints are container-only, and that's fine.

---

## 9. Offline, updates, and data safety

- The service worker precaches the app shell and WASM. Runtime caching:
  - Stale-while-revalidate for thesession JSON. The IndexedDB cache is the main cache, so this
    is a backup.
  - Cache-first for thumbnails.
  - No caching for Google APIs.
- **Updates:** the new service worker installs in the background, and a toast offers "Update
  available — reload". It auto-applies on the next cold start.
- **Persistence:** call `navigator.storage.persist()` on first meaningful write. Show storage
  usage in settings.
- **Backups:** "Export library" downloads the Automerge binary plus a JSON snapshot. "Import"
  merges, or replaces after confirmation. This guards against relay and device loss.
- **Schema versioning:** `schemaVersion` with idempotent forward migrations, run on load.

---

## 10. Project layout

```
/
├─ PLAN.md
├─ app/                      SvelteKit PWA
│  ├─ src/lib/domain/        pure TS: types, ops (create/edit/merge/split/link), shuffle, indexes, migrations
│  ├─ src/lib/store/         Automerge repo setup, Svelte bindings, export/import
│  ├─ src/lib/pwa/           service-worker update prompt
│  ├─ src/lib/integrations/  thesession, gdrive, youtube, spotify, sharetarget, ...
│  ├─ src/lib/audio/         PlayerAdapter impls, OPFS cache, trim editor
│  ├─ src/lib/ui/            components (PieceCard, TagInput, SkillSlider, Fab, Modal, ...)
│  ├─ src/routes/            / (list), /piece/[id], /shuffle, /settings, /link-device
│  ├─ src/service-worker/    precache + cache-first app shell (own tsconfig)
│  └─ static/                manifest.webmanifest, icons/
├─ server/                   (later) Hono backend + Dockerfile + compose
└─ spikes/                   M0 manual test guide (spike code: app/src/routes/spike, app/src/lib/spike)
```

The domain layer never imports Svelte or Automerge internals directly. It takes a mutable
`Library` proxy, as in `repo.change(d => ops.merge(d, a, b))`, so it's trivially testable
against plain objects.

---

## 11. Milestones

**M0: Spikes** (§7.1)
- [x] Integration spike results recorded in §7 (Drive, the Android share sheet and the slow-down
      listening test are pending manual tests; see `spikes/README.md`)
- [x] Final Automerge/Evolu decision recorded in §4: Automerge
- [x] Backend-timing decision recorded: not before M4 (§7.1)

**M1: Skeleton and core list**
- [x] SvelteKit static + PWA + CI (typecheck, lint, vitest, build). `npm run verify` runs check,
      lint, unit tests and build; `npm run test:e2e` runs Playwright against `vite preview`.
      **Not deployed yet:** the build is ready for any static host (SPA fallback `index.html`),
      but there's no CI pipeline because the repo has no remote yet. The verify script is the CI
      for now.
- [x] Automerge repo with IndexedDB storage, Library doc creation, migrations scaffold
- [x] Piece CRUD: (+)/Add, Edit modal (kind, title, description), soft delete with undo toast
- [x] Tags with suggest/create input
- [x] Favorite ★, skill slider (unrated by default), key + first notes fields (tunes/parts only)
- [x] Practiced button + log, "last practiced" display
- [x] Search, filter, and sort bar (the has/lacks recordings filter arrived in M4)
- [x] Responsive layout: full-screen detail on mobile, list + right-hand detail pane on desktop
- [x] Export/import

M1 notes:
- Domain: `src/lib/domain/ops.ts` (mutations), `derived.ts` (memoized index, filter, sort, search),
  `key.ts` (key parsing and normalization), `format.ts` (labels, relative time), `transfer.ts`
  (import of an unrelated library). Unit tests run each op on plain objects and on Automerge
  docs, plus fork/merge tests.
- `derived.ts` routes practice, skill and key through `effectivePractice`, `effectiveSkill` and
  `effectiveKey`. They return the piece's own values for now; M5 adds the ancestor walk and
  Part → Tune inheritance there.
- UI components are in `src/lib/ui/`. Routes: `/` and `/piece/[id]` share the `(main)` layout
  (list + detail), plus `/settings` and a `/shuffle` placeholder. The spike routes are linked from
  Settings.
- E2E (`app/e2e/`, mobile 390×844 and desktop 1280×800): add/edit, tag suggestions, search, tag
  filter (persisted), practice + undo, delete + undo, reload persistence, export/import, and an
  offline reload. They block the public sync relay so tests stay local. Playwright uses the
  system Chromium at `/usr/sbin/chromium` when it exists.

**M2: Sync**
- [x] `BrowserWebSocketClientAdapter` to the public relay. Link-device QR screen.
- [x] Sync status indicator. Conflict-free behaviour tested with two browsers offline/online.

M2 notes:
- `/link-device` (linked from Settings) shows the library as a QR code of a deep link
  (`<origin>/link-device#automerge:…`), with a copyable link and address. It also joins a pasted
  or deep-linked library. Camera scanning uses `BarcodeDetector` only where it exists (Android
  Chrome); elsewhere the phone's own camera opens the deep link. QR codes come from `uqr` and are
  drawn as an SVG path.
- Store: `store/link.ts` (parse and build deep links), `store/sync.svelte.ts` (status),
  `store/journal.ts` (save-on-change and write-ahead copy), `findLibrary` and `RelayAdapter` in
  `store/repo.ts`, and `library.switchTo` in `store/library.svelte.ts`.
- The relay URL is `PUBLIC_SYNC_URL`, set at build time. It defaults to `wss://sync.automerge.org`.
- E2E runs a local relay (`app/e2e/sync-server.ts`: a server-mode Repo with in-memory storage
  behind `NodeWSServerAdapter`). Playwright starts it and builds the app against it. Tests cover:
  two devices linking through the deep link, with edits flowing both ways; offline edits on both
  sides converging without duplicate tags; joining with and without merging local pieces; join
  errors (bad link, unknown library, offline); and the status states. The single-device tests
  block the relay, so their reload checks really test local persistence. Note: after
  `npm run test:e2e`, `build/` points at the local relay, so rebuild before deploying.

**M3: thesession.org**
- [x] Title search → autofill (title, type tag, external ID, thesession source link, and key +
      first notes from the chosen setting)
- [x] Integration cache with TTL; aliases included in search
- [x] Detail view: "Appears in sets", settings/keys, recordings count
- [x] Promote a suggested set into Set piece + links
- [x] Duplicate-tuneId detection banner → merge flow (the merge op is built here; M5 adds the
      manual "Merge with…" picker)

M3 notes:
- Domain: `domain/thesession.ts` (`linkTheSessionTune`, `applyTheSessionSetting`,
  `unlinkTheSession`, `promoteTheSessionSet`, `typeTag`, `piecesWithTune`), `domain/relations.ts`
  (`linkPieces`, `unlinkPieces`, `mergePieces`, `resolvePiece`) and `domain/order.ts`
  (`fractional-indexing` keys). The index gained `children`, `parents`, `resolve`, `withTune` and
  `duplicateTunes`; `listPieces` takes an `aliases` map. All ops are tested on plain objects and
  Automerge docs, with concurrent merge/link cases.
- Integration cache: `integrations/cache.ts` (a tiny IndexedDB key-value store, `SwrCache`, and
  `throttledFetch`), `integrations/thesession-cache.ts` (TTLs and keys), and
  `store/thesession.svelte.ts` (shared reactive `Resource`s, the alias map, "Clear cached data").
- UI: the 🔍 panel in the edit modal (`TheSessionSearch.svelte`), "Linked to … / Unlink" in the
  edit modal, `TheSessionInfo.svelte` and a read-only Related section in the detail view, the
  duplicate banner in the list, and `MergeDialog.svelte`.
- E2E (`e2e/thesession.test.ts`) serves the recorded fixtures through `page.route`
  (`e2e/thesession.ts`), so no test reaches thesession.org. It covers search → setting → fields,
  duplicate → merge (and the merged piece's URL redirecting), the banner and merge dialog, set
  promotion, alias search across a reload, and offline display from the cache plus clearing it.

**M4: Recordings and player**
- [x] Source/Clip model, recordings section, provider decorations, empty-state import panel
- [x] Global player bar with HtmlAudio + YouTube + LinkOut adapters, loop, and speed (presets
      and ±5% steps)
- [x] Per-clip key and first-notes overrides
- [x] Google Drive picker + download + OPFS cache + "keep offline". **Drive is pending a manual
      test with real credentials** (`spikes/README.md` §1): request building, the 401 re-auth
      retry and folder find-or-create are unit-tested against a mocked `fetch`, but GIS, the Picker
      and real downloads/uploads haven't run against Google.
- [x] Upload → OPFS → Drive `TuneJournal/` folder (the Drive half is in the manual test above)
- [x] Web Share Target (Recorder → app). The Android share sheet itself is still pending the
      manual test from M0 (`spikes/README.md` §2).
- [x] Trim editor (wavesurfer regions; slider fallback for YouTube); reorder clips

M4 notes:
- Domain: `domain/recordings.ts` (`addRecording` with Source dedupe, `updateClip`, `removeClip` /
  `restoreClip`, `moveClip` / `moveClipBy`, `updateSource`, `orphanSources`, `checkBounds`) and
  `domain/providers.ts` (labels and icons, `playbackOf`, `isLocalOnly`, `driveFileId`,
  `recordingTitle`). The index gained `clipsOf`, `hasRecordings`, `providersOf`, `clipKey` and
  `clipFirstNotes`, and `ListSettings.recordings` (`'has' | 'lacks'`) filters the list. Tests run
  on plain objects and Automerge docs, plus fork/merge cases for concurrent reorders and adds.
- Integrations: `integrations/links.ts` (provider detection from pasted or shared text),
  `integrations/oembed.ts` (YouTube → noembed fallback, Spotify), `integrations/gdrive.ts` (request
  builders, `DriveClient`, `GisTokenSource`, Picker) and `integrations/share-target.ts` (moved out
  of `lib/spike/`; the service worker imports it from there).
- Audio: `audio/cache.ts` (OPFS + IndexedDB fallback, metadata and "keep offline" in IndexedDB,
  plus the share inbox), `audio/bounds.ts` (clip-bound, speed and time math), `audio/adapter.ts`
  (`PlayerAdapter`), `html-audio.ts`, `youtube.ts`, `link-out.ts`, and the `player.svelte.ts`
  store. Stores: `store/audio.svelte.ts`, `store/gdrive.svelte.ts`, `store/oembed.svelte.ts`.
- UI: `PlayerBar`, `SpeedControl` (compact and large, for M6), `Recordings` (the detail
  section), `AddRecording` (import panel), `ClipDialog` (details and overrides), `TrimEditor`
  (reusable, emits `{start, end}`) in `TrimDialog`, `ProviderIcon`, `PiecePicker`, and
  `ui/recordings.ts` (the add/backup/remove flows). Routes: `/shared`. Settings shows recordings
  storage, "Remove downloaded recordings" and, when configured, Google Drive connect/disconnect.
- wavesurfer.js (`^8.0.3`) and its regions plugin are dynamic imports in `TrimEditor`, so they're
  a separate chunk loaded only when trimming a file. The YouTube IFrame API and Google's scripts
  load on first use.
- E2E (`e2e/recordings.test.ts`, helpers in `e2e/media.ts`): upload a generated WAV and play it
  (`currentTime` advances, clip bounds), speed presets and ±5% (remembered across a reload), loop
  and stop-at-end, the bar staying clear of the FABs on mobile, card provider icons; trim with the
  waveform editor, preview, persistence across a reload, playback within the trim, reset; YouTube
  and Spotify paste with intercepted oEmbed, a per-clip key override, YouTube playback and rate
  through a stubbed IFrame API (the real script is never loaded) and the slider trim; reorder by
  menu and by drag (desktop), remove with undo; offline playback of a kept-offline file; the
  has/lacks filter; and share-target POSTs of a file (→ new tune) and of a link (→ existing piece),
  simulated as a multipart form navigation. Routes are set on the browser context, since
  `page.route` doesn't see requests from a page the service worker controls.

**M5: Relations**
- [x] Links: Add child (picker + "New …"), parent/child display, reorder children
- [x] Effective practice history: walk ancestors (cycle-safe) for counts, latest, sort, and
      shuffle. Show "via <Set>" entries in the detail view. (Shuffle itself is M6; it will read
      the same `index.stats`.)
- [x] Part → Tune inheritance of skill and key, with muted "from <Tune>" display
- [x] Split from a clip region → new child piece on the same source
- [x] Merge: manual "Merge with…" picker. (The merge op, the thesession-prompted flow and
      `mergedInto` redirects were built in M3.) Merge now has Undo.

M5 notes:
- Domain (`domain/relations.ts`): `CHILD_KIND`, `linkProblem` (`self` / `exists` / `cycle`),
  `childLinks`, `moveChild` / `moveChildAfter` / `moveChildBy`, `removeLink` / `restoreLink`,
  `addChild`, `splitPiece`, and `mergeWithUndo` / `undoMerge`. The index (`domain/derived.ts`)
  gained `ancestors`, `inheritsFrom`, and the real `effectivePractice` / `effectiveSkill` /
  `effectiveKey`. Tests are in `domain/links.test.ts`: each op on plain objects and Automerge
  docs, cycles, multiple parents, concurrent link add/remove/reorder on forks, merge then undo,
  split keeping one Source, and an index build over 3000 linked pieces (about 60 ms here; the
  test allows 1.5 s).
- UI: `Related.svelte` (the editable Related section: Add child, drag or ↑/↓ to reorder, × to
  unlink with Undo, Split), `SplitDialog.svelte` (TrimEditor + name, "Split another"),
  `MergePicker.svelte` ("Merge with…" → `MergeDialog`), and `PiecePicker` gained `exclude`,
  "New …" and autofocus. Cards show a muted inherited key/skill and a child count ("2 parts").
  The detail view shows the inherited key "from <Tune>", the skill slider's inherited value, and
  "via <Set>" in the practice history. The edit modal offers "Use <Tune>'s key" and the slider
  "Use <Tune>'s" to go back to inheriting.
- E2E (`e2e/relations.test.ts`): add existing and new children, the picker hiding the piece and
  its children, reorder by buttons and (desktop) drag, remove with Undo, the loop warning; practice
  a Set → the tune shows "via" and its card's "last practiced"; a Part inheriting skill and key,
  overriding and going back; split two parts from an uploaded recording and play one (player
  bounds 2.00–4.00), plus a blank split; "Merge with…" from a card, then Undo (survives a reload).

**M6: Shuffle**
- [x] Full-screen shuffle view, Practiced/Skip (Skip persists nothing), inline skill slider
- [x] Skill range filter in shuffle settings
- [x] Prominent player: recording selector (first by default), play/pause, speed presets, loop.
      Speed and loop stay set across cards.
- [x] Settings: temperatures, kind checkboxes
- [x] Unit tests for sampling distribution at temperature extremes

M6 notes:
- Domain (`domain/shuffle.ts`, pure, no Svelte or Automerge): `shuffleCandidates` / `matchesShuffle`
  (live pieces of the enabled kinds, in the skill range, optionally passing the list filter, minus
  `shown`), `toCandidate` (effective last-practiced, count and skill from `index.stats` /
  `effectiveSkill`), `features` (A, S, F), `weights` (features, logits and probabilities, for
  debugging and tests), `pickNext(candidates, settings, rng, now)`, the slider mapping
  (`temperatureAt` / `sliderPosition` / `temperatureLabel`) and `seededRng` (mulberry32).
  `setShuffleSettings` in `ops.ts` merges field by field like `setListSettings`. Tests in
  `domain/shuffle.test.ts`: each factor at a tiny temperature picks the extreme piece ≥ 99% of 2000
  seeded draws; all-∞ passes a chi-square test over 20 000 draws; candidates drop shown pieces,
  unwanted kinds and out-of-range skill; unrated counts as 1 (both for S and the range); a Part's
  inherited skill; practice on a Set making its tune fresh; extreme and infinite logits; slider
  round-trips; settings on Automerge docs with a concurrent merge.
- UI: the `/shuffle` route (card, keyboard shortcuts, empty states), `ShufflePlayer.svelte`,
  `ShuffleSettings.svelte` (a dialog sheet) and `SkillRange.svelte` (two native range inputs on one
  track). The root layout leaves out the mini-player bar on `/shuffle`.
- E2E (`e2e/shuffle.test.ts`, mobile and desktop): full-screen with no mini-player; key, first
  notes and tags on the card; Practiced logs (with the slider's skill) and advances; Skip logs
  nothing but keeps a skill change; the "been through everything" state and Restart; uploaded WAVs
  played from the shuffle player, the recording picker and a clip in another key, speed presets and
  ±5%, loop, pause; Skip stopping playback with speed and loop kept; Parts via the kind checkbox,
  the live count, the skill range, temperatures and "respect list filter" surviving a reload; the
  "Nothing to shuffle" state → Change settings → a card is dealt.

**M7: Backend (as needed)**
- [ ] Self-hosted sync server; migrate the doc off the public relay
- [ ] yt-dlp extraction → asset store → offline YouTube clips with waveform
- [ ] Recorder proxy (optional), S3 asset store (optional), auth token

**M8: Later / nice-to-have**
- [ ] Practice stats: streaks, heatmap calendar, per-tune histogram
- [ ] High-quality time-stretch/pitch-shift engine (better slow-down, key transposition)
- [ ] jigripper identification of untitled recordings (it appears to run in the browser)
- [ ] folkfriend deep links
- [ ] ABC rendering (abcjs) of thesession settings
- [ ] Fuzzy and full-text search over descriptions
- [ ] E2EE for the sync relay (or migrate to Evolu if this becomes important)

---

## 12. Testing strategy

- **Domain (Vitest):** every op (create, edit, tag, link, split, merge, practice) runs against
  plain objects *and* against real Automerge docs. Concurrent-merge tests fork a doc, apply
  conflicting ops on both forks, merge, and assert invariants: no duplicate tags or links, merge
  redirects resolve, and ordering is stable.
- **Shuffle:** a seeded RNG and statistical assertions (for example, at `T_age → 0` the stalest
  piece is chosen at least 99% of the time; at all-∞ the picks are uniform within tolerance).
- **Integrations:** recorded fixtures for thesession JSON. No live calls in CI.
- **E2E (Playwright):** add/edit/search flow, offline reload (service worker), and two-context
  sync through a local sync server.

---

## 13. Conventions

- No vendor lock-in. Every vendor-specific piece sits behind an interface in `integrations/` or
  `store/`.
- User-visible terms: Session/Set/Tune/Part/Recording. The internal names are
  `Piece`/`Clip`/`Source`.
- Never store third-party catalogue data in the synced doc beyond IDs and what the user
  explicitly chose (title, tags).
- Accessibility: every icon button has a label, the skill slider is keyboard-operable, and
  touch targets are at least 44px.

---

## 14. Decisions and open questions

**Decided (2026-10-22)**

- The name is **TuneJournal**.
- The MVP is frontend-only. The backend is deferred until it's needed (§8).
- Unencrypted data on the public Automerge relay is acceptable for now.
- Uploads are stored in the user's Google Drive (`TuneJournal/` folder) for the MVP.
- New pieces start **unrated**.
- Practicing a Set logs only on the Set. Children inherit it at query time by walking up the
  graph (§5).
- Desktop uses a list on the left and a detail pane on the right. Shuffle is full-screen.
- Slow-down is a first-class feature and is prominent in Shuffle. A heavier
  time-stretch/pitch-shift engine is deferred.
- Key and first notes are piece attributes, overridable per recording, and hidden for
  sets and sessions.
- jigripper is deferred. It appears to run a model in the browser.
- Skipping in shuffle persists nothing. Only "Practiced" counts toward staleness.
- Unrated counts as skill 1 for shuffle priority and for skill filters. Shuffle settings have a
  skill-range filter in addition to the temperature.
- The framework is SvelteKit with `adapter-static`.
- A Part inherits skill and key from its parent Tune unless it sets its own (§5). Tunes
  don't inherit from Sets.

**Decided during M1 (2026-10-22)**

- **Edits save as you go.** The edit modal has no Save/Cancel. Text fields write after a 400 ms
  pause (and when the modal closes); everything else writes at once. "Done" or Escape closes it.
- **Add opens the new piece's detail view** under the edit modal, so after "Done" you're on the new
  piece. Blank pieces are left alone, not auto-discarded.
- **Practice doesn't bump `modifiedAt`.** "Modified" is about edits; "last practiced" covers
  practice. Logging practice from a card shows an Undo toast that removes that entry.
- **Tag casing:** a typed tag takes the spelling already used in the library (from the
  oldest-created piece that has it), otherwise it's stored as typed. If a merge brings in two
  casings on one piece, the UI shows one and `removeTag` removes all of them.
- **Keys:** stored as `"<tonic> <full mode>"` ("A dorian"), shown short ("A dor"). Input that
  doesn't parse as a key is kept as trimmed free text. The key filter matches the stored value
  exactly.
- **List filter details:** no kind selected means all kinds. The skill range counts unrated as 1
  (§14), and "Unrated only" finds unrated pieces. "Practiced not within N days" includes
  never-practiced pieces. Search matches title words, ignoring case, accents and apostrophes.
  The search text isn't persisted; filters and sort are, in `settings.list` (new optional fields,
  so no migration was needed).
- **Sort details:** untitled pieces sort last in both directions. Never-practiced counts as the
  oldest "last practiced", and unrated as the lowest skill. Ties go by title, then creation time.
- **Import:** a backup of the same library (shares its root change) merges as a CRDT. A file from
  an unrelated library would conflict at the root maps, so its pieces, sources and links are
  copied in by id instead. Import never deletes anything. Only `.automerge` files can be imported;
  the JSON export is for reading.
- **Persistence:** `navigator.storage.persist()` is requested on the first write of each session
  if storage isn't already persistent. The repo also flushes pending saves on `pagehide` and when
  the page is hidden, since automerge-repo debounces saves by ~100 ms.
- **Filter panel** is collapsed by default on every width, with a one-line summary
  ("Tunes · Title ↑ · 2 filters"). Whether it's open is remembered per device in
  `localStorage`, not synced.

**Decided during M2 (2026-10-22)**

- **By default, linking replaces the library rather than merging.** Joining a library switches
  which library this device opens. The old one stays in IndexedDB, and its URL is remembered in
  `localStorage` (Settings → "Libraries this device showed before" → "Switch back"). If the
  device's library has pieces, the confirm step warns and offers "Copy my N pieces into the linked
  library". That uses the same merge as importing a backup: a CRDT merge if the two share
  history, otherwise a copy by id. Copying can duplicate a tune that both devices added
  separately; the M3/M5 merge tools handle that.
- **The deep link carries the address in the hash**, so it never reaches a server log. Pinned
  heads in a pasted URL are dropped, so devices follow the live library.
- **Waiting for a joined library:** we wait up to 20 s for it to arrive from the relay. If the
  relay says it doesn't have it, we wait 5 s more, since the other device may be uploading. Then
  we explain why: this device is offline, the relay is unreachable, or the relay doesn't have the
  library yet (open the app on the other device first). We use `findWithProgress`, not
  `repo.find`, because `find` gives up as soon as the relay says "unavailable".
- **Sync status** has three states, shown next to the Settings button and in Settings:
  - *Offline*: `navigator.onLine` is false, or the last connection attempt failed and none has
    succeeded since. The second rule avoids flicker during the adapter's 5 s retries.
  - *Connecting…*
  - *Synced*: the relay is a connected peer. While connected, we compare the relay's heads for
    our doc (from `handle.on('remote-heads')`, keyed by its storage id) with ours. If they differ
    for over 1.5 s, the label reads "Syncing…". "Last synced" is when they last matched.
- **Offline handling:** on the browser's `offline` event we close the relay socket. On `online`
  we reconnect at once, instead of waiting for the adapter's retry timer.
- **Every local change is saved straight away.** M1's data-loss window came from automerge-repo's
  ~100 ms save throttle: the IndexedDB write hadn't started when the page unloaded, and the
  `pagehide` flush didn't save it. Now each change calls `repo.flush([libraryId])` immediately,
  and the e2e tests no longer wait 500 ms before reloading. A click-and-reload in the same task
  fails under the old behaviour and passes now. As a safety net for crashes, or for browsers that
  drop in-flight writes, the changes since the last confirmed save are also kept in
  `localStorage` until the flush completes, and replayed on the next load. Chromium didn't need
  this net in testing.

**Decided during M3 (2026-10-22)**

- **The cache stores parsed responses**, under keys like `thesession:tune:1`, in a separate
  IndexedDB database (`tunejournal-cache`), with a `CACHE_VERSION` that invalidates old shapes.
  TTLs: tune, sets and recordings 7 days; search 1 hour. Every read is stale-while-revalidate:
  cached data shows at once (offline too), and a stale entry is refreshed in the background only
  when `navigator.onLine`. A failed refresh keeps the old data. Requests to thesession.org go out
  one at a time, at least 300 ms apart, and the search box waits 400 ms after typing. The cache is
  hand-rolled (about 40 lines) rather than `idb-keyval`, so it can also list and count keys for
  Settings → "Clear cached data".
- **Alias search** uses only tunes already in the cache. The list doesn't fetch thesession data for
  every linked tune on load; picking a tune or opening its detail view caches it. Matching is per
  name: every query word must appear in the title, or all of them in one alias (or the thesession
  name).
- **Autofill order:** picking a result asks before replacing a non-blank title that differs
  (ignoring case and punctuation). It then links the tune (tune id, type tag in the library's
  casing, link-only Source + Clip). If the tune is already on another live piece, it offers *Open
  existing*, *Merge into existing* or *Keep both* before the setting picker. *Open existing*
  discards the new piece if it holds nothing but the search. A tune with one setting fills only
  blank key and first notes; picking one of several overwrites them. First notes are
  `firstBars(abc, 2)`.
- **thesession links are clips with deterministic ids:** Source and Clip id
  `thesession:tune:{id}` (or `thesession:set:{id}`), so the same tune added on two devices, or two
  merged pieces, share one. The Source holds only the URL and id, not the tune name (§13).
  Relinking a piece to another tune drops the old link and setting id. The edit modal shows the ids
  read-only with *Unlink*.
- **Merge details:** losers are merged in one op, and ids resolve through earlier merges first.
  Title, kind, description, key and first notes come from the survivor, or from the first loser
  that has one where the survivor is blank (kind always from the survivor), unless the dialog's
  field picker says otherwise. The picker only lists fields where the pieces differ. External ids
  fill gaps on the survivor. Clips are copied after the survivor's (skipping the same source and
  trim). Practice entries are inserted in time order. Links are re-pointed; one that would join the
  survivor to itself is dropped, and one that already exists keeps its position. The same merge
  done on two devices at once copies the practice log twice, so the index dedupes identical entries
  (same time, via and skill). `resolvePiece` follows `mergedInto` chains and stops at cycles;
  `/piece/[id]` of a merged piece redirects with `replaceState`. There's no undo for a merge yet.
- **Duplicate banner:** shown for the oldest group of live pieces sharing a tune id, with a count of
  any other groups. Dismissing it hides it until the set of duplicates changes (not persisted).
  "Review" opens the merge dialog with the oldest piece preselected as the survivor.
- **Promoting a set** creates a Set titled with its tune names joined by " / " (thesession's own
  set names can be long, odd lists), with `external.thesession.setId` and a set link. Tunes match
  existing live pieces by tune id (oldest first); missing ones become Tunes with title, type tag,
  setting id, key (from the set's abbreviated key) and link, but no first notes, since sets carry no
  ABC. Promoting the same set again reuses it. Children are ordered with `fractional-indexing` keys,
  ties broken by link id. The detail view lists up to 10 sets (the first API page).
- **Related (read-only)** in the detail view lists "Part of" (parents, by title) and "Contains"
  (children, in order). Links to a merged piece follow the redirect. Editing comes in M5.

**Decided during M4 (2026-10-22)**

- **Uploads stay `provider: 'upload'`.** The provider says where a recording came from; where its
  bytes are kept is separate. A Drive backup sets `assetKey: "gdrive:<fileId>"` and points `url`
  at the Drive file, and a later S3 store would use its own prefix. Picking a file *from* Drive
  makes `provider: 'gdrive'` with the file id as `externalId`. Either way, `driveFileId()` finds
  the Drive copy, and another device downloads it (`alt=media`) into its cache on first play.
- **Source ids:** a source with an external id gets a deterministic id
  (`youtube:<videoId>`, `spotify:track:<id>`, `gdrive:<fileId>`, `url:<url>`), like the M3
  thesession links, so the same link added on two devices merges into one Source. A pasted
  thesession tune link reuses `thesession:tune:<id>`. Files without one (uploads, shares) get a
  random id, which is also their audio cache key. `addRecording` also finds an existing source by
  provider + external id whatever its id, and only fills blanks on it.
- **One clip per source and trim:** adding the same untrimmed recording to a piece twice returns
  the existing clip; a different trim of the same source is a new clip.
- **Orphan Sources are never deleted from the doc.** They're tiny, an Undo or another device's
  concurrent edit may still point at one, and M5's Split reuses sources. `orphanSources()` lists
  them. Their cached bytes are dropped by Settings → "Remove downloaded recordings" unless they're
  kept offline or exist nowhere else.
- **Reordering** gives only the moved clip a new fractional key between its neighbours (skipping
  a neighbour that shares the lower key, which concurrent edits can produce). Two devices moving
  different clips both apply; one clip moved two ways ends up in one place, the same everywhere.
  Ties sort by clip id. Drag uses pointer events on a handle; "Move up/down" in each clip's menu
  is the keyboard path.
- **"Has recordings"** counts clips of actual recordings (upload, Drive, Recorder, YouTube,
  Spotify, links), not reference links (thesession, FolkFriend). The import panel stays prominent
  until there's something that plays *in the app* (file or YouTube); Spotify and plain links
  always open in a new tab.
- **oEmbed titles stay in the integration cache** (§13), keyed `oembed:<provider>:<id>`, 30-day
  TTL, cleared with the thesession cache. A clip shows its own title, else the source's (a file
  name), else the cached oEmbed title, else "YouTube recording". A shared link's title becomes
  the clip title, since the user chose to share it.
- **Audio cache:** bytes in OPFS (`audio/<encoded source id>`) or IndexedDB; metadata in the
  `tunejournal-audio` IndexedDB database rather than an OPFS sidecar, so the page and the service
  worker can't overwrite each other's writes. "Keep offline" is device-local and can be set before
  the bytes exist (it downloads them). Uploads and shared files are always kept, since they're
  the only copy until backed up. Played-but-not-kept downloads stay cached until removed in
  Settings; there's no automatic eviction yet.
- **Upload flow:** the file goes into the cache first, then the doc gets the Source and Clip, and
  its duration is measured from the file. If Drive is connected on this device, it's backed up in
  the background; otherwise the clip shows "Not backed up" and its menu offers "Back up to Drive"
  (when Drive is configured). On a device without the bytes, an unbacked upload says "On another
  device".
- **Drive auth:** GIS token client with `drive.file`. Tokens (about an hour) are kept in
  `sessionStorage`; "connected" is remembered in `localStorage`, so later token requests skip the
  consent screen. `DriveClient` retries once with a fresh token on a 401. Drive UI is hidden when
  any `PUBLIC_GOOGLE_*` value is empty.
- **Player:** one global player in the root layout, so playback continues across pages. Loop is
  ours on both adapters (seek back to the start at the end; without loop, stop at the end). The
  speed is remembered per device as the default; the range is 25–200% (YouTube's, and Firefox
  mutes outside 25–400%). `setPitchShift` is a no-op placeholder for M8. Link-out clips render
  as ↗ links rather than buttons, so they work with popup blockers; `LinkOutAdapter` exists for
  callers like Shuffle. The YouTube iframe sits small inside the bar while a YouTube clip is
  loaded.
- **Mini-player layout:** fixed to the bottom, full width. It publishes its height as
  `--player-h`, which pads the page and lifts the mobile FABs and toasts above it (the bottom-left
  FABs never overlap it). On phones the speed control folds behind a "100%" button; on desktop it
  sits inline.
- **Trim:** a trim covering the whole file is stored as no trim; a start under 0.05 s as no
  start. A YouTube `t=` in a pasted link becomes the clip's start. The waveform editor previews
  with its own audio; the YouTube slider previews through the global player with temporary bounds.
- **Share target** moved to `/share-target` → `/shared`. The old `/spike/share-target` action is
  still accepted (an installed WebAPK keeps it until it updates), and `/spike/share` forwards to
  `/shared`. A shared file waits in an inbox until attached to an existing piece (search) or a new
  Tune; a shared link (Share → Link) goes through the same attach flow as a pasted one. Shared
  files from Recorder become `upload` sources.
- **jigripper** isn't hinted at yet; it stays in M8.

**Decided during M5 (2026-10-22)**

- **Child kinds:** "Add Set" on a Session, "Add Tune" on a Set, "Add Part" on a Tune. A Part gets
  a generic "Add…", whose "New" option makes another Part. Split uses the same kinds ("Split Part"
  on a Part makes a Part).
- **Link guards:** the picker leaves out the piece itself and its current children, and
  `linkPieces` refuses a self-link and keeps an existing link's place. A link that would close a
  loop (the parent is already somewhere under the child) shows a warning with "Add anyway". The
  model allows it; practice then flows both ways round the loop, each ancestor counted once.
- **Reordering children** moves one link's fractional key, like clips (M4). The UI moves a child
  *after a visible sibling* (`moveChildAfter`) rather than to an index, since links to deleted
  pieces stay in the doc and keep their places. Drag uses a handle; ↑/↓ buttons are the keyboard
  path (always visible, as children are short rows). Removing a link never touches either piece.
- **Effective practice** = own entries ∪ every live ancestor's own entries, found breadth-first up
  the parent links with a visited set. Inherited entries carry `viaPiece` (the ancestor's id); the
  existing `via` field already means "card or shuffle", so it wasn't reused. Deleted or merged-away
  ancestors don't count; links through a merged piece follow its redirect. Practice only flows up
  (a Set's history doesn't include its tunes'). Entries are computed per index build and memoized
  per piece; the index is memoized per doc snapshot (`getIndex`).
- **Inheritance:** a Part with no skill (or key) uses its earliest-created live parent Tune's own
  value (ties by id). Only Part → Tune; Tunes never inherit from Sets. Setting a value gives the
  Part its own; clearing it goes back to inheriting, so a Part can't be "explicitly unrated" under a
  rated Tune. Filters, sort and cards use the effective values; the key list in the filter still
  only offers keys pieces have themselves.
- **Split** makes the child of the conventional kind with a clip on the **same Source** (never
  copied), bounded by the region; the parent keeps its clip. The new clip copies the parent clip's
  per-recording key but not its title. A region covering the whole file is stored as no trim. The
  first region starts at the clip's own trim; each "Split another" starts where the last ended and
  runs to the end. "No recording" (or a piece without playable recordings) adds a blank child.
- **Merge undo uses a snapshot, not Automerge history.** `mergeWithUndo` takes plain copies of the
  pieces and of every link touching them just before merging. `undoMerge` restores the losers'
  `mergedInto`/`deletedAt`, the survivor's scalar fields (title, kind, description, key, first
  notes, skill, favorite, external ids) and the old links (re-pointed copies removed), and removes
  only the tags, clips and practice entries the losers brought in. Anything else changed after the
  merge (a new practice entry, a new clip) survives the undo. Reverting through Automerge history
  would also roll back concurrent edits from other devices and needs heads bookkeeping in the store,
  so the snapshot is simpler and safer. The snapshot lives only in the Undo toast (not persisted).
- **"Merge with…"** is on the card and detail overflow menus. It opens a picker (the piece itself
  excluded), then the M3 merge dialog with the current piece preselected as the one to keep.

**Decided during M6 (2026-10-22)**

- **Constants:** horizon 60 days; the "practised a lot" half of F saturates at 20 practices
  (`CAP_COUNT`). Neither is a setting yet.
- **Temperature sliders** have 21 notches: 0–19 run log-evenly from T = 0.05 to T = 10, and the
  top notch is ∞ (stored as `null`, as M0 decided). Stored values snap to the nearest notch only
  when the slider moves; the defaults (0.5, 1, 2) stay as they are. Sliders read left = "Stalest
  first" / "Weakest first" / "Favorites first", right = "Random", with words (Very strong … Faint,
  Off) as the value. A temperature of 0 (or so small that logits overflow) gives every top piece an
  equal share instead of NaN.
- **Session state** (`shown`, the current card) lives in the route component only, so leaving
  Shuffle or reloading starts a new round. Candidates are recomputed at each pick, so practice,
  edits and setting changes (on any device) apply from the next card on. A card whose piece is
  deleted or merged away elsewhere is skipped. With no card up, one is dealt as soon as something
  unshown matches (after changing settings from the "Nothing to shuffle" state, say).
- **The skill slider saves as it moves**, like the detail view's: it's an explicit edit, so Skip
  keeps it and leaving Shuffle doesn't lose it. Practiced records the skill as `skillAfter` when
  it differs from the piece's own skill when the card came up. Moving the slider on a Part gives it
  its own skill, as in the detail view. Practiced logs `via: 'shuffle'` and shows no Undo toast,
  since it would cover the buttons. So an accidental Practiced in Shuffle stays logged for now
  (the detail view's history has no per-entry removal yet).
- **"Respect current list filter"** applies the list's saved filters (`settings.list`: kind, tags,
  skill, key, favorites, practiced, recordings) on top of the shuffle's own kind and skill range;
  the list's search text isn't saved, so it doesn't apply. Stored as an optional
  `settings.shuffle.respectListFilter`, so no migration.
- **Player:** Shuffle drives the global player store and adapters. It loads the chosen recording
  paused, so play starts at once; advancing, Restart and leaving Shuffle close the player. Speed
  and loop live in the store, so they carry across cards (speed is also the per-device default, as
  in M4). The mini-player bar isn't rendered on `/shuffle`, so Shuffle hosts the YouTube iframe
  itself. Recordings that only link out are listed as ↗ links when nothing plays in the app.
- **Keyboard:** Space plays/pauses, P is Practiced, S is Skip, unless focus is on a control or the
  settings sheet is open. A hint line shows on devices with a fine pointer.
- **Two-handle skill range** is two native range inputs on one track, so each handle stays
  labelled and keyboard-operable; they can meet but not cross.

**Still open**

None right now. Add questions here as they come up.
