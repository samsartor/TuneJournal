<!--
	Settings → Synthesized playback (PLAN.md §6.6, §14 "Tag playback profiles"): the playback
	profiles, one per tag, as chips in priority order, with an add-a-tag search like a piece's tags.
	A tune plays with the first profile in this order whose tag it has (a Part also has its Tune's
	tags); anything else uses Default, which is always last and can't be removed. Selecting a chip
	edits that profile; Earlier and Later change its priority. Synced, like the rest of the library.
-->
<script lang="ts">
	import {
		DEFAULT_PROFILE_LABEL,
		addProfile,
		defaultProfile,
		moveProfile,
		playbackOf,
		removeProfile,
		restoreProfile,
		seededFeel,
		sortedProfiles,
		updateProfile
	} from '#lib/domain/playback.ts';
	import { tagKey } from '#lib/domain/ops.ts';
	import type { PlaybackProfileSettings } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import SynthOptions from './SynthOptions.svelte';
	import TagInput from './TagInput.svelte';
	import { ui } from './state.svelte.ts';

	let {
		initial
	}: {
		/** The profile to show first (its tag key), e.g. from the recording dialog's link. */
		initial?: string;
	} = $props();

	const doc = $derived(library.doc);
	const profiles = $derived(doc ? sortedProfiles(playbackOf(doc)) : []);
	const fallback = $derived(doc ? defaultProfile(playbackOf(doc)) : undefined);
	/** The selected profile's key; undefined = Default. */
	// svelte-ignore state_referenced_locally
	let selectedKey = $state<string | undefined>(initial);
	const selected = $derived(
		profiles.find((p) => p.key === selectedKey) ?? (selectedKey ? undefined : fallback)
	);
	// A profile removed (here or on another device) leaves Default selected.
	$effect(() => {
		if (selectedKey !== undefined && !profiles.some((p) => p.key === selectedKey))
			selectedKey = undefined;
	});
	const position = $derived(profiles.findIndex((p) => p.key === selectedKey));

	function select(tag: string) {
		const key = tagKey(tag);
		selectedKey = key === tagKey(DEFAULT_PROFILE_LABEL) ? undefined : key;
	}

	function add(tag: string) {
		const key = library.change((d) => addProfile(d, tag));
		if (key) selectedKey = key;
		else select(tag);
	}

	function remove(tag: string) {
		const key = tagKey(tag);
		const removed = library.change((d) => removeProfile(d, key));
		if (!removed) return;
		ui.showToast(`Removed the ${removed.tag} profile`, {
			label: 'Undo',
			run: () => library.change((d) => restoreProfile(d, key, removed))
		});
	}

	function change(patch: Partial<PlaybackProfileSettings>) {
		const key = selectedKey;
		library.change((d) => void updateProfile(d, key, patch));
	}

	function move(delta: number) {
		const key = selectedKey;
		if (key) library.change((d) => void moveProfile(d, key, delta));
	}
</script>

{#if doc && selected}
	<div class="profiles">
		<TagInput
			id="playback-tags"
			label="Profiles"
			placeholder="Add a tag…"
			tags={profiles.map((p) => p.label)}
			fixed={[DEFAULT_PROFILE_LABEL]}
			suggestions={library.index?.tags ?? []}
			selected={selected.label}
			onselect={select}
			onadd={add}
			onremove={remove}
		/>
		<p class="muted small">
			A tune plays with the first profile, in this order, whose tag it has (a part also has its
			tune’s tags). Anything else plays with Default. Tap a profile to change it.
		</p>
		<div class="editing">
			<h3>{selected.key === undefined ? 'Default' : `${selected.label}`} profile</h3>
			{#if selected.key !== undefined}
				<div class="order" role="group" aria-label="Priority">
					<button type="button" class="btn-quiet" disabled={position <= 0} onclick={() => move(-1)}
						>‹ Earlier</button
					>
					<button
						type="button"
						class="btn-quiet"
						disabled={position >= profiles.length - 1}
						onclick={() => move(1)}>Later ›</button
					>
				</div>
			{/if}
		</div>
		{#key selected.key}
			<SynthOptions
				label="{selected.label} profile"
				settings={selected.settings}
				seed={seededFeel(selected.key)}
				onchange={change}
			/>
		{/key}
	</div>
{/if}

<style>
	.profiles {
		display: grid;
		gap: var(--space-2);
	}

	p {
		margin: 0;
	}

	.small {
		font-size: 0.875rem;
	}

	.editing {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	h3 {
		margin: 0;
		font-size: 1rem;
	}

	.order {
		display: flex;
		gap: var(--space-1);
	}
</style>
