# OpacIT Omphalos Phidias

**Phidias** is the visual automation builder in the **OpacIT Omphalos** suite, hosted by a Node.js server. Create projects, arrange and connect blocks, configure multiple workspaces, and export each project as an independent Node.js application.

Inspired by the block/workspace/export approach of [Discord App Builder](https://github.com/Perfectly-Plural/Discord-App-Builder). This is a new implementation with a browser editor and HTTP API instead of Electron, and general automation triggers instead of Discord. It uses its own versioned workspace and block format; existing Discord App Builder blocks and project files are **not directly compatible**.

## Start the builder

Requires **Node.js 22.13 or newer** (Node.js 24 recommended). The builder uses Node’s built-in SQLite module and the `argon2` package. There is no frontend build step.

```sh
npm install
npm run user:create
npm start
```

Set the builder's port in `config.json` beside `server.js`, then restart the builder:

```json
{
  "port": 3000,
  "auth": {
    "database": "data/auth.sqlite",
    "secureCookies": false
  }
}
```

The port must be an integer from 1 to 65535. The builder reads this file regardless of the working directory; `PORT` and `--port` no longer configure the builder.

Open `http://127.0.0.1:3000` (or your chosen port). To serve it on a remote Node.js server:

```sh
HOST=0.0.0.0 npm start
```

Sign in with the username and password you created. For remote access, serve the builder through an **HTTPS reverse proxy** and set `auth.secureCookies` to `true` in `config.json`. Keep it `false` only for local HTTP development. The builder does not terminate TLS itself. No forwarded headers are trusted to enable secure cookies.

| Setting | Default | Purpose |
| --- | --- | --- |
| `port` in `config.json` | `3000` | Builder listening port; restart after editing |
| `HOST` | `127.0.0.1` | Builder listening interface |
| `PROJECTS_DIR` | `projects/` beside `server.js` | Persistent project storage |
| `auth.database` in `config.json` | `data/auth.sqlite` | SQLite account/session file, relative to the builder directory |
| `auth.secureCookies` in `config.json` | `false` | Set to `true` when serving over HTTPS |

Keep `PROJECTS_DIR` on persistent storage and back it up. Run one builder process against a project directory; saves are serialized within that process and use atomic file replacement plus revision checks. This is a shared trusted editor, not a multi-tenant service with separate user permissions.

## Accounts and login

Run account-management commands in an interactive terminal on the server:

```sh
npm run user:create
npm run user:reset-password
```

Both commands prompt for a username and a hidden password, then require password confirmation. Passwords are not passed on the command line or stored in config. Usernames are case-insensitive, 3–64 characters, and may contain letters, numbers, dots, underscores, and hyphens. Passwords must contain at least 12 characters and be at most 1,024 bytes; spaces are preserved.

There is no default account or public registration endpoint. Authentication is always required, including when no accounts exist yet. The previous `BUILDER_TOKEN` / bearer-token login has been removed. All accounts currently share access to every project; accounts do not provide project isolation or roles.

Credentials are stored as salted **Argon2id** hashes (64 MiB memory, 3 iterations, parallelism 1) using [node-argon2](https://github.com/ranisalt/node-argon2). The SQLite database also stores hashed session tokens, CSRF tokens, expiration timestamps, and login-rate-limit counters. Passwords and raw session tokens are not persisted. Database files are created with owner-only permissions on Unix and excluded from Git and project exports.

Sessions use random 256-bit cookies with `HttpOnly`, `SameSite=Strict`, and `Secure` when configured. They expire after eight hours and survive builder restarts. Signing out revokes the current session; resetting a password revokes all sessions for that account. Every successful login issues a fresh session and revokes the browser's previous one. State-changing authenticated API calls require the session's `X-CSRF-Token`, and cross-origin writes are rejected.

Sign-in attempts are limited to 10 per username and 20 per connection IP in 15 minutes, with at most two password verifications in flight per builder process. Limits persist across restarts. Behind a reverse proxy the IP limit applies to the proxy connection address, so users share that limit; the builder deliberately ignores untrusted `X-Forwarded-For` headers. Login failures use the same message for missing accounts and incorrect passwords.

Back up the authentication database as well as projects. For a simple file backup, stop the builder and account commands first, then copy the database and any `-wal`/`-shm` files together. Keep the database on local persistent storage supported by SQLite WAL. Deleting it removes every account and session. Password recovery is through the server-side reset command above.

## Build an automation

1. Create a project. It starts with `GET /hello` connected to an HTTP response.
2. Click a block in the library or drag it onto the canvas.
3. Click an output port, then another block's input port to connect them. Connecting an already used output replaces its wire.
4. Select a block to edit its configuration. Drag blocks to position them; drag the background to pan, scroll to zoom, or use **Fit**.
5. Select a block or connection and press Delete to remove it. Blocks also have duplicate/delete buttons in the configuration panel.
6. Add workspaces with **+**. Use **•••** to rename the project/workspace or pause a workspace. All active workspaces run in the exported application.
7. Click **Save project** or press Ctrl/Cmd+S. Changes are saved explicitly, not automatically; closing the page with unsaved changes prompts you.
8. Click **Export application**. This saves edits and downloads a ZIP of the current saved project.

Invalid graphs, unknown blocks, loops, invalid options, and duplicate active HTTP routes are rejected on save and export. Each output connects to one block; a block can receive multiple incoming connections. Execution follows action wires sequentially. Conditions have separate `true` and `false` outputs. Use timer triggers for recurring work.

## Deploy independently

Extract an exported ZIP into a new directory on your target Node.js server:

```sh
PORT=9000 node app.js
# Or:
PORT=9000 npm start
```

No `npm install` is needed for the supplied blocks. Visit `http://localhost:9000/hello` for the starter workflow. The application defaults to port `3001` and host `0.0.0.0`; these settings are independent from the builder. Stop it with SIGINT or SIGTERM. Run it under your normal process manager or service manager for unattended hosting.

Each server-side project and exported ZIP contains:

```text
projects/<project-id>/
├── app.js             # Standalone runtime
├── workspaces.json    # Project, workspaces, blocks, connections, positions
├── blocks/            # Executable block definitions
├── validate.js        # Runtime graph validation
├── package.json
└── README.md
```

You can also copy the entire project folder directly. The builder never starts project workflows on its own server. Edits to a builder project do not update an already deployed copy: export and deploy again, then restart that application. Runtime and block files are copied when a project is created, so changes to the builder's templates do not silently change existing projects.

## Included blocks

| Block | Behavior |
| --- | --- |
| On startup | Runs once when the application starts |
| On interval | Runs every N seconds; skips overlapping ticks |
| HTTP endpoint | Starts a workflow on an exact method/path match |
| Write to log | Writes to standard output |
| Set variable | Stores a value for the current execution |
| Condition | Compares values and takes the true/false branch |
| Wait | Delays execution |
| HTTP request | Calls an HTTP(S) URL, storing status and response body |
| HTTP response | Sends a text or JSON response to the incoming request |

Text fields support templates such as:

```text
Hello {{request.query.name}}
{{request.body}}
{{vars.result.body}}
{{env.API_KEY}}
```

An entire field containing one template preserves its value's type, so `{{request.body}}` can pass a JSON object to the response block. Embedded templates stringify objects. Templates only read own properties; they do not evaluate JavaScript. Environment variables come from the **deployed application**. Keep secrets there instead of in workspaces, which are included in exports.

HTTP endpoints expose `request.method`, `request.path`, `request.query`, `request.headers`, and `request.body`. JSON request bodies are parsed when Content-Type contains `application/json`. An endpoint without an executed response block returns 204. Unmatched routes return 404; workflow failures are logged and return 500 if no response was sent. Outbound non-2xx HTTP statuses are stored in the result for branching, rather than automatically thrown.

Built-in execution limits: 1 MB incoming/outgoing HTTP bodies, 30-second outbound HTTP timeout, 60-second workflow deadline, 1,000 blocks per workspace. Variables are isolated to a run and held in memory. HTTP triggers are public application routes; add the authentication your deployment needs before exposing sensitive workflows. This initial version has no cron scheduling, durable job queue, persistent variables, retry policy, or in-builder execution console.

## Add blocks

Add a trusted CommonJS `.js` module to the builder's `blocks/` directory for future projects, or to `projects/<id>/blocks/` for an existing project. Restart the builder and reload the editor after changing block modules. Project-specific block files are included in exports. Block modules are executable server code and should only be installed by the server administrator.

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

Use unique lowercase filenames and types containing letters, numbers, `_` or `-`. Fields support `text`, `number` (with `min`/`max`), and `select` (with `choices`). Return an output name to continue or return nothing to stop. `ctx` provides `vars`, `request`, `response`, `env`, `render`, and an abort `signal`. Custom asynchronous blocks must honor `ctx.signal`; this runtime is not a sandbox or a hard execution timeout for arbitrary JavaScript. The three trigger types are implemented by the runtime; adding a new trigger requires extending `app.js` too. Blocks requiring third-party modules must declare their dependencies in the project's `package.json` and install them on deployment.

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

The ZIP contains the builder source, tests, account-management scripts, documentation, and fresh `config.json` defaults. It excludes installed dependencies, projects, accounts, and local environment files. Application files sit directly at the ZIP root, with no enclosing directory. Extract it into your chosen application directory, enter that directory, then run:

```sh
npm ci
npm run user:create
npm start
```

Configure `config.json` for your server, including secure cookies when using HTTPS. Existing installations should keep their own configuration, project storage, and authentication database when upgrading. Dependencies are installed on the destination server so Argon2 uses the correct platform binary.

Build the same ZIP locally without publishing:

```sh
node scripts/package-release.js v0.1.0
```

Output is written to the ignored `dist/` directory. On systems with `sha256sum`, verify a downloaded ZIP using `sha256sum -c amp-release.zip.sha256`.

## Development

```sh
npm test
```

Tests cover salted Argon2id storage, session persistence/expiration/revocation, password reset, rate limiting, CSRF, protected routes, server persistence and conflicts, validation, ZIP contents, deployment in a separate Node process, HTTP workflows, condition branches, outbound requests, startup/interval triggers, and shutdown. The frontend is plain HTML/CSS/JavaScript under `public/`; `server.js` hosts both the UI and the API.
