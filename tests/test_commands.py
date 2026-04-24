from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import unittest

from soc_console.commands import CommandRouter
from soc_console.contracts import ReasoningCard
from soc_console.ingest import EvidenceSnippet, IngestCorpus
from soc_console.reasoning import ReasoningRequest
from soc_console.retrieval import EvidenceRetriever
from soc_console.stage_engine import StageEngine
from soc_console.timeline import Timeline


class FakeReasoner:
    def generate_card(self, request: ReasoningRequest) -> ReasoningCard:
        return ReasoningCard.from_dict(
            {
                "claim": f"claim for {request.command}",
                "evidence": ["/tmp/a#1"],
                "inference": request.query,
                "confidence": 0.7,
                "counterpoint": "counter",
                "mode": "fallback",
            }
        )


class CommandTests(unittest.TestCase):
    def setUp(self) -> None:
        stage = StageEngine(script=Timeline.load_default().script)
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
        retriever = EvidenceRetriever(corpus)
        self.router = CommandRouter(stage=stage, reasoner=FakeReasoner(), retriever=retriever)  # type: ignore[arg-type]

    def test_constraint_mode_blocks_jump(self) -> None:
        self.router.execute("constraint-on")
        result = self.router.execute("jump project_3")
        self.assertFalse(result.ok)
        self.assertIn("blocked", result.message)

    def test_context_command_returns_card_payload(self) -> None:
        result = self.router.execute("context cybernetics")
        self.assertTrue(result.ok)
        assert result.payload is not None
        self.assertIn("claim", result.payload)

    def test_show_source(self) -> None:
        result = self.router.execute("show-source letgo:source:1")
        self.assertTrue(result.ok)
        assert result.payload is not None
        self.assertIn("timeline source", result.payload["text"])


if __name__ == "__main__":
    unittest.main()
