"""Tmux layout profile loading."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .contracts import TmuxLayoutProfile
from .io_utils import load_structured_file
from .paths import data_dir


TMUX_LAYOUT_PATH = data_dir() / "tmux_layouts.json"


@dataclass(frozen=True)
class TmuxProfiles:
    profiles: tuple[TmuxLayoutProfile, ...]

    @classmethod
    def load_default(cls) -> "TmuxProfiles":
        payload = load_structured_file(TMUX_LAYOUT_PATH)
        items = payload.get("profiles", [])
        if not isinstance(items, list):
            raise ValueError("tmux_layouts.json must contain a profiles list")
        profiles = tuple(TmuxLayoutProfile.from_dict(item) for item in items)
        return cls(profiles=profiles)

    def get(self, name: str) -> TmuxLayoutProfile:
        for profile in self.profiles:
            if profile.name == name:
                return profile
        raise KeyError(f"Unknown tmux profile: {name}")

    def names(self) -> tuple[str, ...]:
        return tuple(profile.name for profile in self.profiles)
