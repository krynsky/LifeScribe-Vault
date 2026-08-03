"""Generate the shared LifeScribe wordmark and Vault-specific app mark."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "branding"
ASSETS = ROOT / "src" / "assets"
PUBLIC = ROOT / "public"

PRIMARY = "#235A6A"
CREAM = "#FAF7F0"
ACCENT = "#D7A84D"


def tinted_logo(source: Image.Image, color: str) -> Image.Image:
    """Turn the site's grayscale-on-white artwork into a tinted alpha image."""
    rgba = source.convert("RGBA")
    luminance = rgba.convert("L")
    # The published PNG has faint near-white compression texture. Discard it,
    # while keeping a narrow antialiasing band around the actual artwork.
    alpha = luminance.point(
        lambda value: 0
        if value >= 225
        else 255
        if value <= 190
        else round((225 - value) * 255 / 35),
    )
    result = Image.new("RGBA", rgba.size, color)
    result.putalpha(alpha)
    return result


def shield(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], color: str, width: int) -> None:
    left, top, right, bottom = box
    size = right - left

    def point(x: float, y: float) -> tuple[int, int]:
        return left + round(x * size), top + round(y * size)

    outline = [
        point(0.50, 0.08),
        point(0.69, 0.18),
        point(0.86, 0.21),
        point(0.86, 0.50),
        point(0.82, 0.67),
        point(0.70, 0.80),
        point(0.50, 0.91),
        point(0.30, 0.80),
        point(0.18, 0.67),
        point(0.14, 0.50),
        point(0.14, 0.21),
        point(0.31, 0.18),
        point(0.50, 0.08),
    ]
    draw.line(outline, fill=color, width=width, joint="curve")
    draw.line(
        [point(0.32, 0.49), point(0.45, 0.62), point(0.70, 0.36)],
        fill=color,
        width=width,
        joint="curve",
    )


def generate_wordmark(source: Image.Image) -> Image.Image:
    logo = tinted_logo(source, PRIMARY)
    bounds = logo.getbbox()
    if bounds is None:
        raise RuntimeError("The LifeScribe source logo contains no visible artwork.")
    logo = logo.crop(bounds)
    target_height = 292
    logo = logo.resize(
        (round(logo.width * target_height / logo.height), target_height),
        Image.Resampling.LANCZOS,
    )

    shield_size = 216
    gap = 34
    margin_x = 22
    canvas = Image.new(
        "RGBA",
        (margin_x * 2 + logo.width + gap + shield_size, 352),
        (0, 0, 0, 0),
    )
    canvas.alpha_composite(logo, (margin_x, (canvas.height - logo.height) // 2))
    badge_x = margin_x + logo.width + gap
    badge_y = (canvas.height - shield_size) // 2
    draw = ImageDraw.Draw(canvas)
    draw.ellipse(
        (badge_x, badge_y, badge_x + shield_size, badge_y + shield_size),
        fill=PRIMARY,
    )
    inset = 40
    shield(
        draw,
        (
            badge_x + inset,
            badge_y + inset,
            badge_x + shield_size - inset,
            badge_y + shield_size - inset,
        ),
        CREAM,
        13,
    )
    canvas.save(ASSETS / "lifescribe-vault-logo.png", optimize=True)
    return canvas


def generate_app_icon(source: Image.Image) -> Image.Image:
    emblem = tinted_logo(source.crop((0, 0, 415, source.height)), CREAM)
    bounds = emblem.getbbox()
    if bounds is None:
        raise RuntimeError("The LifeScribe emblem crop contains no visible artwork.")
    emblem = emblem.crop(bounds)
    emblem = emblem.resize(
        (720, round(emblem.height * 720 / emblem.width)),
        Image.Resampling.LANCZOS,
    )

    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((32, 32, 992, 992), radius=210, fill=PRIMARY)
    emblem_y = 154 + (620 - emblem.height) // 2
    canvas.alpha_composite(emblem, (92, emblem_y))

    badge_box = (690, 690, 948, 948)
    draw.ellipse(badge_box, fill=CREAM)
    draw.ellipse((704, 704, 934, 934), fill=ACCENT)
    shield(draw, (748, 746, 890, 888), PRIMARY, 15)

    icon_path = BRANDING / "lifescribe-vault-app-icon.png"
    canvas.save(icon_path, optimize=True)
    canvas.resize((512, 512), Image.Resampling.LANCZOS).save(
        PUBLIC / "lifescribe-vault-icon.png",
        optimize=True,
    )
    return canvas


def generate_installer_art(wordmark: Image.Image, app_icon: Image.Image) -> None:
    header = Image.new("RGB", (150, 57), "white")
    fitted_wordmark = wordmark.copy()
    fitted_wordmark.thumbnail((138, 45), Image.Resampling.LANCZOS)
    header.paste(
        fitted_wordmark,
        ((header.width - fitted_wordmark.width) // 2, (header.height - fitted_wordmark.height) // 2),
        fitted_wordmark,
    )
    header.save(BRANDING / "nsis-header.bmp")

    sidebar = Image.new("RGB", (164, 314), CREAM)
    fitted_icon = app_icon.resize((140, 140), Image.Resampling.LANCZOS)
    sidebar.paste(fitted_icon, (12, 70), fitted_icon)
    sidebar.save(BRANDING / "nsis-sidebar.bmp")

    wix_banner = Image.new("RGB", (493, 58), "white")
    fitted_wordmark = wordmark.copy()
    fitted_wordmark.thumbnail((230, 44), Image.Resampling.LANCZOS)
    wix_banner.paste(
        fitted_wordmark,
        (wix_banner.width - fitted_wordmark.width - 12, (wix_banner.height - fitted_wordmark.height) // 2),
        fitted_wordmark,
    )
    wix_banner.save(BRANDING / "wix-banner.bmp")

    wix_dialog = Image.new("RGB", (493, 312), "white")
    draw = ImageDraw.Draw(wix_dialog)
    draw.rectangle((0, 0, 164, wix_dialog.height), fill=CREAM)
    fitted_icon = app_icon.resize((140, 140), Image.Resampling.LANCZOS)
    wix_dialog.paste(fitted_icon, (12, 70), fitted_icon)
    wix_dialog.save(BRANDING / "wix-dialog.bmp")


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    source = Image.open(BRANDING / "source-lifescribe-logo.png")
    wordmark = generate_wordmark(source)
    app_icon = generate_app_icon(source)
    generate_installer_art(wordmark, app_icon)


if __name__ == "__main__":
    main()
