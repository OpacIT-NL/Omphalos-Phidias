# OpacIT Omphalos Phidias

**Phidias** is the visual automation builder in the **OpacIT Omphalos** suite, hosted by a Node.js server. Create projects, arrange and connect blocks, configure multiple workspaces, and export each project as an independent Node.js application.

Inspired by the block/workspace/export approach of [Discord App Builder](https://github.com/Perfectly-Plural/Discord-App-Builder). This implementation has a browser editor and HTTP API instead of Electron, and general automation triggers instead of Discord. Phidias accepts its native block format plus trusted Discord App Builder-style block modules through a compatibility runtime. Discord client objects are intentionally unavailable; imported general-purpose data, file, network, database, event, and utility blocks run as server automations.

## Start the builder

Requires **Node.js 22.13 or newer** (Node.js 24 recommended). The builder uses Node’s built-in SQLite module and the `argon2` package. There is no frontend build step.

```sh
npm ci
node server.js
```

First launch generates `config.json` beside `server.js` with local defaults. **This file is machine-local: it is not tracked by Git or included in release ZIPs.** Subsequent launches preserve it, and extracting an updated release does not overwrite it. An existing invalid config produces an error rather than being replaced with defaults.

In an interactive terminal, create your first account and save the configuration:

```text
Console$> enable
Console#> conf t
Config#> username admin
Password (hidden):
Confirm password (hidden):
Config#> enable secret
Password (hidden):
Confirm password (hidden):
Config#> exit
Console#> copy run start
```

`username admin` creates the web-login account. `enable secret` sets a separate password for privileged console access. Neither password is echoed, logged, or accepted inline. There is no default enable password; until one is configured, `enable` enters privileged mode directly.

Open `http://127.0.0.1:3000` and sign in with your web account. For remote access, use `host 0.0.0.0` in configuration mode and serve the builder through an **HTTPS reverse proxy**. Set `auth secure-cookies true` for HTTPS; use `false` only for local HTTP development. The builder does not terminate TLS itself.

## Interactive console

`help` or `?` lists commands available in the current mode. `do help` lists enabled-mode commands while in configuration mode.

| Mode | Prompt | Entry / exit |
| --- | --- | --- |
| Disabled | `Console$> ` | Initial mode; `enable` or `en` enters enabled mode, prompting for the enable password if configured |
| Enabled | `Console#> ` | `config terminal`, `configure terminal`, or `conf t` enters configuration mode; `disable`, `dis`, or `exit` returns to disabled mode |
| Configuration | `Config#> ` | `exit` or `end` returns to enabled mode; `disable` or `dis` returns to disabled mode |

Enabled commands:

| Command | Purpose |
| --- | --- |
| `show run` / `show running-config` | Show the current running settings and unsaved-change status; secrets are redacted |
| `show start` / `show startup-config` | Show settings saved in `config.json`; secrets are redacted |
| `show users` | List running accounts and whether their changes are unsaved |
| `show status` | Show the active listening address and unsaved-change status |
| `show version` | Show the application version (also available in disabled mode) |
| `copy run start` | Save running settings to `config.json` and pending account changes to SQLite |
| `shutdown` / `exit server` | Stop the application; asks for confirmation if changes are unsaved |

`copy running-config startup-config` is also accepted. Enabled commands require the `do` prefix in configuration mode, for example `do show users` or `do copy run start`. Ordinary `do show` and `do copy` commands keep configuration mode active; mode-changing commands such as `do disable` still change modes. `exit` alone never shuts down the server.

Configuration commands:

| Command | Purpose / timing |
| --- | --- |
| `host <IPv4-or-IPv6>` | Change the listening address immediately |
| `port <1-65535>` | Change the listening port immediately |
| `log-level <0-4>` | Change console log filtering immediately |
| `file-log-level <0-4>` | Change file log filtering immediately |
| `username <name>` | Create or reset an account using hidden password prompts |
| `user create <name>` | Create a new account; rejects an existing username |
| `user password <name>` | Reset an existing account’s password |
| `user delete <name>` / `no username <name>` | Remove an account from the running configuration |
| `enable secret` / `enable password` | Set the console enable password with hidden prompts |
| `no enable secret` / `no enable password` | Remove the console enable password |
| `auth secure-cookies <true-or-false>` | Change the flag on newly issued cookies immediately |
| `projects-directory <path>` | Change project storage after saving and restarting |
| `auth database <path>` | Change the SQLite database path after saving and restarting |

Quote paths containing spaces, for example `projects-directory "project storage"`. Relative storage paths resolve beside `server.js`, not against the terminal’s working directory. Storage path commands do not move existing files: account saves still target the active database until restart. Move/copy your database while the server is stopped if you intend to keep those accounts at a new path.

Host and port changes reconnect the listener. If binding fails, the server attempts to restore its previous address and leaves the running configuration unchanged. Host, port, storage, and logging settings now come from `config.json`; the builder no longer uses `HOST`, `PORT`, `PROJECTS_DIR`, or `--port` overrides. Exported automation applications use their own independent `config.json`, with optional `PORT` and `HOST` overrides.

Changes affect the running server but **do not survive restart until `copy run start`**. Account password hashes stay in SQLite, not in `config.json`; unsaved account changes and sessions for those accounts are held in memory. Saving persists both settings and accounts. New or reset accounts can log in before saving, and resets/deletions revoke sessions immediately. Restarting without saving restores the previously saved accounts/settings; revoked sessions remain revoked. Browser project saves are independent and still persist using the editor’s Save button.

Console enable passwords use Argon2id hashes in `config.json`. `show run` and `show start` hide those hashes. Three failed enable attempts temporarily block elevation for 30 seconds. Console access requires access to the server terminal and does not use the web account password.

The console accepts both an interactive terminal and line-based redirected stdin from process managers such as CubeCoders AMP. AMP commands therefore use the same prompts and modes as a local terminal. When stdin is unavailable or closes, the console detaches while the web server keeps running. Ctrl+C cancels a local terminal command/password prompt (and leaves configuration mode when at its command prompt); use `shutdown` to stop interactively. Ctrl+D detaches the console without stopping the web server. SIGTERM still shuts down the server; unsaved changes are not automatically saved. Logs redraw the active prompt without exposing password input.

## Startup configuration

Generated defaults:

```json
{
  "port": 3000,
  "host": "127.0.0.1",
  "log-level": 3,
  "file-log-level": 3,
  "projects-directory": "projects",
  "auth": {
    "database": "data/auth.sqlite",
    "secureCookies": false
  },
  "console": {
    "enablePasswordHash": null
  }
}
```

Settings can also be edited while the server is stopped. Missing fields in older configurations receive defaults in memory and are written on the next `copy run start`. Keep the startup configuration, project directory, and authentication database on persistent storage and back them up. Run one builder process against a project directory. All accounts share project access; this is not a service with isolated user workspaces or roles.

## Server logging

Use `log-level <0-4>` in configuration mode to control console filtering and `file-log-level <0-4>` to control file filtering. Both change immediately; save them with `copy run start`. The corresponding `"log-level"` and `"file-log-level"` fields can also be edited in `config.json` while the builder is stopped. Both default to `3`. Older configs without `file-log-level` inherit their existing `log-level`.

| Level | Messages included |
| --- | --- |
| `0` | Critical |
| `1` | Critical, Error |
| `2` | Critical, Error, Warning |
| `3` | Critical, Error, Warning, Info |
| `4` | Critical, Error, Warning, Info, Debug |

Each event is independently filtered for the console and the launch-specific file such as `log/2026-10-01-1.txt` beside `server.js`. The date is the UTC date on which the process started. A second start on the same date creates `2026-10-01-2.txt`, then `-3.txt`, and so on; an existing launch file is never reused. Entries include a UTC timestamp and severity; multiline errors are escaped into one log entry. Enabled console Critical/Error/Warning messages go to stderr, and Info/Debug messages go to stdout. Console prompts and command replies are always shown, independently of log level.

Info records startup, shutdown, sign-in/sign-out, and project create/save/export activity. Warning records rejected requests, Error records unexpected request failures, and Debug records request paths, status codes, and durations. Startup failures and uncaught failures are Critical. Request bodies, query strings, authorization headers, cookies, and passwords are not included in request logs.

The `log/` directory is created automatically and excluded from Git and release ZIPs. Files are not automatically deleted; manage retention on your server. If a file write fails, the original console entry remains available along with a Critical diagnostic. Exported automations use the same severity levels and launch-file naming in their own `log/` directory; their application `log-level` currently controls both destinations.

## Accounts and login

Manage web accounts through the configuration console, then save with `copy run start`. Usernames are case-insensitive, 3–64 characters, and may contain letters, numbers, dots, underscores, and hyphens. Web-account passwords must contain at least 12 characters and be at most 1,024 bytes; spaces are preserved. Console enable passwords have no length or complexity requirements.

There is no default web account or public registration endpoint. Web authentication is always required, even before any accounts exist. All accounts currently share access to every project. Account credentials are salted **Argon2id** hashes (64 MiB memory, 3 iterations, parallelism 1) using [node-argon2](https://github.com/ranisalt/node-argon2). Saved account credentials, hashed session tokens, CSRF tokens, expiration timestamps, and login-rate-limit counters live in SQLite. Passwords and raw session tokens are not persisted.

Sessions use random 256-bit cookies with `HttpOnly`, `SameSite=Strict`, and `Secure` when configured. They expire after eight hours. Saved sessions survive builder restarts; sessions for unsaved accounts remain in memory until `copy run start`. Signing out revokes the current session; resetting or deleting an account revokes its sessions. State-changing authenticated API calls require the session’s `X-CSRF-Token`, and cross-origin writes are rejected.

Sign-in attempts are limited to 10 per username and 20 per connection IP in 15 minutes, with at most two password verifications in flight per builder process. Limits persist across restarts. Behind a reverse proxy the IP limit applies to the proxy connection address; the builder ignores untrusted `X-Forwarded-For` headers. Missing accounts and incorrect passwords return the same login error.

For offline account recovery, `npm run user:create` and `npm run user:reset-password` remain available after the first launch. Run them with the server stopped: they update SQLite directly and do not participate in the running configuration. To recover a forgotten console enable password, stop the server, set `console.enablePasswordHash` to `null` in your local config, restart, and set a new enable secret from the console.

Back up `config.json`, projects, and the authentication database. For a simple file backup, stop the builder and account commands, then copy SQLite’s database and any `-wal`/`-shm` files together. Keep it on local persistent storage supported by SQLite WAL. Deleting the database removes every saved account and session.

## Build an automation

1. Create a project. It starts with `GET /hello` connected to an HTTP response.
2. Click a block in the library or drag it onto the canvas.
3. Click an output port, then a compatible input port. Green ports carry actions and gold ports carry values. Action outputs have one wire; value outputs can feed multiple blocks. Each value input accepts one wire.
4. Select a block to edit its configuration. Hold Ctrl/Cmd or Shift while clicking blocks to toggle them in a multi-selection. Drag the header of any selected block to move the whole group.
5. Press Ctrl/Cmd+C and Ctrl/Cmd+V to copy and paste the selected blocks. Connections are copied when both endpoint blocks are selected, and pasted blocks and connections receive new IDs. Select blocks or a connection and press Delete to remove them.
6. Add workspace categories with **▤** and workspaces with **+**. Choose a category when creating a workspace or move the current workspace from **•••**. All active workspaces run in the exported application.
7. Click **Save project** or press Ctrl/Cmd+S. Changes are saved explicitly, not automatically; closing the page with unsaved changes prompts you.
8. Click **Export application**. This saves edits and downloads a ZIP of the current saved project.

Invalid graphs, unknown blocks, incompatible value types, loops, invalid options, and duplicate active HTTP routes are rejected on save and export. Execution follows action wires; connected value blocks are evaluated when their values are needed. Branching blocks expose separate action outputs. Use timer triggers for recurring work.

## Deploy independently

Extract an exported ZIP into a new directory on your target Node.js server:

```sh
npm install
node app.js
# Or, after npm install:
npm start
```

`npm install` installs Argon2 plus the FTP, SSH, and MySQL clients used by authentication and imported network/database blocks. Visit `http://localhost:3001/hello` for the starter workflow. Use **Application settings** in the builder toolbar to set a project's host, port, and log level before exporting; its ZIP will contain a ready-to-use `config.json`. Without saved application settings, first launch creates `config.json` with port `3001`, host `0.0.0.0`, and log level `3`. `PORT` and `HOST` remain optional process-level overrides. A pre-generated config is included in every later export for that project, so review it before extracting an update over an existing deployment. Stop it with SIGINT or SIGTERM. Run it under your normal process manager or service manager for unattended hosting.

Each server-side project and exported ZIP contains:

```text
projects/<project-id>/
├── app.js             # Standalone runtime
├── workspaces.json    # Project, workspaces, blocks, connections, positions
├── blocks/            # Executable block definitions
├── auth.js            # Browser-session and API-token authentication runtime
├── logger.js          # Console and per-launch file logger
├── legacy.js          # Discord App Builder block compatibility
├── validate.js        # Runtime graph validation
├── package.json
└── README.md
```

Standalone automations create `log/yyyy-mm-dd-N.txt` when `node app.js` starts. `N` begins at `1` each UTC date and increases for every restart that day. Lifecycle messages (listening, stopping, and stopped) are always written to stdout so process managers such as AMP can show application state; their file copies still follow the configured level. Workflow errors, HTTP request diagnostics, **Write to log**, and console output from blocks use the automation's configured log level. Level meanings are the same as the builder table above.

You can also copy the entire project folder directly. The builder never starts project workflows on its own server. Edits to a builder project do not update an already deployed copy: export and deploy again, run `npm install` when dependencies change, then restart that application. Existing managed projects use the current bundled definitions in the editor and receive the current bundled runtime/blocks when exported; their stored project folders are not overwritten. Project-only custom block types remain available.

## Included blocks

| Block | Behavior |
| --- | --- |
| On startup | Runs once when the application starts |
| On interval | Runs every N seconds; skips overlapping ticks |
| On cron | Runs once per matching minute using a five-field local-time cron expression |
| HTTP endpoint | Starts the longest matching method/path workflow; Body and Headers outputs expose the incoming request; ANY accepts every HTTP method |
| Get sub-endpoint by name | Outputs the path following the matched HTTP endpoint, such as `/vhins` for `/systems/vhins` |
| Write to log | Writes to standard output |
| Set variable | Stores a value for the current execution |
| Condition | Compares values and takes the true/false branch |
| Wait | Delays execution |
| HTTP request | Calls an HTTP(S) URL with JSON, HTML, or text request bodies and stores status, response headers, and body |
| HTTP response | Sends JSON by default, with HTML and text available from the Reply format menu |
| Linux command | Runs `/bin/sh -c` as the deployed automation's OS user and exposes stdout, stderr, and exit code |
| List Folder Contents | Accepts a connected text folder path and outputs detailed entries, file paths, and subfolder paths, optionally including nested contents |
| Display Login | Shows the Phidias-style browser login page, creates a session-only browser cookie, and redirects back to the requested page |
| Check If Logged In | Branches on a valid browser session and outputs its username |
| Login Through API | Validates JSON/form or connected credentials and outputs a bearer token, authorization header, username, and login-result object |
| Check API Token | Branches on a valid `Authorization: Bearer …` token and outputs its username |
| Logout | Revokes either the browser session or API token selected in the block and clears browser cookies when applicable |
| Get Current Logged In User | Outputs the current Browser or API username and branches on whether a user was found |
| Select HTML Table Columns | Accepts HTML and comma-separated column headers from Text blocks, then removes non-selected columns while preserving nested tables |
| Sort HTML Table | Accepts HTML and a column header from Text blocks, then naturally sorts body rows in ascending or descending order |
| Create Button Column | Adds a link-button column and replaces `${text1}` in its URL with each row's URL-encoded value from a selected argument column |
| Convert JSON to HTML Table | Converts layered JSON into escaped HTML tables, with nested objects and lists rendered as tables inside cells |

Cron expressions use `minute hour day-of-month month weekday`; lists, ranges, and steps such as `*/15 * * * *` are supported. Schedules use the deployed application server's local time.

The imported library additionally includes text/number/list/object manipulation, comparisons, dates, files/folders, console input, emitters/receivers, arbitrary JavaScript, API requests with reusable session-cookie input/output and returned session-token output, FTP/FTPS, SSH, and MySQL blocks. Network and database credentials are stored in exported `workspaces.json` when entered directly, so prefer protected files or environment-oriented custom blocks for secrets.

Text fields support templates such as:

```text
Hello {{request.query.name}}
{{request.body}}
{{vars.result.body}}
{{env.API_KEY}}
```

An entire field containing one template preserves its value's type, so `{{request.body}}` can pass a JSON object to the response block. Embedded templates stringify objects. Templates only read own properties; they do not evaluate JavaScript. Environment variables come from the **deployed application**. Keep secrets there instead of in workspaces, which are included in exports.

HTTP endpoints expose `request.method`, `request.path`, `request.endpoint`, `request.subpath`, `request.query`, `request.headers`, and `request.body`. A request uses the longest endpoint prefix that ends on a path-segment boundary: `/systems/vhins` matches `/systems`, while `/systematic` does not. An exact endpoint takes priority over a shorter prefix. **Get sub-endpoint by name** outputs the unmatched part with a leading slash (`/vhins` in this example), or `/` when the endpoint itself was requested. Body carries the request body as text or parsed JSON, while Headers exposes incoming headers as an object. HTTP request and response blocks accept configured JSON headers or connected header objects. API Call offers JSON, HTML, and Text body formats; API Reply offers the same formats and defaults to JSON. JSON request bodies are parsed when Content-Type contains `application/json`. An endpoint without an executed response block returns 204. Unmatched routes return 404; workflow failures are logged and return 500 if no response was sent. Outbound non-2xx HTTP statuses are stored in the result for branching, rather than automatically thrown.

Authentication blocks accept the SQLite path from a connected Text block or use the path configured in the block as a fallback. One Text block can feed the same path into multiple authentication blocks. Relative paths resolve from the deployed application's directory; absolute paths can point at the builder's authentication database when both processes can securely access it. The `users` table and Argon2id password hashes are compatible with the builder. Workflow browser sessions and API tokens use separate `automation_sessions` records, so they do not reuse editor sessions. Raw session tokens are returned only to the client and only SHA-256 token hashes are stored in SQLite.

**Display Login** can follow a normal **GET** HTTP endpoint. When that endpoint can reach Display Login, the runtime routes the form's POST submission directly to the login block; unrelated POST requests cannot enter the protected GET branch. **ANY** endpoints remain supported. A successful login sends a `303` redirect to the same path. Its `phidias_session` cookie is `HttpOnly`, `SameSite=Strict`, and has no `Expires` or `Max-Age`, so it is a browser-session cookie. Browser sessions also expire server-side after 24 hours. **Login Through API** accepts `username` and `password` from connected inputs or a JSON/form request body. Its API token expires after eight hours and must be sent as `Authorization: Bearer <token>`. Use **Logout** with Session type set to Browser or API to revoke the current credential.

Built-in execution limits: 1 MB incoming/outgoing HTTP bodies, 1 MB Linux-command output, 30-second outbound HTTP timeout, 60-second workflow deadline, 1,000 blocks per workspace. Variables are isolated to a run and held in memory. HTTP triggers are public application routes; add the authentication your deployment needs before exposing sensitive workflows. There is no durable job queue, persistent variables, retry policy, or in-builder execution console.

## Add blocks

Add a trusted CommonJS `.js` module to the builder's `blocks/` directory to make it available to every managed project and export, or add a uniquely named/type module to `projects/<id>/blocks/` for one project. Restart the builder and reload the editor after changing block modules. Project-specific block files are included in exports. Block modules are executable server code and should only be installed by the server administrator.

```js
// blocks/uppercase.js
module.exports = {
  type: 'uppercase',
  name: 'Uppercase text',
  category: 'Data',
  description: 'Store uppercase text in vars.uppercase.',
  outputs: ['next'],
  fields: [
    { key: 'text', label: 'Text', type: 'text', default: 'hello' }
  ],
  async execute(ctx, options) {
    ctx.vars.uppercase = String(ctx.render(options.text)).toUpperCase();
    return 'next';
  }
};
```

Use unique lowercase filenames and types containing letters, numbers, `_` or `-`. Fields support `text`, `number` (with `min`/`max`), and `select` (with `choices`). Return an output name to continue or return nothing to stop. `ctx` provides `vars`, `request`, `response`, `env`, `render`, and an abort `signal`. Custom asynchronous blocks must honor `ctx.signal`; this runtime is not a sandbox or a hard execution timeout for arbitrary JavaScript. The built-in startup, interval, cron, and HTTP triggers are implemented by the runtime; adding a new trigger requires extending `app.js` too. Blocks requiring third-party modules must declare their dependencies in the project's `package.json` and install them on deployment.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/login` | Sign in with `{ "username": "…", "password": "…" }`; sets session cookie and returns CSRF token |
| GET | `/api/session` | Get signed-in username, CSRF token, and expiration |
| POST | `/api/logout` | Revoke current session and clear cookie |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create with `{ "name": "…" }` |
| GET | `/api/projects/:id` | Load `workspaces.json` |
| PUT | `/api/projects/:id` | Save document with current `revision`; conflict returns 409 |
| GET | `/api/projects/:id/blocks` | Read block metadata |
| GET | `/api/projects/:id/export` | Download saved project ZIP |

API clients must keep the session cookie returned by login. Get the session CSRF token from login or `/api/session`, and send it in `X-CSRF-Token` on all authenticated writes. Writes require `Content-Type: application/json`. The API accepts at most 1 MB per request. Paths are derived from server-generated project IDs, not client-supplied filesystem locations.

## Tagged releases

Pushing a Git tag runs `.github/workflows/release.yml`. The tagged commit must include the workflow and application files. Commit and push your changes first, then create and push a tag, for example:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The workflow installs dependencies on Node.js 24, runs the test suite, and publishes a GitHub release with generated release notes and these assets:

- `amp-release.zip`
- `amp-release.zip.sha256`

All tag pushes trigger the workflow, but packaging requires a semantic version tag such as `v0.0.1`, `0.0.1`, or `v1.0.0-rc.1`. Invalid version tags fail before publishing. The workflow uses GitHub's built-in `GITHUB_TOKEN` with `contents: write`; no additional secret is needed. Re-running a tag's workflow uploads/replaces its assets on the existing release (repositories with immutable releases must use a new tag instead).

The tag automatically sets the application version inside the ZIP: `v0.0.1` becomes `0.0.1` in `package.json` and both root version fields of `package-lock.json`. The login page, editor footer, and startup message read that version from `package.json`. Prerelease and build suffixes are preserved. Packaging stamps the archived files without modifying or committing the source checkout; local development displays the version in the local `package.json`.

The ZIP contains the builder source, tests, account-management scripts, and documentation. It excludes `config.json`, installed dependencies, projects, accounts, the `log/` directory, and local environment files. First launch creates a startup configuration only if it is missing, so extracting a new ZIP over an installation preserves its configuration. Application files sit directly at the ZIP root, with no enclosing directory. Extract it into your chosen application directory, enter that directory, then run:

```sh
npm ci
node server.js
```

Use the console to create an account, configure the server, and save with `copy run start`, including secure cookies when using HTTPS. Existing installations should keep their own configuration, project storage, and authentication database when upgrading. Dependencies are installed on the destination server so Argon2 uses the correct platform binary.

Build the same ZIP locally without publishing:

```sh
node scripts/package-release.js v0.1.0
```

Output is written to the ignored `dist/` directory. On systems with `sha256sum`, verify a downloaded ZIP using `sha256sum -c amp-release.zip.sha256`.

## Development

```sh
npm test
```

Tests cover console modes and help, running/startup persistence, staged accounts, first-launch configuration, upgrade-safe packaging, cumulative log levels, file rotation, log privacy, salted Argon2id storage, session persistence/expiration/revocation, password reset, rate limiting, CSRF, protected routes, server persistence and conflicts, validation, ZIP contents, deployment in a separate Node process, HTTP workflows, condition branches, outbound requests, startup/interval/cron triggers, and shutdown. The frontend is plain HTML/CSS/JavaScript under `public/`; `server.js` hosts both the UI and the API.
