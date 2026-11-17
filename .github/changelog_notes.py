"""Print one version's CHANGELOG.md section, for the release notes.

    python3 .github/changelog_notes.py 0.1.20

Exits with an error when the section is missing or empty, so a release can't
go out without its changelog entry.
"""

import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
version = sys.argv[1] if len(sys.argv) > 1 else ""
if not re.fullmatch(r"\d+\.\d+\.\d+", version):
    sys.exit(f"usage: changelog_notes.py X.Y.Z (got {version!r})")

text = Path(__file__).resolve().parent.parent.joinpath("CHANGELOG.md").read_text(encoding="utf-8")
match = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)", text, re.M | re.S)
if not match or not match.group(1).strip():
    sys.exit(f"CHANGELOG.md has no section for {version}: add it before tagging v{version}.")
print(match.group(1).strip())
