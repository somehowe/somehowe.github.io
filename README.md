# Ryan Howe

Personal website with an interactive orbital home, project index, writing and video reader, and a public GitHub-backed coding-practice feed.

## Build

Use Node.js 24 or later:

```sh
npm ci
npm run build
npm test
```

The maintained source lives on the `source` branch. Its build output is `docs/`; the contents of that directory are published at the root of `main`. GitHub Pages serves `main` from `/`. This keeps the source project separate from the deployment tree.

For future updates, check out `source`, edit the files, run the commands above, and commit the source and rebuilt `docs/`. Publish the **contents** of `docs/` to `main`, preserving the live branch's `CNAME` if GitHub Pages has added a custom domain. The site uses root-relative URLs, suitable for the account's Pages site or a custom domain.

## Edit

- `src/space/`: orbital home and interaction logic.
- `src/reader/`: public project, writing, video, notes, and practice pages.
- `public/`: original images, local fonts and licenses, résumé, practice snapshot, and the 404 page.
- `content/publications.json`: published documents only. Each entry keeps its `slug`, `kind` (`essay`, `video`, or `note`), `status: "published"`, title, summary, Markdown body, tags, dates, optional video URL, and attachments.
- `content/media/`: files referenced by published documents, served at `/media/`.

Markdown supports LaTeX math, code blocks, heading links, and footnotes. Directories for all project and published-document URLs are generated during the build, so direct links work on GitHub Pages. The coding-practice page reads public activity from `somehowe/leetcode-practice` and uses the included snapshot when GitHub is unavailable.

The build projects documents through an explicit public-field allowlist, rejects draft/deleted records, and copies only media referenced by published documents. `public/CNAME` supplies `ryanahowe.com` on a clean build. An existing `docs/CNAME` is preserved across rebuilds; domain configuration belongs in GitHub Pages settings.

This public repository contains no publishing studio, server endpoints, credentials, drafts, or private revision history. It is a static reader; publishing changes happens through source updates. Third-party assets and libraries are credited in `public/assets/THIRD-PARTY-LICENSES.txt` and the font license files.
