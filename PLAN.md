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
| Audio UI | `<audio>`; the trim editor draws its own waveform (Web Audio decode → canvas) | YouTube uses the IFrame Player API behind the same player interface. |
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
  schemaVersion: number;                   // currently 2 (2 added settings.playback)
  pieces: Record<PieceId, Piece>;
  sources: Record<SourceId, Source>;       // shared by many clips across pieces
  links: Record<LinkId, Link>;             // many-to-many piece relations
  settings: Settings;                      // shuffle temps, default sort, playback profiles (synced)
}

interface PlaybackSettings {               // settings.playback: synth playback per tag (§14)
  default: PlaybackProfileSettings;        // catches every piece no profile matches; shown last
  profiles: Record<string, PlaybackProfile>; // keyed by tagKey(tag), so concurrent adds merge
}

interface PlaybackProfileSettings {        // flat, so concurrent edits to different fields merge
  instrument: InstrumentId;                // fiddle | flute | whistle | accordion | piano
  timesThrough: number;                    // 1–4
  chords: boolean;
  lilt: number;                            // long:short ratio of the strong quaver, 0.5–2; 1 = even
  accent: number;                          // −100…100 on the strong quavers; negative de-emphasises
  attack: number;                          // −100…100
}

interface PlaybackProfile extends PlaybackProfileSettings {
  tag: string;                             // as typed; matched case-insensitively
  order: string;                           // fractional index; the first match wins
}

interface Piece {
  id: PieceId;
  kind: PieceKind;                         // required; shown as Session/Set/Tune/Part
  title?: string;
  description?: string;                    // plain text/markdown
  tags: Record<string, true>;              // free-form; case-insensitive matching, stored as typed
  skill?: 1 | 2 | 3 | 4 | 5;               // undefined = unrated (default); 1 = never played … 5 = amazing
  key?: string;                            // usual key, e.g. "D major", "A dorian"; hidden for set/session; else inherited (below)
  firstNotes?: string;                     // ABC snippet of the opening, e.g. "A2 FA dAFA"; hidden for set/session; else inherited
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
  key?: string;                            // key as played in this recording (a thesession link: its setting's)
  firstNotes?: string;                     // ABC opening as played here (a thesession link: its setting's)
  note?: string;
  instrument?: InstrumentId;               // synthesized thesession link only: overrides its profile's
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
  keys. `clip.key`/`clip.firstNotes` say how a specific recording goes; a linked thesession.org
  setting's key and opening bars live on the **thesession recording** (the tune link's clip), not
  on the piece. `piece.key`/`piece.firstNotes` are the user's own "usual version". A piece's
  **effective** key is, in order: its own `key`; else the `key` of its first clip (in clip order)
  that has one; else, for a Part only, its Tune's effective key (the Part → Tune rule below).
  Effective first notes are its own, else the first clip's that has some; Parts never take their
  Tune's (a B part starts differently). Filters, sort, the filter's key list, cards, the detail
  view and Shuffle use the effective values, shown muted with "from <recording title>" (or
  "from <Tune>") when inherited, and setting the piece's own value overrides them. Each clip's own
  effective key is its `key`, else the piece's effective key; the player shows that. Both fields
  are hidden in the UI for sets and sessions; the data stays if the kind changes. Keys are stored
  normalized (tonic + mode) so they can be filtered, and are rendered like "D maj" or "A dor".
  The first notes are an ABC fragment. Display them as text at first; rendering them with abcjs
  comes later.
- Derived values like "last practiced", "times practiced", and "has recordings" are computed,
  never stored. A small memoized index layer rebuilds them on doc change.
- **Practice propagates upward at query time, not write time.** Practicing a Set logs an entry
  on the Set only. A piece's *effective* practice history combines its own entries with the
  entries of every ancestor, found by walking `Link`s from child to parent. The traversal keeps
  a visited set, because nothing enforces that links form a hierarchy and cycles are possible.
  "Last practiced" and "times practiced" on cards, sorting, and the shuffle's staleness factor
  all use the effective history. The detail view shows it with each inherited entry labelled
  "via <Set name>".
- **Parts inherit from their Tune.** If a Part has no `skill` of its own, it uses the value from
  its parent Tune. If it has no `key` of its own and none of its own recordings has one, it uses
  its Tune's effective key (the Tune's own, else the Tune's first recording's). Inherited values appear muted, with a "from <Tune>" hint, and
  editing one gives the Part its own value. Filters, sorting, and the shuffle use the effective
  value. If a Part belongs to several Tunes, it inherits from the earliest-created one.
  - `firstNotes`, title, tags, favorite, and recordings are *not* inherited. A B part starts
    differently from the A part.
  - Only Part → Tune inherits attributes. Tunes don't inherit from Sets, and Sets don't
    inherit from Sessions. Practice history is different: it propagates up the whole graph
    (above).
- **Playback profiles** (`settings.playback`, §14 "Tag playback profiles"): a synthesized tune
  plays with the first profile, in the profiles' order, whose tag the piece has, never the order
  of the piece's own tags. A Part also has its Tune's tags for this (the Part → Tune rule above);
  nothing else is inherited. Anything unmatched uses `default`. A recording may override only
  the instrument (`clip.instrument`). Schema 2 seeds Old Time, Reel, Jig and Default.
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
  - A title field with a 🔍 button that opens the thesession tune picker (§6.3).
  - Description, tags, skill (starts unrated, with a "clear rating" option), and favorite.
  - Key (a tonic + mode picker that also accepts free text) and first notes (ABC text). Both are
    hidden for sets and sessions.
  - External IDs, read-only with an unlink option.
- **Tag input:** a chip input. Typing filters existing tags, sorted by usage count. Enter or a
  comma accepts the highlighted suggestion, or creates the typed text as a new tag. The
  "Create 'xyz'" row is always present when the text is new.
- **Recordings section:** if there are no clips, a prominent import panel shows the source
  buttons (Drive, Recorder, YouTube, Upload, Link). Once clips exist it collapses to a small
  "+ Add recording". Clips can be dragged to reorder, removed, or trimmed. Each clip's ⋯ menu has
  **Edit…** (title, key and first notes as played; a thesession link's tune and setting, through
  the pickers of §6.3; another
  link's URL; Trim), **Open link ↗** (YouTube, Spotify, thesession, the Drive file's page, any
  URL; an upload that's only on this device offers **Download file** instead), Trim…, Move
  up/down, Back up to Drive and Remove.

### 6.3 Add flow
1. Tap (+). This creates a blank Tune immediately and opens Edit, so nothing is lost if the user
   navigates away. Empty pieces untouched for 60s could be auto-discarded, or just left.
2. Optionally press 🔍 next to the title to search thesession and pick a result. This fills the
   title, `external.thesession.tuneId`, and a type tag (Reel/Jig/Slip Jig/Hornpipe/Polka/…). It
   can also add the thesession link as a non-audio source. If the result has several settings,
   the user picks one, and that setting's `key` (from its `mode`, e.g. `Dmajor`) and
   `firstNotes` (the first bar or two of its ABC) go on the thesession recording, which the
   piece inherits them from (§5). The recording's Edit… can later pick another tune or setting.
3. If that thesession tune already exists in the library, offer to open it instead, or to merge.

**The thesession pickers.** Searching (🔍, or the recording's *Change tune…*) and choosing a
setting (after a tune, or the recording's *Change setting…*) happen in a view of their own rather
than in a panel inside the dialog:
- **Mobile:** full screen, with a header (title, × to close, and ‹ back to the results from the
  setting step), the search box under it, the list scrolling, and a footer.
- **Desktop:** a modal the size of a dialog that takes the place of the edit modal (or the
  recording's Edit), which is hidden while it's open.
- × or Escape (also from the search box) closes it and goes back to the dialog underneath as it
  was, focus on the button that opened it. Android's back gesture does the same through the
  dialog's close watcher. Choosing a setting closes it too; *Open existing* and *Merge into
  existing* leave both for the other piece.
- **Tune results** show the name, type, usual meter, the alias the search matched, "In library",
  and, for tunes already loaded on this device, the settings count with their commonest keys,
  the tunebook count and other names (from the cache, no extra requests).
- **Settings** each show their number, key, meter, who posted them and when, and the opening bars
  drawn as notation (abcjs, once scrolled into view; the ABC text until then). The current
  setting is marked. The footer has *Skip* (keep the tune, no setting) or *Cancel*.
- **Previews:** ▶ on every setting, and on every tune result (its first setting, fetched through
  the cache on the first tap), plays it synthesized (§6.6) with this device's synth options at
  the tune type's default tempo. ■ on the row stops it; ▶ on a paused one carries on. One plays at
  a time; starting one pauses the main player, and closing the picker (or ‹ back) stops it.
- **Preview bar:** while a preview is loaded (playing or paused), the footer shows it above the
  speed and Skip/Cancel: play/pause, its name ("Setting 2", or the tune's) over a seek bar with
  the elapsed and total time (the player bar's scrubber: drag, tap or arrow keys), and ■ to stop.
  Times are the tune's at 100%, as in the player bar, so a place holds across speed changes. The
  speed control is folded behind a "Speed 100%" toggle on a phone, inline on a desktop.
- **Notation follows:** while a setting plays or is paused, its row's incipit shows the bars
  being played instead of the opening ones, about two at a time (a pickup with the bars after it),
  with the note sounding highlighted. It follows the repeats, endings and times through as heard,
  moves on at once after a seek, and keeps the row's height. Stopped, the opening bars come back.
  Tune results have no notation, so their previews only get the bar.

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
- **State:** a session is a seed, a start time and a position, kept in the URL as
  `/shuffle?seed=…&at=…&i=…` (§14 "Decided for seeded Shuffle"). The order is fixed when the
  session starts, so a reload, or going to a piece's details and back, lands on the same card.
  The header shows "3 of 12" and a ⤮ **Reshuffle** button (new seed and start, from the top).
  - **Practiced** logs a practice entry. If the slider moved, it also saves the skill.
  - **Skip** persists nothing. A change to the skill slider is still saved, because that's an
    explicit edit.
  - Either button moves to the next position (updating `i` in place, so Back leaves Shuffle).
    Past the end, show "You've been through everything 🎉" with a Reshuffle option.
  - Changing the shuffle settings starts a new shuffle.

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
shuffle is uniform.

The session's whole order is drawn at once with the **Gumbel-top-k trick**: each candidate's key
is `logit + G` with `G = -log(-log(u))`, and sorting by key, descending, has exactly the
distribution of drawing one piece at a time from the softmax and removing it. Each `u` is a hash
of `(seed, piece id)`, and the features are taken as of the session's start (`at`), so the order
is a pure function of the seed, the start time and the library, and is unit-testable.

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
  - `SynthAdapter` plays a **synthesized thesession setting** (below) through an inner
    `HtmlAudioAdapter`, so scrubbing, loop, trim and the waveform work as for a file.
  - `LinkOutAdapter` (Spotify, thesession without a playable setting, unknown) opens the URL in a
    new tab.
- **Synthesized playback (♪ Synth).** A thesession tune link whose piece has a chosen setting
  plays that setting in the app: abcjs (lazy-loaded) renders its ABC with self-hosted instrument
  samples to a WAV, which is cached in the audio cache (OPFS) and played like a recording. It's
  marked "♪ Synth" on the clip row, in the mini-player and in Shuffle, since it isn't a real
  recording. Speed re-renders at the new tempo rather than time-stretching (the stretched
  rendering bridges the fraction of a second until then), and the player, trim and playhead all
  work in *tune time* (seconds at 100%), so a trim means the same bars at every speed. How it
  plays is set per tag in **playback profiles** (Settings → Synthesized playback, synced): the
  profiles' tags are chips in priority order, with an add-a-tag search like a piece's tags and ×
  to remove (with Undo); a fixed **Default** chip comes last and catches everything else. Tapping
  a chip edits that profile: instrument (fiddle, flute, whistle, accordion, piano), times through
  (1–4, the ABC's own repeats honoured), chord accompaniment, and a **Feel** group for the strong
  quavers: **Lilt** (the long:short ratio, 1:2 to 2:1 in notches, "Even" in the middle),
  **Accent** and **Attack** (−100 to +100; below 0 de-emphasises them), with "As written" and
  "Default" (the tag's seeded feel) buttons, and ‹ Earlier / Later › to change its priority.
  Sliders re-render once they settle. The recording's Edit dialog shows which profile applies
  ("Playback: Reel profile", linking to it in Settings), an optional **Instrument** override for
  that recording, and **Show notation** (abcjs sheet music, highlighting the note being
  played). Without a chosen setting, or offline before the tune was ever loaded, the link opens
  thesession.org as before. Decisions in §14 "Synthesized playback".
- The **trim editor** (Trim, and Split's region picker) has its own transport, since the
  mini-player bar sits behind its dialog: play/pause, a playhead you can tap or drag on the
  waveform (a plain timeline for YouTube, where we can't get the audio), two draggable start/end
  flags, "Set start/end at playhead", a looped preview of the region, and typed times. It drives
  the global player and its adapters (the clip loads there, playing the whole recording while
  trimming). The waveform is drawn on a canvas from the file decoded with Web Audio.

### 6.7 Provider decoration
Each provider has an icon and colour accent on its clip rows and card icons. Links that open
outside the app show an ↗ affordance.

---

## 7. Integrations

Results of the M0 spike (2026-10-22, see §7.1 for evidence) and the planned approach:

| Source | Client-side? | Approach | Backend needed for |
|---|---|---|---|
| **thesession.org** | ✅ **confirmed**. All four endpoints send `ACAO: *` and were fetched from a page in headless Chromium | Client: `src/lib/integrations/thesession.ts` (fixtures + tests). Search `/tunes/search?q=` (honours `perpage`, results carry no aliases or settings). Details `/tunes/{id}` (type, aliases, `recordings` count, settings with `key` such as `Edorian` plus the ABC body). `/tunes/{id}/sets` is paged at a fixed 10 and ignores `perpage`; its entries are *settings*, so the tune id has to be parsed from the URL, and keys there are abbreviated (`Edor`). `/tunes/{id}/recordings` returns everything (197 for Cooley's) plus `recorded_with` counts. Cache in IndexedDB with a TTL, debounce search, throttle. A chosen setting's ABC also plays synthesized in the app (§6.6), rendered in the browser by abcjs with self-hosted samples. | Nothing |
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
│  ├─ src/lib/audio/         PlayerAdapter impls, OPFS cache, trim editor, abcjs synth + WAV encoder
│  ├─ src/lib/ui/            components (PieceCard, TagInput, SkillSlider, Fab, Modal, ...)
│  ├─ src/routes/            / (list), /piece/[id], /shuffle, /settings, /link-device
│  ├─ src/service-worker/    precache + cache-first app shell (own tsconfig)
│  └─ static/                manifest.webmanifest, icons/, soundfont/ (synth samples, see §14)
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
- UI: the 🔍 panel in the edit modal (`TheSessionSearch.svelte`, since replaced by the pickers of §6.3), "Linked to … / Unlink" in the
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
  (`pickNext` and `seededRng` were later replaced by the seeded Gumbel-top-k `shuffleOrder`, §14.)
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

**Fixes after M6 review** (user-reported bugs and nits; decisions in §14)
- [x] "500 Internal Error" on opening some tunes: thesession.org's `/tunes/{id}/sets` can list a
      set twice (High Drive, tune 4428, lists set 150333 twice), and the "Appears in sets" list is
      keyed by set id, so Svelte threw `each_key_duplicate`. The parsers drop repeated sets, search
      hits, settings and recordings, and the store dedupes data cached before the fix. Every keyed
      `{#each}` was audited: menus key by position, the merge dialog and "previous libraries"
      dedupe their ids; the rest key by ids that are unique by construction (map keys, `tagsOf`,
      deduped relations). A `+error.svelte` page (with a client `handleError` that keeps the real
      message) replaces the bare error, with "Back to list" and Reload.
- [x] Overflow menus are fixed to the viewport: they open below the button when there's room
      (else on the roomier side), stay inside the viewport horizontally, scroll when too tall, and
      reposition on scroll and resize. Items can be real links (for "Open link ↗").
- [x] The skill slider's "Clear rating" / "Use <Tune>'s" moved into its header row, next to the
      value, so the slider's width never depends on its value (detail, edit modal, Shuffle).
- [x] The clip menu's "Details…" is now **Edit…**: thesession links can move to another tune
      (the 🔍 search) or setting (the picker, with key and first bars, current one marked); other
      links can be corrected (provider detected again, so the oEmbed title refreshes; a `t=` sets
      the start); title, key and first notes as played; Trim.
- [x] thesession key and first notes live on the thesession recording, and pieces inherit key and
      first notes from their first recording that has them (§5).
- [x] The trim editor has its own transport over the global player (§6.6), in Trim and Split.
- [x] Every recording's menu has **Open link ↗** (or **Download file** for an upload that's only
      on this device).
- [x] Desktop pages scrolled far past their content: absolutely positioned `.visually-hidden`
      elements (the hidden file input, "(in library)" labels) inside the two scrolling panes had
      the page as their containing block, so the page grew by however far down the pane they sat.
      The panes are now positioned (and contain overscroll).
- [x] Google Drive can be set up at runtime: Settings → Google Drive takes the client ID, API key
      and project number, saved on the device only, overriding the build's `PUBLIC_GOOGLE_*`.
- Tests: unit tests for the dedupe, menu placement, effective key/first notes, `relinkClip`,
  `openLinkOf`, the clip-level setting autofill and the Drive config helpers; `e2e/fixes.test.ts`
  covers each item (repeated sets, the error page, menus in the viewport, slider width in all
  three views, changing a thesession tune and setting, correcting a link, Open link / Download
  file, the trim transport in Trim and Split, no overscroll with and without the player, runtime
  Drive setup with a stubbed Google). The user's real library was imported in a scratch
  Playwright run that opened every piece and dealt Shuffle cards with no errors.

**Post-M6: synthesized playback of thesession settings** (the user's top priority; decisions in
§14 "Synthesized playback")
- [x] A thesession link with a chosen setting plays it synthesized (abcjs → WAV → OPFS →
      `HtmlAudioAdapter`) in the mini-player, Shuffle and the trim editor, with the same speed,
      loop and trim controls; "♪ Synth" marks it everywhere
- [x] Speed re-renders at the new tempo (stretched meanwhile), keeping the place in the tune
- [x] Default tempo per tune type when the ABC has no `Q:`; times through (default 2); instrument;
      chord accompaniment; options per device in Settings and the recording's Edit dialog
- [x] Offline after the first play: tune ABC from the integration cache, samples from the service
      worker's soundfont cache, renderings from OPFS
- [x] Show notation in the thesession recording's Edit dialog, with the playing note highlighted
- [ ] Transposition: `SynthAdapter.setPitchShift` re-renders with abcjs' `midiTranspose`, but no UI
      offers it yet (it fits the M8 key-transposition item)

Post-M6 notes:
- Domain (`domain/synth.ts`, pure): instruments and their sampled ranges, `TUNE_TYPES` (meter and
  default tempo), `parseTempo`, `buildTuneAbc` (header, body × times through, restating K/M/L when
  the body changes them), `renderRequest`, `synthCacheKey`/`synthCacheFamily`, `synthTarget`;
  `clipPlayback` in `domain/providers.ts` adds the `synth` playback kind. Browser half:
  `audio/synth.ts` (`renderTune`, `fitToSoundfont`), `audio/wav.ts` (`encodeWav`),
  `audio/synth-adapter.ts`, `store/synth.svelte.ts` (options, availability, render + cache +
  prune). UI: `SynthOptions.svelte`, `Notation.svelte`; Recordings, ClipDialog, TrimDialog,
  ShufflePlayer, PlayerBar and Settings use the clip-level playback. The service worker caches
  `/soundfont/` at runtime. `scripts/fetch-soundfont.js` fetches the samples.
- Tests: `domain/synth.test.ts` (tempo defaults by type, `Q:` parsing, ABC building and times
  through, keys, cache keys, option normalizing, pitch folding, `synthTarget`, `clipPlayback`),
  `audio/wav.test.ts` (header, interleaving, mono mix, normalizing, clamping) and
  `audio/synth-adapter.test.ts` (tune time, trim, stretch-then-swap at the same place, debounced
  re-renders, option/pitch re-renders, `fitToSoundfont`). `e2e/synth.test.ts` (mobile and
  desktop, real abcjs and samples in headless Chromium): plays in the mini-player with a duration
  of 2× through at the reel default (77 s for Cooley's), the cached rendering is loud with no gaps,
  75% re-renders in place and runs at 0.75 s a second, loop, the trim editor (waveform, preview,
  save) and a trimmed play stopping at its end; times through, instrument and chords re-render,
  notation draws, options persist; Shuffle plays it (and re-renders at 60%), and comes up on a real
  recording first; offline after one play with thesession.org and the samples cut off (re-rendering
  at 90% from the service worker's cache; a control run with that cache deleted fails); offline
  with nothing cached, the link opens thesession.org.

**M7: Backend (as needed)**
- [ ] Self-hosted sync server; migrate the doc off the public relay
- [ ] yt-dlp extraction → asset store → offline YouTube clips with waveform
- [ ] Recorder proxy (optional), S3 asset store (optional), auth token

**M8: Later / nice-to-have**
- [ ] Practice stats: streaks, heatmap calendar, per-tune histogram
- [ ] High-quality time-stretch/pitch-shift engine (better slow-down, key transposition)
- [ ] jigripper identification of untitled recordings (it appears to run in the browser)
- [ ] folkfriend deep links
- [x] ABC rendering (abcjs) of thesession settings: "Show notation" in the thesession recording's
      Edit dialog (post-M6). First notes are still shown as text.
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
- **Session state** (superseded by "Decided for seeded Shuffle" below: the session is now in the
  URL) (`shown`, the current card) lives in the route component only, so leaving
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

**Decided in the fixes after M6 review (2026-10-22)**

- **thesession key and first notes live on the recording** (decided with the user). Picking a
  setting (title-search autofill, the clip's Edit…, or a promoted set's tune) writes its key and
  first notes to the thesession clip (`thesession:tune:{id}`, re-added if it was removed), never
  to the piece. With one setting only the clip's blanks are filled; picking one replaces the
  clip's values, clearing what the new setting lacks. The M3 rule "fills only blank key and first
  notes" now applies to the clip.
- **Effective key and first notes** (§5): own value → first clip in order with one → (key only,
  Parts only) the Tune's effective key. The Part's own recordings come before its Tune because
  they're how this Part is actually played; first notes still never come from the Tune (M5). The
  index exposes `keyOf`/`firstNotesOf` (value plus origin: own, clip or tune) and
  `inheritedKey`/`inheritedFirstNotes` (what clearing the own value goes back to). The filter's key
  list now offers effective keys, superseding M5's "only keys pieces have themselves".
- **Existing data isn't migrated.** Pieces whose key and first notes the old autofill wrote keep
  them as their own values. The edit modal offers "Use <recording>'s key" / "Use <recording>'s
  first notes" to drop the copy and inherit instead.
- **Changing a thesession link's tune** goes through the same search and duplicate/merge steps as
  the title search, so it relinks the *piece* (the tune id is its identity); the old link's clip
  and setting id go, as in M3. The clip Edit dialog follows the link to its new clip id.
- **Correcting a link** (`relinkClip`) finds or creates the Source for the new URL, as adding one
  does, and moves the clip onto it; the old Source stays (§14 M4). The clip keeps its title, key,
  notes and trim, unless the new link carries a start (`t=`), which replaces the start. Files
  (upload, Drive, Recorder) and the tune and set links can't be relinked this way.
- **Trim transport:** the trim editor loads the clip into the global player (paused) and calls
  `player.editTrim()`, which drops the clip bounds so the whole recording plays; "Preview (loop)"
  uses the existing `preview(start, end)` (now optionally without restarting while a flag moves);
  closing pauses and `endPreview()` restores the clip's bounds and loop. The flags are two native
  range inputs over the lane (like M6's skill range), so they stay keyboard-operable; a "Playhead"
  slider is the keyboard path for scrubbing. wavesurfer.js was dropped: the editor decodes the
  file with `OfflineAudioContext` and draws peaks on a canvas, which made its own transport much
  simpler than bending wavesurfer's media element onto the global player.
- **Open link** is a real `<a target="_blank">` menu item (popup blockers allow it). Its target
  (`openLinkOf`, in `domain/providers.ts`): the Drive file's web view for anything kept in Drive,
  else the source's http(s) URL. A local-only upload offers Download file (from the audio cache).
- **Menus** use `position: fixed` with measured placement (`ui/menu.ts`, unit-tested), not the
  Popover API, which would also work but adds nothing here.
- **Google Drive settings** are stored in `localStorage` (`tunejournal.gdrive.config`), field by
  field over the build's `PUBLIC_GOOGLE_*` values; blank fields fall back to the build's.
  Changing the client ID forgets the old connection (its tokens belong to the other client).
  "Test connection" gets a token and lists the app's folder, which checks the client ID, the
  origin and the Drive API; the API key and project number are only used by the Picker, so they're
  checked when a file is picked. The form warns about likely typos (client ID suffix, a non-numeric
  project number) without blocking.
- **Error page:** `src/hooks.client.ts` returns the thrown error's own message for unexpected
  errors (there's no server to hide details from); `+error.svelte` shows it, with "Back to list".

**Decided for synthesized playback (2026-10-22)**

- **Which recordings synthesize:** a `thesession:tune:{id}` clip on a piece whose
  `external.thesession` has that tune id and a `settingId` (`synthTarget`). Set links, links to
  another tune, and tunes with no chosen setting keep opening thesession.org. It plays in the app
  when the tune is in the integration cache or we're online to fetch it (`clipPlayback`); offline
  and never loaded, it links out. The key shown is the clip's, i.e. the setting's (§5).
- **Not a real recording:** "♪ Synth" marks it on the clip row, the mini-player and Shuffle. It
  doesn't count for "has recordings" or fold the import panel (§14 M4), Split doesn't offer it, and
  it has no "Keep offline" (it can always be rendered again). Shuffle comes up on the first *real*
  recording, and offers the synth ("♪ thesession.org (synth)") in its picker or alone.
- **abcjs 6.7**, loaded with `import()` on first use (a separate ~500 KB chunk, precached like
  every immutable chunk). We parse with `parseOnly`, build the sequence with `setUpAudio` (melody
  program, `chordsOff`, `midiTranspose`), fit it to our samples, and render with `CreateSynth`
  (`init({ sequence, millisecondsPerMeasure })` + `prime`). Each note fades out over its last
  20 ms (`fadeLength: 20, noteEnd: 20`) so it's silent by its written end, as abcjs 5 (which
  thesession.org uses) cut notes; abcjs 6's default 200 ms fade *after* the end, plus
  `programOffsets` starting notes early, left 2–3 sustained fiddle/accordion notes sounding at
  once at reel tempo (fixed 2026-10-23, cache version v2). abcjs is given a stand-in AudioContext
  that decodes through an `OfflineAudioContext` at 32 kHz and makes plain `AudioBuffer`s, so no
  real AudioContext is needed: no autoplay-policy wait (Shuffle renders a card before any tap) and
  the sample rate is ours. The buffer is mixed to mono, normalized to a 0.89 peak and encoded as
  16-bit WAV (`encodeWav`): about 64 KB a second, ~5 MB for a reel twice through. abcjs keeps
  failed sample loads as rejected promises, so a failed render clears its sample cache.
- **The tune's ABC:** thesession's body gets a header: `X`, `T` (tune name), `R` (type), `M` from
  the type, `L:1/8`, `Q:` unless the body has its own, `K:` from the setting's key; `!` becomes a
  line break. The body is repeated for the times through, on new lines; abcjs expands its own
  repeats and endings each time. A body that changes key, meter or note length part-way gets the
  header's restated before each repeat.
- **Default tempos** (moderate session tempos, a bit steady for learning; the speed control goes
  from there), as `Q:` values: reel 1/2=100, jig 3/8=110, slip jig 3/8=115, hornpipe 1/2=80,
  polka 1/4=130, slide 3/8=130, waltz 1/4=120, barndance 1/2=85, strathspey 1/4=120, mazurka
  1/4=120, three-two 1/2=90, anything else 4/4 at 1/4=120. Meters: reel, hornpipe, barndance,
  strathspey 4/4; jig 6/8; slip jig 9/8; slide 12/8; polka 2/4; waltz, mazurka 3/4; three-two 3/2.
- **Speed re-renders** (`SynthAdapter`): rendering at the target tempo sounds far better than
  stretching synthesized notes. Renders are keyed to the rate rounded to 1% and start 300 ms after
  the speed settles (±5% taps). Until the new one is ready (a fraction of a second; instant when
  cached) the current one plays at the corrected rate with pitch preserved, then the new one
  swaps in at the same place in the tune, still playing. The adapter reports *tune time* (media
  time × rendered tempo) and converts bounds and seeks back, so the player, the speed UI, loop and
  trims are the same as for audio, and a clip's trim is stored in tune seconds at 100%. The trim
  editor draws the 100% rendering. The player re-renders in place when the options change or the
  piece's setting changes.
- **Audio cache keys:** `synth:v{SYNTH_VERSION}:s{settingId}:{FNV hash of the full ABC}:{instrument}:{chords|
  melody}[:t{semitones}][:hr{lilt},{accent},{attack}]@{tempo}` (the `h` part from §14 "Synth
  humanization"), so an edited setting, other times through or options never reuse
  a stale rendering. After each render we keep the 3 newest renderings of that tune and options
  and 24 synth renderings in all (they're regenerable); "Remove downloaded recordings" drops them
  too.
- **Options** were device-local (`localStorage`, `tunejournal.synth`) until 2026-10-23; they're
  now per-tag playback profiles in the synced library (§14 "Tag playback profiles"). Defaults:
  fiddle, 2 times through, chords off (few thesession settings have chord symbols, and the piano's
  oom-pah can mask the tune). No metronome: abcjs' drum track needs percussion samples we don't
  ship, so it's left for later.
- **Soundfont:** a subset of FluidR3_GM (CC BY 3.0) from gleitz/midi-js-soundfonts, in abcjs'
  per-note MP3 layout, self-hosted in `static/soundfont/` (README there): violin G3–E6, flute
  C4–A6, whistle C5–D7 (played an octave above written pitch, as tin whistle music is written),
  accordion F3–E6, piano C2–E6 (also chords and bass): 184 files, 4.4 MB on the server. Notes
  outside a range are folded in by octaves (`fitToSoundfont`), so no sample is ever missing, and a
  setting's own `%%MIDI program` is overridden. Per-instrument onset offsets (90 ms for the
  slow-bowing violin, ~30 ms for the MP3 lead-in elsewhere) put notes on the beat. The **service
  worker doesn't precache** the samples (that would download 4.4 MB on every app update): it caches
  each `/soundfont/` file the first time it's fetched, cache-first, in `tunejournal-soundfont-v1`,
  which survives app updates. A device downloads only the notes its tunes use (~25 KB each, a few
  hundred KB per instrument).
- **Offline story:** after one play online, a synthesized tune plays offline at any speed or
  option already rendered (OPFS), and renders anew at other speeds from the cached ABC and samples.
  An instrument never heard on this device can't render offline; the error says to play it once
  online. Offline with the tune never loaded, the link opens thesession.org (which also fails, as
  any link does offline).
- **Notation** ("Show notation" in the thesession recording's Edit dialog) draws the setting once
  through with `renderAbc`, and highlights the note being played from abcjs' `setTiming` events at
  the 100% tempo, using tune time modulo one time through. The first-notes text stays text.
- **Transposition** is wired but not offered: `setPitchShift(semitones)` on the synth adapter
  re-renders with `midiTranspose` (a cache-key part). A UI belongs with the M8 key-transposition
  work, which would also cover audio.
- **e2e:** `mockTheSession` now routes on the browser context. Context routes still answer when
  the context is offline, so offline tests also abort thesession.org (and the samples) explicitly.

**Decided for the thesession pickers (2026-10-23)**

- **Views, not dropdowns:** the pickers (§6.3) are a `<dialog>` of their own, opened modally over
  the edit modal or the recording's Edit, which gets `visibility: hidden` meanwhile (its backdrop
  goes with it, so the picker has its own). The native top layer handles stacking, focus trapping
  and Escape (only the top dialog closes); closing refocuses the opener explicitly, since the
  browser's own focus restore runs while the dialog underneath is still hidden. One component
  (`TheSessionPicker`) holds both steps, so ‹ can go back from the settings to the results.
- **No history entry for the picker:** on Android, Chrome sends the back gesture to the open modal
  dialog's close watcher, which closes it like Escape, so a `pushState` per picker would only add
  a second, out-of-step way to close it. The edit modal works the same way.
- **The flow is unchanged:** picking a tune still links it at once (title confirm, duplicate
  offer), then the setting step; closing at the setting step is *Skip*. Picking another tune
  after ‹ relinks, as before.
- **Previews are their own player** (`audio/preview.svelte.ts`): a `SynthAdapter` on its own
  `<audio>`, rendering through `synth.render`, so it shares the playback profiles, the renderer
  and the OPFS synth cache (a setting heard at 100% plays at once once chosen) but never touches
  the library, the clips or the mini-player. It has its own speed (starting at 100%, kept while the
  app is open, not persisted), since previews are for picking, not practice.
- **Tune previews** play the tune's first setting: one `/tunes/{id}` request, cached, which the
  setting step needs anyway. Search results carry no settings, so a tune that has never been
  loaded shows only its type, meter and alias until then.
- **Incipits** are the first two bars (`firstBars`, as for first notes) with the type's meter and
  the setting's key, drawn by abcjs when the row scrolls into view.
- **Following notation (2026-10-23):** re-render a small slice at window changes rather than
  clip a moving window over the whole tune: abcjs lays a full tune out in wrapped lines at its own
  widths, so a clipped window would jump between lines and scales. The map (`ui/follow.ts`) comes
  from `setUpAudio` on the very ABC the synth renders (times through included): each note has its
  start (whole notes × the 100% tempo = tune seconds, so speed changes need nothing) and its
  `startChar`, which places it between two of the parsed bar lines. Measures in played order are
  grouped greedily into windows of ≥1.9 bars by duration, so a pickup rides with the two bars
  after it and a short last bar takes the pickup back. A window's ABC is the header's `M/L/K` plus
  its measures' text with their bar lines (an opener restated after a jump, `:|2` → `|2`; ending
  numbers dropped from a closer). It's drawn (abcjs, ~ms) only when the window changes, over the
  static incipit, which stays in place invisible to hold the row's height; the window's SVG is
  fitted into that box. The note highlight reads the audio's time every frame while playing and
  finds the note's element through the slice's own `setTiming`.
- **Preview bar in the footer**, not on the row: it stays put while the list scrolls, works the
  same for tune results (no notation), and the row only changes its notation. The scrubber is a
  shared `Scrubber` component (player bar, Shuffle, previews). e2e ports can be moved with
  `E2E_PORT` / `E2E_SYNC_PORT` (`e2e/ports.ts`) to run two suites side by side.

**Decided for synth humanization (2026-10-23)**

- **Ours, not abcjs':** a pure pass (`domain/humanize.ts`) over the flat note events from
  `setUpAudio` (start and duration in whole notes, velocity), before rendering, plus an attack
  shaper over the rendered buffer. abcjs' own `swing` only works with a `visualObj`, only delays
  isolated off-beats, and has no accent or attack. abcjs already varies velocity a little (105 on
  the downbeat, 95 on other crotchet beats, 85 between); ours scales on top of that.
- **The grid is the quaver**, in groups of 2 in simple meters (`x/4`, `x/2`: reels, hornpipes,
  barndances, strathspeys, polkas, waltzes, three-twos) and 3 in compound ones (`6/8`, `9/8`,
  `12/8`, `3/8`: jigs, slip jigs, slides). Strong positions are the first of each group, counting
  from 1 in the bar: 1 mod 2 (quavers 1, 3, 5, 7 of a reel bar, i.e. every crotchet beat) or
  1 mod 3 (1, 4, 7, 10). Always these: no style setting moves them (2026-10-23, below). We read "the 1st and 3rd beat" as the first two strong quavers of that
  rule rather than as crotchets 1 and 3, since the lilt is a quaver-pair thing and abcjs' velocity
  already marks the bar's first beat. Other meters (5/8, 7/8, x/16) aren't humanized. The meter is
  the parsed tune's (`getMeterFraction`), which is the thesession type's (§14 synthesized playback).
- **Bars come from abcjs' sequencer** (`abcjs.synth.sequence`, first voice, repeats expanded) by
  summing note durations up to each bar line, rather than from start times modulo the bar, since
  a pickup, a shortened last bar and repeats make the modulo drift. Full and long bars count from
  their start. A short bar counts back from its end (a pickup) when it starts a time through (the
  request carries `timesThrough`) or completes the short bar before it (Cooley's `|:D2|…E2:|`);
  any other short bar counts from its start, as abcjs' own accents do. A pickup group missing its
  first quaver isn't lilted.
- **Lilt** is a ratio (since 2026-10-23): the strong quaver's length against each of the others
  in its group, 0.5–2 (1 = even; below 1 the strong quaver is the short one). With `n` quavers
  after the first (1 in a reel's pair, 2 in a jig's three), the first becomes
  `r(1 + n)/(r + n)` quavers and the others share the rest equally, by a piecewise-linear time
  warp per group, so group boundaries, bar lines, the tune's length, trims (in tune time) and the
  notation's bar timing never move. A short group uses the same formula with the `n` it has. Every
  note's start and end go through it, so triplets, grace notes, crotchets across groups and the
  chord/bass tracks all stay consistent and in order. The slider has 23 notches, roughly even on a
  log scale and symmetric about 1 (1.05, 1.1, 1.15, 1.2, 1.25, 1.33, 1.4, 1.5, 1.6, 1.75, 2 and
  their reciprocals), shown as "1.5:1", "Even" or "1:1.5". The notation highlight still uses
  abcjs' even timing, so an off-beat note's highlight leads its sound a little (50 ms in a reel at
  2:1).
- **Accent** multiplies velocity: strong ×(1 + k), others ×(1 − k/(group − 1)), k = accent/100 ×
  0.5, so the average stays about the same; rounded and clamped to 1–127 (abcjs keys sounds by
  integer velocity; `place-note` maps velocity linearly to gain, v/96). Grace notes keep abcjs'
  own velocity (⅔ of their main note's); off-grid notes (triplet middles) are left alone.
- **Grace notes (fixed 2026-10-23):** abcjs' flattener plays graces *inside* their main note's
  time: `writeGraceNotes` puts them at the main note's written start (style `'grace'`, velocity
  ⅔), together taking half its length, and the main note then starts halfway through
  (`p.duration /= 2; p.start += p.duration`). So `{g}A2` on a beat became a grace on the beat and
  an A on the off-beat quaver, which counted as weak and got softened, and `{ag}f` put f off the
  grid. Now a note that starts where a run of graces (just before it in the track) ends takes its
  stress from where the run starts, its written position: the main note gets the strong or weak
  accent and the attack onset (at its own, warped, start), the graces are never accented, and both
  still go through the lilt warp. Unit tests use abcjs' real sequence for such a tune.
- **Attack**: abcjs can't change a sample's attack, so after rendering, each strong onset (after
  the warp, in seconds; a graced note's own start, not its graces') gets a 50 ms gain envelope on the mixed buffer, `1 + b(1 − x)²`, with
  b = 2 × attack/100 above 0 (×3 at the onset at 100) or attack/100 below (a fade in from silence
  at −100), cut short at the next strong onset. Clipping isn't an issue: the buffer is float, and
  the WAV is normalized to the 0.89 peak afterwards.
- **No style setting (2026-10-23):** the first version had an Old-time style that moved accent
  and attack to the last quaver of each group. It's gone: old-time is a profile with a negative
  accent, which softens the strong quavers and so makes the others relatively stronger, and
  nothing inverts a slider silently.
- **Settings** come from the piece's tag playback profile (§14 "Tag playback profiles"). As
  written (lilt 1, accent 0, attack 0) the renderer skips humanization entirely, so the rendering
  is byte-identical to the plain one and its cache key has no humanize part. Otherwise the key part
  is `hr{lilt},{accent},{attack}` (e.g. `hr1.5,-20,0`); the `hr` sets these apart from the first
  version's `h20,20,15` keys, whose lilt scale and grace handling differ. Sliders commit 400 ms
  after the last movement or on release.

**Decided for tag playback profiles (2026-10-23)**

- **Per tag, not per device or per recording:** synth settings (instrument, times through,
  chords, lilt, accent, attack) live in ordered profiles keyed by tag. A piece plays with the
  first profile, in the profiles' order, whose tag it has; the order of the piece's own tags plays
  no part. Tags compare with `tagKey` (case- and whitespace-insensitive), as everywhere else. A Part
  also has its Tune's tags (the Tune it inherits skill and key from, `inheritsFrom`); only Parts
  inherit. No match: the **Default** profile, which always exists, is shown last, and can't be
  removed or added as a tag. thesession links add the type tag (`typeTag`: "Reel", "Jig", "Slip
  Jig"…), so those profiles match on their own.
- **Seeded** in this order, for new libraries and by the schema 2 migration: Old Time (lilt 1.5,
  accent −20, attack 0), Reel (Even, +30, +10), Jig (1.1, +30, +10), then Default (as written).
  Old Time comes first so tagging a reel "Old Time" makes it old-time. All on fiddle, twice
  through, no chords.
- **Stored in the synced Library doc** (`settings.playback`, §5): they're keyed by tags, which
  are library data, so they follow the user across devices. Profiles are a map keyed by
  `tagKey(tag)` (concurrent adds of one tag merge into one profile) with a fractional-index
  `order`; every setting is its own field (concurrent edits to different settings merge); the
  Default is its own object. Removing a profile deletes its entry (Undo puts a copy back).
- **Migration:** `SCHEMA_VERSION` 2. `migrate` seeds the profiles when `settings.playback` is
  missing. The old per-device options (`localStorage` `tunejournal.synth`) are read once, when
  this device runs that migration, and their instrument, times through and chords go into every
  seeded profile (so a whistle player stays on whistle). If the doc already has profiles (another
  device migrated and synced first), they win and the old options are ignored. Either way the
  key is then deleted and never read again; the old humanize values aren't carried over.
- **Per recording, only the instrument:** `clip.instrument` on the synthesized thesession clip,
  absent for "From profile (Fiddle)". The Edit recording dialog shows "Playback: Reel profile"
  with a link to that profile in Settings (`/settings?profile=reel#synth`).
- **Everything that renders resolves the profile when it renders:** the mini-player and Shuffle
  (through the player), the trim editor's waveform, and the picker previews. The player re-renders
  a loaded synth clip in place when its setting or resolved options change (any library change,
  e.g. a profile edited in Settings or a tag added). In the picker, the chosen tune's type tag
  counts as one of the edited piece's tags, so a reel previews with the Reel profile unless the
  piece's own tags match an earlier one. The cache key is still built from the resolved options.
- **UI:** the chips reuse `TagInput` (same search and suggestions as a piece's tags) with a
  select button on each chip and a fixed Default chip. Priority changes with ‹ Earlier / Later ›
  buttons on the selected profile rather than dragging chips: chips wrap, and buttons work the
  same with touch and keyboard. Undo is the toast's, for removal only; there's no undo history
  for slider edits.

**Decided for seeded Shuffle (2026-10-23)**

- **The order is Gumbel-top-k** (`shuffleOrder` in `domain/shuffle.ts`), replacing the one-at-a-time
  sampler (`pickNext` and the mulberry32 `seededRng` are gone). Key = logit + Gumbel noise,
  sorted descending: the same distribution as sequential softmax sampling without replacement
  (unit-tested over 20 000 seeds for first and second place). Temperatures keep their meaning,
  `null` = ∞ contributes nothing, and all ∞ is a uniform permutation. Comparison is on the
  difference of logits plus the difference of noise, so huge logits from tiny temperatures still
  compare by noise rather than rounding it away; infinite logits (T = 0) come first and tie
  among themselves (an equal share, as `weights` says); ties then fall to the noise and finally
  the piece id, so the sort is total and deterministic with no NaN.
- **Per-piece uniforms from a hash, not an RNG stream:** `u = pieceUniform(seed, id)` takes the
  top 52 bits of cyrb53(`seed` NUL `id`) and centres them in their bucket, so `u` is in
  [2^-53, 1 - 2^-53], never 0 or 1. Adding, removing or filtering out a piece leaves everyone
  else's relative order alone.
- **As of the start:** features (staleness, practice count) and the list's "practiced within"
  filter use practice logged up to `at` (`index.stats(piece, asOf)`, `matchesFilter(…, asOf)`),
  so practising during the session (including a Set, which refreshes its tunes) doesn't reorder
  anything.
- **Route:** `/shuffle?seed=<8 base-36 chars>&at=<epoch ms>&i=<0-based index>`. Missing or
  malformed seed/at on entry starts a fresh session and writes it in; a missing or bad `i` is 0.
  Next/Skip/Practiced and Reshuffle update the URL with a shallow, replacing `goto`, so Back from
  Shuffle leaves it. An `i` past the end shows the "been through everything" state.
- **Kept order:** skill and favorite edits made during a session (the card's own skill slider,
  say) would change a rebuilt order, so the order as first built is kept for the tab, in memory
  and in `sessionStorage` (`tunejournal.shuffle`, keyed by seed, start and a settings
  fingerprint). Reloading or going to details and back reuses it. A new tab, a shared URL or
  unavailable storage rebuilds from the URL: then the piece at index `i` can differ if pieces were
  added, deleted, or had their skill, favorite or kind changed since the session started.
  Pieces deleted or merged away mid-session are stepped over; pieces added mid-session wait for
  the next shuffle.
- **What starts a new shuffle** (new seed and start, index 0): the ⤮ Reshuffle button (in the
  header while a card is up, and on the end screen), any change to the temperatures, kinds,
  skill range or "respect list filter" (or, when that's on, the list's filter but not its sort),
  from this device or synced in. An empty session reshuffles as soon as something matches.
- **Details and back:** "Open details" remembers the Shuffle URL; that piece's detail view then
  shows "← Shuffle" (on both widths), which goes back in history to the same card. Any other
  navigation forgets it, so it's only offered on the piece you came from.
- **Per-card state:** the piece's own skill when its card came up (to tell whether the slider
  moved, for `skillAfter`) is kept with the order, so it survives a reload in the same tab; it's
  lost only when the order is rebuilt from the URL (then a Practiced after a slider move made
  before the reload doesn't record `skillAfter`). Nothing else is per card.

**Still open**

None right now. Add questions here as they come up.
