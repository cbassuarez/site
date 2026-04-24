from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import unittest

from soc_console.tmux_orchestrator import TmuxOrchestrator
from soc_console.tmux_profiles import TmuxProfiles


class TmuxPlanTests(unittest.TestCase):
    def test_plan_generation(self) -> None:
        profiles = TmuxProfiles.load_default()
        profile = profiles.get("seminar-default")
        orchestrator = TmuxOrchestrator(profile)
        plan = orchestrator.build_plan()
        lines = plan.shell_lines()

        self.assertTrue(lines)
        self.assertIn("tmux new-session", lines[0])
        self.assertTrue(any("attach-session" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
