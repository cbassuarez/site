"""Local lexical retrieval over ingested evidence snippets."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from .ingest import EvidenceSnippet, IngestCorpus

TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+")


@dataclass(frozen=True)
class EvidenceHit:
    snippet_id: str
    project_id: str
    path: str
    excerpt: str
    score: float
    source_kind: str


class EvidenceRetriever:
    def __init__(self, corpus: IngestCorpus) -> None:
        self.corpus = corpus
        self._idf = self._compute_idf(corpus.snippets)

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        return [token.lower() for token in TOKEN_RE.findall(text)]

    def _compute_idf(self, snippets: tuple[EvidenceSnippet, ...]) -> dict[str, float]:
        doc_count = max(len(snippets), 1)
        term_doc_freq: dict[str, int] = {}
        for snippet in snippets:
            unique_tokens = set(self._tokenize(snippet.text))
            for token in unique_tokens:
                term_doc_freq[token] = term_doc_freq.get(token, 0) + 1

        return {
            term: math.log((1 + doc_count) / (1 + df)) + 1.0
            for term, df in term_doc_freq.items()
        }

    def search(self, query: str, *, limit: int = 5, project_id: str | None = None) -> tuple[EvidenceHit, ...]:
        tokens = self._tokenize(query)
        if not tokens:
            return tuple()

        scored: list[EvidenceHit] = []
        for snippet in self.corpus.snippets:
            if project_id and snippet.project_id != project_id:
                continue

            snippet_tokens = self._tokenize(snippet.text)
            if not snippet_tokens:
                continue

            tf: dict[str, int] = {}
            for token in snippet_tokens:
                tf[token] = tf.get(token, 0) + 1

            score = 0.0
            for token in tokens:
                term_tf = tf.get(token, 0)
                if term_tf == 0:
                    continue
                score += (1.0 + math.log(term_tf)) * self._idf.get(token, 1.0)

            if score <= 0:
                continue

            excerpt = snippet.text[:320].replace("\n", " ").strip()
            scored.append(
                EvidenceHit(
                    snippet_id=snippet.id,
                    project_id=snippet.project_id,
                    path=snippet.path,
                    excerpt=excerpt,
                    score=score,
                    source_kind=snippet.source_kind,
                )
            )

        scored.sort(key=lambda hit: hit.score, reverse=True)
        return tuple(scored[:limit])

    def trace(self, project_id: str, *, limit: int = 8) -> tuple[EvidenceHit, ...]:
        hits = [
            EvidenceHit(
                snippet_id=snippet.id,
                project_id=snippet.project_id,
                path=snippet.path,
                excerpt=snippet.text[:280].replace("\n", " ").strip(),
                score=1.0,
                source_kind=snippet.source_kind,
            )
            for snippet in self.corpus.for_project(project_id)
        ]
        return tuple(hits[:limit])
