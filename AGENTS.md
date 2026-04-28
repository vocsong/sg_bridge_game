# Floating Bridge

## Repo Map
- `src/` is the Cloudflare Workers/TypeScript app.
- `static/` is the vanilla JS frontend.

## Commands
- `npm run dev` starts Wrangler dev for the Worker, Durable Object, and static assets.
- `npm run deploy` deploys to Cloudflare Workers.
- `npm test` runs Vitest.
- `npm run typecheck` runs `tsc --noEmit`.

## Workflow
- Use `README.md`, `package.json`, `requirements.txt`, and the existing scripts as the source of truth for commands.

## GitNexus
- Run `gitnexus_impact` before editing any function, class, or method.
- Warn the user before proceeding if impact analysis returns HIGH or CRITICAL risk.
- Run `gitnexus_detect_changes()` before committing.
- Use `gitnexus_rename` for renames; do not use search-and-replace.
- If GitNexus reports a stale index, run `npx gitnexus analyze`.
