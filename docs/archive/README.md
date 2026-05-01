# Archive — TPE Communication System Documentation

This folder retains earlier iterations of the TPE Communication System documentation set
plus the Python generator scripts that produced them. Nothing in this folder is canonical.
The single canonical document lives one level up at:

    ../TPE_Communication_System_Charter_v1.0.docx

Everything in this folder is read-only reference material. Do not regenerate, do not
distribute. If a downstream reader needs background on how the canonical Charter
evolved, this folder is the trail.

## Contents

| File | Type | Purpose | Why archived |
|---|---|---|---|
| `TPE_Communication_System_SOW.docx` | Output (DOCX, 286 KB) | SOW v2.0 — 41 sections in 11 parts; built on Claude Code skill suite. | Superseded by v3 → v4 → v5 → v1.0 Charter. |
| `TPE_Communication_System_SOW_v3.0.docx` | Output (DOCX, 124 KB) | Added 13 commercial / legal sections (Charges, Liability, Indemnification, Force Majeure, Governing Law, etc.). | Superseded by v4 (architecture pivot). |
| `TPE_Communication_System_SOW_v4.0.docx` | Output (DOCX, 117 KB) | Architecture pivot — replaced "Claude Code skill suite" with **self-hosted Novu** as the runtime; introduced custom-provider engineering. | Superseded by v5 (summary pass) and then by Charter v1.0. |
| `TPE_Communication_System_SOW_v5.0.docx` | Output (DOCX, 96 KB) | Editorial compression — many sections renamed `(Summary)`; tables reduced 107 → 79. | Superseded by Charter v1.0. |
| `TPE_Communication_Content_Reference.docx` | Output (DOCX, 258 KB) | Companion data bible to the v2.0 SOW: 49 trigger detail cards, 37-token variable catalogue, sample message library, per-regime compliance checklists. | Bound to the v2.0 SOW; superseded once Charter v1.0 carried the same data inline in §4.3. |
| `generate_sow.py` | Generator (Python, 153 KB · 2,633 lines) | Produces `TPE_Communication_System_SOW.docx` (v2.0). | Generator for an archived deliverable. Refactored to take section number as a parameter (registry pattern). |
| `generate_content_ref.py` | Generator (Python, 97 KB · 1,861 lines) | Produces `TPE_Communication_Content_Reference.docx` (v1.0). | Generator for an archived deliverable. |

## Evolution timeline

```
SOW v1.0 → v1.5 → v2.0          (skill-suite era; Claude Code as runtime)
              ↓
SOW v3.0                        (added commercial/legal layer — 41 → 54 sections)
              ↓
SOW v4.0                        (Novu pivot — replaced sections 16/17/18)
              ↓
SOW v5.0                        (editorial compression — many sections summarised)
              ↓
Charter v1.0  ← canonical       (Internal Project Charter, 10 sections,
                                 49-trigger inventory in §4, Novu architecture,
                                 6-week timeline. Renamed from v9.0.)
```

The Charter v1.0 is structurally different from the SOWs:
- **It is a charter**, not a contract — internal scope and ownership document.
- **Architecture is Novu-based** (carried over from SOW v4 onwards).
- **Cleaner: 10 sections** vs 41–54 in the SOW iterations.
- **Trigger detail is in §4.3.6** (per-trigger cards across 5 axes).
- **Commercial / legal clauses present in SOW v3–v5 are not in the Charter** — the charter is internal-only and does not contemplate vendor procurement.

## Why these were not deleted

1. **Provenance.** The decision trail (skill-suite → commercial → Novu → charter) is documentation in itself. If a future reviewer asks "why Novu?", the diff between v3 and v4 is the answer.
2. **Reusable generator code.** `generate_sow.py` and `generate_content_ref.py` contain ~4,500 lines of working python-docx infrastructure (XML-level cell-width persistence, brand styling, section accents, visual helpers) that should be lifted into any future generator rather than re-derived.
3. **Companion data.** The Content Reference DOCX has 49 trigger detail cards + 37 variables + sample messages + compliance checklists. If the canonical Charter ever needs a detailed companion again, this is the source.

## Cleanup policy

- **Do not delete** any file in this folder without explicit Sponsor approval.
- **Do not regenerate** the archived DOCX from the archived `.py` scripts (they will overwrite themselves cleanly, but the file timestamps will mislead future readers about provenance).
- **Do not modify** the archived DOCX files in place. They are point-in-time snapshots.
- If a new version of the canonical Charter requires content from any archived file, copy the content into the new Charter source — do not link or symlink.

## Pointers to canonical material

| Looking for… | Go to… |
|---|---|
| Project scope, ownership, deliverables, timeline | `../TPE_Communication_System_Charter_v1.0.docx` |
| Per-trigger cadence detail | `../TPE_Communication_System_Charter_v1.0.docx` §4.3.6 |
| Variable token catalogue | `archive/TPE_Communication_Content_Reference.docx` §4 |
| Sample message drafts | `archive/TPE_Communication_Content_Reference.docx` §5 / §6 |
| Compliance checklists per regime | `archive/TPE_Communication_Content_Reference.docx` §9 |
| Commercial / legal clause templates | `archive/TPE_Communication_System_SOW_v5.0.docx` §38 onwards |

## Last updated

27 April 2026 — folder consolidated to single canonical Charter v1.0; five DOCX
deliverables and two generator scripts archived here.
