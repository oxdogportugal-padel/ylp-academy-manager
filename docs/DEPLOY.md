# Deploying Bandeja from GitHub

Every push to `main` runs the full test suite on GitHub Actions
(`.github/workflows/ci.yml`). When the tests pass **and** Catalyst is
connected, the same run deploys:

1. the `api` function — `catalyst deploy --only functions:api`
2. the Slate app `padel-planner-slate` — `catalyst deploy slate padel-planner-slate`

to the **Development** environment. Production stays a console action.

Until Catalyst is connected, the deploy job runs, says why it skipped, and
stops — nothing breaks.

---

## Connecting Catalyst — once, on your computer (~10 minutes)

The Catalyst CLI needs a human to log in once. Everything after that is
automatic. Commands below are from the CLI's own `--help` (zcatalyst-cli
1.29.1, the version the workflow pins).

### 1. Install the CLI and log in

```bash
npm install -g zcatalyst-cli@1.29.1
```

```bash
catalyst login
```

Pick the **EU** data center and sign in as `info@youlovepadel.pt`.

### 2. Get the repository

```bash
git clone https://github.com/oxdogportugal-padel/ylp-academy-manager.git
```

```bash
cd ylp-academy-manager
```

### 3. Let `catalyst init` write the project config

```bash
catalyst init --project 5361000000043001 --org 20105401867
```

- Choose **Functions** (not Client: the client is a Slate app, step 4).
- Point it at the existing **`api`** function in `functions/api`. If it offers
  to create a new function or overwrite `functions/api/index.js`, say no.

### 4. Link the client folder to the existing Slate app

```bash
catalyst slate:link --source client --name padel-planner-slate
```

The app is plain HTML, no framework (`client/.catalyst/slate-config.toml`
already says `framework = "static"`).

### 5. Check that only config files changed

```bash
git status
```

```bash
git diff
```

You should see **new** `catalyst.json` and `.catalystrc` (and perhaps a
change to `client/.catalyst/slate-config.toml`) and **no** changes to
`functions/api/index.js`, `client/index.html` or `client/admin.html`. If code
was touched, undo it with `git checkout -- <file>` before committing.

```bash
git add catalyst.json .catalystrc client/.catalyst/slate-config.toml
```

```bash
git commit -m "Connect Catalyst for automatic deploys"
```

### 6. Create the deploy token and give it to GitHub

```bash
catalyst token:generate
```

Copy the token it prints. On GitHub: the repository → **Settings → Secrets and
variables → Actions → New repository secret**, name it `CATALYST_TOKEN`, paste
the token. It is a password for your Catalyst account: never commit it or paste
it anywhere else. `catalyst token:list` / `catalyst token:revoke <id>` manage it.

### 7. Push

```bash
git push origin main
```

Open the repository's **Actions** tab: the run tests, then deploys.

---

## If something is off after the first automatic deploy

- **The Slate address changed.** If step 4 created a new Slate app instead of
  linking `padel-planner-slate`, it will have a new `*.onslate.eu` address.
  Then `APP_URL` at the top of `functions/api/index.js` (where invitations send
  people) must be set to it, and the redirect URL under Authentication in the
  Catalyst console too. Ask Claude to do the code part.
- **`app/` missing.** `client/app/index.html` forwards Catalyst's post-login
  `/app/` to the planner. It is in the repository, so it ships with every
  deploy — but if login ends on a 404, check it is there.
- **The deploy job fails with an auth error.** The token was revoked or
  expired: generate a new one (step 6) and replace the secret.

## Releasing by hand still works

The zip uploads used so far remain a fallback: the function folder with
`node_modules`, and the `client` folder's `index.html`, `admin.html` and
`app/index.html`.
