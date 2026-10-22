<script lang="ts">
	import type { TagUsage } from '#lib/domain/derived.ts';
	import { tagKey } from '#lib/domain/ops.ts';

	let {
		tags,
		suggestions,
		onadd,
		onremove,
		id = 'tags',
		label = 'Tags'
	}: {
		tags: string[];
		/** Library tags, most used first. */
		suggestions: TagUsage[];
		onadd: (tag: string) => void;
		onremove: (tag: string) => void;
		id?: string;
		label?: string;
	} = $props();

	const MAX_OPTIONS = 8;

	let text = $state('');
	let open = $state(false);
	let active = $state(-1);
	let input: HTMLInputElement;

	type Option = { kind: 'existing'; tag: string; count: number } | { kind: 'create'; tag: string };

	const options = $derived.by((): Option[] => {
		const typed = text.trim().replace(/\s+/g, ' ');
		const key = tagKey(typed);
		const have = new Set(tags.map(tagKey));
		const matches: Option[] = suggestions
			.filter((s) => !have.has(tagKey(s.tag)) && tagKey(s.tag).includes(key))
			.slice(0, MAX_OPTIONS)
			.map((s) => ({ kind: 'existing', tag: s.tag, count: s.count }));
		const known = have.has(key) || suggestions.some((s) => tagKey(s.tag) === key);
		if (key && !known) matches.push({ kind: 'create', tag: typed });
		return matches;
	});

	const listId = $derived(`${id}-options`);
	const expanded = $derived(open && options.length > 0);

	function accept(option: Option | undefined) {
		const tag = option?.tag ?? text.trim();
		if (tag) onadd(tag);
		text = '';
		active = -1;
	}

	function keydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			if (e.key === 'Enter' && !text.trim() && active < 0) return;
			e.preventDefault();
			accept(options[active]);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			active = Math.min(active + 1, options.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Escape' && expanded) {
			// Don't let Escape also close a surrounding dialog.
			e.preventDefault();
			e.stopPropagation();
			open = false;
		} else if (e.key === 'Backspace' && text === '' && tags.length > 0) {
			onremove(tags[tags.length - 1]);
		}
	}

	function oninput() {
		open = true;
		// Android keyboards often report a typed comma only as input, not as a keydown.
		const comma = text.indexOf(',');
		if (comma >= 0) {
			text = text.slice(0, comma);
			if (text.trim()) accept(options[0]);
			else text = '';
			return;
		}
		active = text.trim() ? 0 : -1;
	}
</script>

<div class="tag-input">
	<label for={id}>{label}</label>
	<div class="box">
		{#if tags.length > 0}
			<ul class="chips" aria-label="Current {label.toLowerCase()}">
				{#each tags as tag (tag)}
					<li class="chip">
						{tag}
						<button
							type="button"
							class="remove"
							aria-label="Remove tag {tag}"
							onclick={() => {
								onremove(tag);
								input.focus();
							}}>×</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<input
			bind:this={input}
			bind:value={text}
			{id}
			type="text"
			role="combobox"
			autocomplete="off"
			autocapitalize="off"
			enterkeyhint="done"
			placeholder="Add a tag…"
			aria-autocomplete="list"
			aria-expanded={expanded}
			aria-controls={listId}
			aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
			onkeydown={keydown}
			{oninput}
			onfocus={() => (open = true)}
			onblur={() => (open = false)}
		/>
	</div>
	{#if expanded}
		<ul class="options" id={listId} role="listbox" aria-label="Tag suggestions">
			{#each options as option, i (option.kind + option.tag)}
				<!-- Options are reached with the arrow keys from the combobox, which keeps focus. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{listId}-{i}"
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					onpointerdown={(e) => e.preventDefault()}
					onclick={() => accept(option)}
				>
					{#if option.kind === 'create'}
						Create “{option.tag}”
					{:else}
						<span>{option.tag}</span><span class="count">{option.count}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.tag-input {
		position: relative;
		display: grid;
		gap: var(--space-1);
	}

	label {
		font-weight: 600;
	}

	.box {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius) * 0.75);
	}

	.box:focus-within {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.chips {
		display: contents;
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
		font-size: 1.1rem;
		line-height: 1;
	}

	input {
		flex: 1;
		min-width: 8rem;
		border: none;
		background: transparent;
	}

	input:focus-visible {
		outline: none;
	}

	.options {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 30;
		margin: 4px 0 0;
		padding: var(--space-1);
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		max-height: 16rem;
		overflow-y: auto;
	}

	.options li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-2);
		border-radius: calc(var(--radius) * 0.6);
		cursor: pointer;
	}

	.options li.active,
	.options li:hover {
		background: var(--color-accent-soft);
	}

	.count {
		color: var(--color-muted);
		font-size: 0.875rem;
	}
</style>
