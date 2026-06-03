# Deployment Runbook

This document records how this site was published and how to maintain the deployment.

## Current Deployment

- Public site: <https://bibliotheque-du-hussard.github.io/le-hussard-links/>
- GitHub repository: <https://github.com/bibliotheque-du-hussard/le-hussard-links>
- GitHub owner: `bibliotheque-du-hussard`
- Branch served by GitHub Pages: `main`
- Pages source path: `/`
- Local remote:

```bash
git@github-personal:bibliotheque-du-hussard/le-hussard-links.git
```

## What Was Done

1. Created a separate personal GitHub CLI profile so the work GitHub login stayed untouched.
2. Created and verified a personal SSH identity for GitHub pushes.
3. Created the public repository `JulianRomana/le-hussard-links`.
4. Committed the static site and pushed `main`.
5. Enabled GitHub Pages from the `main` branch and repository root.
6. Created the GitHub organization `bibliotheque-du-hussard` in the GitHub web UI.
7. Transferred the repository from `JulianRomana` to `bibliotheque-du-hussard`.
8. Updated the local `origin` remote to the org-owned repository.
9. Verified the org GitHub Pages URL returned `HTTP 200`.

## Personal GitHub CLI Profile

The default `gh` profile is the work account. The personal profile uses a separate config directory:

```bash
export GH_CONFIG_DIR="$HOME/.config/gh-personal"
gh auth status
```

Expected personal account:

```text
Logged in to github.com as JulianRomana
```

To use the default work profile again:

```bash
unset GH_CONFIG_DIR
gh auth status
```

## Personal SSH Setup

The personal SSH key is:

```bash
~/.ssh/id_ed25519_github_personal
```

The SSH host alias in `~/.ssh/config` is:

```sshconfig
Host github-personal
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github_personal
  IdentitiesOnly yes
```

Verify personal SSH:

```bash
ssh -T git@github-personal
```

Expected response:

```text
Hi JulianRomana! You've successfully authenticated, but GitHub does not provide shell access.
```

## Initial Publish Commands

These are the commands used for the first publish, summarized for reference:

```bash
git config user.name "JulianRomana"
git config user.email "jjulian.romana@gmail.com"

git add .gitignore .nojekyll README.md app.js data/le-hussard-links.json index.html package.json scripts/update-data.mjs styles.css
git commit -m "Initial static affiliate catalog"

GH_CONFIG_DIR="$HOME/.config/gh-personal" gh repo create JulianRomana/le-hussard-links \
  --public \
  --description "Static catalog of Le Hussard's Amazon links"

git remote add origin git@github-personal:JulianRomana/le-hussard-links.git
git push -u origin main
```

GitHub Pages was enabled with:

```bash
printf '{"source":{"branch":"main","path":"/"}}' \
  | GH_CONFIG_DIR="$HOME/.config/gh-personal" gh api \
      --method POST \
      repos/JulianRomana/le-hussard-links/pages \
      --input -
```

## Organization Transfer

After creating the organization in the GitHub web UI, the repo was transferred with:

```bash
GH_CONFIG_DIR="$HOME/.config/gh-personal" gh api \
  --method POST \
  repos/JulianRomana/le-hussard-links/transfer \
  -f new_owner=bibliotheque-du-hussard
```

Then the local remote was updated:

```bash
git remote set-url origin git@github-personal:bibliotheque-du-hussard/le-hussard-links.git
```

## Verify Deployment

Check Pages status:

```bash
GH_CONFIG_DIR="$HOME/.config/gh-personal" gh api \
  repos/bibliotheque-du-hussard/le-hussard-links/pages \
  --jq '{html_url, status, source}'
```

Expected:

```json
{
  "html_url": "https://bibliotheque-du-hussard.github.io/le-hussard-links/",
  "status": "built",
  "source": {
    "branch": "main",
    "path": "/"
  }
}
```

Check the public site:

```bash
curl -I -L https://bibliotheque-du-hussard.github.io/le-hussard-links/
```

Expected: `HTTP/2 200`.

Check the deployed catalog data:

```bash
curl -s -L https://bibliotheque-du-hussard.github.io/le-hussard-links/data/le-hussard-links.json > /tmp/le-hussard-pages-data.json
node -e "const data=require('/tmp/le-hussard-pages-data.json'); const links=data.videos.flatMap(v=>v.links); console.log(data.videos.length + ' videos, ' + links.length + ' links');"
```

## Routine Deploys

After editing the site or updating `data/le-hussard-links.json`:

```bash
git status --short
git add .
git commit -m "Describe the change"
git push
```

GitHub Pages rebuilds automatically after the push. It may take a minute or two for the hosted site to update because GitHub Pages is cached.

## Important Notes

- Keep using `git@github-personal:...` for personal/org remotes so pushes use the personal SSH key.
- Keep using `GH_CONFIG_DIR="$HOME/.config/gh-personal"` for GitHub CLI commands that should run as `JulianRomana`.
- `.nojekyll` is included so GitHub Pages serves the static files directly.
- The site is static and does not need a build step.
