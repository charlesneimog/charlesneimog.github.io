# Charles K. Neimog — Website / Portfolio

Welcome to my personal website.  

Here you’ll find my work as composer, researcher, and audio-developer: compositions, software projects, research articles, blog posts, and more.

## 🚀 What’s inside

- **Works** — Compositions (acoustic, electroacoustic, installations)  
- **Software** — Tools and libraries I develop (e.g. py4pd, pd4web)  
- **Research** — Papers on music theory, microtonality, just intonation, and audio-tech research  
- **Blog / Articles** — Thoughts, essays and writings on music, technology and art  
- **Talks & Presentations** — Academic and public presentations  

## Tools

* **Encrypt presentations**: `python3 talks/encrypt.py` (also extracts generated JavaScript and CSS into the shared asset folders).
* **Encrypt class lessons**: set `encrypt` in each `course.json`, then run `python3 classes/encrypt.py`. See [classes/README.md](classes/README.md) for the reversible editing workflow and password environment variables.
* **Update CSS style**: `tailwindcss -i css/input.css -o css/output.css`
* **Extract inline page assets**: `python3 scripts/extract_page_assets.py path/to/index.html`
* **Refresh content URLs, metadata and homepage links**: `node scripts/build-content.cjs` after editing Music, Research or Blog JSON. This updates the existing homepage; it creates no detail pages.
* **Update the sitemap**: `python3 scripts/github-sites.py` (use `--dry-run` to inspect first). See [scripts/README.md](scripts/README.md) for URL compatibility, cache/progress options and SEO limitations on GitHub Pages.

## Deploying to a private server

The repository can remain private. A GitHub Actions workflow publishes a
filtered static artifact to `/srv/charles-site` over SSH, and Caddy serves that
directory over HTTPS. Git history, repository instructions, build scripts,
Typst sources, and backup files are not deployed.

The instructions below assume Ubuntu or Debian, a domain whose DNS points to
the server, and inbound TCP ports 80 and 443. Replace example values before
running commands. Do not commit or send private keys or plaintext passwords.

### 1. Prepare the server

Install the web server and synchronization tool:

```sh
sudo apt update
sudo apt install caddy rsync
```

Create an unprivileged deployment account and a web root that Caddy can read:

```sh
sudo adduser --disabled-password --gecos "" deploy
sudo install -d -o deploy -g caddy -m 2750 /srv/charles-site
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
sudo install -o deploy -g deploy -m 600 /dev/null /home/deploy/.ssh/authorized_keys
```

The workflow deliberately deploys into the fixed `/srv/charles-site` path.
Keep that path, or update both `deploy/Caddyfile` and
`.github/workflows/deploy.yml` together.

### 2. Create the deployment SSH key

Create a dedicated key on an administrator workstation, not on the web server:

```sh
ssh-keygen -t ed25519 -f github-actions-deploy -C "github-actions-deploy"
```

Append the contents of `github-actions-deploy.pub` to the server's
`/home/deploy/.ssh/authorized_keys`. Prefixing the line with `restrict` disables
port forwarding, agent forwarding, and PTY allocation while still allowing the
`rsync` command used by the workflow:

```text
restrict ssh-ed25519 AAAA... github-actions-deploy
```

Use the server console or an existing administrator account to edit that file,
then restore its ownership and permissions:

```sh
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Keep `github-actions-deploy` (without `.pub`) private. Its contents will become
the GitHub `DEPLOY_SSH_KEY` secret.

Record the server's SSH host key from a trusted connection. For example, on the
server:

```sh
sudo cat /etc/ssh/ssh_host_ed25519_key.pub
```

Combine the resulting public key with the hostname in known-hosts format:

```text
your-domain.example ssh-ed25519 AAAA...
```

This complete line will become the `DEPLOY_KNOWN_HOSTS` secret. Verify the key
fingerprint through the server console before trusting it.

### 3. Configure Caddy and HTTPS

Generate a separate password for the server-side `/classes/` gate and hash it:

```sh
caddy hash-password
```

Create `/etc/caddy/site.env` with the real domain and the generated hash:

```text
SITE_DOMAIN=your-domain.example
CLASSES_PASSWORD_HASH='$2a$...'
```

Protect that file and make it available to the Caddy service:

```sh
sudo chown root:root /etc/caddy/site.env
sudo chmod 600 /etc/caddy/site.env
sudo systemctl edit caddy
```

Add this systemd override in the editor:

```ini
[Service]
EnvironmentFile=/etc/caddy/site.env
```

Copy `deploy/Caddyfile` from an administrator checkout to the server; it is
intentionally excluded from the public web artifact. Install the copied file
and validate it:

```sh
sudo install -o root -g root -m 644 /path/to/copied/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Caddy obtains and renews the TLS certificate automatically after the domain's
DNS records point to this server and ports 80 and 443 are reachable. The
`basic_auth` rule protects the entire `/classes/*` path at the server, including
raw lesson Markdown, audio, and PDFs. The existing browser-side course prompt
may therefore appear as a second login; it is retained for compatibility, but
it is not the security boundary.

### 4. Configure GitHub Actions

In the private GitHub repository, open **Settings → Secrets and variables →
Actions** and create these repository or `production` environment secrets:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | Server DNS name or IP address |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Complete private deployment key |
| `DEPLOY_KNOWN_HOSTS` | Verified known-hosts line from the previous step |
| `DEPLOY_PORT` | Optional SSH port; defaults to `22` |

The workflow at `.github/workflows/deploy.yml` runs after every push to `main`
and can also be started manually. It builds `_site`, checks that excluded files
did not enter the artifact, then synchronizes it with `rsync --delete`. Files
removed from the repository are consequently removed from the server on the
next successful deployment.

The `deploy` account must own `/srv/charles-site`; it does not need `sudo`.
GitHub Actions receives read-only repository permission, and the server stores
only the filtered site—not a Git checkout or its history.

### 5. Migrate the public URL

This repository currently contains absolute references and canonical metadata
using `https://charlesneimog.github.io`. Hosting it under another domain will
work only partially until those references are migrated. Locate them with:

```sh
rg -l 'https://charlesneimog\.github\.io'
```

Replace them with the final HTTPS origin, then run the relevant content and
sitemap tools listed above and test the site before disabling GitHub Pages.
The `github.io` subdomain itself cannot be pointed at a private server; use a
domain you control.

### 6. Verify a deployment

After the workflow succeeds, check at least:

```sh
curl -I https://your-domain.example/
curl -I https://your-domain.example/classes/
curl -I https://your-domain.example/classes/2026/LM-Harmonia-II/aula1.md
```

The home page should return `200`. Unauthenticated `/classes/` requests should
return `401`, and the same credentials should allow the class page and its raw
assets. Also confirm that `https://your-domain.example/.git/HEAD` and
`https://your-domain.example/AGENTS.md` return `404`.
