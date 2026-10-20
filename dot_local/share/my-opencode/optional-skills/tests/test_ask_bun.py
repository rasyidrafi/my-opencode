"""Verify that only completed Bun Docs AI streams produce answers."""

from contextlib import redirect_stderr, redirect_stdout
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ask-bun/scripts"))
import ask_bun


class Response(io.BytesIO):
    status = 200


class AskBunTests(unittest.TestCase):
    def test_completed_stream_returns_answer_and_sources(self) -> None:
        response = Response(
            b'data: {"type":"text","delta":"Hello "}\n\n'
            b'data: {"type":"text","delta":"Bun"}\n\n'
            b'data: {"type":"done","sources":[{"title":"Docs","url":"https://bun.sh/docs"}]}\n\n'
        )
        with patch.object(ask_bun.urllib.request, "urlopen", return_value=response):
            self.assertEqual(ask_bun.ask("test"), (
                "Hello Bun", [{"title": "Docs", "url": "https://bun.sh/docs"}],
            ))

    def test_incomplete_stream_fails_without_printing_partial_answer(self) -> None:
        for stream in (b'', b'data: {"type":"text","delta":"Partial answer"}\n\n'):
            with self.subTest(stream=stream):
                stdout, stderr = io.StringIO(), io.StringIO()
                with patch.object(ask_bun.urllib.request, "urlopen", return_value=Response(stream)), \
                     patch.object(sys, "argv", ["ask_bun.py", "test"]), \
                     redirect_stdout(stdout), redirect_stderr(stderr):
                    self.assertEqual(ask_bun.main(), 1)
                self.assertEqual(stdout.getvalue(), "")
                self.assertIn("stream ended before the done event", stderr.getvalue())
