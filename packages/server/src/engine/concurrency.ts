/**
 * Map over items with at most `limit` callbacks in flight. Preserves input
 * order in the result. A rejected callback resolves to the provided fallback
 * instead of failing the whole batch — sweep loops must not die because one
 * subject errored.
 */
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
	onError?: (item: T, err: unknown) => R,
): Promise<R[]> {
	// NaN-safe: Math.max(1, NaN) is NaN, and Array.from({length: NaN}) spawns
	// ZERO workers — a non-numeric limit must degrade to serial, not to no-op.
	const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
	const results = new Array<R>(items.length);
	let next = 0;
	async function worker(): Promise<void> {
		while (next < items.length) {
			const i = next++;
			try {
				results[i] = await fn(items[i], i);
			} catch (err) {
				if (onError) results[i] = onError(items[i], err);
				else throw err;
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(max, items.length) }, () => worker()));
	return results;
}
