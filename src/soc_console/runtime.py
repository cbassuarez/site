"""Runtime assembly helpers."""

from __future__ import annotations

from dataclasses import dataclass

from .commands import CommandRouter
from .dossier_store import DossierStore
from .ingest import ContextIngestPipeline
from .reasoning import ReasoningEngine
from .retrieval import EvidenceRetriever
from .stage_engine import StageEngine
from .timeline import Timeline


@dataclass(frozen=True)
class RuntimeBundle:
    timeline: Timeline
    stage: StageEngine
    dossiers: DossierStore
    corpus: object
    retriever: EvidenceRetriever
    reasoner: ReasoningEngine
    commands: CommandRouter


def build_runtime() -> RuntimeBundle:
    dossiers = DossierStore.load_default()
    timeline = Timeline.load_default()
    stage = StageEngine(script=timeline.script)

    pipeline = ContextIngestPipeline(dossier_store=dossiers)
    corpus = pipeline.ingest()
    retriever = EvidenceRetriever(corpus)
    reasoner = ReasoningEngine(retriever=retriever, dossier_store=dossiers)
    commands = CommandRouter(stage=stage, reasoner=reasoner, retriever=retriever)

    return RuntimeBundle(
        timeline=timeline,
        stage=stage,
        dossiers=dossiers,
        corpus=corpus,
        retriever=retriever,
        reasoner=reasoner,
        commands=commands,
    )
