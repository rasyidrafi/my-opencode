"""Focused checks for Gordon's streaming protocol and CLI failures."""

from contextlib import redirect_stderr, redirect_stdout
from email.message import Message
from http.client import IncompleteRead
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ask-docker/scripts"))
import ask_docker


class Response(io.BytesIO):
    status = 200
    headers = Message()
    headers["Content-Type"] = "text/event-stream"


class AskDockerTests(unittest.TestCase):
    def test_request_and_stream_preserve_answer_and_sources(self) -> None:
        stream = (
            b': heartbeat\r\n\r\n'
            b'data: {"thread_id":"test"}\r\n\r\n'
            b'data: {"choices":\r\ndata: [{"delta":{"content":"Use docker ps."}}]}\r\n\r\n'
            b'data:{"choices":[{"delta":{"content":"\\nhttps://docs.docker.com/"}}]}\n\n'
        )
        with patch.object(ask_docker.urllib.request, "urlopen", return_value=Response(stream)) as open_url:
            answer = ask_docker.ask("List containers")
        self.assertEqual(answer, "Use docker ps.\nhttps://docs.docker.com/")
        request = open_url.call_args.args[0]
        message = json.loads(request.data)["messages"][0]
        self.assertEqual(message["content"], "List containers")
        context = message["copilot_references"][0]["data"]
        self.assertEqual(context["page_title"], "Docker Docs")
        self.assertEqual(context["page_url"], "https://docs.docker.com/")
        self.assertTrue(context["uuid"].startswith("docs-"))

    def test_invalid_or_unfinished_streams_fail(self) -> None:
        for stream in (
            b'', b'data: broken\n\n', b'data: []\n\n',
            b'data: {"error":"unavailable"}\n\n',
            b'data: {"unknown":true}\n\n',
            b'data: {"choices":[{"delta":{"content":42}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
        ):
            with self.subTest(stream=stream), self.assertRaises(ValueError):
                ask_docker.read_answer(io.BytesIO(stream))

    def test_cli_failures_do_not_print_answers(self) -> None:
        errors = (
            TimeoutError("timed out"), IncompleteRead(b"partial"),
            urllib.error.HTTPError(ask_docker.ENDPOINT, 429, "Too many requests", {}, None),
        )
        for error in errors:
            with self.subTest(error=error):
                stdout, stderr = io.StringIO(), io.StringIO()
                with patch.object(sys, "argv", ["ask_docker.py", "test"]), \
                     patch.object(ask_docker, "ask", side_effect=error), \
                     redirect_stdout(stdout), redirect_stderr(stderr):
                    self.assertEqual(ask_docker.main(), 1)
                self.assertEqual(stdout.getvalue(), "")
                self.assertIn("request failed", stderr.getvalue())
