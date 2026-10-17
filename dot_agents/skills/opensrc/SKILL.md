---
name: opensrc
description: Fetch dependency or remote repository source with opensrc to
  investigate implementation details, debug library behavior, or compare
  versions. Use when relevant source is needed beyond local code, types, or API
  documentation.
---

# Opensrc

Use `opensrc path` to locate source, fetching automatically on a cache miss. Check `opensrc --version` and subcommand help when options are uncertain.

## Choose the source

- For npm dependencies, resolve from the target project with `--cwd`; use an explicit version when comparing releases or reproducing a specific issue.
- For PyPI and crates.io, supply the project's version explicitly. For repositories, use a tag or commit when reproducibility matters; a branch can change.

```bash
opensrc path is-number --cwd /path/to/project
opensrc path is-number@7.0.0
opensrc path pypi:six@1.16.0
opensrc path crates:serde@1.0.219
opensrc path jonschlinkert/is-number@7.0.0
```

Confirm the resolved version in the package manifest or version declaration. Monorepos may place the package below the returned repository root. Source snapshots may lack `.git`, so do not rely on `git describe`. State any version mismatch or unresolved provenance before drawing conclusions.

## Investigate

Capture one source path and check success before searching it:

```bash
if src_dir=$(opensrc path is-number@7.0.0); then
  rg --files "$src_dir"
  rg -n 'module\.exports|Number\.isFinite' "$src_dir"
fi
```

Follow the relevant symbol into its implementation, callers, and nearby tests. Read focused sections instead of dumping the repository. When runtime verification is requested, use a small reproduction against the resolved version and distinguish observed results from code inspection.

Report the package or repository, version/ref examined, relevant file and line references, and what the evidence establishes. Mention limitations that affect the answer.

## Cache and failures

- Cache defaults to `~/.opensrc/`; `OPENSRC_HOME` overrides it. Use `opensrc list --json` to inspect cached sources and fetch timestamps. A cached branch snapshot does not establish current upstream behavior.
- Paths go to stdout; diagnostics go to stderr. Keep them separate. Multiple specs produce separate paths, and a failed batch can still emit successful paths before exiting nonzero. Fetch individually when each result needs attribution.
- On failure, inspect the diagnostic and correct the version, repository, or network issue. Do not silently substitute latest or another ref. Use `opensrc path --verbose <spec>` for fetch diagnostics.
- If freshness is required, refresh only the relevant entry using `opensrc remove --help` and fetch again; avoid clearing the entire shared cache.