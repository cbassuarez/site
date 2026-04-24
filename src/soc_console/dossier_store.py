"""Project dossier loading + indexing."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .contracts import ProjectDossier
from .io_utils import load_structured_file
from .paths import dossiers_dir


@dataclass(frozen=True)
class DossierStore:
    dossiers: tuple[ProjectDossier, ...]

    @classmethod
    def load_default(cls) -> "DossierStore":
        return cls.load_from_dir(dossiers_dir())

    @classmethod
    def load_from_dir(cls, directory: Path) -> "DossierStore":
        paths = sorted(
            [
                path
                for path in directory.glob("*")
                if path.suffix.lower() in {".json", ".yaml", ".yml"}
            ]
        )
        dossiers = [ProjectDossier.from_dict(load_structured_file(path)) for path in paths]
        dossiers.sort(key=lambda dossier: dossier.chronology_order)
        return cls(dossiers=tuple(dossiers))

    def by_id(self, dossier_id: str) -> ProjectDossier:
        for dossier in self.dossiers:
            if dossier.id == dossier_id:
                return dossier
        raise KeyError(f"Unknown dossier id: {dossier_id}")

    def ids(self) -> tuple[str, ...]:
        return tuple(dossier.id for dossier in self.dossiers)

    def as_iterable(self) -> Iterable[ProjectDossier]:
        return iter(self.dossiers)
