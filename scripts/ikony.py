#!/usr/bin/env python3
"""Vygeneruje ikony appky (Fáza 6 — PWA).

Ikony sú schválne uložené priamo v repozitári (public/icons/), nie na cudzom
serveri. Pripnutá appka na ploche iPhonu si ikonu ťahá aj vtedy, keď je telefón
bez signálu — a keby ikona visela na cudzej adrese, raz jednoducho zmizne.

Spustenie:  python3 scripts/ikony.py
"""

from PIL import Image, ImageDraw, ImageFont

POZADIE = (16, 16, 16)          # --f-bg, tmavá téma
ORANZOVA = (255, 77, 23)        # --f-accent
BIELA = (245, 245, 243)
FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

VYSTUP = "public/icons"


def _text_font(velkost):
    return ImageFont.truetype(FONT, velkost)


def _vycentruj(draw, text, font, stred_x, stred_y):
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    draw.text((stred_x - (r + l) / 2, stred_y - (b + t) / 2), text, font=font, fill=BIELA)


def ikona(velkost, podiel_obsahu=0.72, zaoblenie=None, text="F18"):
    """Jedna ikona. "podiel_obsahu" je, akú časť plochy smie zabrať kresba —
    pri maskovateľnej ikone musí byť menší, lebo Android jej okraje oreže."""
    obr = Image.new("RGB", (velkost, velkost), POZADIE)
    d = ImageDraw.Draw(obr)

    if zaoblenie:
        # jemný rám, aby ikona nesplynula s tmavým pozadím plochy
        d.rounded_rectangle(
            [velkost * 0.02, velkost * 0.02, velkost * 0.98, velkost * 0.98],
            radius=velkost * zaoblenie, outline=(38, 38, 38), width=max(1, velkost // 128),
        )

    obsah = velkost * podiel_obsahu
    stred_x = velkost / 2
    # text mierne nad stredom, pod ním oranžový pruh (ako podčiarknutie v grafike relácie)
    font = _text_font(int(obsah * 0.50))
    _vycentruj(d, text, font, stred_x, velkost * 0.435)

    sirka_pruhu = obsah * 0.70
    vyska_pruhu = max(2, int(obsah * 0.085))
    y = velkost * 0.645
    d.rounded_rectangle(
        [stred_x - sirka_pruhu / 2, y, stred_x + sirka_pruhu / 2, y + vyska_pruhu],
        radius=vyska_pruhu / 2, fill=ORANZOVA,
    )
    return obr


def main():
    import os
    os.makedirs(VYSTUP, exist_ok=True)

    # bežné ikony (Android, Chrome, prehliadačová záložka)
    ikona(192, 0.74, zaoblenie=0.18).save(f"{VYSTUP}/icon-192.png")
    ikona(512, 0.74, zaoblenie=0.18).save(f"{VYSTUP}/icon-512.png")

    # maskovateľné — Android ich oreže do svojho tvaru, obsah musí byť v strede
    ikona(192, 0.52).save(f"{VYSTUP}/maskable-192.png")
    ikona(512, 0.52).save(f"{VYSTUP}/maskable-512.png")

    # iPhone: ikona na ploche. Rohy si zaobľuje iOS sám, pozadie musí byť nepriehľadné.
    ikona(180, 0.74).save(f"{VYSTUP}/apple-touch-icon.png")

    # záložka v prehliadači — "F18" je pri 32 px nečitateľné, stačí "18"
    ikona(32, 0.86, text="18").save(f"{VYSTUP}/favicon-32.png")
    ikona(64, 0.86, text="18").save(f"{VYSTUP}/favicon-64.png")

    print("ikony hotové v", VYSTUP)


if __name__ == "__main__":
    main()
