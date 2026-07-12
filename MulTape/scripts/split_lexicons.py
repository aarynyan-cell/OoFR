#!/usr/bin/env python3
"""Convert existing MulTape monolithic lexicon JSON files into chunked packages."""

from __future__ import annotations

import argparse
import json

from build_lexicons import MANIFEST_PATH, OUT_DIR, PACKS, load_manifest, update_manifest_package, write_chunked_package


def main() -> None:
    parser = argparse.ArgumentParser(description="Split existing lexicons/*.json packages into mobile-friendly chunks.")
    parser.add_argument("--pair", choices=["all", *PACKS.keys()], default="all")
    parser.add_argument("--keep-legacy", action="store_true", help="Keep the original lexicons/{pair}.json files.")
    args = parser.parse_args()

    selected = PACKS.values() if args.pair == "all" else [PACKS[args.pair]]
    manifest = load_manifest()

    for config in selected:
        source = OUT_DIR / f"{config.pair}.json"
        if not source.exists():
            print(f"Skipping {config.pair}: {source.name} not found", flush=True)
            continue
        print(f"Splitting {config.pair}", flush=True)
        package = json.loads(source.read_text(encoding="utf-8"))
        artifacts = write_chunked_package(config, package)
        update_manifest_package(manifest, config, package, artifacts)
        if not args.keep_legacy:
            source.unlink()
        print(
            f"  wrote {len(artifacts['chunks']['entries'])} entry chunks and "
            f"{len(artifacts['chunks']['forms'])} form chunks",
            flush=True,
        )

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
