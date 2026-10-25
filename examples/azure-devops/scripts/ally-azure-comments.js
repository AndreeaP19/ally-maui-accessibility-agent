// Posts an Ally "Findings Report Format" report (see .github/agents/ally.md)
// to an Azure DevOps pull request: a summary thread, then one thread per
// finding anchored inline to its file and line. Also decides whether the
// build should fail, using the failOn gate from .allyconfig.json.
//
// Mirrors the GitHub Actions workflow in AndreeaP19/ally-maui-accessibility-agent.
// Azure DevOps has no "review" object, so each finding is its own PR thread.
//
// Inputs (environment): SYSTEM_ACCESSTOKEN, SYSTEM_COLLECTIONURI,
// SYSTEM_TEAMPROJECT, BUILD_REPOSITORY_ID, SYSTEM_PULLREQUEST_PULLREQUESTID,
// ALLY_REPORT_PATH, ALLY_CHANGED_FILES_PATH, ALLY_EXIT_CODE.
// Set ALLY_DRY_RUN=1 to print what would be posted instead of calling Azure.
//
// Output: sets the pipeline variables allyShouldFail and allyFailingTiers.

const fs = require('fs');

const env = process.env;
const DRY_RUN = env.ALLY_DRY_RUN === '1';

const ORDER = ['critical', 'major', 'minor', 'info'];
const ICONS = { critical: '🔴', major: '🟠', minor: '🟡', info: '⚪' };

// Azure DevOps CommentThreadStatus
const ACTIVE = 1;
const CLOSED = 4;

function setVariable(name, value) {
  console.log(`##vso[task.setvariable variable=${name}]${value}`);
}

function readFailOn() {
  const configPath = '.allyconfig.json';
  if (!fs.existsSync(configPath)) {
    throw new Error('.allyconfig.json is missing at the repo root.');
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error('Failed to parse .allyconfig.json as JSON.');
  }
  const value = String(config.failOn || '').toLowerCase();
  if (!ORDER.includes(value)) {
    throw new Error('.allyconfig.json failOn must be one of: critical, major, minor, info.');
  }
  return value;
}

function readLines(path) {
  if (!path || !fs.existsSync(path)) return [];
  return fs.readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// Ally reports paths as it sees them (often relative to a project folder);
// Azure DevOps needs the path from the repo root. Match against the files
// the PR actually changed.
function resolveRepoPath(reported, changedFiles) {
  const wanted = reported.replace(/\\/g, '/').replace(/^\.?\//, '');
  const exact = changedFiles.find((f) => f === wanted);
  if (exact) return exact;
  const suffix = changedFiles.find((f) => f.endsWith(`/${wanted}`));
  return suffix || wanted;
}

// True when `text` is exactly one XML element: one root, fully closed, with
// nothing else before or after it.
function isSingleElement(text) {
  const re = /<(\/?)([A-Za-z_][\w.:]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const trimmed = text.trim();
  const leading = text.length - text.trimStart().length;
  let depth = 0;
  let end = 0;
  let match;
  let first = true;
  while ((match = re.exec(text))) {
    if (first && match.index !== leading) return false;
    first = false;
    if (match[1]) depth--;
    else if (!match[4]) depth++;
    if (depth < 0) return false;
    end = re.lastIndex;
    if (depth === 0 && end !== leading + trimmed.length) return false;
  }
  return !first && depth === 0 && end === leading + trimmed.length;
}

// Turns Ally's fix into a ```suggestion block when it is a safe drop-in
// replacement for one element in the file. The fix must be exactly one XML
// element, and the element it replaces is located like this, in order:
//   1. an element of the same control whose text matches the finding's
//      Element quote (ignoring whitespace), when exactly one does;
//   2. otherwise the nearest element of the same control that encloses the
//      reported line and shares an identifying attribute with the fix (Ally
//      often points at an attribute line, or is off by a few lines, and it
//      quotes multi-line elements on one line).
// The replaced range is that element's real extent in the file. Anything
// that doesn't match stays a plain code block, because one click on "apply
// suggestion" must never break the XAML. Returns { suggestion } or { reason }.
function buildSuggestion(path, line, fix, element) {
  if (!fix) return { reason: 'the finding has no fix text' };
  if (!fs.existsSync(path)) return { reason: `${path} is not in the checkout` };
  // Accept ```xml, ```xaml or a bare ``` fence.
  const blocks = [...fix.matchAll(/```(?:xml|xaml)?[ \t]*\r?\n([\s\S]*?)\r?\n```/gi)];
  if (blocks.length !== 1) return { reason: `the fix has ${blocks.length} code blocks (needs exactly 1)` };

  const fileLines = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const fixLines = blocks[0][1].split(/\r?\n/);
  if (!isSingleElement(fixLines.join('\n'))) return { reason: 'the fix is not exactly one XML element' };

  const tagOf = (l) => (l.trim().match(/^<([A-Za-z_][\w.:]*)/) || [])[1];
  const fixTag = tagOf(fixLines.find((l) => l.trim()) || '');

  // Last line (1-based) of the element that starts on `startLine`, or null.
  const extentFrom = (startLine) => {
    for (let e = startLine; e <= Math.min(fileLines.length, startLine + 300); e++) {
      if (isSingleElement(fileLines.slice(startLine - 1, e).join('\n'))) return e;
    }
    return null;
  };
  const squash = (t) => t.replace(/\s+/g, '');

  let start = null;
  let end = null;

  const quote = (element || '').replace(/^`+|`+$/g, '').trim();
  if (quote.startsWith('<') && !quote.includes('...') && !quote.includes('…')) {
    const matches = [];
    for (let i = 1; i <= fileLines.length; i++) {
      if (tagOf(fileLines[i - 1]) !== fixTag) continue;
      const e = extentFrom(i);
      if (e && squash(fileLines.slice(i - 1, e).join('')) === squash(quote)) matches.push({ start: i, end: e });
    }
    if (matches.length === 1) ({ start, end } = matches[0]);
  }

  // Ally's line numbers drift (often by 10+ lines further down a file), so a
  // line alone can land inside a neighbouring element of the same control.
  // Only trust the line when the element also shares an identifying attribute
  // (x:Name, Text, Source...) with the fix.
  const IDENTITY = ['x:Name', 'Text', 'Source', 'Title', 'Placeholder', 'IconImageSource', 'Command', 'Clicked'];
  const identityOf = (text) => {
    const pairs = new Set();
    for (const m of text.matchAll(/([\w:.]+)\s*=\s*"([^"]*)"/g)) {
      if (IDENTITY.includes(m[1])) pairs.add(`${m[1]}=${m[2]}`);
    }
    return pairs;
  };
  const fixIdentity = identityOf(fixLines.join('\n'));
  let nearest = null;

  if (!start) {
    for (let i = Math.min(line, fileLines.length); i >= Math.max(1, line - 30); i--) {
      if (tagOf(fileLines[i - 1]) !== fixTag) continue;
      const e = extentFrom(i);
      if (!e || e < line) continue;
      nearest = nearest || i;
      const shared = [...identityOf(fileLines.slice(i - 1, e).join('\n'))].some((pair) => fixIdentity.has(pair));
      if (shared) { start = i; end = e; break; }
    }
  }
  if (!start) {
    return {
      reason: nearest
        ? `the <${fixTag}> at line ${nearest} shares no identifying attribute with the fix and none matches the quoted element`
        : `no <${fixTag}> element encloses line ${line} and none matches the quoted element`,
    };
  }

  // Fix snippets are written from column 0; match the file's indentation.
  const indent = fileLines[start - 1].match(/^\s*/)[0];
  const fixIndent = Math.min(...fixLines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
  const text = fixLines.map((l) => (l.trim() ? indent + l.slice(fixIndent) : '')).join('\n');

  return {
    suggestion: {
      block: '```suggestion\n' + text + '\n```',
      startLine: start,
      endLine: end,
      endOffset: fileLines[end - 1].length + 1,
    },
  };
}

function parseFindings(report, changedFiles) {
  const blocks = report.split(/^###\s+FINDING:\s*/m).slice(1);
  const findings = [];

  for (const block of blocks) {
    const titleLine = block.split(/\r?\n/, 1)[0].trim();
    const ruleId = (titleLine.match(/^([A-Z0-9_]+)/) || ['', titleLine])[1];

    const fields = {};
    for (const row of block.matchAll(/^\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*$/gm)) {
      const key = row[1].trim();
      if (key.toLowerCase() === 'property' || /^-+$/.test(key)) continue;
      fields[key] = row[2].trim();
    }

    const problemMatch = block.match(/\*\*The Problem:\*\*\s*([\s\S]*?)(?=\n\*\*Fix:\*\*|$)/);
    const fixMatch = block.match(/\*\*Fix:\*\*\s*([\s\S]*)$/);
    const problem = problemMatch ? problemMatch[1].trim() : '';
    const fix = fixMatch ? fixMatch[1].trim() : '';

    const severity = (fields.Severity || '').replace(/[^a-z]/gi, '').toLowerCase();
    const header = `${ICONS[severity] || '⚪'} **${titleLine}** (${fields.Confidence || 'unknown'} confidence)`;
    const detail = [
      ...(fields.Element ? [`> ${fields.Element}`, ''] : []),
      ...(problem ? [`**The Problem:** ${problem}`, ''] : []),
      ...(fix ? [`**Fix:**\n${fix}`] : []),
    ];

    const fileMatch = (fields.File || '').match(/^(.+?):(\d+)(?:-\d+)?\s*$/);
    const path = fileMatch ? resolveRepoPath(fileMatch[1], changedFiles) : null;
    const line = fileMatch ? parseInt(fileMatch[2], 10) : null;
    const built = path ? buildSuggestion(path, line, fix, fields.Element) : { reason: 'the report has no file and line for it' };
    const suggestion = built.suggestion || null;
    findings.push({
      ruleId,
      header,
      detail,
            // Explanation first, then the suggestion block on its own: no label or
      // wording from Ally around it, so nothing can stop it being recognised.
      suggestionDetail: suggestion ? [...detail.slice(0, -1), suggestion.block] : null,
      suggestion,
      suggestionReason: built.reason,
      fileText: fields.File || '',
      path,
      line,
    });
  }
  return findings;
}

function createClient() {
  const threadsBase =
    `${env.SYSTEM_COLLECTIONURI}${encodeURIComponent(env.SYSTEM_TEAMPROJECT)}` +
    `/_apis/git/repositories/${env.BUILD_REPOSITORY_ID}` +
    `/pullRequests/${env.SYSTEM_PULLREQUEST_PULLREQUESTID}/threads`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + Buffer.from(`:${env.SYSTEM_ACCESSTOKEN}`).toString('base64'),
  };

  async function call(method, url, body) {
    const res = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from ${method} PR threads: ${text}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  return {
    // marker -> [{ id, active }] for every Ally comment already on the PR
    async existingMarkers() {
      const markers = new Map();
      if (DRY_RUN) return markers;
      const data = await call('GET', `${threadsBase}?api-version=7.1`);
      for (const thread of data.value || []) {
        if (thread.isDeleted) continue;
        const active = thread.status === 'active' || thread.status === 1;
        for (const comment of thread.comments || []) {
          for (const m of (comment.content || '').matchAll(/<!-- (ally-[^ ]+) -->/g)) {
            if (!markers.has(m[1])) markers.set(m[1], []);
            markers.get(m[1]).push({ id: thread.id, active });
          }
        }
      }
      return markers;
    },
    async postThread(content, status, location) {
      const body = { comments: [{ parentCommentId: 0, content, commentType: 1 }], status };
      if (location) {
        // A ```suggestion block replaces exactly the anchored range, so
        // suggestion threads span from the start of the first line to the
        // end of the last one.
        body.threadContext = {
          filePath: `/${location.path}`,
          rightFileStart: { line: location.line, offset: 1 },
          rightFileEnd: { line: location.endLine || location.line, offset: location.endOffset || 1 },
        };
      }
      if (DRY_RUN) {
        console.log(`--- DRY RUN thread (status ${status}) ${JSON.stringify(body.threadContext || 'no anchor')}\n${content}\n`);
        return;
      }
      await call('POST', `${threadsBase}?api-version=7.1`, body);
    },
    async closeThread(id) {
      if (DRY_RUN) {
        console.log(`--- DRY RUN close thread ${id}`);
        return;
      }
      await call('PATCH', `${threadsBase}/${id}?api-version=7.1`, { status: CLOSED });
    },
  };
}

async function main() {
  const failOn = readFailOn();
  const reportPath = env.ALLY_REPORT_PATH || 'ally-report.md';
  const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  const changedFiles = readLines(env.ALLY_CHANGED_FILES_PATH);
  const client = createClient();
  const seen = await client.existingMarkers();

  // Every thread carries a hidden marker so re-runs on the same PR don't
  // repeat comments that are already there.
  async function postOnce(marker, content, status, location) {
    if (seen.has(marker)) {
      console.log(`Skipping ${marker}: already posted on this PR.`);
      return;
    }
    await client.postThread(`${content}\n\n<!-- ${marker} -->`, status, location);
    seen.set(marker, []);
  }

  // An unset pipeline variable arrives as the literal text "$(allyExitCode)".
  const exitCode = /^\d+$/.test(env.ALLY_EXIT_CODE || '') ? env.ALLY_EXIT_CODE : '0';

  if (exitCode !== '0') {
    await postOnce(
      `ally-failed:${exitCode}`,
      `## ⚠️ Ally audit failed to run\n\nThe Copilot CLI exited with code ${exitCode}.\n\n` +
        '```\n' + report.slice(0, 20000) + '\n```',
      ACTIVE,
    );
    setVariable('allyShouldFail', 'true');
    setVariable('allyFailingTiers', 'Ally did not run');
    return;
  }

  const summary = report.match(
    /<!--\s*FINDINGS_SUMMARY:\s*critical=(\d+)\s+major=(\d+)\s+minor=(\d+)\s+info=(\d+)\s*-->/,
  );
  if (!summary) {
    await postOnce(
      'ally-unparsed',
      '## ⚠️ Ally audit report could not be parsed\n\n' +
        "Ally's output didn't include the expected `FINDINGS_SUMMARY` marker (see the " +
        '"Findings Report Format" section of `.github/agents/ally.md`), so results can\'t be ' +
        'reliably posted or gated. Treating this as a failure rather than reporting "no findings."\n\n' +
        '```\n' + report.slice(0, 20000) + '\n```',
      ACTIVE,
    );
    setVariable('allyShouldFail', 'true');
    setVariable('allyFailingTiers', 'Unparseable Ally report');
    return;
  }

  // The report parsed, so earlier "failed to run" / "could not be parsed"
  // threads are stale. Close them so they don't block a resolve-all policy.
  for (const [marker, threads] of seen) {
    if (marker !== 'ally-unparsed' && !marker.startsWith('ally-failed:')) continue;
    for (const old of threads) {
      if (!old.active) continue;
      try {
        await client.closeThread(old.id);
      } catch (err) {
        console.log(`##[warning]Could not close stale thread ${old.id}: ${err.message}`);
      }
    }
  }

  const counts = {};
  ORDER.forEach((tier, i) => { counts[tier] = parseInt(summary[i + 1], 10); });
  const total = ORDER.reduce((sum, tier) => sum + counts[tier], 0);
  const summaryLine = ORDER.map((t) => `${ICONS[t]} ${t[0].toUpperCase() + t.slice(1)}: ${counts[t]}`).join('   ');

  await postOnce(
    `ally-summary:${ORDER.map((t) => counts[t]).join('-')}`,
    total === 0
      ? '## 🔍 Ally Accessibility Audit\n\n✅ No accessibility findings detected.'
      : `## 🔍 Ally Accessibility Audit\n\nFindings by severity: ${summaryLine}`,
    CLOSED,
  );

  for (const f of parseFindings(report, changedFiles)) {
    // A suggestion has its own marker, so a plain comment from an earlier run
    // doesn't stop the upgrade to a suggestion on a later one.
    const base = `ally-finding:${f.ruleId}:${f.path || f.fileText || 'unknown'}:${f.line || 0}`;
    const suggestionMarker = `${base}:suggestion`;
    const plain = [f.header, '', ...f.detail].join('\n');
    const withFile = [f.header, '', `**File:** ${f.fileText || 'unknown'}`, '', ...f.detail].join('\n');

    console.log(
      `${f.ruleId} at ${f.fileText || 'no location'}: ` +
        (f.suggestion
          ? `suggestion for lines ${f.suggestion.startLine}-${f.suggestion.endLine}` + (f.suggestion.startLine !== f.line ? ` (reported line ${f.line})` : '')
          : `plain comment, not a suggestion because ${f.suggestionReason}`),
    );
    if (seen.has(suggestionMarker) || (!f.suggestion && seen.has(base))) {
      console.log('  already posted on this PR, skipping.');
      continue;
    }

    // Most specific first, falling back so a finding is never dropped:
    // 1. applicable suggestion spanning the element's lines
    // 2. plain comment on the first line
    // 3. general thread that names the file
    const attempts = [];
    if (f.suggestion) {
      attempts.push({
        marker: suggestionMarker,
        body: [f.header, '', ...f.suggestionDetail].join('\n'),
        location: { path: f.path, line: f.suggestion.startLine, endLine: f.suggestion.endLine, endOffset: f.suggestion.endOffset },
      });
    }
    if (f.path) attempts.push({ marker: base, body: plain, location: { path: f.path, line: f.line } });
    attempts.push({ marker: base, body: withFile, location: null });

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        await postOnce(attempt.marker, attempt.body, ACTIVE, attempt.location);
        if (attempt.marker === suggestionMarker) {
          // Replace the plain version an earlier run left behind.
          for (const old of seen.get(base) || []) {
            if (!old.active) continue;
            try {
              await client.closeThread(old.id);
            } catch (err) {
              console.log(`##[warning]Could not close the earlier plain comment (thread ${old.id}): ${err.message}`);
            }
          }
        }
        break;
      } catch (err) {
        if (i === attempts.length - 1 || err.status === 401 || err.status === 403) throw err;
        console.log(`##[warning]Could not post ${f.ruleId} for ${f.path}:${f.line} (${err.message}); trying a simpler anchor.`);
      }
    }
  }

  const failIdx = ORDER.indexOf(failOn);
  const failingTiers = ORDER.slice(0, failIdx + 1).filter((tier) => counts[tier] > 0);
  setVariable('allyShouldFail', failingTiers.length > 0 ? 'true' : 'false');
  setVariable('allyFailingTiers', failingTiers.join(', '));
}

main().catch((err) => {
  console.log(`##[error]${err.message}`);
  process.exit(1);
});
