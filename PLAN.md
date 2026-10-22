# TuneJournal — Plan

A local-first PWA for tracking folk tunes: what I can play, what I want to learn, and where I've
heard or recorded them. Part todo list, part spaced-repetition deck, part file store, part music
player.

> Status: planning. Nothing is built yet. Sections marked **(decision)** are proposals to confirm;
> see [Decisions and open questions](#14-decisions-and-open-questions) at the end.

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
| App framework | SvelteKit + `adapter-static` (SPA fallback, `ssr = false`) | Gives routing and builds to plain static files. Plain Vite + Svelte + a small router also works if we'd rather avoid Kit. |
| PWA | `@vite-pwa/sveltekit` (Workbox) | Precached app shell. Prompt "New version available — reload" rather than a silent reload mid-practice. |
| User state | **Automerge** + `@automerge/automerge-repo` | See §4. Needs `vite-plugin-wasm` + `vite-plugin-top-level-await`. |
| Local storage | `automerge-repo-storage-indexeddb`, OPFS for audio, `idb-keyval` for caches | |
| Styling | Plain CSS with custom properties, or Tailwind | No component library. Mobile-first. |
| Audio UI | `<audio>` + wavesurfer.js (regions plugin) for trimming | YouTube uses the IFrame Player API behind the same player interface. |
| Search | In-memory, MiniSearch or plain filtering | A few thousand pieces at most. |
| Tests | Vitest (domain layer), Playwright (e2e, offline mode) | |
| Backend (later) | Hono on Node in Docker on the VPS | Hono also runs on Workers/Deno/Bun, so the light endpoints stay portable. Heavy ones (yt-dlp, headless Chrome) need a real server anyway. |
| Asset storage (later) | Any S3-compatible API (MinIO/Garage on VPS, R2, B2) | Abstracts over the vendor. |
| Static hosting | Cloudflare Pages *or* anything else | Use nothing Pages-specific beyond `_headers`/`_redirects`, which most static hosts support too. |

---

## 4. Automerge vs Evolu (decision)

Both are good. My recommendation is **Automerge**, with a thin repository layer so the
UI never touches the CRDT directly.

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
  - `LinkOutAdapter` (Spotify, thesession, unknown) opens the URL in a new tab.
- The **trim editor** uses wavesurfer.js with the regions plugin on file-backed sources. For
  YouTube it uses a simple dual-handle slider with time readout and preview, since we can't
  get a waveform.

### 6.7 Provider decoration
Each provider has an icon and colour accent on its clip rows and card icons. Links that open
outside the app show an ↗ affordance.

---

## 7. Integrations

Initial CORS findings (checked 2026-10-22) and planned approach:

| Source | Client-side? | Approach | Backend needed for |
|---|---|---|---|
| **thesession.org** | ✅ `Access-Control-Allow-Origin: *` on `?format=json` | Search `/tunes/search?q=`, details `/tunes/{id}` (type, aliases, settings w/ ABC), `/tunes/{id}/sets`, `/tunes/{id}/recordings`. Cache responses in IndexedDB with a TTL. Be polite: debounce search and throttle requests. | Nothing |
| **Google Drive** | ✅ (expected) | Google Identity Services token client + Picker API, `drive.file` scope. That scope is non-sensitive, so the app needs no Google verification and sees only files the user picks or the app creates. Download with `files.get?alt=media` + bearer token → blob → OPFS cache. | Nothing. Tokens are short-lived, so a re-auth prompt is acceptable. |
| **Pixel Recorder** | ❌ | The only API is the unofficial cookie-based web API used by `google-recorder-cli`, which needs headless Chrome to refresh cookies. That's fragile and server-only. **v1 path:** the Recorder app's *Share* button sends the audio file to our PWA through the **Web Share Target API** (Android, installed PWA). Alternatively, the user saves to Drive and picks it there. | Optional later: a proxy using `google-recorder-cli` on the VPS for browsing and bulk import |
| **YouTube** | ✅ for playback | IFrame player with clip start/end. Title/thumbnail via oEmbed, but CORS needs a spike; fall back to noembed or just the URL. No offline playback. | `yt-dlp` → audio file → asset storage, for offline use and waveform trimming |
| **Spotify** | Link only | Open the URL. Title/thumbnail via oEmbed (spike CORS). Full playback would need Premium and the Web Playback SDK, so it's out of scope. | — |
| **folkfriend.app** | Link (TBD) | Treat as a non-audio source with custom decoration. Check whether it exposes stable tune IDs that map to thesession IDs. | — |
| **jigripper.com** | TBD (deferred) | Tune identification from a recording. It appears to run a model in the browser, so it might be embeddable or reusable client-side with no backend. Investigate post-MVP. | Possibly none |
| **Uploads** | ✅ local | Stored in OPFS immediately. For cross-device sync, **upload to the user's own Drive** (an app-created `TuneJournal/` folder through `drive.file`) until we run our own asset store. | Own S3 store later (optional) |

**Proposal: use Google Drive as the asset store in v1.** It removes the need for a backend for
file storage entirely. It also keeps the user's audio in the user's own account, which suits a
local-first app.

### 7.1 Integration spike (Milestone 0)
A throwaway page under `spikes/`. For each item, record the result back into this table:
- [ ] thesession: search, tune, sets, and recordings from the browser. CORS is already confirmed
      for GET.
- [ ] Drive: GIS token flow + Picker + `alt=media` fetch of an m4a, then playback from a blob.
- [ ] Web Share Target: share an m4a from Pixel Recorder into the installed PWA. Receive it in
      the service worker and store it in OPFS.
- [ ] YouTube: IFrame clip playback with `start`/`end`/`setPlaybackRate`. Check oEmbed CORS.
- [ ] Spotify oEmbed CORS.
- [ ] folkfriend: what's linkable, and what's queryable? (jigripper is deferred to M8.)
- [ ] `preservesPitch` slow-down quality at 0.5–0.75× on Android Chrome and desktop, for m4a
      from Drive and Recorder.
- [ ] Automerge in the SvelteKit static build. Check that WASM loads with the service worker
      offline, and that two browsers sync through `sync.automerge.org`.

**Exit criterion:** decide whether the backend is needed before Milestone 4. My expectation is
that it isn't. With CORS open on thesession, Drive working client-side, and Share Target
covering Recorder, the backend can wait until we want `yt-dlp`, a private sync relay, or
Recorder browsing.

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
│  ├─ src/lib/domain/        pure TS: types, ops (create/edit/merge/split/link), shuffle, indexes
│  ├─ src/lib/store/         Automerge repo setup, Svelte bindings, migrations, export/import
│  ├─ src/lib/integrations/  thesession, gdrive, youtube, spotify, sharetarget, ...
│  ├─ src/lib/audio/         PlayerAdapter impls, OPFS cache, trim editor
│  ├─ src/lib/ui/            components (PieceCard, TagInput, SkillSlider, Fab, Modal, ...)
│  └─ src/routes/            / (list), /piece/[id], /shuffle, /settings, /link-device
├─ server/                   (later) Hono backend + Dockerfile + compose
└─ spikes/                   throwaway experiments
```

The domain layer never imports Svelte or Automerge internals directly. It takes a mutable
`Library` proxy, as in `repo.change(d => ops.merge(d, a, b))`, so it's trivially testable
against plain objects.

---

## 11. Milestones

**M0: Spikes** (§7.1)
- [ ] Integration spike results recorded in §7
- [ ] Final Automerge/Evolu decision recorded in §4
- [ ] Backend-timing decision recorded

**M1: Skeleton and core list**
- [ ] SvelteKit static + PWA + CI (typecheck, lint, vitest, build), deployed to a static host
- [ ] Automerge repo with IndexedDB storage, Library doc creation, migrations scaffold
- [ ] Piece CRUD: (+)/Add, Edit modal (kind, title, description), soft delete with undo toast
- [ ] Tags with suggest/create input
- [ ] Favorite ★, skill slider (unrated by default), key + first notes fields (tunes/parts only)
- [ ] Practiced button + log, "last practiced" display
- [ ] Search, filter, and sort bar
- [ ] Responsive layout: full-screen detail on mobile, list + right-hand detail pane on desktop
- [ ] Export/import

**M2: Sync**
- [ ] `BrowserWebSocketClientAdapter` to the public relay. Link-device QR screen.
- [ ] Sync status indicator. Conflict-free behaviour tested with two browsers offline/online.

**M3: thesession.org**
- [ ] Title search → autofill (title, type tag, external ID, thesession source link, and key +
      first notes from the chosen setting)
- [ ] Integration cache with TTL; aliases included in search
- [ ] Detail view: "Appears in sets", settings/keys, recordings count
- [ ] Promote a suggested set into Set piece + links
- [ ] Duplicate-tuneId detection banner → merge flow (requires M5 merge op, or build it here)

**M4: Recordings and player**
- [ ] Source/Clip model, recordings section, provider decorations, empty-state import panel
- [ ] Global player bar with HtmlAudio + YouTube + LinkOut adapters, loop, and speed (presets
      and ±5% steps)
- [ ] Per-clip key and first-notes overrides
- [ ] Google Drive picker + download + OPFS cache + "keep offline"
- [ ] Upload → OPFS → Drive `TuneJournal/` folder
- [ ] Web Share Target (Recorder → app)
- [ ] Trim editor (wavesurfer regions; slider fallback for YouTube); reorder clips

**M5: Relations**
- [ ] Links: Add child (picker + "New …"), parent/child display, reorder children
- [ ] Effective practice history: walk ancestors (cycle-safe) for counts, latest, sort, and
      shuffle. Show "via <Set>" entries in the detail view.
- [ ] Part → Tune inheritance of skill and key, with muted "from <Tune>" display
- [ ] Split from a clip region → new child piece on the same source
- [ ] Merge (manual + thesession-prompted), `mergedInto` redirects

**M6: Shuffle**
- [ ] Full-screen shuffle view, Practiced/Skip (Skip persists nothing), inline skill slider
- [ ] Skill range filter in shuffle settings
- [ ] Prominent player: recording selector (first by default), play/pause, speed presets, loop.
      Speed and loop stay set across cards.
- [ ] Settings: temperatures, kind checkboxes
- [ ] Unit tests for sampling distribution at temperature extremes

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

**Still open**

None right now. Add questions here as they come up.
