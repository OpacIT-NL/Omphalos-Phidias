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
| `copy run start` | Save running settings to `config.json` and pending account changes to the selected auth backend |
| `shutdown` / `exit server` | Stop the application; asks for confirmation if changes are unsaved |

`copy running-config startup-config` is also accepted. Enabled commands require the `do` prefix in configuration mode, for example `do show users` or `do copy run start`. Ordinary `do show` and `do copy` commands keep configuration mode active; mode-changing commands such as `do disable` still change modes. `exit` alone never shuts down the server.

Configuration commands:

| Command | Purpose / timing |
| --- | --- |
| `host <IPv4-or-IPv6>` | Change the listening address immediately |
| `port <1-65535>` | Change the listening port immediately |
| `log-level <0-4>` | Change console log filtering immediately |
| `file-log-level <0-4>` | Change file log filtering immediately |
| `console force-input-log <true-or-false>` | Always audit console commands to both logging destinations; hidden answers remain redacted |
| `username <name>` | Create or reset an account using hidden password prompts |
| `user create <name>` | Create a new account; rejects an existing username |
| `user password <name>` | Reset an existing account’s password |
| `user delete <name>` / `no username <name>` | Remove an account from the running configuration |
| `user <name> grant_all` | Grant every core and project permission by adding the user to Administrators; save with `copy run start` |
| `enable secret` / `enable password` | Set the console enable password with hidden prompts |
| `no enable secret` / `no enable password` | Remove the console enable password |
| `auth secure-cookies <true-or-false>` | Change the flag on newly issued cookies immediately |
| `projects-directory <path>` | Change project storage after saving and restarting |
| `auth database <path>` | Change the SQLite database path after saving and restarting |

Quote paths containing spaces, for example `projects-directory "project storage"`. Relative storage paths resolve beside `server.js`, not against the terminal’s working directory. Storage path commands do not move existing files: account saves still target the active database until restart. Move/copy your database while the server is stopped if you intend to keep those accounts at a new path.

Host and port changes reconnect the listener. If binding fails, the server attempts to restore its previous address and leaves the running configuration unchanged. Host, port, storage, and logging settings now come from `config.json`; the builder no longer uses `HOST`, `PORT`, `PROJECTS_DIR`, or `--port` overrides. Exported automation applications use their own independent `config.json`, with optional `PORT` and `HOST` overrides.

Changes affect the running server but **do not survive restart until `copy run start`**. Account password hashes stay in SQLite, not in `config.json`; unsaved account changes and sessions for those accounts are held in memory. Saving persists both settings and accounts. New or reset accounts can log in before saving, and resets/deletions revoke sessions immediately. Restarting without saving restores the previously saved accounts/settings; revoked sessions remain revoked. Browser project saves are independent and still persist using the editor’s Save button.

Console enable passwords use Argon2id hashes in `config.json`. `show run` and `show start` hide those hashes. Three failed enable attempts temporarily block elevation for 30 seconds. Console access requires access to the server terminal and does not use the web account password.

Accounts with the **Console** core permission also see **CLI** in the editor toolbar. Opening it creates a fresh `Console$>` session in disabled mode. It supports the same `enable`, `conf t`, hidden password prompts, configuration commands, and `copy run start` behavior as the server terminal. Closing and reopening the panel resets it to disabled mode.

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
    "enablePasswordHash": null,
    "forceInputLog": false
  }
}
```

Settings can also be edited while the server is stopped. Missing fields in older configurations receive defaults in memory and are written on the next `copy run start`. Keep the startup configuration, project directory, and authentication database on persistent storage and back them up. Run one builder process against a project directory. Web accounts only see projects granted through their direct permissions and group memberships.

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

Set `console force-input-log true` in configuration mode to write every terminal and browser-console input to both the console and launch log file regardless of their configured thresholds. Save it with `copy run start`. Hidden enable and account password answers are recorded as `[hidden]`; passwords are never written to the log.

Info records startup, shutdown, sign-in/sign-out, and project create/save/export activity. Warning records rejected requests, Error records unexpected request failures, and Debug records request paths, status codes, and durations. Startup failures and uncaught failures are Critical. Request bodies, query strings, authorization headers, cookies, and passwords are not included in request logs.

The `log/` directory is created automatically and excluded from Git and release ZIPs. Files are not automatically deleted; manage retention on your server. If a file write fails, the original console entry remains available along with a Critical diagnostic. Exported automations use the same severity levels and launch-file naming in their own `log/` directory; their application `log-level` currently controls both destinations.

## Accounts and login

Manage web accounts through **Access management** in the editor or through the configuration console, then save console-staged account changes with `copy run start`. Usernames are case-insensitive, 3–64 characters, and may contain letters, numbers, dots, underscores, and hyphens. Web-account passwords must contain at least 12 characters and be at most 1,024 bytes; spaces are preserved. Console enable passwords have no length or complexity requirements.

There is no default web account or public registration endpoint. Web authentication is always required, even before any accounts exist. Account credentials are salted **Argon2id** hashes (64 MiB memory, 3 iterations, parallelism 1) using [node-argon2](https://github.com/ranisalt/node-argon2). Saved account credentials, groups, ACL grants, hashed session tokens, CSRF tokens, expiration timestamps, and login-rate-limit counters live in the selected SQLite or MySQL backend. Passwords and raw session tokens are not persisted.

Core permissions are **Login**, **Manage users**, **Create projects**, and **Console**. Project permissions are **Login to RC**, **Login to Prod**, **View Builder Project**, **Edit Builder Project**, **Promote to Prod**, and **Delete Project**. Grants are additive: a user receives the union of direct grants and every group grant. A newly created project grants all project permissions directly to its creator. The local Cisco-style terminal still requires OS-level terminal access and its enable secret; the Console ACL is recorded for authenticated console integrations.

The ACL and database-credential schemas are added with `CREATE TABLE IF NOT EXISTS`; the updater never replaces `auth.sqlite`. On the first ACL migration, every existing user is placed in the built-in **Administrators** group, which has every core permission and wildcard access to existing and future projects. This preserves access during upgrades. The first account created in a completely empty database becomes the bootstrap administrator. Later accounts start with no permissions until an administrator assigns them.

Administrators open **CRED** beside CLI and ACL to manage SSH, Windows, MySQL, MSSQL, PostgreSQL, and other credentials. Passwords and private keys are never returned by the builder API. Existing MySQL credential sets migrate automatically with their original IDs. RC and Prod independently select a MySQL application database and logging database in Version manager. **Database SQL Query** and **Database SQL Bulk Query** use the selected application database, while **Send Query to Log Database** uses the selected logging database.

Phidias can store authentication, ACL, session, and credential tables in SQLite or MySQL. In `conf t`, use `auth storage mysql` to enter and stage the MySQL connection, or `auth storage sqlite [path]` to switch back. When MySQL is selected, the builder reads and writes MySQL directly; it does not maintain a local SQLite mirror or overwrite application sessions during page refreshes. `copy run start` tests the destination and migrates the complete data set without deleting the source. Configure the separate startup broker with `auth broker enabled true`, `auth broker host <IP>`, and `auth broker port <port>`, then restart Phidias after saving. The broker accepts only signed, time-limited bootstrap requests and rejects replayed nonces.

Sessions use random 256-bit cookies with `HttpOnly`, `SameSite=Strict`, and `Secure` when configured. They expire after eight hours. Saved sessions survive builder restarts; sessions for unsaved accounts remain in memory until `copy run start`. Signing out revokes the current session; resetting or deleting an account revokes its sessions. State-changing authenticated API calls require the session’s `X-CSRF-Token`, and cross-origin writes are rejected.

Sign-in attempts are limited to 10 per username and 20 per connection IP in 15 minutes, with at most two password verifications in flight per builder process. Limits persist across restarts. Behind a reverse proxy the IP limit applies to the proxy connection address; the builder ignores untrusted `X-Forwarded-For` headers. Missing accounts and incorrect passwords return the same login error.

For offline account recovery on a SQLite installation, `npm run user:create` and `npm run user:reset-password` remain available after the first launch. Run them with the server stopped; MySQL-backed installations should use the Phidias console so changes go through MySQL. To recover a forgotten console enable password, stop the server, set `console.enablePasswordHash` to `null` in your local config, restart, and set a new enable secret from the console.

Back up `config.json`, projects, the sibling `repo` directory, and the authentication database. For a simple file backup, stop the builder and account commands, then copy SQLite’s database and any `-wal`/`-shm` files together. Keep it on local persistent storage supported by SQLite WAL. Deleting the database removes every saved account and session.

## Build an automation

1. Create a project. It starts with `GET /hello` connected to an HTTP response.
   Existing Phidias applications can be added with **Import project**. Upload an exported ZIP or provide its URL. Imports receive a fresh project ID and revision history while preserving workspaces and HTML/CSS templates. The current trusted runtime and bundled block implementations are used; JavaScript files inside the uploaded archive are not installed or executed.
2. Click a block in the library or drag it onto the canvas.
3. Click an output port, then a compatible input port, or drag a wire between them. A dragged wire snaps to a nearby compatible port before you release it. Green ports carry actions and gold ports carry values. Action outputs have one wire; value outputs can feed multiple blocks. Each value input accepts one wire.
4. Select a block to edit its configuration. Hold Ctrl/Cmd or Shift while clicking blocks to toggle them in a multi-selection, or Shift-drag across the canvas to select every block the rectangle touches. Drag the header of any selected block to move the whole group. Drag a block's lower-right resize handle to make it as large as needed; text option fields grow with the available space and custom dimensions are saved in `workspaces.json`.
5. Press Ctrl/Cmd+C and Ctrl/Cmd+V to copy and paste selected blocks. Connections are copied when both endpoint blocks are selected, and pasted blocks and connections receive new IDs. With no block or wire selected, Ctrl/Cmd+C copies the current workspace; Ctrl/Cmd+V then pastes it as a new workspace. Select blocks or a connection and press Delete to remove them.
6. Add workspace groups with **▤**. Use the **+** beside a group name to create a workspace directly inside it. Drag group headers to reorder groups; use **✎** to rename one or **×** to delete it. Deleting a group moves its workspaces to Uncategorized. Drag workspace rows to reorder them or drop them onto another group. Close editor tabs with **×**; this leaves the workspace in the sidebar, where clicking it reopens the tab. Right-click a workspace row or tab to open settings, duplicate it, activate/deactivate it, or delete it. Workspace settings can also force structured INFO logs and route block-run events through **On Workspace Log**. All active workspaces run in the exported application.
7. Click **Save project** or press Ctrl/Cmd+S. Changes are saved explicitly, not automatically; closing the page with unsaved changes prompts you. Every successful save also creates a numbered RC ZIP and updates that project's RC `latest.zip`.
8. Open **HTML and CSS templates** with **</>** to create and edit `.html` and `.css` files. Saving, renaming, or deleting a file creates a project revision and updates its RC build. Use placeholders such as `%title%`, `%styles%`, and `%content%` in HTML files. `Get Template` can read a CSS file as text so it can be inserted into `%styles%` with `Apply Variable`.
9. Open **Version manager** with **↶** to configure host, port, log level, update URL, and forced Console Input logging independently for RC and Prod, download old builds, restore one as a new revision, delete an old revision, or promote a tested revision to Prod. The cleanup control deletes every RC-only revision below the entered revision number while preserving all promoted Prod revisions and the current revision. Point each update URL at that channel's public `latest.zip`. RC saves and direct exports use the RC profile. Promotion packages the selected revision with the Prod profile and updates Prod `latest.zip`; later RC saves do not change Prod. Restoring a revision also restores its saved HTML templates.
10. Click **Export application** to save edits and download the current project directly.

Project editors can use **Clear block cache** (⟳) in the toolbar after changing block files on disk. It removes cached bundled and project-local block modules, including imported helper modules, reloads the block library, and refreshes the current graph without discarding unsaved workspace edits.

Accounts with **Manage users** can open the **ACL** control panel in the top-right toolbar. Create users and groups, select one, assign core and per-project permissions, and save. Group membership and direct user grants combine. The built-in Administrators group always has every permission; change its membership to add or remove administrators.

Invalid graphs, unknown blocks, incompatible value types, loops, invalid options, and duplicate active HTTP routes are rejected on save and export. Execution follows action wires; connected value blocks are evaluated when their values are needed. Branching blocks expose separate action outputs. Use timer triggers for recurring work.

With the default `projects` directory, repository builds are stored in `repo` beside it. A project named `Delphi` publishes RC builds as `/repo/DelphiRC/latest.zip` and `/repo/DelphiRC/delphi.revN.zip`. Promoting revision N creates `/repo/DelphiProd/latest.zip` and `/repo/DelphiProd/delphi.revN.zip`. Open `/repo/` to browse every published project-state folder and continue into a folder to browse its current and numbered ZIPs. Repository browsing and downloads are public and require no builder session. Exported `workspaces.json` files are included in these ZIPs. Database credential-set passwords are not included in repository archives.

## Deploy independently

Extract an exported ZIP into a new directory on your target Node.js server:

```sh
npm install
node app.js
# Or, after npm install:
npm start
```

`npm install` installs Argon2 plus the FTP, SSH, and database clients used by authentication and imported network/database blocks. Visit `http://localhost:3001/hello` for the starter workflow. In **Version manager**, set separate host, port, log level, update URL, authentication storage, credential broker URL, and **Force Console Log block output** profiles for RC and Prod. RC and Prod can point to different broker URLs. SQLite builds receive `auth.database`; MySQL builds receive only `auth.broker.url`, the immutable `project-id`, and the release channel. They never receive the MySQL password in `config.json`.

An authenticated direct export contains a unique 32-byte `application.key`. Keep this file beside `app.js`, limit it to the account running the application, and do not commit or share it. Public `/repo/...` archives deliberately exclude `application.key`; applying a public update therefore preserves the key already installed on the server. At startup, a MySQL-backed application signs a request to the configured broker. The broker returns the MySQL connection settings in an AES-256-GCM encrypted response tied to that request. Application keys are encrypted at rest using AES-256-GCM with key material derived from the database server key and the machine-local Phidias key. Changing a deployment profile updates the corresponding existing repository ZIPs and `latest.zip`. An unset profile uses port `3001`, host `0.0.0.0`, log level `3`, SQLite authentication, and normally filtered Console Log output. `PORT` and `HOST` remain optional process-level overrides. Stop it with SIGINT or SIGTERM.

Each server-side project and exported ZIP contains:

```text
projects/<project-id>/
├── app.js             # Standalone runtime
├── workspaces.json    # Project, workspaces, blocks, connections, positions
├── deployment-configs.json # Builder-side RC and Prod deployment profiles
├── blocks/            # Executable block definitions
├── html/              # HTML and CSS templates edited in the builder
├── auth.js            # Browser-session and API-token authentication runtime
├── favicon.ico        # Multi-resolution exported-application browser icon
├── logger.js          # Console and per-launch file logger
├── legacy.js          # Discord App Builder block compatibility
├── validate.js        # Runtime graph validation
├── package.json
└── README.md
```

Standalone automations create `log/yyyy-mm-dd-N.txt` when `node app.js` starts. `N` begins at `1` each UTC date and increases for every restart that day. **Restart App** closes the current cycle after its stopped message, allocates the next numbered file, and writes the restarting and listening messages into the new cycle just like a complete process restart. Lifecycle messages (listening, stopping, and stopped) are always written to stdout so process managers such as AMP can show application state; their file copies still follow the configured level. Workflow errors, HTTP request diagnostics, **Write to log**, and **Console Log** output use the automation's configured log level. Level meanings are the same as the builder table above.

The deployment profile's **Force Console Log block output** option makes every imported **Console Log** block write to both the console and launch log file regardless of their configured levels. Console Input values are never audited by this option. The existing generated `config.json` field remains `"force-console-input-log"` for upgrade compatibility.

Each workspace has two independent logging controls. **Force log** writes an INFO event for every executed block to the application console and launch file even when the application log level would normally filter it. **Log all runs to log block** sends the workspace's events to application-wide logging triggers. Place **On Run ID Created** and **On Workspace Log** once in a dedicated active logging workspace; they receive runs and block events from every active workspace that has this setting enabled. The run-start trigger outputs the shared Run ID, start time, user, and original workspace identity, making it suitable for a runs table. Each trace event includes timestamps, duration, success state, original workspace and block identities, action input, connected inputs, configured options, outputs, and error details. Every external HTTP, startup, interval, cron, or console-input trigger receives a UUID Run ID; emitter/receiver continuations retain it across workspaces. Unauthenticated and scheduled runs use `svc_automation` as the username. Valid browser and API sessions are recognized at run start, and authentication blocks attach a recognized username to subsequent events. Logging-handler branches do not generate further workspace-log or run-start events, preventing recursion.

Every workspace and block also has a persistent numeric ID shown in the editor, alongside its internal UUID. New workspaces and blocks receive the next ascending number in their own scope; reordering does not change it. Workflow failures identify the exact location, for example: `Block triggered error (Workspace #1: MyWorkspace > Block #14: Request API)`. Older projects receive numeric IDs automatically when they are loaded.

You can also copy the entire project folder directly. The builder never starts project workflows on its own server. Edits to a builder project do not update an already deployed copy: export and deploy again, run `npm install` when dependencies change, then restart that application. Existing managed projects use the current bundled definitions in the editor and receive the current bundled runtime/blocks when exported; their stored project folders are not overwritten. Project-only custom block types remain available.

The builder serves its Phidias favicon from `public/favicon.ico`. Every project export includes a separate automation favicon and serves it from `/favicon.ico` before workflow route matching, so it remains available to login pages, HTML replies, and nested endpoint pages. Regenerate both multi-resolution ICO files with `node scripts/generate-favicons.js`.

## Included blocks

| Block | Behavior |
| --- | --- |
| On startup | Runs once when the application starts |
| On interval | Runs every N seconds; skips overlapping ticks |
| On cron | Runs once per matching minute using a five-field local-time cron expression |
| On Workspace Log | Application-wide listener that receives each structured block-run event from active workspaces with Log all runs to log block enabled and outputs Action, Logged In User, Content, and Run ID |
| On Run ID Created | Application-wide listener that runs once before each logged workflow run and outputs Run ID, start time, logged-in user, and the original workspace name, numeric ID, UUID, and object |
| HTTP endpoint | Starts the longest matching method/path workflow; Body and Headers outputs expose the incoming request; ANY accepts every HTTP method |
| Get sub-endpoint by name | Outputs the path following the matched HTTP endpoint, such as `/vhins` for `/systems/vhins` |
| Write to log | Writes to standard output |
| Console Log | Writes connected text, objects, lists, and other values at Info level; the deployment profile can force these messages through console and file filters |
| Set variable | Stores a value for the current execution |
| Condition | Compares values and takes the true/false branch |
| Wait | Delays execution |
| Database SQL Query | Executes one SQL statement using the database credential set selected for this RC or Prod application |
| Database SQL Bulk Query | Executes up to 1,000 SQL statements sequentially and outputs ordered responses, counts, and the failed query details |
| Send Query to Log Database | Executes one SQL statement using the separate logging database credential set selected for this RC or Prod application |
| Get Linux Server Credentials by Name | Loads an SSH credential from `auth.sqlite` by display name |
| Get Windows Credentials by Name | Loads a Windows/LDAP credential by display name |
| Get Other Credentials by Name | Loads an Other credential by display name |
| Get Database Credentials by Name | Loads a MySQL, MSSQL, or PostgreSQL credential by display name |
| Get Credential Info | Exposes connection metadata and secret passthrough values; secrets are redacted from console and workspace logs |
| MSSQL Query | Runs a query with a connected MSSQL credential |
| PostgreSQL Query | Runs a query with a connected PostgreSQL credential |
| Send SSH Command | Runs commands with a connected Linux SSH credential |
| Get Linux Status Over SSH | Returns CPU, load, RAM, filesystem capacity, inode usage, block-device, process-table, interface, and socket data as an object |
| HTTP request | Calls an HTTP(S) URL with JSON, HTML, or text request bodies and stores status, response headers, and body |
| HTTP response | Sends JSON by default, with HTML and text available from the Reply format menu |
| Linux command | Runs `/bin/sh -c` as the deployed automation's OS user and exposes stdout, stderr, and exit code |
| Update Application | Uses this build's RC or Prod `update-url` to download `latest.zip` with `wget` and extract it in the application directory with `unzip`; command output always reaches the console and log file |
| Stop App | Gracefully closes the exported automation runtime and exits the Node.js process |
| Restart App | Gracefully reloads the exported automation runtime in the same process, preserving compatibility with process managers such as AMP |
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
| Convert JSON to HTML Detail | Converts one JSON object into a vertical detail table with a header column and value column; nested objects and lists become nested tables |
| Select HTML Detail Rows | Accepts detail HTML and comma-separated row headers, then removes non-selected top-level rows while preserving nested tables |
| Sort HTML Detail Rows | Naturally sorts detail rows by header or value in ascending or descending order |
| Create Button Detail Row | Adds a link-button row and replaces `${text1}` in its URL with the URL-encoded value from a selected argument row |
| Get Template | Reads a `.html` or `.css` file from the exported application's `html` folder using a connected template-name input |
| Apply Variable | Replaces every `%name%` placeholder with connected text or HTML; enter `name` without percent signs |
| Markdown to HTML | Converts headings, emphasis, links, lists, quotes, inline code, and fenced code to HTML while escaping raw HTML |
| Convert JSON to HTML Table | Converts layered JSON into escaped HTML tables, with nested objects and lists rendered as tables inside cells |
| JSON to Cartesian Chart | Creates responsive line, area, grouped bar, stacked bar, horizontal bar, or scatter chart HTML from JSON rows, labels/datasets, or key-value objects |
| JSON to Circular Chart | Creates responsive pie or donut chart HTML from JSON, with slice sorting, small-slice grouping, custom palettes, labels, legends, and themes |
| Math Operation | Adds, subtracts, multiplies, divides, calculates modulo or powers, or selects the minimum/maximum of two connected numbers |
| Percentage Calculator | Calculates ratios, percentage amounts, percentage changes, percentage-point differences, and percentage-based increases or decreases |
| Aggregate Numbers | Calculates count, sum, average, minimum, maximum, median, range, variance, and standard deviation from JSON or lists |
| Transform JSON Numbers | Adds or replaces calculated numeric fields across JSON rows or key-value data and outputs object/list data directly compatible with graph blocks |

The chart blocks return self-contained HTML with responsive inline SVG, so their output can connect directly to **Apply Variable** or an HTML **HTTP response**. They require no browser-side chart library or network access. Both blocks automatically recognize these JSON layouts:

```json
[
  { "Month": "January", "Sales": 42, "Costs": 18 },
  { "Month": "February", "Sales": 51, "Costs": 21 }
]
```

```json
{
  "labels": ["January", "February"],
  "datasets": [
    { "label": "Sales", "data": [42, 51], "color": "#69b7e6" },
    { "label": "Costs", "data": [18, 21], "color": "#e8ad60" }
  ]
}
```

```json
{ "Online": 18, "Warning": 3, "Offline": 1 }
```

Use **Category / X Field** and **Series / Y Fields** to override automatic row mapping. Cartesian charts can aggregate duplicate categories by sum, average, minimum, maximum, or count; sort and limit points; treat missing values as gaps, zeroes, or skipped points; and control axes, grids, values, sizing, colors, and themes. Connect Number blocks or other numeric outputs to **X Minimum**, **X Maximum**, **Y Minimum**, and **Y Maximum** for explicit bounds. Scatter charts use all four bounds, horizontal bars use the X bounds, and charts with categorical X labels use the Y bounds. Scatter datasets may use `{ "x": 10, "y": 25 }` points. Circular charts can sort and limit slices, combine small slices into Other, adjust the donut radius, and control labels, values, legends, sizing, colors, and themes.

Math blocks always output numeric values rather than formatted strings, so their results remain usable by later calculations and charts. **Transform JSON Numbers** can calculate from a constant, a connected number, or another field in each row. For example, select `Used` as the source, `Total` as the operand field, `Value as Percentage of Operand` as the operation, and `UsagePercent` as the result field. The returned rows retain their original fields and add a numeric `UsagePercent` field that can be selected as a chart series. Nested field paths such as `metrics.used` are supported.

Cron expressions use `minute hour day-of-month month weekday`; lists, ranges, and steps such as `*/15 * * * *` are supported. Schedules use the deployed application server's local time.

The imported library additionally includes text/number/list/object manipulation, comparisons, dates, files/folders, console input, emitters/receivers, arbitrary JavaScript, API requests with reusable session-cookie input/output and returned session-token output, FTP/FTPS, SSH, and MySQL blocks. Network credentials entered directly into block options are stored in exported `workspaces.json`, so prefer protected files or environment-oriented custom blocks for those secrets. MySQL Query uses the credential set selected in application settings.

Text fields support templates such as:

```text
Hello {{request.query.name}}
{{request.body}}
{{vars.result.body}}
{{env.API_KEY}}
```

An entire field containing one template preserves its value's type, so `{{request.body}}` can pass a JSON object to the response block. Embedded templates stringify objects. Templates only read own properties; they do not evaluate JavaScript. Environment variables come from the **deployed application**. Keep secrets there instead of in workspaces, which are included in exports.

HTTP endpoints expose `request.method`, `request.path`, `request.endpoint`, `request.subpath`, `request.query`, `request.headers`, and `request.body`. A request uses the longest endpoint prefix that ends on a path-segment boundary: `/systems/vhins` matches `/systems`, while `/systematic` does not. An exact endpoint takes priority over a shorter prefix. **Get sub-endpoint by name** outputs the unmatched part with a leading slash (`/vhins` in this example), or `/` when the endpoint itself was requested. Body carries the request body as text or parsed JSON, while Headers exposes incoming headers as an object. HTTP request and response blocks accept configured JSON headers or connected header objects. API Call offers JSON, HTML, and Text body formats; API Reply offers the same formats and defaults to JSON. JSON request bodies are parsed when Content-Type contains `application/json`. An endpoint without an executed response block returns 204. Unmatched routes return 404; workflow failures are logged and return 500 if no response was sent. Outbound non-2xx HTTP statuses are stored in the result for branching, rather than automatically thrown.

All authentication blocks use the deployed application's configured auth backend; they no longer contain a database field or connector. Relative SQLite paths resolve from the deployed application's directory, while generated builds point at the builder authentication database. On builder startup, existing projects are migrated by removing saved authentication-block database options and incoming database wires without changing users, groups, ACLs, or sessions. The `users` table and Argon2id password hashes are compatible with the builder. Login and session checks read `project-id` and `release-channel` from `config.json` and require that project's **Login to RC** or **Login to Prod** permission. Revoking that permission invalidates subsequent checks for an existing automation session. Older manually assembled applications without release identity retain their legacy authentication behavior. Workflow browser sessions and API tokens use separate `automation_sessions` records, so they do not reuse editor sessions. Raw session tokens are returned only to the client and only SHA-256 token hashes are stored in the selected auth backend.

**Display Login** can follow a normal **GET** HTTP endpoint, either directly or through matching emitter/receiver blocks in another active workspace. When that endpoint can reach Display Login, the runtime routes the form's POST submission directly to the login block; unrelated POST requests cannot enter the protected GET branch. **ANY** endpoints remain supported. A successful login sends a `303` redirect to the same path. Its browser cookie is `HttpOnly`, `SameSite=Strict`, and has no `Expires` or `Max-Age`, so it is a browser-session cookie. Exported applications with a project ID use a project- and release-specific cookie name; older/manual applications derive a stable name from the application name. RC, Prod, and other applications on the same hostname therefore cannot overwrite one another's sessions. Active browser sessions renew their server-side 24-hour window whenever they are checked; inactive sessions still expire. At log level 4, failed session checks record only a reason (`missing-token`, `unknown-token`, `expired`, or `permission-denied`); they never record the token. **Login Through API** accepts `username` and `password` from connected inputs or a JSON/form request body. Its API token has a rolling eight-hour lifetime and must be sent as `Authorization: Bearer <token>`. Use **Logout** with Session type set to Browser or API to revoke the current credential.

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
| GET | `/api/access` | Read users, groups, memberships, projects, and ACL grants (Manage users required) |
| POST, DELETE | `/api/access/users[/:username]` | Create or delete a user |
| PUT | `/api/access/users/:username/password` | Reset a user's password and sessions |
| POST, DELETE | `/api/access/groups[/:id]` | Create or delete a group |
| PUT | `/api/access/groups/:id/members` | Replace a group's membership |
| PUT | `/api/access/grants/core/:type/:id` | Replace direct core grants for a user or group |
| PUT | `/api/access/grants/projects/:project/:type/:id` | Replace direct project grants for a user or group |
| GET, DELETE | `/api/console` | Poll or close the current browser console session (Console permission required) |
| POST | `/api/console/reset` | Start a fresh browser console in disabled mode |
| POST | `/api/console/input` | Submit a command or answer the current hidden prompt |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create with `{ "name": "…" }` |
| POST | `/api/projects/import` | Import an application ZIP (`application/zip`, 25 MB compressed limit) |
| POST | `/api/projects/import-url` | Download and import `{ "url": "https://…/application.zip" }`; remote hosts must resolve to public addresses, while same-origin repository URLs are allowed |
| GET | `/api/projects/:id` | Load `workspaces.json` |
| PUT | `/api/projects/:id` | Save document with current `revision`; conflict returns 409 |
| DELETE | `/api/projects/:id` | Delete a project and its repository revisions |
| GET | `/api/projects/:id/blocks` | Read block metadata |
| DELETE | `/api/projects/:id/blocks/cache` | Clear server-side block modules and return freshly loaded metadata (Edit permission required) |
| GET | `/api/projects/:id/export` | Download saved project ZIP |
| GET | `/api/projects/:id/deployment-configs` | Read the separate RC and Prod host, port, log-level, update URL, and forced Console Input logging profiles |
| PUT | `/api/projects/:id/deployment-configs/:channel` | Save the `RC` or `Prod` profile and update that channel's repository ZIPs |
| GET | `/api/projects/:id/templates` | List project HTML and CSS templates |
| GET | `/api/projects/:id/templates/:name` | Read one project HTML or CSS template |
| PUT | `/api/projects/:id/templates/:name` | Create, edit, or rename a template and create a revision |
| DELETE | `/api/projects/:id/templates/:name` | Delete a template and create a revision |
| GET | `/api/projects/:id/versions` | List saved RC and Prod revisions and their repository URLs |
| POST | `/api/projects/:id/versions/cleanup-rc` | Delete RC-only revisions below `beforeRevision`; promoted Prod and current revisions are preserved |
| POST | `/api/projects/:id/versions/:revision/promote` | Copy an RC revision to Prod and update Prod `latest.zip` |
| POST | `/api/projects/:id/versions/:revision/restore` | Restore a snapshot as a new RC revision; body contains current `{ "revision": N }` |
| DELETE | `/api/projects/:id/versions/:revision` | Delete a non-current revision from RC and Prod |
| GET, HEAD | `/repo/` and `/repo/:channel/` | Publicly browse repository folders and ZIPs without authentication |
| GET, HEAD | `/repo/:channel/:file.zip` | Publicly download a revision or `latest.zip` without authentication |

API clients must keep the session cookie returned by login. Get the session CSRF token from login or `/api/session`, and send it in `X-CSRF-Token` on all authenticated writes. Writes require `Content-Type: application/json`, except direct ZIP imports which use `application/zip` or `application/octet-stream`. JSON requests accept at most 1 MB; ZIP imports accept at most 25 MB compressed and 100 MB expanded. Paths are derived from server-generated project IDs, not client-supplied filesystem locations.

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
