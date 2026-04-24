"""Context ingest pipeline for canonical project roots."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .dossier_store import DossierStore
from .io_utils import read_text_safe


CANONICAL_ROOTS: tuple[Path, ...] = (
    Path("/Users/seb/letgo"),
    Path("/Users/seb/the-tub-harness"),
    Path("/Users/seb/praetorius"),
    Path("/Users/seb/dexdsl.github.io"),
)

DISSERTATION_PRIMARY_PDF = Path("/Users/seb/Documents/concerning_human_understanding.pdf")
DISSERTATION_ALT_PDF = Path("/Users/seb/Downloads/JBM_Cybernetic_Phenomenology_of_Music_PNM.pdf")
DISSERTATION_MARKDOWN_CONTEXT: tuple[Path, ...] = (
    Path("/Users/seb/tub-proposal/docs/research.md"),
    Path("/Users/seb/Desktop/research.md"),
)

DEFAULT_PROJECT_SOURCE_MAP: dict[str, tuple[Path, ...]] = {
    "cybernetics_paper": (
        DISSERTATION_PRIMARY_PDF,
        DISSERTATION_ALT_PDF,
        Path("/Users/seb/tub-proposal/docs/research.md"),
        Path("/Users/seb/Desktop/research.md"),
    ),
    "letgo": (
        Path("/Users/seb/letgo/README.md"),
        Path("/Users/seb/letgo/docs/ARCHITECTURE.md"),
        Path("/Users/seb/letgo/harness-swift/README.md"),
    ),
    "the_tub": (
        Path("/Users/seb/the-tub-harness/README.md"),
        Path("/Users/seb/the-tub-harness/docs/mode-contract.md"),
        Path("/Users/seb/the-tub-harness/docs/log_schema.md"),
    ),
    "praetorius": (
        Path("/Users/seb/praetorius/README.md"),
        Path("/Users/seb/praetorius/website/docs/index.md"),
        Path("/Users/seb/praetorius/website/docs/docs/getting-started.md"),
    ),
    "dexdrones": (
        Path("/Users/seb/dexdsl.github.io/README.md"),
        Path("/Users/seb/dexdsl.github.io/data/about.data.json"),
        Path("/Users/seb/dexdsl.github.io/content/dexnotes/posts/dexdrones-launch-announcement-2026-03-09.md"),
    ),
}


@dataclass(frozen=True)
class EvidenceSnippet:
    id: str
    project_id: str
    path: str
    text: str
    source_kind: str


@dataclass(frozen=True)
class IngestCorpus:
    snippets: tuple[EvidenceSnippet, ...]
    missing_paths: tuple[str, ...]

    def for_project(self, project_id: str) -> tuple[EvidenceSnippet, ...]:
        return tuple(snippet for snippet in self.snippets if snippet.project_id == project_id)


class ContextIngestPipeline:
    """Read-only ingest pipeline from canonical project roots + dossier evidence refs."""

    def __init__(
        self,
        source_map: dict[str, tuple[Path, ...]] | None = None,
        dossier_store: DossierStore | None = None,
    ) -> None:
        self.source_map = source_map or DEFAULT_PROJECT_SOURCE_MAP
        self.dossier_store = dossier_store or DossierStore.load_default()

    @staticmethod
    def _extract_pdf_text(path: Path, max_chars: int = 12000) -> str:
        try:
            from pypdf import PdfReader  # type: ignore
        except Exception:
            return ""

        try:
            reader = PdfReader(str(path))
            text_parts: list[str] = []
            for page in reader.pages[:20]:
                extracted = page.extract_text() or ""
                if extracted.strip():
                    text_parts.append(extracted)
                if sum(len(item) for item in text_parts) >= max_chars:
                    break
            return "\n".join(text_parts)[:max_chars]
        except Exception:
            return ""

    @staticmethod
    def _truncate(text: str, max_chars: int = 18000) -> str:
        cleaned = text.strip()
        if len(cleaned) <= max_chars:
            return cleaned
        return cleaned[:max_chars] + "\n... [truncated for stage runtime]"

    def _load_path_text(self, path: Path) -> str:
        if path.suffix.lower() == ".pdf":
            pdf_text = self._extract_pdf_text(path)
            if pdf_text.strip():
                return pdf_text
            return (
                f"PDF source available at {path}. "
                "Text extraction unavailable in current runtime; use markdown side-context and direct page citation."
            )
        return read_text_safe(path)

    def _dossier_evidence_snippets(self) -> Iterable[EvidenceSnippet]:
        for dossier in self.dossier_store.dossiers:
            for index, ref in enumerate(dossier.evidence_refs, start=1):
                snippet_id = f"{dossier.id}:dossier:{index}"
                text = f"{ref.label}\n{ref.excerpt}\nPath: {ref.path}"
                if ref.line_hint:
                    text += f"\nLine hint: {ref.line_hint}"
                yield EvidenceSnippet(
                    id=snippet_id,
                    project_id=dossier.id,
                    path=ref.path,
                    text=self._truncate(text, max_chars=2400),
                    source_kind="dossier_ref",
                )

    def ingest(self) -> IngestCorpus:
        snippets: list[EvidenceSnippet] = []
        missing_paths: list[str] = []

        for project_id, paths in self.source_map.items():
            for idx, path in enumerate(paths, start=1):
                if not path.exists():
                    missing_paths.append(str(path))
                    continue

                content = self._load_path_text(path)
                if not content.strip():
                    continue

                snippet = EvidenceSnippet(
                    id=f"{project_id}:source:{idx}",
                    project_id=project_id,
                    path=str(path),
                    text=self._truncate(content),
                    source_kind="source_file",
                )
                snippets.append(snippet)

        snippets.extend(self._dossier_evidence_snippets())

        # Ensure dissertation context always has markdown backup snippets.
        paper_present = any(snippet.project_id == "cybernetics_paper" for snippet in snippets)
        if not paper_present:
            for idx, side_path in enumerate(DISSERTATION_MARKDOWN_CONTEXT, start=1):
                if side_path.exists():
                    snippets.append(
                        EvidenceSnippet(
                            id=f"cybernetics_paper:side:{idx}",
                            project_id="cybernetics_paper",
                            path=str(side_path),
                            text=self._truncate(read_text_safe(side_path), max_chars=12000),
                            source_kind="markdown_side_context",
                        )
                    )

        return IngestCorpus(snippets=tuple(snippets), missing_paths=tuple(sorted(set(missing_paths))))
