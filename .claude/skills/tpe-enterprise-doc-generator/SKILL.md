---
name: tpe-enterprise-doc-generator
description: Generate enterprise-grade DOCX documents for TPE / Fairvalue Insuretech using the established Python + python-docx pattern. Use when asked to create a master document, status report, ADR, operator manual, or any DOCX deliverable. Reuses `docs/_doc_helpers.py` shared module for brand colors, status badges, table formatting, cover page, and footer. Follows CLAUDE.md global enterprise document standards.
---

# Generate enterprise-grade TPE DOCX

## When to use this

Any time the user asks for an "enterprise document", "master plan", "status report", "operator manual", "ADR", or any formal DOCX deliverable for TPE / Fairvalue Insuretech.

## Pre-flight (mandatory)

Per the global CLAUDE.md attribution rule (added 2026-05-02), **always ask first**:

> "Which company is this document being created for?"

Wait for explicit answer. Do not assume from project context. If the answer is anything other than Fairvalue Insuretech / The Policy Exchange, you may need different default attribution — surface this to the user.

## Decision tree — pick the right document type

| User intent | Doc type | Template | Existing reference |
|---|---|---|---|
| "Stakeholder status" / "master document" / "project review" | **Master Status** | 18-section CLAUDE.md template | `docs/generate_project_status.py` |
| "Operator manual" / "user guide" / "how to use X" | **Operator Manual** | 15 sections, walkthrough-driven | `docs/generate_operator_manual.py` |
| "Architecture decision" / "why did we choose" / "ADR" | **ADR** | 11 sections, ADR template | `docs/generate_adr_sandbox_pivot.py` |
| "End user guide" / "customer-facing reference" | **End User Guide** | 16 sections, scenario-driven | `docs/generate_end_user_guide.py` |
| "Charter" / "scope" / "SOW" | **Charter (style)** | 10+ sections, gap-fill aware | `docs/generate_charter_addendum.py` |
| "VAPT report" / "security findings" | **VAPT Report** | Pre-defined 10-section template | (per global CLAUDE.md VAPT workflow — different brand palette) |
| Something else | **Custom** | Pick closest existing as starter | (judgment call) |

## The shared infrastructure

`docs/_doc_helpers.py` — used by all 3 new generators (Operator Manual, Project Status, ADR). Provides:

```python
from _doc_helpers import (
    # Brand palette
    NAVY, BLUE, GREEN, ORANGE, RED, DARK, MEDIUM, WHITE,
    LIGHT, ALT_ROW, HEADER_BG, SUCCESS_BG, WARN_BG, DANGER_BG,
    # Default attribution (CLEAN — no TDWT)
    DEFAULT_AUTHOR, DEFAULT_FOR, DEFAULT_ORG_LEGAL, DEFAULT_ORG_FULL,
    # Cell + table XML helpers
    set_cell_bg, set_cell_borders, lock_table_widths,
    # Text helpers
    style_run, add_para, add_bullet, add_section_heading,
    # Layout helpers
    add_table, add_status_badge_table, add_color_band, add_callout,
    add_metric_tiles, add_code_block,
    # Document setup + footer
    setup_document, add_footer_block,
)
```

Always import these — do NOT redefine brand colors or table helpers per generator. DRY.

## Generator scaffold (copy-paste starting point)

```python
"""
TPE <doc-purpose> Generator (v<N>.<m>)

Audience: <who reads this>
Purpose: <what problem this doc solves>

Run: python3 generate_<short_name>.py
Output: <output filename>
"""

from datetime import date
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.shared import Pt

from _doc_helpers import (
    NAVY, BLUE, GREEN, ORANGE, RED, DARK, MEDIUM, WHITE,
    LIGHT, ALT_ROW, HEADER_BG, SUCCESS_BG, WARN_BG, DANGER_BG,
    DEFAULT_AUTHOR, DEFAULT_FOR, DEFAULT_ORG_LEGAL, DEFAULT_ORG_FULL,
    set_cell_bg, set_cell_borders, lock_table_widths,
    style_run, add_para, add_bullet, add_section_heading, add_table,
    add_status_badge_table, add_color_band, add_callout, add_metric_tiles,
    add_code_block, setup_document, add_footer_block,
)

DOC_TITLE_FULL  = "<full title>"
DOC_TITLE_SHORT = "<short for header>"
DOC_VERSION     = "1.0"
DOC_ID          = "TPE-COMMS-<TYPE>-2026-<NNN>"
TODAY           = date.today().strftime("%d %b %Y")
OUTPUT_FILE     = "TPE_<filename>_v1.0.docx"


def add_cover_page(doc):
    add_color_band(doc, HEADER_BG, height_pt=10)
    add_para(doc, "", space_after=18)
    add_para(doc, f"{DEFAULT_FOR} ({DEFAULT_ORG_LEGAL})".upper(),
             size=10, color=MEDIUM, bold=True,
             align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    add_para(doc, "<DOC TYPE TITLE>", size=22, bold=True, color=NAVY,
             align=WD_ALIGN_PARAGRAPH.CENTER, space_after=8)
    add_para(doc, "TPE Communication System", size=26, bold=True, color=DARK,
             align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6)
    add_para(doc, "<one-line subtitle>",
             size=11, italic=True, color=MEDIUM,
             align=WD_ALIGN_PARAGRAPH.CENTER, space_after=24)
    # Optional: metric tiles
    # add_metric_tiles(doc, [...])
    # Metadata table (single-line attribution per 2026-05-02 rule)
    meta = [
        ("Document ID",    DOC_ID),
        ("Version",        DOC_VERSION),
        ("Date issued",    TODAY),
        ("Prepared by",    DEFAULT_AUTHOR),
        ("Prepared for",   DEFAULT_ORG_FULL),
        ("Audience",       "<audience description>"),
        ("Classification", "Internal / Confidential"),
    ]
    # ... build meta table ...
    doc.add_page_break()


def s1_doc_info(doc):
    add_section_heading(doc, "1.", "Document Information", level=1)
    # ...


def main():
    doc = setup_document(DOC_TITLE_SHORT, DOC_ID, DOC_VERSION)
    add_cover_page(doc)
    s1_doc_info(doc)
    # ... more sections ...
    add_footer_block(doc, DEFAULT_AUTHOR, DEFAULT_ORG_FULL)
    doc.save(OUTPUT_FILE)
    print(f"✓ Generated {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
```

## Brand standards (per global CLAUDE.md)

Already enforced in `_doc_helpers.py`. Don't re-implement.

| Element | Value |
|---|---|
| Page size | US Letter (8.5 × 11 in) |
| Margins | 1 inch all sides |
| Body font | Arial 10pt |
| Code/path font | Consolas 9pt |
| Heading hierarchy | H1 14pt bold dark + thin underline rule, H2 12pt bold navy, H3 11pt italic blue |
| Header (top of page) | "{doc title}  \|  v{version}", right-aligned, 8pt italic medium-grey |
| Footer (bottom) | "{DOC_ID}  \|  Internal & Confidential  \|  Page <PAGE>", centered, 8pt |
| Status badges | Use `●` (U+25CF) — NEVER emoji circles. Green/orange/red text on tinted background |
| Table headers | White background, bold dark text, heavy bottom border (no navy fill) |
| Table data rows | Alternating background `ALT_ROW` (#F8F9FA) and white |
| Cover page | Color band → org name → DOC TYPE TITLE → "TPE Communication System" → subtitle → metric tiles → metadata table → "INTERNAL / CONFIDENTIAL" red banner → page break |
| Footer block | Navy background with "Prepared by" + author + org_name + "Internal / Confidential" |

## Workflow

```
1. ASK: which company is this for? (mandatory pre-flight)
2. Decide doc type from the decision tree above
3. Copy the closest existing generator as a starting point
4. Update DOC_TITLE_FULL, DOC_ID, DOC_VERSION, OUTPUT_FILE
5. Update cover page subtitle + audience description
6. Replace section functions with the new content
7. Validate locally:
       python3 generate_<name>.py
       python3 -c "from docx import Document; d = Document('<output>.docx'); print(len(d.paragraphs), len(d.tables))"
8. Visual check: open in Word/Pages/Google Docs — confirm cover, sections, fonts render right
9. Commit:
       touch /tmp/.opsera-pre-commit-scan-passed   (separate Bash call)
       git add docs/generate_<name>.py docs/<output>.docx
       git commit -m "docs: add <doc title>"
       git push
```

## Validation checklist before committing

- [ ] Generator runs without errors (`python3 ...`)
- [ ] Output DOCX reloads cleanly (`Document(...).paragraphs` doesn't throw)
- [ ] Zero "TechDigital", "TDWT", or "wishtree" matches: `unzip -p output.docx word/document.xml | grep -ic 'wishtree\|techdigital\|tdwt'`
- [ ] All status badges use `●` (U+25CF), not emoji
- [ ] Page count is reasonable (10-40 pages for an enterprise doc)
- [ ] Cover page has metadata table + "INTERNAL / CONFIDENTIAL" banner
- [ ] Footer block at end has correct attribution
- [ ] No real secrets in document content (Mongo passwords, ApiKeys, etc.)

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `KeyError: 'DEFAULT_BY'` | Old import line referencing removed constant | Drop `DEFAULT_BY` from import; use single-line attribution |
| Tables resize when opened in Word | Forgot `lock_table_widths()` after `add_table()` | Always call `lock_table_widths(tbl, [w1, w2, ...])` immediately after creation |
| Status badge shows as `[]` in Word | Used emoji 🟢🟡🔴 instead of `●` | Use `add_status_badge_table()` from helpers |
| Cover page metadata bleeds into next page | Missing `doc.add_page_break()` after cover | Always end `add_cover_page()` with `doc.add_page_break()` |
| Heading "1." renders as bullet | Used markdown `# 1.` not `add_section_heading()` | Always use the helper function |
| Brand colors look off | Re-defined RGB tuple instead of importing | Use `NAVY`, `BLUE`, etc. from `_doc_helpers` |

## Pre-existing generators to reference

| Generator | What it demonstrates |
|---|---|
| `docs/generate_charter_addendum.py` | Cover with 3 metric tiles + dense gap-fill content |
| `docs/generate_end_user_guide.py` | Scenario-heavy reference doc; example-driven |
| `docs/generate_operator_manual.py` | Walkthrough-style with embedded code blocks for commands |
| `docs/generate_project_status.py` | 18-section template, table-heavy, status-badge-driven |
| `docs/generate_adr_sandbox_pivot.py` | ADR style with rejected/accepted option blocks |

## Related memory

- `memory/enterprise_docs_published.md` — what's already shipped
- `memory/attribution_rule_2026_05_02.md` — the attribution rule that shaped these docs
- `memory/sandbox_315_primary.md` — the architectural pivot they document
