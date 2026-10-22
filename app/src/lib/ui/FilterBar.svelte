<script lang="ts">
	import { activeFilterCount, type LibraryIndex } from '#lib/domain/derived.ts';
	import { KINDS, KIND_PLURAL, SKILL_LABEL, SORT_LABEL } from '#lib/domain/format.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { setListSettings, tagKey } from '#lib/domain/ops.ts';
	import type { ListSettings, PieceKind, Skill, SortField } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';

	let { settings, index }: { settings: ListSettings; index: LibraryIndex } = $props();

	const OPEN_KEY = 'tunejournal.filtersOpen';

	let open = $state(readOpen());

	function readOpen() {
		try {
			return localStorage.getItem(OPEN_KEY) === '1';
		} catch {
			return false;
		}
	}

	function toggle() {
		open = !open;
		try {
			localStorage.setItem(OPEN_KEY, open ? '1' : '0');
		} catch {
			// Remembering this is only a convenience.
		}
	}

	function set(patch: Partial<ListSettings>) {
		library.change((d) => setListSettings(d, patch));
	}

	const kindsOn = $derived(KINDS.filter((k) => settings.kinds[k]));
	const selectedTags = $derived(Object.keys(settings.tags ?? {}));
	const tagChoices = $derived(
		index.tags.filter((t) => !selectedTags.some((s) => tagKey(s) === tagKey(t.tag)))
	);
	const filterCount = $derived(activeFilterCount(settings));

	const summary = $derived(
		[
			kindsOn.length === 0 || kindsOn.length === KINDS.length
				? 'All kinds'
				: kindsOn.map((k) => KIND_PLURAL[k]).join(', '),
			`${SORT_LABEL[settings.sort]} ${settings.descending ? '↓' : '↑'}`,
			filterCount > 0 ? `${filterCount} ${filterCount === 1 ? 'filter' : 'filters'}` : ''
		]
			.filter(Boolean)
			.join(' · ')
	);

	function toggleKind(kind: PieceKind) {
		set({ kinds: { ...settings.kinds, [kind]: !settings.kinds[kind] } });
	}

	function addTagFilter(e: Event) {
		const select = e.currentTarget as HTMLSelectElement;
		if (select.value) set({ tags: { ...settings.tags, [select.value]: true } });
		select.value = '';
	}

	function removeTagFilter(tag: string) {
		const tags = { ...settings.tags };
		delete tags[tag];
		set({ tags: Object.keys(tags).length > 0 ? tags : undefined });
	}

	function skillValue(e: Event): Skill | undefined {
		const v = Number((e.currentTarget as HTMLSelectElement).value);
		return v ? (v as Skill) : undefined;
	}

	type PracticedMode = '' | 'within' | 'not';
	const practicedMode = $derived<PracticedMode>(
		settings.practiced ? (settings.practiced.within ? 'within' : 'not') : ''
	);

	function setPracticed(mode: PracticedMode, days = settings.practiced?.days ?? 7) {
		set({ practiced: mode ? { within: mode === 'within', days: Math.max(1, days) } : undefined });
	}

	function clearFilters() {
		set({
			tags: undefined,
			tagMode: undefined,
			skillMin: undefined,
			skillMax: undefined,
			unratedOnly: undefined,
			key: undefined,
			favoritesOnly: undefined,
			practiced: undefined,
			recordings: undefined
		});
	}
</script>

<div class="filter-bar">
	<button
		type="button"
		class="toggle btn-quiet"
		aria-expanded={open}
		aria-controls="filter-panel"
		onclick={toggle}
	>
		<span class="label">Filter &amp; sort</span>
		<span class="summary muted">{summary}</span>
		<span class="chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
	</button>

	{#if open}
		<div class="panel" id="filter-panel">
			<div class="group" role="group" aria-label="Kinds">
				{#each KINDS as kind (kind)}
					<button
						type="button"
						class="pill"
						aria-pressed={settings.kinds[kind]}
						onclick={() => toggleKind(kind)}>{KIND_PLURAL[kind]}</button
					>
				{/each}
			</div>

			<div class="row">
				<label for="sort">Sort by</label>
				<select
					id="sort"
					value={settings.sort}
					onchange={(e) => set({ sort: e.currentTarget.value as SortField })}
				>
					{#each Object.entries(SORT_LABEL) as [field, label] (field)}
						<option value={field}>{label}</option>
					{/each}
				</select>
				<button
					type="button"
					class="btn-quiet dir"
					aria-label={settings.descending ? 'Descending' : 'Ascending'}
					title={settings.descending ? 'Descending' : 'Ascending'}
					onclick={() => set({ descending: !settings.descending })}
					>{settings.descending ? '↓' : '↑'}</button
				>
			</div>

			<label class="check">
				<input
					type="checkbox"
					checked={settings.favoritesOnly ?? false}
					onchange={(e) => set({ favoritesOnly: e.currentTarget.checked || undefined })}
				/>
				Favorites only
			</label>

			<div class="field">
				<div class="row">
					<label for="tag-filter">Tags</label>
					<select id="tag-filter" onchange={addTagFilter} disabled={tagChoices.length === 0}>
						<option value="">{tagChoices.length ? 'Add a tag…' : 'No more tags'}</option>
						{#each tagChoices as t (t.tag)}<option value={t.tag}>{t.tag} ({t.count})</option>{/each}
					</select>
					{#if selectedTags.length > 1}
						<div class="segmented" role="group" aria-label="Tag match">
							<button
								type="button"
								aria-pressed={settings.tagMode !== 'all'}
								onclick={() => set({ tagMode: undefined })}>Any</button
							>
							<button
								type="button"
								aria-pressed={settings.tagMode === 'all'}
								onclick={() => set({ tagMode: 'all' })}>All</button
							>
						</div>
					{/if}
				</div>
				{#if selectedTags.length > 0}
					<ul class="chips" aria-label="Tag filters">
						{#each selectedTags as tag (tag)}
							<li class="chip">
								{tag}
								<button
									type="button"
									class="remove"
									aria-label="Stop filtering by {tag}"
									onclick={() => removeTagFilter(tag)}>×</button
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="row">
				<span class="row-label" id="skill-label">Skill</span>
				<select
					aria-label="Minimum skill"
					value={settings.skillMin ?? 0}
					onchange={(e) => set({ skillMin: skillValue(e) })}
				>
					<option value={0}>Any</option>
					{#each [1, 2, 3, 4, 5] as const as n (n)}<option value={n}>{n} · {SKILL_LABEL[n]}</option
						>{/each}
				</select>
				<span aria-hidden="true">to</span>
				<select
					aria-label="Maximum skill"
					value={settings.skillMax ?? 0}
					onchange={(e) => set({ skillMax: skillValue(e) })}
				>
					<option value={0}>Any</option>
					{#each [1, 2, 3, 4, 5] as const as n (n)}<option value={n}>{n} · {SKILL_LABEL[n]}</option
						>{/each}
				</select>
			</div>
			<label class="check">
				<input
					type="checkbox"
					checked={settings.unratedOnly ?? false}
					onchange={(e) => set({ unratedOnly: e.currentTarget.checked || undefined })}
				/>
				<span>Unrated only <span class="muted">(otherwise unrated counts as 1)</span></span>
			</label>

			<div class="row">
				<label for="key-filter">Key</label>
				<select
					id="key-filter"
					value={settings.key ?? ''}
					onchange={(e) => set({ key: e.currentTarget.value || undefined })}
				>
					<option value="">Any key</option>
					{#each index.keys as key (key)}<option value={key}>{formatKey(key)}</option>{/each}
				</select>
			</div>

			<div class="row">
				<label for="practiced-filter">Practiced</label>
				<select
					id="practiced-filter"
					value={practicedMode}
					onchange={(e) => setPracticed(e.currentTarget.value as PracticedMode)}
				>
					<option value="">Any time</option>
					<option value="within">within the last</option>
					<option value="not">not within the last</option>
				</select>
				{#if settings.practiced}
					<input
						class="days"
						type="number"
						min="1"
						inputmode="numeric"
						aria-label="Days"
						value={settings.practiced.days}
						onchange={(e) => setPracticed(practicedMode, Number(e.currentTarget.value) || 1)}
					/>
					<span>days</span>
				{/if}
			</div>

			<div class="row">
				<label for="recordings-filter">Recordings</label>
				<select
					id="recordings-filter"
					value={settings.recordings ?? ''}
					onchange={(e) =>
						set({
							recordings: (e.currentTarget.value || undefined) as ListSettings['recordings']
						})}
				>
					<option value="">With or without</option>
					<option value="has">Has recordings</option>
					<option value="lacks">No recordings</option>
				</select>
			</div>

			{#if filterCount > 0}
				<button type="button" class="btn-quiet clear" onclick={clearFilters}>Clear filters</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.filter-bar {
		display: grid;
		gap: var(--space-2);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		text-align: left;
	}

	.label {
		font-weight: 600;
		flex: none;
	}

	.summary {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.875rem;
	}

	.panel {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.group {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.pill,
	.segmented button {
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0 var(--space-3);
	}

	.pill[aria-pressed='true'],
	.segmented button[aria-pressed='true'] {
		background: var(--color-accent);
		color: var(--color-on-accent);
		border-color: var(--color-accent);
	}

	.segmented {
		display: inline-flex;
	}

	.segmented button:first-child {
		border-radius: 999px 0 0 999px;
	}

	.segmented button:last-child {
		border-radius: 0 999px 999px 0;
		margin-left: -1px;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.row > label,
	.row-label {
		min-width: 4.5rem;
		font-weight: 600;
	}

	.row select {
		flex: 1;
		min-width: 0;
	}

	.dir {
		width: var(--touch);
		padding: 0;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch);
	}

	.field {
		display: grid;
		gap: var(--space-2);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chip {
		padding-right: 0;
	}

	.remove {
		min-height: 2rem;
		min-width: 2rem;
		padding: 0;
		background: transparent;
		color: var(--color-muted);
	}

	.days {
		width: 5rem;
	}

	.clear {
		justify-self: start;
	}
</style>
