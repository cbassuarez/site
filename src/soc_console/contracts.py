"""Core public contracts for the second-order cybernetic console."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal


class ContractError(ValueError):
    """Raised when a contract payload is invalid."""


def _require_keys(data: dict[str, Any], required: set[str], allowed: set[str], name: str) -> None:
    missing = sorted(required.difference(data.keys()))
    extra = sorted(set(data.keys()).difference(allowed))
    if missing:
        raise ContractError(f"{name} missing required keys: {', '.join(missing)}")
    if extra:
        raise ContractError(f"{name} has unknown keys: {', '.join(extra)}")


def _require_non_empty(value: str, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} must be a non-empty string")
    return value.strip()


@dataclass(frozen=True)
class EvidenceRef:
    label: str
    path: str
    excerpt: str
    line_hint: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EvidenceRef":
        required = {"label", "path", "excerpt"}
        allowed = required | {"line_hint"}
        _require_keys(data, required, allowed, "EvidenceRef")
        return cls(
            label=_require_non_empty(data["label"], "EvidenceRef.label"),
            path=_require_non_empty(data["path"], "EvidenceRef.path"),
            excerpt=_require_non_empty(data["excerpt"], "EvidenceRef.excerpt"),
            line_hint=data.get("line_hint"),
        )


@dataclass(frozen=True)
class DemoAsset:
    label: str
    type: Literal["video", "audio", "image", "doc", "repo", "url", "terminal"]
    path: str
    pane: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DemoAsset":
        required = {"label", "type", "path"}
        allowed = required | {"pane"}
        _require_keys(data, required, allowed, "DemoAsset")
        demo_type = _require_non_empty(data["type"], "DemoAsset.type")
        valid_types = {"video", "audio", "image", "doc", "repo", "url", "terminal"}
        if demo_type not in valid_types:
            raise ContractError(f"DemoAsset.type must be one of {sorted(valid_types)}")
        return cls(
            label=_require_non_empty(data["label"], "DemoAsset.label"),
            type=demo_type,  # type: ignore[arg-type]
            path=_require_non_empty(data["path"], "DemoAsset.path"),
            pane=data.get("pane"),
        )


@dataclass(frozen=True)
class ProjectDossier:
    """Stable schema for project ingest + retrieval."""

    id: str
    title: str
    chronology_order: int
    thesis_claim: str
    cybernetic_loop: str
    material_system: str
    agency_model: str
    evidence_refs: tuple[EvidenceRef, ...]
    demo_assets: tuple[DemoAsset, ...]
    risk_notes: tuple[str, ...]
    tags: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProjectDossier":
        required = {
            "id",
            "title",
            "chronology_order",
            "thesis_claim",
            "cybernetic_loop",
            "material_system",
            "agency_model",
            "evidence_refs",
            "demo_assets",
            "risk_notes",
        }
        allowed = required | {"tags"}
        _require_keys(data, required, allowed, "ProjectDossier")

        evidence_list = data["evidence_refs"]
        demo_list = data["demo_assets"]
        risk_list = data["risk_notes"]

        if not isinstance(evidence_list, list) or not evidence_list:
            raise ContractError("ProjectDossier.evidence_refs must be a non-empty list")
        if not isinstance(demo_list, list):
            raise ContractError("ProjectDossier.demo_assets must be a list")
        if not isinstance(risk_list, list) or not risk_list:
            raise ContractError("ProjectDossier.risk_notes must be a non-empty list")

        chronology_order = data["chronology_order"]
        if not isinstance(chronology_order, int) or chronology_order < 1:
            raise ContractError("ProjectDossier.chronology_order must be an integer >= 1")

        tags_raw = data.get("tags", [])
        if not isinstance(tags_raw, list):
            raise ContractError("ProjectDossier.tags must be a list")

        return cls(
            id=_require_non_empty(data["id"], "ProjectDossier.id"),
            title=_require_non_empty(data["title"], "ProjectDossier.title"),
            chronology_order=chronology_order,
            thesis_claim=_require_non_empty(data["thesis_claim"], "ProjectDossier.thesis_claim"),
            cybernetic_loop=_require_non_empty(data["cybernetic_loop"], "ProjectDossier.cybernetic_loop"),
            material_system=_require_non_empty(data["material_system"], "ProjectDossier.material_system"),
            agency_model=_require_non_empty(data["agency_model"], "ProjectDossier.agency_model"),
            evidence_refs=tuple(EvidenceRef.from_dict(item) for item in evidence_list),
            demo_assets=tuple(DemoAsset.from_dict(item) for item in demo_list),
            risk_notes=tuple(_require_non_empty(item, "ProjectDossier.risk_notes[]") for item in risk_list),
            tags=tuple(_require_non_empty(item, "ProjectDossier.tags[]") for item in tags_raw),
        )


@dataclass(frozen=True)
class SceneCue:
    id: str
    title: str
    start_minute: float
    baton_owner: Literal["human", "agent", "shared"]
    fallback_cue: str
    kind: Literal[
        "intro",
        "project",
        "cross_project_synthesis",
        "audience_intervention",
        "closing_thesis",
    ]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SceneCue":
        required = {"id", "title", "start_minute", "baton_owner", "fallback_cue", "kind"}
        _require_keys(data, required, required, "SceneCue")

        start_minute = data["start_minute"]
        if not isinstance(start_minute, (int, float)) or start_minute < 0:
            raise ContractError("SceneCue.start_minute must be >= 0")

        baton_owner = _require_non_empty(data["baton_owner"], "SceneCue.baton_owner")
        kind = _require_non_empty(data["kind"], "SceneCue.kind")

        valid_baton = {"human", "agent", "shared"}
        valid_kinds = {"intro", "project", "cross_project_synthesis", "audience_intervention", "closing_thesis"}
        if baton_owner not in valid_baton:
            raise ContractError(f"SceneCue.baton_owner must be one of {sorted(valid_baton)}")
        if kind not in valid_kinds:
            raise ContractError(f"SceneCue.kind must be one of {sorted(valid_kinds)}")

        return cls(
            id=_require_non_empty(data["id"], "SceneCue.id"),
            title=_require_non_empty(data["title"], "SceneCue.title"),
            start_minute=float(start_minute),
            baton_owner=baton_owner,  # type: ignore[arg-type]
            fallback_cue=_require_non_empty(data["fallback_cue"], "SceneCue.fallback_cue"),
            kind=kind,  # type: ignore[arg-type]
        )


@dataclass(frozen=True)
class SceneScript:
    """Stable contract for seminar sequencing."""

    version: str
    duration_minutes: int
    scenes: tuple[SceneCue, ...]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SceneScript":
        required = {"version", "duration_minutes", "scenes"}
        _require_keys(data, required, required, "SceneScript")

        duration = data["duration_minutes"]
        scenes_raw = data["scenes"]
        if not isinstance(duration, int) or duration <= 0:
            raise ContractError("SceneScript.duration_minutes must be a positive integer")
        if not isinstance(scenes_raw, list) or not scenes_raw:
            raise ContractError("SceneScript.scenes must be a non-empty list")

        scenes = tuple(SceneCue.from_dict(item) for item in scenes_raw)
        ordered = sorted(scenes, key=lambda item: item.start_minute)
        if list(scenes) != ordered:
            raise ContractError("SceneScript.scenes must be sorted by start_minute")

        # Explicit state requirements from the implementation plan.
        required_ids = {
            "intro",
            "project_1",
            "project_2",
            "project_3",
            "project_4",
            "project_5",
            "cross_project_synthesis",
            "audience_intervention",
            "closing_thesis",
        }
        ids = {scene.id for scene in scenes}
        missing = sorted(required_ids.difference(ids))
        if missing:
            raise ContractError(f"SceneScript missing required scene ids: {', '.join(missing)}")

        return cls(
            version=_require_non_empty(data["version"], "SceneScript.version"),
            duration_minutes=duration,
            scenes=scenes,
        )


@dataclass(frozen=True)
class ReasoningCard:
    """Public reasoning surface contract."""

    claim: str
    evidence: tuple[str, ...]
    inference: str
    confidence: float
    counterpoint: str
    mode: Literal["cloud", "fallback"] = "fallback"
    model: str | None = None
    generated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ReasoningCard":
        required = {"claim", "evidence", "inference", "confidence", "counterpoint"}
        allowed = required | {"mode", "model", "generated_at"}
        _require_keys(data, required, allowed, "ReasoningCard")

        evidence = data["evidence"]
        if not isinstance(evidence, list) or not evidence:
            raise ContractError("ReasoningCard.evidence must be a non-empty list")

        confidence = data["confidence"]
        if not isinstance(confidence, (int, float)):
            raise ContractError("ReasoningCard.confidence must be numeric")
        confidence_f = float(confidence)
        if confidence_f < 0.0 or confidence_f > 1.0:
            raise ContractError("ReasoningCard.confidence must be within [0, 1]")

        mode = data.get("mode", "fallback")
        if mode not in {"cloud", "fallback"}:
            raise ContractError("ReasoningCard.mode must be cloud or fallback")

        return cls(
            claim=_require_non_empty(data["claim"], "ReasoningCard.claim"),
            evidence=tuple(_require_non_empty(item, "ReasoningCard.evidence[]") for item in evidence),
            inference=_require_non_empty(data["inference"], "ReasoningCard.inference"),
            confidence=confidence_f,
            counterpoint=_require_non_empty(data["counterpoint"], "ReasoningCard.counterpoint"),
            mode=mode,
            model=data.get("model"),
            generated_at=data.get("generated_at", datetime.now(timezone.utc).isoformat()),
        )


@dataclass(frozen=True)
class TmuxPane:
    name: str
    command: str
    split: Literal["root", "vertical", "horizontal"]
    size: int | None = None
    focus: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TmuxPane":
        required = {"name", "command", "split"}
        allowed = required | {"size", "focus"}
        _require_keys(data, required, allowed, "TmuxPane")
        split = _require_non_empty(data["split"], "TmuxPane.split")
        if split not in {"root", "vertical", "horizontal"}:
            raise ContractError("TmuxPane.split must be root, vertical, or horizontal")
        size = data.get("size")
        if size is not None and (not isinstance(size, int) or size <= 0):
            raise ContractError("TmuxPane.size must be a positive integer")
        return cls(
            name=_require_non_empty(data["name"], "TmuxPane.name"),
            command=_require_non_empty(data["command"], "TmuxPane.command"),
            split=split,  # type: ignore[arg-type]
            size=size,
            focus=bool(data.get("focus", False)),
        )


@dataclass(frozen=True)
class TmuxLayoutProfile:
    """Deterministic pane geometry + bindings."""

    name: str
    description: str
    session_name: str
    window_name: str
    panes: tuple[TmuxPane, ...]
    bindings: dict[str, str]
    scene_overrides: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TmuxLayoutProfile":
        required = {"name", "description", "session_name", "window_name", "panes", "bindings"}
        allowed = required | {"scene_overrides"}
        _require_keys(data, required, allowed, "TmuxLayoutProfile")

        panes_raw = data["panes"]
        if not isinstance(panes_raw, list) or not panes_raw:
            raise ContractError("TmuxLayoutProfile.panes must be a non-empty list")
        bindings_raw = data["bindings"]
        if not isinstance(bindings_raw, dict):
            raise ContractError("TmuxLayoutProfile.bindings must be a dictionary")

        pane_names = [pane_data.get("name") for pane_data in panes_raw if isinstance(pane_data, dict)]
        if len(set(pane_names)) != len(pane_names):
            raise ContractError("TmuxLayoutProfile.panes names must be unique")

        return cls(
            name=_require_non_empty(data["name"], "TmuxLayoutProfile.name"),
            description=_require_non_empty(data["description"], "TmuxLayoutProfile.description"),
            session_name=_require_non_empty(data["session_name"], "TmuxLayoutProfile.session_name"),
            window_name=_require_non_empty(data["window_name"], "TmuxLayoutProfile.window_name"),
            panes=tuple(TmuxPane.from_dict(pane) for pane in panes_raw),
            bindings={
                _require_non_empty(key, "TmuxLayoutProfile.bindings.key"):
                _require_non_empty(value, "TmuxLayoutProfile.bindings.value")
                for key, value in bindings_raw.items()
            },
            scene_overrides={
                _require_non_empty(key, "TmuxLayoutProfile.scene_overrides.key"):
                _require_non_empty(value, "TmuxLayoutProfile.scene_overrides.value")
                for key, value in data.get("scene_overrides", {}).items()
            },
        )
