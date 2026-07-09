#!/usr/bin/env python3
import argparse
import sys

from lottie.exporters.core import export_tgs
from lottie.parsers.svg import parse_svg_file
from lottie.utils.stripper import float_strip


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert an SVG icon to Telegram TGS.")
    parser.add_argument("input_svg")
    parser.add_argument("output_tgs")
    args = parser.parse_args()

    try:
        with open(args.input_svg, "r", encoding="utf-8") as input_file:
            animation = parse_svg_file(input_file, n_frames=60, framerate=60)
        float_strip(animation)
        export_tgs(animation, args.output_tgs, sanitize=True, validate=True)
    except Exception as error:
        sys.stderr.write(f"SVG to TGS conversion failed: {error}\n")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
