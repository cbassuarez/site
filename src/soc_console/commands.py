"""Command palette router for performance control."""

from __future__ import annotations

import shlex
from dataclasses import dataclass
from typing import Any

from .contracts import ReasoningCard
from .reasoning import ReasoningEngine, ReasoningRequest
from .retrieval import EvidenceRetriever
from .stage_engine import StageEngine


SAFE_WHEN_CONSTRAINED = {
    "next",
    "hold",
    "context",
    "cite",
    "trace",
    "show-source",
    "audience-prompt",
    "constraint-on",
    "constraint-off",
}


@dataclass(frozen=True)
class CommandResult:
    ok: bool
    command: str
    message: str
    payload: dict[str, Any] | None = None


class CommandRouter:
    def __init__(self, stage: StageEngine, reasoner: ReasoningEngine, retriever: EvidenceRetriever) -> None:
        self.stage = stage
        self.reasoner = reasoner
        self.retriever = retriever
        self.constraint_mode = False
        self.audience_prompt: str | None = None

    def _card_to_payload(self, card: ReasoningCard) -> dict[str, Any]:
        return {
            "claim": card.claim,
            "evidence": list(card.evidence),
            "inference": card.inference,
            "confidence": card.confidence,
            "counterpoint": card.counterpoint,
            "mode": card.mode,
            "model": card.model,
        }

    def _reason(self, command: str, query: str, project_id: str | None = None) -> CommandResult:
        request = ReasoningRequest(
            command=command,
            query=query,
            scene_id=self.stage.current_scene.id,
            baton_owner=self.stage.baton_owner,
            project_id=project_id,
        )
        card = self.reasoner.generate_card(request)
        return CommandResult(ok=True, command=command, message=card.claim, payload=self._card_to_payload(card))

    def _deny(self, command: str, reason: str) -> CommandResult:
        return CommandResult(ok=False, command=command, message=reason)

    def _show_source(self, needle: str) -> CommandResult:
        needle = needle.strip()
        for snippet in self.retriever.corpus.snippets:
            if snippet.id == needle or snippet.path == needle:
                return CommandResult(
                    ok=True,
                    command="show-source",
                    message=f"source {snippet.id}",
                    payload={
                        "snippet_id": snippet.id,
                        "path": snippet.path,
                        "source_kind": snippet.source_kind,
                        "text": snippet.text,
                    },
                )
        return self._deny("show-source", f"No source found for '{needle}'")

    def execute(self, raw_command: str) -> CommandResult:
        raw = raw_command.strip()
        if not raw:
            return self._deny("", "No command provided")

        try:
            parts = shlex.split(raw)
        except ValueError as exc:
            return self._deny("parse", f"Parse error: {exc}")

        command = parts[0]
        args = parts[1:]

        if self.constraint_mode and command not in SAFE_WHEN_CONSTRAINED:
            return self._deny(command, "Command blocked by constraint mode")

        if command == "next":
            scene = self.stage.next_scene()
            return CommandResult(ok=True, command=command, message=f"scene -> {scene.id}", payload=self.stage.status())

        if command == "jump":
            if not args:
                return self._deny(command, "Usage: jump <scene_id>")
            try:
                scene = self.stage.jump(args[0])
                return CommandResult(ok=True, command=command, message=f"scene -> {scene.id}", payload=self.stage.status())
            except KeyError as exc:
                return self._deny(command, str(exc))

        if command == "hold":
            if self.stage.hold_active:
                scene = self.stage.release_hold()
                return CommandResult(ok=True, command=command, message=f"hold released at {scene.id}", payload=self.stage.status())
            scene = self.stage.hold()
            return CommandResult(ok=True, command=command, message=f"hold enabled at {scene.id}", payload=self.stage.status())

        if command == "context":
            if not args:
                return self._deny(command, "Usage: context <query>")
            return self._reason(command, " ".join(args))

        if command == "compare":
            if len(args) < 2:
                return self._deny(command, "Usage: compare <project_a> <project_b> [query]")
            project_a, project_b = args[0], args[1]
            query = " ".join(args[2:]) or f"Compare {project_a} and {project_b}"
            card_a = self.reasoner.generate_card(
                ReasoningRequest(
                    command="context",
                    query=query,
                    scene_id=self.stage.current_scene.id,
                    baton_owner=self.stage.baton_owner,
                    project_id=project_a,
                )
            )
            card_b = self.reasoner.generate_card(
                ReasoningRequest(
                    command="context",
                    query=query,
                    scene_id=self.stage.current_scene.id,
                    baton_owner=self.stage.baton_owner,
                    project_id=project_b,
                )
            )
            synthesis = self.reasoner.generate_card(
                ReasoningRequest(
                    command="synthesize",
                    query=f"Synthesize comparison between {project_a} and {project_b}: {query}",
                    scene_id=self.stage.current_scene.id,
                    baton_owner=self.stage.baton_owner,
                    project_id=None,
                )
            )
            return CommandResult(
                ok=True,
                command=command,
                message=synthesis.claim,
                payload={
                    "project_a": self._card_to_payload(card_a),
                    "project_b": self._card_to_payload(card_b),
                    "synthesis": self._card_to_payload(synthesis),
                },
            )

        if command == "synthesize":
            if not args:
                return self._deny(command, "Usage: synthesize <query>")
            return self._reason(command, " ".join(args))

        if command == "cite":
            if not args:
                return self._deny(command, "Usage: cite <query>")
            query = " ".join(args)
            hits = self.retriever.search(query, limit=8)
            payload = {
                "query": query,
                "hits": [
                    {
                        "snippet_id": hit.snippet_id,
                        "project_id": hit.project_id,
                        "path": hit.path,
                        "score": hit.score,
                        "excerpt": hit.excerpt,
                        "source_kind": hit.source_kind,
                    }
                    for hit in hits
                ],
            }
            return CommandResult(ok=True, command=command, message=f"{len(hits)} citations", payload=payload)

        if command == "trace":
            if not args:
                return self._deny(command, "Usage: trace <project_id>")
            hits = self.retriever.trace(args[0])
            payload = {
                "project_id": args[0],
                "hits": [
                    {
                        "snippet_id": hit.snippet_id,
                        "path": hit.path,
                        "source_kind": hit.source_kind,
                        "excerpt": hit.excerpt,
                    }
                    for hit in hits
                ],
            }
            return CommandResult(ok=True, command=command, message=f"trace {args[0]} -> {len(hits)} snippets", payload=payload)

        if command == "show-source":
            if not args:
                return self._deny(command, "Usage: show-source <snippet_id|path>")
            return self._show_source(" ".join(args))

        if command == "audience-prompt":
            if not args:
                return self._deny(command, "Usage: audience-prompt <prompt>")
            self.audience_prompt = " ".join(args)
            return CommandResult(
                ok=True,
                command=command,
                message="audience intervention prompt armed",
                payload={"audience_prompt": self.audience_prompt},
            )

        if command == "constraint-on":
            self.constraint_mode = True
            return CommandResult(ok=True, command=command, message="constraint mode enabled")

        if command == "constraint-off":
            self.constraint_mode = False
            return CommandResult(ok=True, command=command, message="constraint mode disabled")

        if command == "baton":
            if not args:
                return self._deny(command, "Usage: baton <human|agent|shared>")
            owner = args[0]
            if owner not in {"human", "agent", "shared"}:
                return self._deny(command, "baton must be human|agent|shared")
            self.stage.set_baton(owner)  # type: ignore[arg-type]
            return CommandResult(ok=True, command=command, message=f"baton -> {owner}", payload=self.stage.status())

        return self._deny(command, "Unknown command")
