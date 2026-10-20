#!/usr/bin/env python3
"""Query Docker Docs Gordon without browser state or third-party dependencies."""

import argparse
from http.client import HTTPException
import json
import sys
from typing import Iterable
import urllib.error
import urllib.request
from uuid import uuid4

ENDPOINT = "https://ai-backend-service.docker.com/public/ask"


def read_answer(lines: Iterable[bytes]) -> str:
    """Collect SSE data frames; Gordon currently ends answers by closing the stream."""
    answer: list[str] = []
    data: list[str] = []
    for raw_line in lines:
        line = raw_line.decode("utf-8").rstrip("\r\n")
        if line:
            field, _, value = line.partition(":")
            if field == "data":
                data.append(value.removeprefix(" "))
            continue
        if not data:
            continue
        event = json.loads("\n".join(data))
        data.clear()
        if not isinstance(event, dict) or "error" in event:
            raise ValueError("Gordon returned an invalid event or an error")
        if "choices" not in event:
            if "thread_id" in event or "question_answer_id" in event:
                continue
            raise ValueError("Gordon returned an unrecognized event")
        choices = event["choices"]
        if not isinstance(choices, list):
            raise ValueError("Gordon returned invalid choices")
        for choice in choices:
            if not isinstance(choice, dict) or not isinstance(choice.get("delta"), dict):
                raise ValueError("Gordon returned an invalid text delta")
            content = choice["delta"].get("content", "")
            if not isinstance(content, str):
                raise ValueError("Gordon returned non-text content")
            answer.append(content)
    if data:
        raise ValueError("Gordon stream ended inside an event")
    result = "".join(answer).strip()
    if not result:
        raise ValueError("Gordon returned no answer")
    return result


def ask(question: str) -> str:
    # Mirror the public docs widget's context; no user identity is needed.
    payload = {"messages": [{"role": "user", "content": question,
        "copilot_references": [{"data": {
            "origin": "docs-website", "email": "docs@docker.com",
            "uuid": "docs-" + str(uuid4()), "action": "AskGordon",
            "page_url": "https://docs.docker.com/", "page_title": "Docker Docs",
        }}]}]}
    request = urllib.request.Request(
        ENDPOINT, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 200:
            raise ValueError(f"Gordon returned HTTP {response.status}")
        if response.headers.get_content_type() != "text/event-stream":
            raise ValueError("Gordon returned an unexpected content type")
        return read_answer(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("question", nargs="+")
    args = parser.parse_args()
    question = " ".join(args.question).strip()
    if not question:
        parser.error("question must not be empty")
    try:
        answer = ask(question)
    except urllib.error.HTTPError as error:
        detail = " (rate limited; try again later)" if error.code == 429 else ""
        print(f"ask-docker: request failed: HTTP {error.code}{detail}", file=sys.stderr)
        return 1
    except (OSError, HTTPException, ValueError) as error:
        print(f"ask-docker: request failed: {error}", file=sys.stderr)
        return 1
    print(answer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
