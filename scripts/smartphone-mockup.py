import cv2
import numpy as np
import argparse


def rounded_rectangle(img, pt1, pt2, color, radius, thickness=-1):
    x1, y1 = pt1
    x2, y2 = pt2

    if thickness < 0:
        cv2.rectangle(img, (x1 + radius, y1), (x2 - radius, y2), color, -1)
        cv2.rectangle(img, (x1, y1 + radius), (x2, y2 - radius), color, -1)

        cv2.circle(img, (x1 + radius, y1 + radius), radius, color, -1)
        cv2.circle(img, (x2 - radius, y1 + radius), radius, color, -1)
        cv2.circle(img, (x1 + radius, y2 - radius), radius, color, -1)
        cv2.circle(img, (x2 - radius, y2 - radius), radius, color, -1)


def create_phone_frame(frame, output_w=2400, output_h=1080):
    # Background
    canvas = np.full((output_h, output_w, 3), 235, dtype=np.uint8)

    # Smartphone dimensions
    phone_w = 2050
    phone_h = 970

    x = (output_w - phone_w) // 2
    y = (output_h - phone_h) // 2

    # Shadow
    shadow_offset = 18

    rounded_rectangle(
        canvas,
        (x + shadow_offset, y + shadow_offset),
        (x + phone_w + shadow_offset, y + phone_h + shadow_offset),
        (180, 180, 180),
        radius=75
    )

    # Phone body
    rounded_rectangle(
        canvas,
        (x, y),
        (x + phone_w, y + phone_h),
        (20, 20, 20),
        radius=75
    )

    # Screen margins
    bezel = 32

    screen_x = x + bezel
    screen_y = y + bezel
    screen_w = phone_w - bezel * 2
    screen_h = phone_h - bezel * 2

    # Resize video preserving aspect ratio
    fh, fw = frame.shape[:2]

    scale = min(screen_w / fw, screen_h / fh)

    new_w = int(fw * scale)
    new_h = int(fh * scale)

    resized = cv2.resize(
        frame,
        (new_w, new_h),
        interpolation=cv2.INTER_AREA
    )

    # Black screen
    rounded_rectangle(
        canvas,
        (screen_x, screen_y),
        (screen_x + screen_w, screen_y + screen_h),
        (0, 0, 0),
        radius=50
    )

    # Center video
    vx = screen_x + (screen_w - new_w) // 2
    vy = screen_y + (screen_h - new_h) // 2

    canvas[vy:vy + new_h, vx:vx + new_w] = resized

    # ---------------------------------------------------------
    # Camera
    #
    # Landscape phone:
    # camera is placed on the LEFT bezel, equivalent to
    # the "top" camera when the phone is rotated.
    # ---------------------------------------------------------

    camera_x = x + bezel // 2
    camera_y = y + phone_h // 2

    # camera housing
    cv2.circle(
        canvas,
        (camera_x, camera_y),
        10,
        (5, 5, 5),
        -1
    )

    # lens
    cv2.circle(
        canvas,
        (camera_x, camera_y),
        5,
        (45, 55, 65),
        -1
    )

    # tiny reflection
    cv2.circle(
        canvas,
        (camera_x - 2, camera_y - 2),
        1,
        (120, 130, 140),
        -1
    )

    return canvas


def process_video(input_path, output_path):
    cap = cv2.VideoCapture(input_path)

    if not cap.isOpened():
        raise RuntimeError(f"Could not open: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)

    output_w = 2400
    output_h = 1080

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")

    writer = cv2.VideoWriter(
        output_path,
        fourcc,
        fps,
        (output_w, output_h)
    )

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    i = 0

    while True:
        ret, frame = cap.read()

        if not ret:
            break

        result = create_phone_frame(
            frame,
            output_w,
            output_h
        )

        writer.write(result)

        i += 1

        if i % 30 == 0:
            print(f"\r{i}/{total}", end="", flush=True)

    cap.release()
    writer.release()

    print(f"\nSaved to: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()

    parser.add_argument("input")
    parser.add_argument("output")

    args = parser.parse_args()

    process_video(args.input, args.output)
