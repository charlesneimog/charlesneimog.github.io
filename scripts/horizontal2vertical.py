"""Fit a horizontal video into a portrait frame with a blurred background.

Like vertical2horizontal.py, this uses OpenCV and writes video without audio.
"""

import argparse

from vertical2horizontal import vertical_to_landscape


def horizontal_to_vertical(
    input_path,
    output_path,
    target_width=1080,
    target_height=1920,
    blur=81,
):
    # The existing fit-and-fill converter supports either frame orientation.
    vertical_to_landscape(
        input_path,
        output_path,
        target_width=target_width,
        target_height=target_height,
        blur=blur,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert a horizontal video to 1080x1920 with a blurred background."
    )
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument(
        "--blur",
        type=int,
        default=81,
        help="Background blur amount",
    )
    args = parser.parse_args()

    horizontal_to_vertical(args.input, args.output, blur=args.blur)
