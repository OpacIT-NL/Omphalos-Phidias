# OpacIT Omphalos Phidias

Phidias is a browser-based visual automation builder. It lets you build applications from connected blocks, divide them into workspaces, expose HTTP endpoints, work with databases and remote systems, create HTML interfaces, and export each project as an independent Node.js application.

This guide is intended for people using the builder, creating projects, and administering Phidias or its exported applications.

## Requirements

- Node.js 22.13 or newer; Node.js 24 is recommended
- npm
- A current desktop browser
- Persistent storage for `config.json`, the project directory, the repository directory, and the authentication database
- An HTTPS reverse proxy when exposing Phidias outside a trusted network

Some exported workflows also require network access to databases, APIs, SSH servers, or the Phidias authentication broker.

## Install and start Phidias

```sh
npm ci
node server.js
```

The first start creates a local `config.json`. Phidias listens on `127.0.0.1:3000` by default.

Create the first administrator from the server console:

```text
Console$> enable
Console#> conf t
Config#> username admin
Password (hidden):
Confirm password (hidden):
Config#> user admin grant_all
Config#> enable secret
Password (hidden):
Confirm password (hidden):
Config#> exit
Console#> copy run start
```

Open `http://127.0.0.1:3000` and sign in with the account you created. The first account in an empty authentication database is also granted bootstrap administrator access.

For remote access, set the listening host to `0.0.0.0`, place Phidias behind an HTTPS reverse proxy, and enable secure cookies:

```text
Console$> enable
Console#> conf t
Config#> host 0.0.0.0
Config#> auth secure-cookies true
Config#> exit
Console#> copy run start
```

Phidias does not terminate TLS itself.

## Build a project

1. Create a project or use **Import project** to upload an exported ZIP or import one from a URL.
2. Add blocks from the block library and connect action ports and value ports. You can click two ports or drag directly between compatible ports.
3. Create additional workspaces for separate endpoints, scheduled jobs, shared event receivers, or centralized logging.
4. Use workspace groups to organize larger projects. Workspaces and groups can be reordered, renamed, duplicated, deactivated, or deleted from their menus.
5. Hold Ctrl/Cmd or Shift while clicking to select multiple blocks. Shift-drag on the canvas selects blocks in an area. Ctrl/Cmd+C and Ctrl/Cmd+V copy selected blocks and their internal wires. With nothing selected, the same shortcuts copy and paste the workspace.
6. Resize blocks from their lower-right handle. Positions and custom sizes are stored with the project.
7. Save the project with **Save project** or Ctrl/Cmd+S. Saving creates a numbered RC revision and updates the project’s RC `latest.zip`.

A project can contain active and inactive workspaces. Only active workspaces run in the exported application.

### HTTP applications

Use **API Endpoint** to start a workflow from an HTTP request and **API Reply** to return JSON, HTML, or text. Endpoint outputs include the request path, query parameters, headers, and body. Prefix routes are supported, so an endpoint at `/systems` can also receive `/systems/server-01` and expose the remaining subpath.

For authenticated browser pages, connect **Display Login** and **Check If Logged In**. API workflows can use the bearer-token login and token-check blocks. Access is checked against the project and its RC or Prod stage.

### HTML and CSS templates

Open **HTML and CSS templates** from the editor toolbar to manage files in the project’s `html` folder. Use:

- **Get Template** to load an `.html` or `.css` file.
- **Apply Variable** to replace `%variable%` placeholders.
- **Markdown to HTML** for Markdown content.
- Table, detail-page, chart, and form blocks to generate reusable HTML.

Template changes are saved as project revisions and included in exported applications.

### Workspace logging

Workspace settings provide two logging controls:

- **Force log** writes an INFO record for every block that actually executes, regardless of the application log level.
- **Log all runs to log block** sends run and block events to application-wide **On Run ID Created** and **On Workspace Log** triggers.

You can place the logging triggers once in a dedicated active workspace. All enabled workspaces can send events to them. A single Run ID follows the complete workflow, including emitter and receiver continuations across workspaces.

## Versions and deployment profiles

Open **Version manager** to configure RC and Prod independently. Each profile can define:

- Host and port
- Log level
- Application database credential set
- Logging database credential set
- Authentication storage
- Authentication broker URL
- Update URL
- Forced Console Log output

Every save creates an RC revision. Promoting a selected revision creates or updates the Prod copy; later RC saves do not alter Prod. Version manager can download, restore, promote, delete, and clean up revisions while preserving promoted production versions.

Published archives are available without authentication:

```text
/repo/
/repo/<ProjectName>RC/latest.zip
/repo/<ProjectName>RC/<projectname>.rev<N>.zip
/repo/<ProjectName>Prod/latest.zip
/repo/<ProjectName>Prod/<projectname>.rev<N>.zip
```

Treat the repository as public. Do not place secrets in templates, block options, or project files.

## Deploy an exported application

Extract the ZIP on the target server, then run:

```sh
npm install
node app.js
```

You can also use `npm start` after installing dependencies. Exported applications use Node.js 22 or newer and read their host, port, stage, log level, database selections, broker URL, and update URL from the packaged `config.json`. `HOST` and `PORT` can override the packaged listening address when needed.

An authenticated direct export contains a unique `application.key`. Keep it beside `app.js`, restrict it to the operating-system account running the application, and never publish it. Public repository ZIPs exclude this key so an in-place update preserves the key already installed on the server.

The **Update Application** block downloads the configured stage’s `latest.zip` and extracts it over the current application. The host needs `wget` and `unzip`. Restart the application after updating. The **Restart App** block begins a fresh numbered log cycle.

Use a process manager such as AMP or systemd for long-running applications. Stop cleanly with SIGINT or SIGTERM.

## Users, groups, and permissions

Open **ACL** to manage users, groups, and grants. Permissions are additive: a user receives direct permissions plus permissions from every group they belong to.

Core permissions:

- Login
- Manage users
- Create projects
- Console

Per-project permissions:

- Login to RC
- Login to Prod
- View Builder Project
- Edit Builder Project
- Promote to Prod
- Delete Project

Use **CRED** to manage SSH, Windows, MySQL, MSSQL, PostgreSQL, and other credential types. Project blocks retrieve credentials by display name through the configured authentication broker. Credential passwords and private keys are encrypted at rest and are redacted from application and workspace logs.

## Authentication storage and broker

Phidias supports SQLite and MySQL for users, sessions, ACLs, groups, credentials, and application keys.

SQLite is the default. To switch to MySQL, use configuration mode:

```text
Console$> enable
Console#> conf t
Config#> auth storage mysql
MySQL host:
MySQL port [3306]:
MySQL username:
MySQL password (hidden):
MySQL database:
Config#> exit
Console#> copy run start
```

`copy run start` verifies the destination and migrates the complete authentication data set. The source is not deleted. To switch back:

```text
Config#> auth storage sqlite data/auth.sqlite
```

Applications on other servers obtain credentials through the Phidias authentication broker. Enable it on a dedicated address and port:

```text
Config#> auth broker enabled true
Config#> auth broker host 0.0.0.0
Config#> auth broker port 3002
Config#> exit
Console#> copy run start
```

Restart Phidias after changing the authentication backend or broker listener. Set the correct RC and Prod broker URLs in each project’s Version manager.

Applications authenticate with their `application.key`. Broker requests are signed, time-limited, and protected against replay. Credential responses are encrypted for that application before being returned.

## Console administration

The local console and the editor’s **CLI** panel use the same modes:

| Mode | Prompt | Usage |
| --- | --- | --- |
| Disabled | `Console$> ` | Initial mode; enter `enable` or `en` |
| Enabled | `Console#> ` | View status, save configuration, or enter configuration mode |
| Configuration | `Config#> ` | Change running settings with `conf t` |

Useful commands:

| Command | Purpose |
| --- | --- |
| `help` or `?` | Show commands for the current mode |
| `show run` | Show running configuration with secrets redacted |
| `show start` | Show saved configuration with secrets redacted |
| `show status` | Show listener and unsaved-change status |
| `show users` | List accounts and pending changes |
| `show version` | Show the Phidias version |
| `copy run start` | Save settings and pending account changes |
| `conf t` | Enter configuration mode |
| `disable` | Return to disabled mode |
| `shutdown` | Stop Phidias cleanly |

Common configuration commands:

| Command | Purpose |
| --- | --- |
| `host <address>` | Set the builder listening address |
| `port <1-65535>` | Set the builder listening port |
| `log-level <0-4>` | Set console log filtering |
| `file-log-level <0-4>` | Set file log filtering |
| `projects-directory <path>` | Set project storage after restart |
| `auth database <path>` | Set the SQLite path after restart |
| `auth secure-cookies <true-or-false>` | Control the Secure flag on new cookies |
| `console force-input-log <true-or-false>` | Force console command auditing; hidden answers remain redacted |
| `username <name>` | Create an account or reset its password |
| `user create <name>` | Create an account |
| `user password <name>` | Reset an account password |
| `user delete <name>` | Delete an account |
| `user <name> grant_all` | Add a user to Administrators |
| `enable secret` | Set the privileged console password |
| `no enable secret` | Remove the privileged console password |

Running changes remain unsaved until `copy run start`. Paths containing spaces must be quoted. Relative paths resolve beside `server.js`.

## Configuration file

The generated `config.json` starts with these values:

```json
{
  "port": 3000,
  "host": "127.0.0.1",
  "log-level": 3,
  "file-log-level": 3,
  "projects-directory": "projects",
  "auth": {
    "provider": "sqlite",
    "database": "data/auth.sqlite",
    "mysql": null,
    "secureCookies": false,
    "broker": {
      "enabled": false,
      "host": "0.0.0.0",
      "port": 3002
    }
  },
  "console": {
    "enablePasswordHash": null,
    "forceInputLog": false
  }
}
```

`config.json` is machine-local and excluded from releases. Existing files are preserved during upgrades. An invalid file causes startup to fail with an error instead of being silently replaced.

## Logging

Phidias and exported applications create a `log` directory automatically. Each start writes to a new file:

```text
log/yyyy-mm-dd-1.txt
log/yyyy-mm-dd-2.txt
```

The number increases when the application starts or begins a new restart cycle on the same UTC date.

| Level | Included messages |
| --- | --- |
| `0` | Critical |
| `1` | Critical and Error |
| `2` | Critical, Error, and Warning |
| `3` | Critical through Info |
| `4` | Critical through Debug |

Logs contain UTC timestamps and severity. Passwords, private keys, session tokens, authorization headers, cookies, request bodies, and hidden console answers are excluded or redacted. Log files are not deleted automatically, so configure retention on the host.

## Backups and upgrades

Back up these items:

- `config.json`
- The configured projects directory
- The sibling `repo` directory containing revision ZIPs
- `data/phidias.key`
- The SQLite authentication database and its `-wal` and `-shm` files, or the selected MySQL database

For a consistent SQLite file backup, stop Phidias before copying the database files. Store the database on persistent local storage supported by SQLite WAL.

When upgrading Phidias:

1. Stop the builder.
2. Back up the files above.
3. Extract the new release over the application directory.
4. Run `npm install` or `npm ci` when dependencies changed.
5. Start Phidias and review the startup log.

Schema upgrades are additive and preserve existing users, groups, ACLs, sessions, and credentials.

## Troubleshooting

- **The browser keeps returning to login:** enable `auth secure-cookies true` only when accessing Phidias through HTTPS. Secure cookies are not sent over plain HTTP.
- **A credential block cannot connect:** confirm the project’s RC or Prod profile has the correct broker URL and that `application.key` exists beside the exported `app.js`.
- **An application cannot access a database:** verify the correct stage-specific credential set is selected in Version manager and the broker is reachable from the application host.
- **The application starts but AMP shows no output:** lifecycle messages are always written to stdout. Check the application’s current `log/yyyy-mm-dd-N.txt` for startup errors.
- **An update fails:** confirm the stage update URL points to its public `latest.zip`, and that `wget` and `unzip` are installed.
- **A project is missing:** verify the configured `projects-directory`, the user’s project ACL, and that the workspace or project was not deactivated.
- **Configuration changes disappear after restart:** run `copy run start` after changing settings in the console.

## License

Phidias is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
