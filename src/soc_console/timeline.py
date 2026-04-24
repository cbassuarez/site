"""Scene script loading and timeline utilities."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .contracts import SceneCue, SceneScript
from .io_utils import load_structured_file
from .paths import data_dir


SCENE_SCRIPT_PATH = data_dir() / "scene_script.json"


@dataclass(frozen=True)
class Timeline:
    script: SceneScript

    @classmethod
    def load_default(cls) -> "Timeline":
        return cls.load_from_path(SCENE_SCRIPT_PATH)

    @classmethod
    def load_from_path(cls, path: Path) -> "Timeline":
        payload = load_structured_file(path)
        return cls(script=SceneScript.from_dict(payload))

    def find_scene(self, scene_id: str) -> SceneCue:
        for scene in self.script.scenes:
            if scene.id == scene_id:
                return scene
        raise KeyError(f"Unknown scene id: {scene_id}")
