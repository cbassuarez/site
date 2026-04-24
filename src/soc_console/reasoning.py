"""Cloud-first reasoning with strict local retrieval and fallback cards."""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any

from .contracts import ProjectDossier, ReasoningCard
from .dossier_store import DossierStore
from .retrieval import EvidenceHit, EvidenceRetriever


JSON_BLOCK_RE = re.compile(r"\{[\s\S]*\}")


@dataclass(frozen=True)
class ReasoningRequest:
    command: str
    query: str
    scene_id: str
    baton_owner: str
    project_id: str | None = None


class OpenAIResponseClient:
    """Small wrapper so tests can mock cloud behavior."""

    def __init__(self, model: str = "gpt-4.1") -> None:
        self.model = model
        self._client = None

    def available(self) -> bool:
        if not os.getenv("OPENAI_API_KEY"):
            return False
        try:
            from openai import OpenAI  # type: ignore
        except Exception:
            return False
        if self._client is None:
            self._client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        return True

    def run(self, *, system_prompt: str, user_prompt: str, timeout_s: float = 4.0) -> str:
        if not self.available():
            raise RuntimeError("OpenAI client unavailable")
        assert self._client is not None

        response = self._client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_output_tokens=500,
            timeout=timeout_s,
        )
        text = getattr(response, "output_text", "")
        if text:
            return text

        # Fallback extraction for SDK variants.
        fragments: list[str] = []
        output = getattr(response, "output", []) or []
        for item in output:
            content = getattr(item, "content", []) or []
            for part in content:
                part_text = getattr(part, "text", "")
                if part_text:
                    fragments.append(part_text)
        if fragments:
            return "\n".join(fragments)
        raise RuntimeError("No text output from OpenAI response")


class ReasoningEngine:
    def __init__(
        self,
        retriever: EvidenceRetriever,
        dossier_store: DossierStore,
        *,
        stage_voice: str = "critical-poetic scholar",
        cloud_client: OpenAIResponseClient | None = None,
        max_failover_seconds: float = 4.5,
        max_retries: int = 2,
    ) -> None:
        self.retriever = retriever
        self.dossier_store = dossier_store
        self.stage_voice = stage_voice
        self.cloud_client = cloud_client or OpenAIResponseClient()
        self.max_failover_seconds = max_failover_seconds
        self.max_retries = max_retries

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

        match = JSON_BLOCK_RE.search(text)
        if not match:
            raise ValueError("No JSON object in model output")
        data = json.loads(match.group(0))
        if not isinstance(data, dict):
            raise ValueError("Model JSON root must be an object")
        return data

    @staticmethod
    def _format_hits(hits: tuple[EvidenceHit, ...]) -> str:
        if not hits:
            return "No direct snippets retrieved."
        lines = []
        for idx, hit in enumerate(hits, start=1):
            lines.append(
                f"[{idx}] project={hit.project_id} source={hit.path} score={hit.score:.3f}\n"
                f"excerpt={hit.excerpt}"
            )
        return "\n\n".join(lines)

    def _fallback_card(
        self,
        request: ReasoningRequest,
        hits: tuple[EvidenceHit, ...],
    ) -> ReasoningCard:
        dossier: ProjectDossier | None = None
        if request.project_id:
            try:
                dossier = self.dossier_store.by_id(request.project_id)
            except KeyError:
                dossier = None
        elif hits:
            try:
                dossier = self.dossier_store.by_id(hits[0].project_id)
            except KeyError:
                dossier = None

        if dossier:
            claim = dossier.thesis_claim
            inference = (
                f"{dossier.cybernetic_loop} This supports the {request.command} move "
                f"inside scene `{request.scene_id}` with baton `{request.baton_owner}`."
            )
            counterpoint = dossier.risk_notes[0]
        else:
            claim = "The requested synthesis can proceed from local evidence traces."
            inference = (
                f"Using local snippets only, the console can answer `{request.query}` "
                "without cloud generation."
            )
            counterpoint = "Cloud reasoning is unavailable; rhetorical depth may reduce."

        evidence_lines = [f"{hit.path}#{hit.snippet_id}" for hit in hits] or ["local://fallback/no-hit"]

        return ReasoningCard.from_dict(
            {
                "claim": claim,
                "evidence": evidence_lines,
                "inference": inference,
                "confidence": 0.62 if hits else 0.42,
                "counterpoint": counterpoint,
                "mode": "fallback",
                "model": None,
            }
        )

    def _build_prompts(self, request: ReasoningRequest, hits: tuple[EvidenceHit, ...]) -> tuple[str, str]:
        system_prompt = (
            "You are a constrained co-pilot in a doctoral seminar talk runtime. "
            "Voice: critical-poetic scholar. "
            "You must only use provided evidence snippets. "
            "No hidden chain-of-thought; produce externalized rationale only. "
            "Return strict JSON with keys: claim, evidence, inference, confidence, counterpoint."
        )

        user_prompt = (
            f"Stage voice: {self.stage_voice}\n"
            f"Command: {request.command}\n"
            f"Query: {request.query}\n"
            f"Scene: {request.scene_id}\n"
            f"Baton owner: {request.baton_owner}\n"
            f"Project focus: {request.project_id or 'auto'}\n\n"
            f"Evidence snippets:\n{self._format_hits(hits)}\n\n"
            "Rules:\n"
            "1) Ground every claim in evidence list entries.\n"
            "2) confidence must be 0..1.\n"
            "3) evidence must be array of citation pointers.\n"
            "4) Keep inference concise but rigorous."
        )

        return system_prompt, user_prompt

    def generate_card(self, request: ReasoningRequest) -> ReasoningCard:
        hits = self.retriever.search(request.query, limit=5, project_id=request.project_id)

        start = time.perf_counter()
        if self.cloud_client.available():
            system_prompt, user_prompt = self._build_prompts(request, hits)
            for attempt in range(self.max_retries + 1):
                elapsed = time.perf_counter() - start
                if elapsed > self.max_failover_seconds:
                    break
                try:
                    remaining = max(0.6, self.max_failover_seconds - elapsed)
                    raw = self.cloud_client.run(system_prompt=system_prompt, user_prompt=user_prompt, timeout_s=remaining)
                    payload = self._extract_json(raw)
                    payload.setdefault("mode", "cloud")
                    payload.setdefault("model", self.cloud_client.model)
                    card = ReasoningCard.from_dict(payload)
                    return card
                except Exception:
                    if attempt >= self.max_retries:
                        break
                    time.sleep(0.15)

        return self._fallback_card(request, hits)
