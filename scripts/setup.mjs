#!/usr/bin/env node
/**
 * Epic Workbench setup.
 * Takes the Epic URL and the repositories, clones what is missing into ./repos,
 * checks each repo, and writes:
 *   - epic-request.md            (the single input file the agents read)
 *   - epic-workbench.code-workspace (open THIS in VS Code)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOS_DIR = join(ROOT, 'repos');

const HELP = `
Usage:
  node scripts/setup.mjs --epic <EPIC_URL> --repos <repo>[,<repo>...] [options]

Repo formats (mix freely):
  owner/repo                      -> https://<host>/owner/repo.git
  repo   (with --owner acme)      -> https://<host>/acme/repo.git
  https://host/owner/repo(.git)   -> used as is
  git@host:owner/repo.git         -> used as is (SSH)

Options:
  --epic <url>        Epic URL (Jira, GitHub issue, Azure DevOps work item, ...)
  --repos <list>      Comma or space separated repos (can be repeated; bare args also count)
  --owner <name>      Default owner/org for bare repo names
  --host <host>       Git host for owner/repo form (default: github.com)
  --protocol <p>      https (default) or ssh, for owner/repo form
  --auto-proceed      Skip the human approval of the analysis IF the Repo Gate passes
  --no-fetch          Do not run "git fetch" on repos that are already cloned
  --dry-run           Show what would happen; clone nothing
  -h, --help          Show this help

Example:
  node scripts/setup.mjs --epic https://acme.atlassian.net/browse/PAY-123 \\
       --repos acme/payments-api,acme/payments-web
`;

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const a = { epic: '', repos: [], owner: '', host: 'github.com', protocol: 'https',
    autoProceed: false, noFetch: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) die(`${k} needs a value`);
      return argv[++i];
    };
    switch (k) {
      case '--epic': a.epic = next(); break;
      case '--repos': a.repos.push(...next().split(/[,\s]+/).filter(Boolean)); break;
      case '--owner': a.owner = next(); break;
      case '--host': a.host = next(); break;
      case '--protocol': a.protocol = next(); break;
      case '--auto-proceed': a.autoProceed = true; break;
      case '--no-fetch': a.noFetch = true; break;
      case '--dry-run': a.dryRun = true; break;
      case '-h': case '--help': a.help = true; break;
      default:
        if (k.startsWith('-')) die(`Unknown option ${k}. Use --help.`);
        a.repos.push(...k.split(/[,\s]+/).filter(Boolean));
    }
  }
  return a;
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60 * 1000,
  }).trim();
}

function tryGit(args, cwd) {
  try { return git(args, cwd); } catch { return null; }
}

const firstLine = (s) => {
  const lines = String(s || '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^(fatal|error):/i.test(l)) || lines[0] || 'unknown error';
};

function parseRepo(spec, a) {
  let url;
  if (/^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/i.test(spec)) {
    url = spec;
  } else {
    const path = spec.replace(/\.git$/, '');
    let full = null;
    if (/^[\w.-]+\/[\w.-]+$/.test(path)) full = path;
    else if (/^[\w.-]+$/.test(path) && a.owner) full = `${a.owner}/${path}`;
    if (!full) return { error: 'Use owner/repo, a full URL, or pass --owner for bare names' };
    url = a.protocol === 'ssh' ? `git@${a.host}:${full}.git` : `https://${a.host}/${full}.git`;
  }
  const name = basename(url.replace(/\.git$/, '').replace(/\/+$/, '').replace(/^.*:(?!\/)/, ''));
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    return { error: `Cannot derive a safe folder name from "${spec}"` };
  }
  return { url, name };
}

function deriveEpicId(url) {
  const jira = url.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  if (jira) return jira[1];
  const gh = url.match(/\/(?:issues|pull)\/(\d+)/);
  if (gh) return `GH-${gh[1]}`;
  const ado = url.match(/workitems?\/(?:edit\/)?(\d+)/i);
  if (ado) return `ADO-${ado[1]}`;
  return 'EPIC-UNKNOWN';
}

function detectStack(p) {
  const has = (f) => existsSync(join(p, f));
  let files = [];
  try { files = readdirSync(p); } catch { /* ignore */ }
  if (has('pom.xml')) return 'Maven: mvn -B verify';
  if (has('build.gradle') || has('build.gradle.kts')) return 'Gradle: ./gradlew test';
  if (has('package.json')) return 'Node: npm ci && npm test (see package.json scripts)';
  if (files.some((f) => /\.(sln|csproj)$/.test(f))) return '.NET: dotnet test';
  if (has('go.mod')) return 'Go: go test ./...';
  if (has('pyproject.toml') || has('requirements.txt')) return 'Python: pytest';
  return 'unknown (check README)';
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(HELP); return; }
  if (!a.epic) die('--epic <url> is required. Use --help.');
  if (!/^https?:\/\/\S+$/i.test(a.epic)) die('--epic must be an http(s) URL');
  if (!a.repos.length) die('At least one repository is required (--repos ...).');
  if (!['https', 'ssh'].includes(a.protocol)) die('--protocol must be https or ssh');

  mkdirSync(REPOS_DIR, { recursive: true });

  const results = [];
  const seen = new Set();
  for (const spec of a.repos) {
    const p = parseRepo(spec, a);
    if (p.error) {
      results.push({ name: spec, url: '-', path: '-', ready: false, note: p.error });
      continue;
    }
    if (seen.has(p.name)) continue;
    seen.add(p.name);

    const dest = join(REPOS_DIR, p.name);
    const r = { name: p.name, url: p.url, path: `repos/${p.name}`, ready: false, note: '' };
    try {
      if (existsSync(join(dest, '.git'))) {
        r.ready = true;
        r.note = 'already cloned';
        if (!a.noFetch && !a.dryRun) tryGit(['fetch', '--quiet', 'origin'], dest);
      } else if (existsSync(dest)) {
        r.note = 'folder exists but is not a git repository';
      } else if (a.dryRun) {
        r.note = 'dry run: would clone';
      } else {
        console.log(`Cloning ${p.url} ...`);
        git(['clone', '--quiet', '--', p.url, dest], ROOT);
        r.ready = true;
        r.note = 'cloned';
      }
    } catch (e) {
      r.note = `clone failed: ${firstLine(e.stderr || e.message)}`;
    }

    if (r.ready) {
      r.remote = tryGit(['remote', 'get-url', 'origin'], dest) || '(no origin)';
      const head = tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], dest);
      r.branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], dest) || 'unknown';
      r.defaultBranch = head ? head.replace(/^origin\//, '') : r.branch;
      const st = tryGit(['status', '--porcelain'], dest);
      r.tree = st === null ? 'unknown' : st === '' ? 'clean' : 'DIRTY';
      r.stack = detectStack(dest);
    }
    results.push(r);
  }

  const epicId = deriveEpicId(a.epic);
  const now = new Date().toISOString();
  const rows = results.map((r) => r.ready
    ? `| ${cell(r.name)} | ${r.path} | ${cell(r.remote)} | ${cell(r.defaultBranch)} | ${cell(r.branch)} | ${r.tree} | READY | ${cell(r.stack)} |`
    : `| ${cell(r.name)} | ${cell(r.path)} | ${cell(r.url)} | - | - | - | UNAVAILABLE: ${cell(r.note)} | - |`);

  const md = `# Epic request

<!-- Generated by scripts/setup.mjs at ${now}. Re-run the script to change it. -->

epic_url: ${a.epic}
epic_id: ${epicId}
auto_proceed: ${a.autoProceed ? 'yes' : 'no'}

\`auto_proceed: yes\` skips the human approval of the analysis, but ONLY when the Repo Gate passes.
Review before PR and any push are always human-only.

## Repository allow-list
Agents may change ONLY the repositories in this table, and only those marked READY.
If the analysis needs any other repository, coding is blocked and you are told what to add.

| Repo | Path | Remote | Default branch | Current branch | Working tree | Availability | Detected build/test (verify) |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
  writeFileSync(join(ROOT, 'epic-request.md'), md);

  const workspace = {
    folders: [
      { name: 'epic-workbench', path: '.' },
      ...results.filter((r) => r.ready).map((r) => ({ name: r.name, path: r.path })),
    ],
    settings: {
      'files.exclude': { repos: true },
      'github.copilot.chat.codeGeneration.useInstructionFiles': true,
    },
  };
  writeFileSync(join(ROOT, 'epic-workbench.code-workspace'), JSON.stringify(workspace, null, 2) + '\n');

  console.log(`\nEpic: ${epicId}  (${a.epic})`);
  for (const r of results) {
    console.log(`  ${r.ready ? 'READY      ' : 'UNAVAILABLE'}  ${r.name}  - ${r.note}${r.tree === 'DIRTY' ? '  [working tree has uncommitted changes]' : ''}`);
  }
  if (results.some((r) => !r.ready)) {
    console.log('\nWarning: some repos are unavailable. Analysis will still run, but coding stays blocked until they are fixed.');
  }
  console.log('\nNext:\n  1. code epic-workbench.code-workspace\n  2. Copilot Chat -> Agent mode -> run /run-epic');
}

main();
