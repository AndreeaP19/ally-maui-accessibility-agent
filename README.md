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

Ally can run in CI as a read-only check: it invokes `/ally diff` against a base branch, which reports findings only for changed hunks in the files a PR actually touches — not a full-repo `/ally feedback` pass. Both CI examples resolve the base branch from `.allyconfig.json`'s `defaultBaseBranch` when it's set, falling back to the PR's actual target branch otherwise — so if this repo's PRs sometimes target a branch other than `defaultBaseBranch` (e.g. a release branch), keep `defaultBaseBranch` in sync or unset it. Findings are posted as a PR comment. `/ally apply` is deliberately left out of automation — the apply checkpoint's confirmation step is a safety feature, not a formality, and there's no one in CI to confirm it. Always run `/ally apply` manually, locally.

### GitHub Actions

1. Copy `.github/agents/ally.md` and `.allyconfig.json` into the target repository, at the same paths (repo root).
   Run `/ally config` in the target repository first if `.allyconfig.json` does not already exist.
2. Add a caller workflow that invokes the reusable workflow in this repo — see [`examples/github-actions/ally-audit-caller.yml`](examples/github-actions/ally-audit-caller.yml).
3. **Auth:** the default `GITHUB_TOKEN` only works if the organization's Copilot policy allows "Allow use of Copilot CLI billed to the organization." Otherwise, create a PAT with the **Copilot Requests** permission and store it as a repository secret named `COPILOT_GITHUB_TOKEN`.

### Azure DevOps

See [`examples/azure-devops/ally-audit-pipeline.yml`](examples/azure-devops/ally-audit-pipeline.yml).

- **Auth** always requires a GitHub PAT — Copilot billing is GitHub-side regardless of which CI host runs the pipeline — stored as a secret pipeline variable.
- Enable **"Allow scripts to access the OAuth token"** on the pipeline and grant the **Build Service** identity **"Contribute to pull requests"**, or the PR comment step will fail.

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
| `localize` | boolean | `false` disables `.resx` key generation and fires `MAUI_A11Y_009_NON_LOCALIZED_A11Y_TEXT` for any hardcoded accessibility strings. |
| `localizeNamespace` | string | The `xmlns:` alias used to reference the localization markup extension in XAML (e.g. `strings`). |
| `keyPrefix` | string | Prefix applied to generated `.resx` keys (e.g. `A11y`). |
| `placeholderValue` | string | Placeholder value written for new `.resx` entries until translated. Defaults to `"TODO: add translation"`. |
| `headingDefaultLevel` | string | Default `SemanticProperties.HeadingLevel` suggested for section titles (e.g. `"Level1"`). |
| `keyConvention` | string | `"Pascal_Underscore"`, `"SCREAMING_SNAKE"`, `"dot.notation"`, or `"custom"` (with a `keyTemplate`). |
| `constConvention` | string | Naming convention for generated C# constants (e.g. `"PascalCase"`). |
| `orderDetection` | boolean | Enables heuristic detection of reading-order mismatches (`MAUI_A11Y_003_READING_ORDER`). |
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
SemanticProperties.Description="{markupExtensions:Localize A11y_NotesBtn_Description}"
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
    ally.md          ← Agent prompt (loaded by Copilot)
.allyconfig.json     ← Project config (created by /ally config)
README.md            ← This file
```

---

## License

See [LICENSE](LICENSE).
