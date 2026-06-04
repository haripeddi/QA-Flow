#!/usr/bin/env python3
"""Generate rows using Faker. Reads JSON from stdin: {schema, count, locale?}."""
import json
import sys

try:
    from faker import Faker
except ImportError:
    print(json.dumps({"error": "Faker not installed"}), file=sys.stderr)
    sys.exit(1)


def generate_row(faker: Faker, schema: dict) -> dict:
    row = {}
    for key, spec in schema.items():
        if isinstance(spec, str):
            if spec.startswith("faker:"):
                method = spec[6:]
                fn = getattr(faker, method, None)
                row[key] = fn() if callable(fn) else spec
            else:
                row[key] = spec
        else:
            row[key] = spec
    return row


def main() -> None:
    payload = json.load(sys.stdin)
    schema = payload.get("schema") or {}
    count = int(payload.get("count") or 1)
    locale = payload.get("locale") or "en_US"
    faker = Faker(locale)
    rows = [generate_row(faker, schema) for _ in range(max(1, min(count, 1000)))]
    print(json.dumps({"rows": rows}))


if __name__ == "__main__":
    main()
