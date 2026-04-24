"""tmux orchestration for deterministic stage layouts."""

from __future__ import annotations

import shlex
import subprocess
from dataclasses import dataclass
from typing import Sequence

from .contracts import TmuxLayoutProfile, TmuxPane


@dataclass(frozen=True)
class TmuxCommandPlan:
    commands: tuple[list[str], ...]

    def shell_lines(self) -> tuple[str, ...]:
        return tuple(" ".join(shlex.quote(part) for part in cmd) for cmd in self.commands)


class TmuxOrchestrator:
    def __init__(self, profile: TmuxLayoutProfile) -> None:
        self.profile = profile

    @staticmethod
    def _split_flag(pane: TmuxPane) -> str:
        if pane.split == "vertical":
            return "-v"
        if pane.split == "horizontal":
            return "-h"
        raise ValueError("root pane has no split flag")

    def build_plan(self) -> TmuxCommandPlan:
        panes = list(self.profile.panes)
        root_pane = next((pane for pane in panes if pane.split == "root"), None)
        if root_pane is None:
            raise ValueError("Tmux profile must contain exactly one root pane")

        plan: list[list[str]] = [
            [
                "tmux",
                "new-session",
                "-d",
                "-s",
                self.profile.session_name,
                "-n",
                self.profile.window_name,
                root_pane.command,
            ]
        ]

        for pane in panes:
            if pane is root_pane:
                continue
            split_cmd = [
                "tmux",
                "split-window",
                self._split_flag(pane),
                "-t",
                f"{self.profile.session_name}:{self.profile.window_name}",
            ]
            if pane.size:
                split_cmd.extend(["-p", str(pane.size)])
            split_cmd.append(pane.command)
            plan.append(split_cmd)

        plan.append(["tmux", "select-layout", "-t", f"{self.profile.session_name}:{self.profile.window_name}", "tiled"])

        for key, action in self.profile.bindings.items():
            plan.append(["tmux", "bind-key", "-T", "prefix", key, "run-shell", action])

        focus_index = 0
        for idx, pane in enumerate(panes):
            if pane.focus:
                focus_index = idx
                break
        plan.append(
            [
                "tmux",
                "select-pane",
                "-t",
                f"{self.profile.session_name}:{self.profile.window_name}.{focus_index}",
            ]
        )
        plan.append(["tmux", "attach-session", "-t", self.profile.session_name])

        return TmuxCommandPlan(commands=tuple(plan))

    def run_plan(self, plan: TmuxCommandPlan | None = None) -> None:
        run_plan = plan or self.build_plan()
        commands = list(run_plan.commands)

        # Attach should run last in foreground.
        attach = commands.pop()
        for cmd in commands:
            subprocess.run(cmd, check=True)
        subprocess.run(attach, check=True)

    def switch_layout_for_scene(self, scene_id: str) -> Sequence[str]:
        layout = self.profile.scene_overrides.get(scene_id, "tiled")
        cmd = [
            "tmux",
            "select-layout",
            "-t",
            f"{self.profile.session_name}:{self.profile.window_name}",
            layout,
        ]
        subprocess.run(cmd, check=True)
        return cmd
