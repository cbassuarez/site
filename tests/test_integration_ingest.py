from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import unittest
from pathlib import Path

from soc_console.ingest import CANONICAL_ROOTS, ContextIngestPipeline
from soc_console.retrieval import EvidenceRetriever


class IngestIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        missing = [str(path) for path in CANONICAL_ROOTS if not Path(path).exists()]
        if missing:
            self.skipTest(f"Canonical roots missing: {missing}")

    def test_ingests_all_projects(self) -> None:
        pipeline = ContextIngestPipeline()
        corpus = pipeline.ingest()

        counts = {}
        for snippet in corpus.snippets:
            counts[snippet.project_id] = counts.get(snippet.project_id, 0) + 1

        for project_id in ["cybernetics_paper", "letgo", "the_tub", "praetorius", "dexdrones"]:
            self.assertGreater(counts.get(project_id, 0), 0, f"No snippets ingested for {project_id}")

    def test_seeded_retrieval_quality(self) -> None:
        corpus = ContextIngestPipeline().ingest()
        retriever = EvidenceRetriever(corpus)

        letgo_hits = retriever.search("timeline source of truth cue stream", limit=3)
        self.assertTrue(any(hit.project_id == "letgo" for hit in letgo_hits))

        tub_hits = retriever.search("contract fingerprint protocol version mode contract", limit=3)
        self.assertTrue(any(hit.project_id == "the_tub" for hit in tub_hits))

        prae_hits = retriever.search("page-follow pdf synchronized audio", limit=3)
        self.assertTrue(any(hit.project_id == "praetorius" for hit in prae_hits))


if __name__ == "__main__":
    unittest.main()
