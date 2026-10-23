// The e2e ports: the preview server and the local sync relay. Override them with E2E_PORT and
// E2E_SYNC_PORT to run two suites side by side (e.g. from two workspaces).

export const PORT = Number(process.env.E2E_PORT ?? 4173);
export const SYNC_PORT = Number(process.env.E2E_SYNC_PORT ?? 3031);
