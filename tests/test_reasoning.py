from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import time
import unittest

from soc_console.dossier_store import DossierStore
from soc_console.ingest import EvidenceSnippet, IngestCorpus
from soc_console.reasoning import OpenAIResponseClient, ReasoningEngine, ReasoningRequest
from soc_console.retrieval import EvidenceRetriever


class FailClient(OpenAIResponseClient):
    def __init__(self) -> None:
        super().__init__(model="fake")

    def available(self) -> bool:  # type: ignore[override]
        return True

    def run(self, *, system_prompt: str, user_prompt: str, timeout_s: float = 4.0) -> str:  # type: ignore[override]
        raise RuntimeError("forced failure")


class SuccessClient(OpenAIResponseClient):
    def __init__(self) -> None:
        super().__init__(model="fake")

    def available(self) -> bool:  # type: ignore[override]
        return True

    def run(self, *, system_prompt: str, user_prompt: str, timeout_s: float = 4.0) -> str:  # type: ignore[override]
        return '{"claim":"c","evidence":["/tmp/a#1"],"inference":"i","confidence":0.91,"counterpoint":"k"}'


class ReasoningTests(unittest.TestCase):
    def setUp(self) -> None:
        corpus = IngestCorpus(
            snippets=(
                EvidenceSnippet(
                    id="letgo:source:1",
                    project_id="letgo",
                    path="/Users/seb/letgo/README.md",
                    text="Swift harness is the timeline source of truth.",
                    source_kind="source_file",
                ),
            ),
            missing_paths=(),
        )
        self.retriever = EvidenceRetriever(corpus)
        self.store = DossierStore.load_default()

    def test_cloud_success_parses_card(self) -> None:
        engine = ReasoningEngine(
            retriever=self.retriever,
            dossier_store=self.store,
            cloud_client=SuccessClient(),
        )
        card = engine.generate_card(
            ReasoningRequest(
                command="context",
                query="timeline source of truth",
                scene_id="project_2",
                baton_owner="shared",
                project_id="letgo",
            )
        )
        self.assertEqual(card.mode, "cloud")
        self.assertGreater(card.confidence, 0.8)

    def test_failover_under_five_seconds(self) -> None:
        engine = ReasoningEngine(
            retriever=self.retriever,
            dossier_store=self.store,
            cloud_client=FailClient(),
            max_retries=1,
            max_failover_seconds=2.0,
        )

        start = time.perf_counter()
        card = engine.generate_card(
            ReasoningRequest(
                command="synthesize",
                query="fallback behavior",
                scene_id="project_2",
                baton_owner="shared",
                project_id="letgo",
            )
        )
        elapsed = time.perf_counter() - start

        self.assertEqual(card.mode, "fallback")
        self.assertLess(elapsed, 5.0)


if __name__ == "__main__":
    unittest.main()
