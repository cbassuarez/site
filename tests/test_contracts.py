from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import unittest

from soc_console.contracts import ContractError, ProjectDossier, ReasoningCard, SceneScript, TmuxLayoutProfile
from soc_console.io_utils import load_structured_file
from soc_console.paths import data_dir, dossiers_dir


class ContractTests(unittest.TestCase):
    def test_all_dossiers_validate(self) -> None:
        for path in sorted(dossiers_dir().glob("*.json")):
            payload = load_structured_file(path)
            dossier = ProjectDossier.from_dict(payload)
            self.assertTrue(dossier.id)
            self.assertGreaterEqual(dossier.chronology_order, 1)
            self.assertTrue(dossier.evidence_refs)

    def test_dossier_missing_key_raises(self) -> None:
        payload = {
            "id": "x",
            "title": "X",
            "chronology_order": 1,
            "thesis_claim": "x",
            "cybernetic_loop": "x",
            "material_system": "x",
            "agency_model": "x",
            "evidence_refs": [{"label": "l", "path": "/tmp/a", "excerpt": "e"}],
            "demo_assets": [],
        }
        with self.assertRaises(ContractError):
            ProjectDossier.from_dict(payload)

    def test_scene_script_validates_required_ids(self) -> None:
        payload = load_structured_file(data_dir() / "scene_script.json")
        script = SceneScript.from_dict(payload)
        self.assertEqual(script.duration_minutes, 60)
        self.assertEqual(script.scenes[0].id, "intro")

    def test_reasoning_card_confidence_bounds(self) -> None:
        with self.assertRaises(ContractError):
            ReasoningCard.from_dict(
                {
                    "claim": "c",
                    "evidence": ["a"],
                    "inference": "i",
                    "confidence": 1.5,
                    "counterpoint": "cp",
                }
            )

    def test_tmux_layout_validates(self) -> None:
        payload = load_structured_file(data_dir() / "tmux_layouts.json")
        profile = TmuxLayoutProfile.from_dict(payload["profiles"][0])
        self.assertTrue(profile.panes)
        self.assertIn("R", profile.bindings)


if __name__ == "__main__":
    unittest.main()
