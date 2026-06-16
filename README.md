# Health Records Prototype

Created: 2026-04-26

This is now a local-first app shell for the shared health-records platform.

Included views:

- Personal Health Record Vault mode
- Pet Health Vault pilot mode
- request cadence dashboard
- local vault overview
- packet builder
- searchable record rail
- SQLite-backed local state
- direct file import into the local vault
- inbound-folder scan intake
- request workflow actions that persist in the local runtime

## Run

```bash
npm run dev
```

This starts:

- frontend on `http://127.0.0.1:4178`
- local app shell API on `http://127.0.0.1:4179`

## Build

```bash
npm run build
```

## Serve Built App Shell

```bash
npm start
```

This serves the built frontend and API from the same local app shell on port `4179`.

## Run As Desktop App

```bash
npm run desktop
```

## Package Desktop App

```bash
npm run package:desktop
```

Output lands in `release/`.

## Notes

- The local runtime uses Node's built-in SQLite module and stores state in `runtime/db`.
- Direct uploads land in `runtime/imports/originals` and are normalized into `runtime/vault`.
- Inbound scan intake watches `runtime/inbound` and archives processed files into `runtime/inbound/archive`.
- PDF and text extraction are supported in this alpha. Image files can be stored, but OCR is not implemented yet.
- Request actions currently track and log outbound work; they do not yet send real portal, email, or fax requests.
- Packet export now writes a local packet folder with `manifest.json`, `summary.txt`, and copied source documents.
- Inbound scanning is intentionally lightweight. It scans inbound folders on an interval and on explicit UI actions.
- The Electron desktop wrapper stores runtime data in the app user-data directory so packaged builds stay writable and local.
