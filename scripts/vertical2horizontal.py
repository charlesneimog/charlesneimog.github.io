import cv2
import argparse


def vertical_to_landscape(
    input_path,
    output_path,
    target_width=1920,
    target_height=1080,
    blur=81,
):
    cap = cv2.VideoCapture(input_path)

    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Output codec
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")

    writer = cv2.VideoWriter(
        output_path,
        fourcc,
        fps,
        (target_width, target_height),
    )

    # Scale foreground to fit inside 1920x1080
    foreground_scale = min(
        target_width / width,
        target_height / height,
    )

    foreground_width = int(width * foreground_scale)
    foreground_height = int(height * foreground_scale)

    # GaussianBlur kernel must be odd
    if blur % 2 == 0:
        blur += 1

    while True:
        ret, frame = cap.read()

        if not ret:
            break

        # ─────────────────────────────────────
        # Background
        #
        # Scale until it completely covers
        # the 1920x1080 frame.
        # ─────────────────────────────────────
        background_scale = max(
            target_width / width,
            target_height / height,
        )

        bg_width = int(width * background_scale)
        bg_height = int(height * background_scale)

        background = cv2.resize(
            frame,
            (bg_width, bg_height),
            interpolation=cv2.INTER_LINEAR,
        )

        # Center crop to 1920x1080
        x = (bg_width - target_width) // 2
        y = (bg_height - target_height) // 2

        background = background[
            y:y + target_height,
            x:x + target_width,
        ]

        # Blur enlarged background
        background = cv2.GaussianBlur(
            background,
            (blur, blur),
            0,
        )

        # ─────────────────────────────────────
        # Foreground
        # ─────────────────────────────────────
        foreground = cv2.resize(
            frame,
            (foreground_width, foreground_height),
            interpolation=cv2.INTER_LANCZOS4,
        )

        # Center foreground
        x = (target_width - foreground_width) // 2
        y = (target_height - foreground_height) // 2

        background[
            y:y + foreground_height,
            x:x + foreground_width,
        ] = foreground

        writer.write(background)

    cap.release()
    writer.release()

    print(f"Saved to: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()

    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument(
        "--blur",
        type=int,
        default=81,
        help="Background blur amount",
    )

    args = parser.parse_args()

    vertical_to_landscape(
        args.input,
        args.output,
        blur=args.blur,
    )
