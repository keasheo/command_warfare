"""Add +2 Toughness to every Commander in KingdomsBuilder YAML (in-place line edit)."""
from pathlib import Path

base = Path(r"C:\Users\keash\Projects\KingdomsBuilder\data\cards")
changed = 0

for path in sorted(base.glob("*/commanders.yaml")):
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    out: list[str] = []
    in_commander = False
    name = "?"
    file_changes = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        # New card entry
        if stripped.startswith("- id:"):
            in_commander = False
            name = "?"
        if "card_type: Commander" in line:
            in_commander = True
        if in_commander and stripped.startswith("name:"):
            name = stripped[len("name:") :].strip()
        if in_commander and stripped.startswith("toughness:"):
            indent = line[: len(line) - len(line.lstrip())]
            val = stripped.split(":", 1)[1].strip()
            if val.isdigit():
                old = int(val)
                new = old + 2
                nl = "\n" if line.endswith("\n") else ""
                # preserve original newline style
                if line.endswith("\r\n"):
                    nl = "\r\n"
                elif line.endswith("\n"):
                    nl = "\n"
                else:
                    nl = ""
                out.append(f"{indent}toughness: {new}{nl}")
                print(f"{path.parent.name}: {name} {old} -> {new}")
                changed += 1
                file_changes += 1
                i += 1
                continue
        out.append(line)
        i += 1
    if file_changes:
        path.write_text("".join(out), encoding="utf-8")

print("changed", changed)
