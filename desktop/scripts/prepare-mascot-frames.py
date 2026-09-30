"""Cut the flat plate off Lil Brutus stills and fit him to the 168x95 decal."""

from pathlib import Path
from PIL import Image

SRC = Path(r"C:\Users\isaia\Downloads\brutus\desktop\renderer\app")
GEN = Path(r"C:\Users\isaia\.cursor\projects\c-Users-isaia-Downloads-brutus\assets")
OUTS = [
    Path(r"C:\Users\isaia\Projects\Brutus-private\frontend\mascot-frames"),
    Path(r"C:\Users\isaia\Downloads\brutus\desktop\renderer\app\mascot-frames"),
]
CANVAS = (504, 285)  # 168x95 at 3x, so contain does not rescale him
PAD = 10

JOBS = [
    ("bust.png", SRC / "brutus-mascot.png"),
    ("laptop.png", SRC / "brutus-mascot-laptop.png"),
    ("notes.png", SRC / "brutus-mascot-notes.png"),
    ("shadow.png", SRC / "brutus-mascot-shadowbox.png"),
    ("lap-close.png", GEN / "brutus-frame-lap-close.png"),
    ("lap-stand.png", GEN / "brutus-frame-lap-stand.png"),
    ("lap-behind.png", GEN / "brutus-frame-lap-behind.png"),
    ("notes-draw.png", GEN / "brutus-frame-notes-draw.png"),
    ("fists-rise.png", GEN / "brutus-frame-fists-rise.png"),
]


def is_magenta(r, g, b):
    return g < 55 and r > 165 and b > 60 and (r - g) > 110


def is_black(r, g, b):
    return r < 24 and g < 24 and b < 24


def is_plate(r, g, b, a):
    if a < 18:
        return True
    return is_magenta(r, g, b) or is_black(r, g, b)


def is_body(r, g, b, a):
    return a >= 18 and not is_magenta(r, g, b) and not is_black(r, g, b)


def clear_plate(im):
    im = im.convert("RGBA")
    w, h = im.size
    pix = im.load()

    def body_near(x, y):
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            nr, ng, nb, na = pix[nx, ny]
            if is_body(nr, ng, nb, na):
                return True
        return False

    seen = bytearray(w * h)
    stack = []

    def consider(x, y):
        if x < 0 or y < 0 or x >= w or y >= h:
            return
        i = y * w + x
        if seen[i]:
            return
        r, g, b, a = pix[x, y]
        if not is_plate(r, g, b, a):
            return
        if is_black(r, g, b) and a >= 18 and body_near(x, y):
            return
        seen[i] = 1
        stack.append((x, y))

    for x in range(w):
        consider(x, 0)
        consider(x, h - 1)
    for y in range(h):
        consider(0, y)
        consider(w - 1, y)
    while stack:
        x, y = stack.pop()
        r, g, b, a = pix[x, y]
        pix[x, y] = (r, g, b, 0)
        consider(x - 1, y)
        consider(x + 1, y)
        consider(x, y - 1)
        consider(x, y + 1)

    for _ in range(4):
        kill = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = pix[x, y]
                if a < 18 or not is_magenta(r, g, b):
                    continue
                if any(
                    nx < 0 or ny < 0 or nx >= w or ny >= h or pix[nx, ny][3] < 18
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                ):
                    kill.append((x, y))
        for x, y in kill:
            r, g, b, a = pix[x, y]
            pix[x, y] = (r, g, b, 0)
        if not kill:
            break
    return im


def normalize(im):
    im = clear_plate(im)
    bbox = im.getbbox()
    if not bbox:
        raise SystemExit("empty frame")
    crop = im.crop(bbox)
    cw, ch = CANVAS
    max_w = cw - PAD * 2
    max_h = ch - PAD * 2
    scale = min(max_w / crop.width, max_h / crop.height)
    nw = max(1, int(round(crop.width * scale)))
    nh = max(1, int(round(crop.height * scale)))
    crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    out.paste(crop, ((cw - nw) // 2, (ch - nh) // 2), crop)
    return out


def main():
    for dest_root in OUTS:
        dest_root.mkdir(parents=True, exist_ok=True)
    for name, src in JOBS:
        if not src.exists():
            raise SystemExit(f"missing {src}")
        frame = normalize(Image.open(src))
        alpha = frame.getchannel("A")
        opaque = sum(1 for p in alpha.getdata() if p > 128)
        print(f"{name} opaque {opaque} from {src.name}")
        for dest_root in OUTS:
            frame.save(dest_root / name, "PNG")


if __name__ == "__main__":
    main()
