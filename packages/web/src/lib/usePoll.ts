/**
 * Shared polling hook. Each tick fetches `url` via getJson with a fresh
 * AbortController; the in-flight request is aborted on unmount and before every
 * new tick, so a slow/stale response can never overwrite newer state (this is
 * what kills the Blocked re-introduce race and the request pile-up).
 *
 * - `available` starts true and flips false on HTTP 404 (lets the Skills
 *   /api/tools/recent feed degrade quietly before the endpoint ships).
 * - `loaded` becomes true after the first settled attempt.
 * - `lastSuccessAt` is the ISO timestamp of the most recent successful fetch —
 *   the telemetry bar uses it to show real sync state, not a wall clock.
 * - `url === null` disables polling entirely.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { HttpError, getJson } from "./api.js";

export interface PollResult<T> {
	data: T | null;
	loaded: boolean;
	available: boolean;
	lastSuccessAt: string | null;
	refresh: () => void;
}

export function usePoll<T>(url: string | null, intervalMs: number): PollResult<T> {
	const [data, setData] = useState<T | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [available, setAvailable] = useState(true);
	const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);

	const controllerRef = useRef<AbortController | null>(null);
	const mountedRef = useRef(true);

	const run = useCallback(async () => {
		if (!url) return;
		// Abort any request still in flight before issuing a fresh one.
		controllerRef.current?.abort();
		const controller = new AbortController();
		controllerRef.current = controller;
		try {
			const result = await getJson<T>(url, controller.signal);
			if (!mountedRef.current || controller.signal.aborted) return;
			setData(result);
			setAvailable(true);
			setLastSuccessAt(new Date().toISOString());
		} catch (err) {
			if (controller.signal.aborted) return;
			if (!mountedRef.current) return;
			if (err instanceof HttpError && err.status === 404) setAvailable(false);
			// Other errors: keep prior data; `loaded` still settles below.
		} finally {
			if (mountedRef.current && !controller.signal.aborted) setLoaded(true);
		}
	}, [url]);

	useEffect(() => {
		mountedRef.current = true;
		if (!url) {
			setLoaded(true);
			return;
		}
		run();
		const h = setInterval(run, intervalMs);
		return () => {
			mountedRef.current = false;
			clearInterval(h);
			controllerRef.current?.abort();
		};
	}, [url, intervalMs, run]);

	return { data, loaded, available, lastSuccessAt, refresh: run };
}
