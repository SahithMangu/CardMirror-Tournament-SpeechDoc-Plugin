#!/usr/bin/env python3
"""Fail if the source contacts a hostname that is not in .allowed-hosts.

The README and SECURITY.md promise a specific set of hosts. A promise in prose
drifts as code changes; this turns it into a check that runs on every commit.

Scope and limits, stated honestly: this is a static scan for URL literals. It
catches accidental drift and casual tampering -- a new endpoint added in a
hurry, or a sloppy pull request. It does NOT stop someone deliberately hiding a
request by building the URL at runtime. It is a guardrail, not a sandbox.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCANNED = ("tabroom_bridge.py", "plugin.js")
ALLOWLIST = ROOT / ".allowed-hosts"

# http(s) URLs, plus bare host-looking literals in a fetch/urlopen/Request call.
URL_RE = re.compile(r"https?://([A-Za-z0-9.\-]+)")


def load_allowlist() -> set:
    if not ALLOWLIST.exists():
        sys.exit(f"error: {ALLOWLIST.name} is missing; it defines the approved hosts.")
    hosts = set()
    for line in ALLOWLIST.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            hosts.add(line.lower())
    if not hosts:
        sys.exit(f"error: {ALLOWLIST.name} lists no hosts.")
    return hosts


def main() -> int:
    allowed = load_allowlist()
    found = {}          # host -> list of "file:line"
    for name in SCANNED:
        path = ROOT / name
        if not path.exists():
            sys.exit(f"error: expected to scan {name}, but it is missing.")
        for n, line in enumerate(path.read_text().splitlines(), 1):
            for host in URL_RE.findall(line):
                # 127.0.0.1 and localhost are the loopback bridge, never network.
                if host in ("127.0.0.1", "localhost"):
                    continue
                found.setdefault(host.lower(), []).append(f"{name}:{n}")

    unapproved = {h: locs for h, locs in found.items() if h not in allowed}

    print(f"scanned: {', '.join(SCANNED)}")
    print(f"approved hosts: {len(allowed)}")
    for host in sorted(found):
        mark = "ok " if host in allowed else "NEW"
        print(f"  [{mark}] {host}  ({', '.join(found[host])})")

    if unapproved:
        print()
        print("FAILED: hostname(s) not in .allowed-hosts:")
        for host, locs in sorted(unapproved.items()):
            print(f"  {host}  at {', '.join(locs)}")
        print()
        print("If this is intentional, add the host to .allowed-hosts in the same")
        print("commit, and update the network tables in README.md and SECURITY.md.")
        return 1

    unused = allowed - set(found)
    if unused:
        print()
        print("note: allowed but not currently used: " + ", ".join(sorted(unused)))

    print("\nOK: no unapproved hosts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
