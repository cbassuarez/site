from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import unittest

from soc_console.rehearsal import RehearsalRunner
from soc_console.runtime import build_runtime


class RehearsalTests(unittest.TestCase):
    def test_dry_run_reaches_final_scene(self) -> None:
        runtime = build_runtime()
        runner = RehearsalRunner(stage=runtime.stage, commands=runtime.commands)
        report = runner.dry_run()

        self.assertEqual(report.duration_minutes, 60)
        self.assertEqual(report.finished_at_scene, "closing_thesis")
        self.assertFalse(report.blockage_detected)

    def test_drills_complete(self) -> None:
        runtime = build_runtime()
        runner = RehearsalRunner(stage=runtime.stage, commands=runtime.commands)
        payload = runner.run_all_drills()
        self.assertIn("all_passed", payload)
        self.assertTrue(payload["all_passed"])


if __name__ == "__main__":
    unittest.main()
