"""Stage engine with deterministic scene transitions and baton control."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from .contracts import SceneCue, SceneScript


BatonOwner = Literal["human", "agent", "shared"]


@dataclass(frozen=True)
class StageEvent:
    at: str
    action: str
    scene_id: str
    baton_owner: BatonOwner
    note: str = ""


@dataclass
class StageEngine:
    script: SceneScript
    scene_index: int = 0
    hold_active: bool = False
    baton_owner: BatonOwner = "shared"
    events: list[StageEvent] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.baton_owner = self.current_scene.baton_owner
        self._log("boot", note="stage engine initialized")

    @property
    def current_scene(self) -> SceneCue:
        return self.script.scenes[self.scene_index]

    def _timestamp(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _log(self, action: str, note: str = "") -> None:
        self.events.append(
            StageEvent(
                at=self._timestamp(),
                action=action,
                scene_id=self.current_scene.id,
                baton_owner=self.baton_owner,
                note=note,
            )
        )

    def status(self) -> dict[str, str | bool | int | float]:
        return {
            "scene_id": self.current_scene.id,
            "scene_title": self.current_scene.title,
            "scene_start_minute": self.current_scene.start_minute,
            "baton_owner": self.baton_owner,
            "hold_active": self.hold_active,
            "scene_index": self.scene_index,
        }

    def set_baton(self, owner: BatonOwner) -> SceneCue:
        self.baton_owner = owner
        self._log("baton", note=f"set baton to {owner}")
        return self.current_scene

    def hold(self) -> SceneCue:
        self.hold_active = True
        self._log("hold", note="stage hold engaged")
        return self.current_scene

    def release_hold(self) -> SceneCue:
        self.hold_active = False
        self._log("release", note="stage hold released")
        return self.current_scene

    def next_scene(self) -> SceneCue:
        if self.hold_active:
            self._log("next_blocked", note="hold active")
            return self.current_scene

        if self.scene_index >= len(self.script.scenes) - 1:
            self._log("next_blocked", note="already at final scene")
            return self.current_scene

        self.scene_index += 1
        self.baton_owner = self.current_scene.baton_owner
        self._log("next", note="advanced to next scene")
        return self.current_scene

    def jump(self, scene_id: str) -> SceneCue:
        target_index = None
        for idx, scene in enumerate(self.script.scenes):
            if scene.id == scene_id:
                target_index = idx
                break

        if target_index is None:
            raise KeyError(f"Unknown scene_id: {scene_id}")

        if self.hold_active:
            self._log("jump_blocked", note="hold active")
            return self.current_scene

        self.scene_index = target_index
        self.baton_owner = self.current_scene.baton_owner
        self._log("jump", note=f"jumped to {scene_id}")
        return self.current_scene
