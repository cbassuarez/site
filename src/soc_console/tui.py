"""Textual front-end for live command + rationale streaming."""

from __future__ import annotations

import json
from dataclasses import dataclass

from .commands import CommandResult
from .runtime import RuntimeBundle


try:  # pragma: no cover - import branch depends on local runtime
    from textual import events
    from textual.app import App, ComposeResult
    from textual.containers import Horizontal, Vertical
    from textual.reactive import reactive
    from textual.widgets import Footer, Header, Input, RichLog, Static

    TEXTUAL_AVAILABLE = True
except Exception:  # pragma: no cover
    TEXTUAL_AVAILABLE = False
    App = object  # type: ignore


@dataclass
class ConsolePresenter:
    runtime: RuntimeBundle

    def render_result(self, result: CommandResult) -> tuple[str, str]:
        status = (
            f"scene={self.runtime.stage.current_scene.id} "
            f"baton={self.runtime.stage.baton_owner} "
            f"hold={self.runtime.stage.hold_active} "
            f"constraint={self.runtime.commands.constraint_mode}"
        )

        if result.payload is None:
            return status, result.message

        if "claim" in result.payload:
            card_block = (
                f"CLAIM: {result.payload['claim']}\n"
                f"EVIDENCE:\n- " + "\n- ".join(result.payload.get("evidence", [])) + "\n"
                f"INFERENCE: {result.payload['inference']}\n"
                f"CONFIDENCE: {result.payload['confidence']}\n"
                f"COUNTERPOINT: {result.payload['counterpoint']}\n"
                f"MODE: {result.payload.get('mode')}"
            )
            return status, card_block

        if "hits" in result.payload:
            lines = [f"{item.get('project_id', '?')} | {item['path']} | {item.get('score', 0):.3f}" for item in result.payload["hits"]]
            return status, "\n".join(lines) if lines else "No hits"

        if "text" in result.payload:
            return status, result.payload["text"]

        return status, json.dumps(result.payload, indent=2)


if TEXTUAL_AVAILABLE:  # pragma: no branch

    class SOCPortfolioApp(App[None]):
        CSS = """
        Screen {
            layout: vertical;
        }

        #main-row {
            height: 1fr;
        }

        #status {
            height: 3;
            border: solid $accent;
            padding: 0 1;
        }

        #rationale-log {
            border: solid green;
            padding: 0 1;
        }

        #evidence-log {
            border: solid blue;
            padding: 0 1;
        }

        Input {
            dock: bottom;
            height: 3;
        }
        """

        BINDINGS = [
            ("ctrl+n", "next_scene", "Next"),
            ("ctrl+h", "toggle_hold", "Hold"),
            ("ctrl+b", "toggle_baton", "Baton"),
        ]

        status_line = reactive("booting")

        def __init__(self, runtime: RuntimeBundle) -> None:
            super().__init__()
            self.runtime = runtime
            self.presenter = ConsolePresenter(runtime)

        def compose(self) -> ComposeResult:
            yield Header(show_clock=True)
            yield Static("", id="status")
            with Horizontal(id="main-row"):
                with Vertical(id="left"):
                    yield RichLog(id="rationale-log", markup=False, wrap=True)
                with Vertical(id="right"):
                    yield RichLog(id="evidence-log", markup=False, wrap=True)
            yield Input(placeholder="command palette: next | jump <scene> | context <query> | ...")
            yield Footer()

        def on_mount(self) -> None:
            self._refresh_status()
            rationale = self.query_one("#rationale-log", RichLog)
            rationale.write("SOC Console live. Type commands in the palette below.")

        def _refresh_status(self) -> None:
            status = self.runtime.stage.status()
            line = (
                f"SCENE: {status['scene_id']} ({status['scene_title']}) | "
                f"BATON: {status['baton_owner']} | HOLD: {status['hold_active']} | "
                f"CONSTRAINT: {self.runtime.commands.constraint_mode}"
            )
            self.status_line = line
            self.query_one("#status", Static).update(line)

        def _write_result(self, result: CommandResult) -> None:
            status, block = self.presenter.render_result(result)
            self.query_one("#status", Static).update(status)

            target_id = "#rationale-log"
            if result.command in {"cite", "trace", "show-source"}:
                target_id = "#evidence-log"

            log = self.query_one(target_id, RichLog)
            prefix = "OK" if result.ok else "ERR"
            log.write(f"[{prefix}] {result.command}: {result.message}")
            log.write(block)
            log.write("-" * 40)

        def on_input_submitted(self, event: Input.Submitted) -> None:
            raw = event.value.strip()
            event.input.value = ""
            result = self.runtime.commands.execute(raw)
            self._write_result(result)
            self._refresh_status()

        def action_next_scene(self) -> None:
            result = self.runtime.commands.execute("next")
            self._write_result(result)
            self._refresh_status()

        def action_toggle_hold(self) -> None:
            result = self.runtime.commands.execute("hold")
            self._write_result(result)
            self._refresh_status()

        def action_toggle_baton(self) -> None:
            current = self.runtime.stage.baton_owner
            nxt = "agent" if current == "human" else "shared" if current == "agent" else "human"
            result = self.runtime.commands.execute(f"baton {nxt}")
            self._write_result(result)
            self._refresh_status()

        async def on_key(self, event: events.Key) -> None:
            # Keep escape hatch simple for live use.
            if event.key == "escape":
                self.exit()


def run_tui(runtime: RuntimeBundle, *, force_repl: bool = False) -> None:
    if TEXTUAL_AVAILABLE and not force_repl:
        app = SOCPortfolioApp(runtime)
        app.run()
        return

    # Fallback REPL if Textual is unavailable.
    print("Textual is unavailable. Falling back to CLI REPL.")
    print("Type 'quit' to exit.")
    while True:
        raw = input("soc> ").strip()
        if raw in {"quit", "exit"}:
            break
        result = runtime.commands.execute(raw)
        presenter = ConsolePresenter(runtime)
        status, block = presenter.render_result(result)
        print(status)
        print(block)
