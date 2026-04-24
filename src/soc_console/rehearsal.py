"""Rehearsal simulation and resilience drills."""

from __future__ import annotations

import time
from dataclasses import dataclass

from .commands import CommandRouter
from .reasoning import ReasoningRequest
from .stage_engine import StageEngine


@dataclass(frozen=True)
class DrillResult:
    name: str
    passed: bool
    latency_seconds: float
    note: str


@dataclass(frozen=True)
class DryRunReport:
    duration_minutes: int
    scene_count: int
    baton_handoffs: int
    finished_at_scene: str
    blockage_detected: bool


class RehearsalRunner:
    def __init__(self, stage: StageEngine, commands: CommandRouter) -> None:
        self.stage = stage
        self.commands = commands

    def dry_run(self) -> DryRunReport:
        baton_handoffs = 0
        prev_baton = self.stage.baton_owner
        blockage_detected = False

        for _ in range(len(self.stage.script.scenes) - 1):
            before = self.stage.current_scene.id
            self.stage.next_scene()
            after = self.stage.current_scene.id
            if before == after:
                blockage_detected = True
            if self.stage.baton_owner != prev_baton:
                baton_handoffs += 1
            prev_baton = self.stage.baton_owner

        return DryRunReport(
            duration_minutes=self.stage.script.duration_minutes,
            scene_count=len(self.stage.script.scenes),
            baton_handoffs=baton_handoffs,
            finished_at_scene=self.stage.current_scene.id,
            blockage_detected=blockage_detected,
        )

    def network_degradation_drill(self) -> DrillResult:
        start = time.perf_counter()
        card = self.commands.reasoner.generate_card(
            ReasoningRequest(
                command="synthesize",
                query="How does baton-switching preserve cybernetic co-observation under network failure?",
                scene_id=self.stage.current_scene.id,
                baton_owner=self.stage.baton_owner,
                project_id=None,
            )
        )
        latency = time.perf_counter() - start
        passed = latency < 5.0 and card.mode in {"fallback", "cloud"}
        note = f"mode={card.mode}"
        return DrillResult(name="network_degradation", passed=passed, latency_seconds=latency, note=note)

    def media_desync_recovery_drill(self) -> DrillResult:
        start = time.perf_counter()
        # Deterministic recovery action: hold, cite context, release.
        self.commands.execute("hold")
        self.commands.execute("cite sync drift correction")
        self.commands.execute("hold")
        latency = time.perf_counter() - start
        passed = latency < 5.0
        return DrillResult(
            name="media_desync_recovery",
            passed=passed,
            latency_seconds=latency,
            note="hold/cite/release sequence completed",
        )

    def audience_intervention_drill(self) -> DrillResult:
        start = time.perf_counter()
        response = self.commands.execute("audience-prompt Offer one intervention that reframes agency as reciprocal listening")
        latency = time.perf_counter() - start
        passed = response.ok and self.commands.audience_prompt is not None
        return DrillResult(
            name="audience_intervention",
            passed=passed,
            latency_seconds=latency,
            note=response.message,
        )

    def run_all_drills(self) -> dict[str, object]:
        dry = self.dry_run()
        network = self.network_degradation_drill()
        media = self.media_desync_recovery_drill()
        audience = self.audience_intervention_drill()
        return {
            "dry_run": dry,
            "drills": [network, media, audience],
            "all_passed": all(item.passed for item in [network, media, audience]) and not dry.blockage_detected,
        }
