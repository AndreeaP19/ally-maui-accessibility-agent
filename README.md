# Ally — MAUI Accessibility Agent

**Ally** is a GitHub Copilot coding agent that audits and fixes accessibility issues in .NET MAUI XAML files. It enforces WCAG 2.2 AA compliance, generates localized `SemanticProperties` and `AutomationProperties`, and operates with configurable severity gates and safe, confirmation-first behavior.

---

## Features

- 🔍 **Automated XAML accessibility audits** — scans active files or entire projects
- 🌐 **Localization-first** — all generated strings use `x:Static` bindings; never hardcoded values
- 🛡️ **WCAG 2.2 AA enforcement** — rule catalog covering critical blockers through informational notes
- ⚙️ **Configurable** — `.allyconfig.json` controls resource paths, key naming, severity gates, and exclusions
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

The wizard asks **one question at a time** and detects your `.resx` resource files automatically. It produces a `.allyconfig.json` file at the project root.

### 3. Audit your XAML

**Read-only audit (no files written):**

```
/ally feedback
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
| `/ally config` | Interactive setup wizard. Detects `.resx` files, namespace aliases, and key naming conventions. Saves `.allyconfig.json`. |
| `/ally apply` | Full audit with an apply checkpoint. Writes XAML and `.resx` changes only after you confirm. |

---

## Configuration — `.allyconfig.json`

The wizard creates this file for you. A typical configuration looks like:

```json
{
  "resourceFile": "MyApp/Resources/AppResources.resx",
  "namespaceAlias": "strings",
  "keyConvention": "Pascal_Underscore",
  "failOn": "critical",
  "excludePaths": ["MyApp/Platforms/", "MyApp/obj/"],
  "readOnlyPaths": ["MyApp/Shared/ThirdParty/"],
  "suppressions": []
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `resourceFile` | string | Path to the `.resx` file used for accessibility string keys. |
| `constantsFile` | string | *(Alternative to `resourceFile`)* Path to a constants file when `localize: false`. |
| `localize` | boolean | `false` disables `.resx` key generation and fires `MAUI_A11Y_009` for any hardcoded strings. |
| `namespaceAlias` | string | The `xmlns:` alias used to reference the resource class in XAML (e.g. `strings`). |
| `keyConvention` | string | `"Pascal_Underscore"` or a custom template. |
| `failOn` | string | Minimum severity that fails a CI gate: `"critical"`, `"major"`, `"minor"`, or `"info"`. |
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

All generated accessibility strings are emitted as `x:Static` expressions:

```xml
SemanticProperties.Description="{x:Static strings:AppResources.A11y_NotesBtn_Description}"
```

New resource keys are added to the `.resx` file with the placeholder value `TODO: add translation`. The suggested English text appears in the audit report only — it is never committed to the `.resx` automatically.

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
