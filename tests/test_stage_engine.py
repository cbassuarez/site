from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import unittest

from soc_console.stage_engine import StageEngine
from soc_console.timeline import Timeline


class StageEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.timeline = Timeline.load_default()
        self.stage = StageEngine(script=self.timeline.script)

    def test_next_progresses_deterministically(self) -> None:
        self.assertEqual(self.stage.current_scene.id, "intro")
        self.stage.next_scene()
        self.assertEqual(self.stage.current_scene.id, "project_1")
        self.stage.next_scene()
        self.assertEqual(self.stage.current_scene.id, "project_2")

    def test_hold_blocks_transition(self) -> None:
        self.stage.hold()
        before = self.stage.current_scene.id
        self.stage.next_scene()
        self.assertEqual(self.stage.current_scene.id, before)
        self.stage.release_hold()
        self.stage.next_scene()
        self.assertNotEqual(self.stage.current_scene.id, before)

    def test_jump(self) -> None:
        self.stage.jump("project_5")
        self.assertEqual(self.stage.current_scene.id, "project_5")
        self.assertEqual(self.stage.baton_owner, "agent")


if __name__ == "__main__":
    unittest.main()
