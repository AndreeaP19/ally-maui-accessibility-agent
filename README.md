# Ally — MAUI Accessibility Agent

**Ally** is a GitHub Copilot coding agent that audits and fixes accessibility issues in .NET MAUI XAML files. It enforces WCAG 2.2 AA compliance, generates localized `SemanticProperties` and `AutomationProperties`, and operates with configurable severity gates and safe, confirmation-first behavior.

---

## Features

- 🔍 **Automated XAML accessibility audits** — scans active files or entire projects
- 🌐 **Localization-first** — all generated strings use a markup-extension binding to the resource class; never hardcoded values
- 🛡️ **WCAG 2.2 AA enforcement** — rule catalog covering critical blockers through informational notes
- ⚙️ **Configurable** — `.allyconfig.json` controls resource paths, key naming, severity gates, and exclusions
- 🧩 **Optional `maui-accessibility` skill integration** — treated as the semantics authority when installed; falls back to built-in rules if missing or erroring
- ✅ **Confirmation-gated writes** — nothing is written until you explicitly approve the apply checkpoint
- 🔕 **Suppressions** — inline or config-level, always requiring a reason

---

## Getting Started

### 1. Load the agent

The agent prompt lives at `.github/agents/ally.md`. Open the Copilot chat panel in your IDE, ensure the agent is listed in the Tools panel, then run:

```
/ally feedback
```

If Ally responds with findings (or confirms no issues), the agent loaded correctly.

> **Tip:** If Ally can read your code but cannot write files, the `edit` tool identifier in `ally.md` may not match your IDE. Check the Tools list in the chat panel and update the `tools` frontmatter accordingly.

### 2. Configure the project

Run the configuration wizard once before the first scan (or whenever you need to update settings):

```
/ally config
```

The wizard asks **one question at a time** and detects your `.resx` resource files automatically. It produces a `.allyconfig.json` file at the project root, then starts an audit using that configuration.

### 3. Audit your XAML

**Read-only audit (no files written):**

```
/ally feedback
```

**Audit only what changed, relative to a base branch:**

```
/ally diff main
```

**Audit + apply fixes:**

```
/ally apply
```

---

## Commands

| Command | Description |
|---|---|
| `/ally feedback` | Read-only audit. Shows all findings with rule IDs, severity, and confidence. No files are written. |
| `/ally diff [base-branch]` | Read-only, diff-scoped audit. Reports findings only for changed hunks (±3 lines) in files modified relative to `[base-branch]`. No files are written — the safe entry point for CI. |
| `/ally config` | Interactive setup wizard. Detects `.resx` files, namespace aliases, and key naming conventions. Saves `.allyconfig.json`. |
| `/ally apply` | Full audit with an apply checkpoint. Writes XAML and `.resx` changes only after you confirm. |

---

## Running Ally in CI

Ally can run in CI as a read-only check: it invokes `/ally diff` against the pull request's actual target branch, reporting findings only for changed hunks in the files a PR actually touches — not a full-repo `/ally feedback` pass. It always uses the PR's real target branch (from the platform's own PR metadata), not `.allyconfig.json`'s `defaultBaseBranch` — that field only matters for a local/manual `/ally diff` with no `[base-branch]` argument, so it stays correct even for repos where PRs sometimes target something other than `main` (e.g. a release branch). `/ally apply` is deliberately left out of automation — the apply checkpoint's confirmation step is a safety feature, not a formality, and there's no one in CI to confirm it. Always run `/ally apply` manually, locally.

Findings are posted as one inline comment per finding, anchored to the exact file and line, plus a separate standalone summary comment with the severity counts — not a flat comment dump.

Two CI hosts are supported:

- **GitHub Actions** — a reusable workflow you call from your repo. Findings are posted as a single PR review. See [GitHub Actions setup](#github-actions-setup).
- **Azure DevOps Pipelines** — a pipeline and a small Node script you copy into your repo. Azure DevOps has no review object, so each finding is its own PR thread. See [Azure DevOps](#azure-devops).

### GitHub Actions setup

1. Copy `.github/agents/ally.md` into the target repository, at the same path (`.github/agents/ally.md`). `.allyconfig.json` isn't something to copy from this template — it's project-specific. In the target repository, run `/ally config` (if it hasn't been already) to generate and commit one.
2. Add a caller workflow that invokes the reusable workflow in this repo — see [`examples/github-actions/ally-audit-caller.yml`](examples/github-actions/ally-audit-caller.yml).
3. Grant the caller job at least:
   ```yaml
   permissions:
     contents: read
     pull-requests: write
     copilot-requests: write
   ```
   A reusable workflow can never be granted more than its caller allows, and a repo's default token permissions (Settings → Actions → General → Workflow permissions) are often read-only — without this, the job fails workflow validation before it even starts.

### GitHub Actions authentication

`copilot-requests: write` above is all the auth this needs — it lets the Copilot CLI authenticate with the job's own automatic `GITHUB_TOKEN`, no secret or PAT required. This only fails to work if your organization's Copilot policy blocks CLI usage outright, which is a Copilot administration setting to fix, not something to work around in the workflow.

### Pinning the model on GitHub Actions (recommended)

By default, `copilot` uses whatever model your Copilot backend/org policy currently defaults to — which can change between CI runs as that policy changes, silently shifting what Ally finds. To pin a specific model instead, pass the reusable workflow's `copilot-model` input:

```yaml
uses: AndreeaP19/ally-maui-accessibility-agent/.github/workflows/ally-audit.yml@<ref>
with:
  copilot-model: claude-opus-4-5
```

This sets the CLI's `COPILOT_MODEL` environment variable for the audit step only. Leave it unset to keep following your org's default. Model availability depends on your Copilot plan — check what's available before pinning one.

### Azure DevOps

The pipeline lives in [`examples/azure-devops/`](examples/azure-devops/). Unlike the GitHub integration it isn't a reusable template: you copy two files into your repo.

| File | Copy to |
|---|---|
| [`examples/azure-devops/ally-audit.yml`](examples/azure-devops/ally-audit.yml) | anywhere in your repo, e.g. the root |
| [`examples/azure-devops/scripts/ally-azure-comments.js`](examples/azure-devops/scripts/ally-azure-comments.js) | `scripts/ally-azure-comments.js` — the "Post Ally findings to PR" step runs it from there; change that path in the pipeline if you put it elsewhere |

#### What it does

1. **Find changed XAML files** — diffs the PR against its target branch (`System.PullRequest.TargetBranch`) and writes the changed `.xaml` files to `ally-changed-files.txt` and their unified diff to `ally-diff.patch`. If nothing matches, the remaining steps are skipped.
2. **Run Ally** — runs `/ally diff` through the Copilot CLI with read-only tools (`--allow-tool read --deny-tool write --no-ask-user`). The prompt hands Ally those two files as its scope, so it never needs to run git. If the output has no `FINDINGS_SUMMARY` marker, it retries once.
3. **Post Ally findings to PR** — `ally-azure-comments.js` parses the [Findings Report Format](.github/agents/ally.md) and posts:
   - a summary thread with the severity counts (posted as closed, so it never blocks a merge);
   - one active thread per finding, anchored inline to its file and line;
   - the fix as a `` ```suggestion `` block spanning the element's lines, when it's a safe drop-in replacement (see below), otherwise as a normal code block.

   Every thread carries a hidden marker, so re-running the build on the same PR doesn't repeat findings that are already there.
4. **Fail on Ally findings** — fails the build when any finding is at or above `failOn` in `.allyconfig.json`. The build also fails, with an explanatory PR comment, when Ally errors or its output can't be parsed — never silently reported as "no findings".

**When a fix becomes a suggestion.** Ally's reported line numbers are approximate, and it quotes multi-line elements on one line, so a suggestion is only used when the script can prove which element the fix replaces: the fix is exactly one XML element, and the file has an element of the same control that either matches the finding's `Element` quote (ignoring whitespace) or encloses the reported line *and* shares an identifying attribute with the fix (`x:Name`, `Text`, `Source`, `Title`, `Placeholder`, `IconImageSource`, `Command` or `Clicked`). Fixes that replace a control with a different one, or with several elements (e.g. adding a `Label` next to a `Picker`), stay plain code blocks — applying the suggestion with one click must never break the XAML. The step log explains each decision, e.g. `suggestion for lines 91-95 (reported line 78)` or `plain comment, not a suggestion because the fix is not exactly one XML element`.

#### Setup

1. **Add the agent and config.** Copy `.github/agents/ally.md` into your repo at the same path, then run `/ally config` to generate `.allyconfig.json` and commit both.
2. **Copy the pipeline and script** as listed in the table above, and commit them.
3. **Create the pipeline.** Pipelines → New pipeline → Azure Repos Git → your repo → Existing Azure Pipelines YAML file → pick `ally-audit.yml`.
4. **Add the Copilot token.** In the pipeline, Edit → Variables → New variable, name `COPILOT_GITHUB_PAT`, value a GitHub personal access token for an account with Copilot access (a fine-grained token needs the *Copilot Requests* permission). Tick **Keep this value secret**. Copilot is always billed GitHub-side, so a token is needed even though the code lives in Azure DevOps. The pipeline passes it to the CLI as `COPILOT_GITHUB_TOKEN`.
5. **Let the pipeline comment on PRs.** Project Settings → Repositories → your repo → Security → find **&lt;Project&gt; Build Service (&lt;organization&gt;)** → set **Contribute to pull requests** to **Allow**. If the project setting *Limit job authorization scope to current project* (Project Settings → Pipelines → Settings) is off, the identity is **Project Collection Build Service (&lt;organization&gt;)** instead.
6. **Run it on pull requests.** Azure Repos ignores `pr:` triggers in YAML, so the pipeline has `trigger: none` and runs through a branch policy: Project Settings → Repositories → your repo → Policies → your target branch (e.g. `main`) → **Build validation** → **+** → pick the pipeline. Set it to **Required** if Ally's findings should block the merge.

#### Pinning the model

The pipeline has a `copilotModel` parameter, the equivalent of the GitHub workflow's `copilot-model` input. When it's set, the Run Ally step exports `COPILOT_MODEL`; when it's empty (the default), the Copilot CLI uses your backend/org default, which can change between runs. PR builds always use the parameter's default, so pin it in the file:

```yaml
parameters:
- name: copilotModel
  displayName: 'Copilot model to pin (e.g. claude-opus-4-5). Leave empty to use the Copilot default.'
  type: string
  default: 'claude-opus-4-5'
```

When you queue the pipeline by hand, the parameter also appears as a text box. The Run Ally log prints which model was used. Model availability depends on your Copilot plan; run `/model` in the Copilot CLI to see the exact names.

The pipeline installs the latest `@github/copilot` on every run. For fully reproducible runs, pin it the way the GitHub workflow does, e.g. `npm install -g @github/copilot@<version>`.

#### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Run Ally" is skipped with *Condition was not met* | No `.xaml` file changed in the PR, or the run wasn't a PR build (a manual run has no target branch). Check the "Find changed XAML files" log. |
| Posting fails with HTTP 403 and `TF401027: You need the Git 'PullRequestContribute' permission` | The build service can't comment on PRs. See setup step 5; the error names the identity. |
| A *"Ally audit report could not be parsed"* comment | Ally answered without the report (for example, it asked a question instead). The step already retried once; re-run the build, and consider pinning the model. The comment is closed automatically once a later run parses. |
| A *"Ally audit failed to run"* comment | The Copilot CLI exited with an error — usually a missing or invalid `COPILOT_GITHUB_PAT`, or a model your plan can't use. The comment includes the CLI output. |
| A re-run doesn't post anything new | Findings already on the PR are skipped on purpose. Delete Ally's old threads (resolving them isn't enough) to have them posted again. |
| A fix shows as a code block, not a suggestion | Check the "Post Ally findings to PR" log: each finding says whether it became a suggestion and, if not, why. |

### Why the check still fails despite posting comments

**This is intentional, not redundant.** This applies to both the GitHub check and the Azure DevOps build. The inline comments are for *visibility and actionability*: what's wrong, exactly where, and how to fix it. The failing check is what *enforces* the gate: nothing about a PR comment stops the PR from being merged unless a required status check backs it up, so if the check always passed, `failOn` would be purely decorative. Concretely: a finding's severity meeting or exceeding `failOn` fails the check even though the same finding is already visible as a comment. To change what's enforced, adjust `failOn` in `.allyconfig.json` (e.g. `"major"` to also block on major findings, or `"info"` to fail on any finding) — no workflow change needed, since the gate reads that value at run time.

### Sample app (CI self-test)

[`examples/sample-app/`](examples/sample-app/) is a small but functional and buildable MAUI app — Login page → Home (a Shell with a flyout) → Settings → Profile — that exists to exercise the CI integration for real, not just document it. Its XAML is a clean, accessible reference implementation (localized `SemanticProperties`, explicit `Slider` ranges, persistent `Picker` labels, and so on) rather than a fixture seeded with violations, so a passing `/ally diff` run demonstrates the pipeline working end-to-end on real, working screens. [`.github/workflows/sample-app-audit.yml`](.github/workflows/sample-app-audit.yml) runs the GitHub Actions integration against it on every PR that touches the sample files, the agent, or the reusable workflow, so a broken pipeline shows up as a failed check instead of silently rotting. It relies on the same `copilot-requests: write` permission described above — no secret needed. There's no equivalent self-test for the Azure DevOps pipeline, since this repo isn't hosted in Azure DevOps.

---

## Configuration — `.allyconfig.json`

The wizard creates this file for you. A typical configuration looks like:

```json
{
  "localize": true,
  "resxPath": "MyApp/Resources/AppResources.resx",
  "localizeNamespace": "strings",
  "keyConvention": "Pascal_Underscore",
  "defaultBaseBranch": "main",
  "failOn": "critical",
  "excludePaths": ["MyApp/Platforms/", "MyApp/obj/"],
  "readOnlyPaths": ["MyApp/Shared/ThirdParty/"],
  "suppressions": []
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `resxPath` | string | Path to the `.resx` file used for accessibility string keys. |
| `constantsFile` | string | Path to a constants file. Required (alongside `localize: false`) when the project has no `.resx` file; optional supplement otherwise. |
| `constantsClassPath` | string | Fully-qualified class path for the constants class (e.g. `CoreConstants.TranslationKeys`), when `constantsFile` is set. |
| `localize` | boolean | `false` disables `.resx` key generation — Ally itself then emits plain string literals for any new property it adds, instead of a markup-extension binding. `MAUI_A11Y_009_NON_LOCALIZED_A11Y_TEXT` fires the other way around: when `true` and an *existing* string bypasses the localization markup extension, since that's a live deviation from the project's own policy. |
| `localizeNamespace` | string | The `xmlns:` alias used to reference the localization markup extension in XAML (e.g. `strings`). |
| `keyPrefix` | string | Prefix applied to generated `.resx` keys (e.g. `A11y`). |
| `placeholderValue` | string | Placeholder value written for new `.resx` entries until translated. Defaults to `"TODO: add translation"`. |
| `headingDefaultLevel` | string | Default `SemanticProperties.HeadingLevel` suggested for section titles (e.g. `"Level1"`). |
| `keyConvention` | string | `"Pascal_Underscore"`, `"SCREAMING_SNAKE"`, `"dot.notation"`, or `"custom"` (with a `keyTemplate`). |
| `constConvention` | string | Naming convention for generated C# constants (e.g. `"PascalCase"`). |
| `orderDetection` | boolean | Opt-in, off by default. Set to `true` to enable heuristic detection of reading-order mismatches (`MAUI_A11Y_003_READING_ORDER`) — `Grid.Row`/`Grid.Column` visual order differing from declaration order, a describing `Label` declared after its control, or absolute/translation-based visual reordering. Left unset or `false`, Ally never fires that rule, even if one of those patterns is present. |
| `defaultBaseBranch` | string | Base branch `/ally diff` uses when `[base-branch]` is omitted (e.g. `"main"`). |
| `failOn` | string | Minimum severity that fails a CI gate: `"critical"`, `"major"`, `"minor"`, or `"info"`. |
| `mauiAccessibilitySkill` | object | Optional integration with a `maui-accessibility` skill: `enabled`, `skillName`, `required`, `fallbackOnMissing`, `fallbackOnError`. |
| `rules` | object | Per-rule `enabled`/`severity` overrides, keyed by rule ID. |
| `excludePaths` | string[] | Paths to skip entirely during scanning. |
| `readOnlyPaths` | string[] | Paths that are reported but never written. |
| `suppressions` | object[] | Rule suppressions with required `ruleId`, `path`, and `reason`. |

---

## Severity Tiers

| Severity | Meaning |
|---|---|
| 🔴 **Critical** | Assistive-tech user is blocked |
| 🟠 **Major** | Usable but degraded experience |
| 🟡 **Minor** | Suboptimal, not a conformance failure |
| ⚪ **Info** | Note or suggestion |

| Confidence | Behavior |
|---|---|
| **High** | Included in proposed fixes; eligible for auto-apply |
| **Medium** | Proposed but flagged "review recommended" |
| **Low** | Reported only — never auto-applied |

### Rule Catalog

<!-- Keep this table in sync with .github/agents/ally.md's "Rule catalog" section. -->

| Rule ID | Default Severity | Confidence | Description |
|---|---|---|---|
| `MAUI_A11Y_001_ICON_ONLY_TOOLBAR` | Critical | High | `ToolbarItem` / `ImageButton` has icon but no accessible name |
| `MAUI_A11Y_002_LABEL_IN_NAME` | Major | High | Accessible name omits visible label text |
| `MAUI_A11Y_003_READING_ORDER` | Major | Medium | Screen-reader order likely differs from visual order |
| `MAUI_A11Y_004_INTERACTIVE_CONTAINER` | Critical | High | Gesture-only container may be the only way to act |
| `MAUI_A11Y_005_MEANINGFUL_IMAGE_NO_DESCRIPTION` | Major | Medium | Meaningful image lacks alt text |
| `MAUI_A11Y_006_ENTRY_DESCRIPTION_ANDROID` | Major | High | `Description` on `Entry`/`Editor` interferes with TalkBack |
| `MAUI_A11Y_007_SLIDER_RANGE_MISSING` | Major | Medium | `Slider`/`Stepper` has no explicit range |
| `MAUI_A11Y_008_HEADING_NOT_MARKED` | Minor | Low | Section title should have `HeadingLevel` |
| `MAUI_A11Y_009_NON_LOCALIZED_A11Y_TEXT` | Minor | High | Accessibility text is hardcoded |
| `MAUI_A11Y_010_CHECKBOX_NO_LABEL` | Major | High | `CheckBox`/`Switch`/`RadioButton` has no describing label |
| `MAUI_A11Y_011_PICKER_TITLE_ONLY` | Major | Medium | `Picker` uses `Title` only; name may disappear after selection |

---

## Apply Checkpoint

When you run `/ally apply`, Ally shows a summary before writing anything:

```
Ally — Apply Checkpoint

Findings:  🔴 Critical 2   🟠 Major 5   🟡 Minor 3   ⚪ Info 1
Planned:   4 XAML files · 7 new resource keys

Apply these changes?
[A] Apply all
[B] Apply critical + major only
[C] Show full diff
[D] Cancel
```

Nothing is written until you select **[A]** or **[B]**.

---

## Localization

All generated accessibility strings are emitted through the configured
localization markup extension (the `localizeNamespace` alias):

```xml
SemanticProperties.Description="{strings:Localize A11y_NotesBtn_Description}"
```

New resource keys are added to the `.resx` file with the placeholder value `TODO: add translation` (configurable via `placeholderValue`). The suggested English text appears in the audit report only — it is never committed to the `.resx` automatically.

---

## Suppressions

### Inline suppression (requires a reason)

```xml
<!-- accessibility-disable-next-line MAUI_A11Y_003_READING_ORDER: visual order intentional -->
<Grid ...>
```

### Config suppression (requires a reason)

```json
{
  "suppressions": [
    {
      "ruleId": "MAUI_A11Y_003_READING_ORDER",
      "path": "Views/DashboardPage.xaml",
      "reason": "Reading order follows visual layout by design decision"
    }
  ]
}
```

---

## Hard Constraints

The following rules are **always enforced** and cannot be overridden by confidence level:

- **`Label` with `Text`** — never add `SemanticProperties.Description`; the label text is already the accessible name.
- **`Entry` / `Editor`** — never add `SemanticProperties.Description`; it breaks TalkBack edit actions on Android.
- **Parent layout with focusable children** — never add `SemanticProperties.Description` without explicit user confirmation of a single-unit focus strategy.
- **WCAG 2.5.3 Label in Name** — the accessible name must contain the visible text as a substring.
- **Icon-only controls** — `ToolbarItem` and `ImageButton` with no visible text must always have an accessible name.
- **`SemanticProperties.IsInAccessibleTree` does not exist** — use `AutomationProperties.IsInAccessibleTree="False"` for single decorative elements, or `AutomationProperties.ExcludedWithChildren="True"` for decorative groups.
- **`Placeholder` and `Hint`** — not combined blindly; they overlap on Android.
- **Heading levels** — Windows/Narrator distinguishes `Level1`–`Level9`; Android/TalkBack and iOS/VoiceOver collapse them all to "heading."
- **Dynamic announcements and focus** (`SemanticScreenReader.Announce(...)`, `SetSemanticFocus()`) are flow-dependent — Ally suggests them, but never adds them automatically.

---

## Manual Verification Checklist

After applying fixes, verify accessibility manually:

```
☐ Run VoiceOver (iOS), TalkBack (Android), Narrator (Windows, if supported)
☐ Verify button names contain visible text when Description is set
☐ Verify icon-only controls announce meaningful names
☐ Verify decorative images are skipped
☐ Verify reading order in complex grids
☐ Fill generated translation key placeholders
☐ Test at 200% system font size
```

---

## Repository Structure

```
.github/
  agents/
    ally.md               ← Agent prompt (loaded by Copilot)
  workflows/
    ally-audit.yml        ← Reusable CI workflow (see "Running Ally in CI")
    sample-app-audit.yml  ← Wires the sample app below to that workflow
examples/
  sample-app/             ← Clean, functional MAUI reference app used to self-test CI
  github-actions/         ← Caller workflow example for consuming repos
  azure-devops/
    ally-audit.yml        ← Azure DevOps pipeline to copy into consuming repos
    scripts/
      ally-azure-comments.js ← Posts findings to the PR and sets the failOn gate
.allyconfig.json          ← Config for auditing examples/sample-app/ in this repo
README.md                 ← This file
```

In a consuming project, only `.github/agents/ally.md` is copied — plus, on
Azure DevOps, the pipeline and script from `examples/azure-devops/`. Everything
else here is specific to this repo (the CI examples and the sample app that
self-tests them). Your own `.allyconfig.json` is generated by `/ally config`,
not copied.

---

## License

See [LICENSE](LICENSE).
