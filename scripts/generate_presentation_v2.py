#!/usr/bin/env python3
"""
Nexus Gebruikerspresentatie - V2 met ECHTE WebGUI screenshots
Gebruik: python3 scripts/generate_presentation_v2.py
Output: Nexus_Gebruikershandleiding.pptx
"""

import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# ------------------------------
# Kleurenschema
# ------------------------------
BRAND_PRIMARY = RGBColor(0x1E, 0x3A, 0x5F)   # Diepblauw
BRAND_SECONDARY = RGBColor(0x2E, 0x86, 0xC1)  # Blauw accent
BRAND_ACCENT = RGBColor(0xE8, 0x6C, 0x00)     # Oranje
BRAND_LIGHT = RGBColor(0xF5, 0xF7, 0xFA)      # Lichtgrijs
BRAND_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
TEXT_DARK = RGBColor(0x1A, 0x1A, 0x1A)
TEXT_MUTED = RGBColor(0x55, 0x55, 0x55)
SUCCESS_GREEN = RGBColor(0x16, 0xA3, 0x4A)
WARNING_AMBER = RGBColor(0xD9, 0x77, 0x06)
ERROR_RED = RGBColor(0xDC, 0x26, 0x26)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS_DIR = os.path.join(BASE_DIR, "screenshots")

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
SW = prs.slide_width
SH = prs.slide_height

TOTAL = 18


def add_background(slide, color=BRAND_WHITE):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_shape(slide, left, top, width, height, fill_color=None, line_color=None, shape_type=MSO_SHAPE.RECTANGLE):
    shp = slide.shapes.add_shape(shape_type, left, top, width, height)
    shp.shadow.inherit = False
    if fill_color:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill_color
    else:
        shp.fill.background()
    if line_color:
        shp.line.color.rgb = line_color
        shp.line.width = Pt(0.75)
    else:
        shp.line.fill.background()
    return shp


def add_text(slide, left, top, width, height, text, font_size=18, bold=False,
             color=TEXT_DARK, align=PP_ALIGN.LEFT, font="Calibri", anchor=MSO_ANCHOR.TOP, line_space=1.2):
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = Inches(0.05)
    tf.margin_right = Inches(0.05)
    lines = text.split("\n") if isinstance(text, str) else text
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line_space
        r = p.add_run()
        r.text = ln
        r.font.name = font
        r.font.size = Pt(font_size)
        r.font.bold = bold
        r.font.color.rgb = color
    return tb


def add_bullets(slide, left, top, width, height, items, font_size=14,
                color=TEXT_DARK, bullet_col=BRAND_ACCENT, line_space=1.3, bold_first=False):
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(0.08)
    for i, it in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        p.line_spacing = line_space
        p.space_after = Pt(5)
        r0 = p.add_run()
        r0.text = "► "
        r0.font.name = "Calibri"
        r0.font.size = Pt(font_size)
        r0.font.bold = True
        r0.font.color.rgb = bullet_col
        if bold_first and " " in it:
            a, b = it.split(" ", 1)
            r1 = p.add_run()
            r1.text = a + " "
            r1.font.name = "Calibri"
            r1.font.size = Pt(font_size)
            r1.font.bold = True
            r1.font.color.rgb = color
            r2 = p.add_run()
            r2.text = b
            r2.font.name = "Calibri"
            r2.font.size = Pt(font_size)
            r2.font.color.rgb = color
        else:
            r = p.add_run()
            r.text = it
            r.font.name = "Calibri"
            r.font.size = Pt(font_size)
            r.font.color.rgb = color
    return tb


def add_header(slide, title, sub=None, page=None):
    add_shape(slide, 0, 0, SW, Inches(1.05), fill_color=BRAND_PRIMARY)
    add_shape(slide, 0, Inches(1.05), SW, Inches(0.05), fill_color=BRAND_ACCENT)
    add_text(slide, Inches(0.5), Inches(0.1), Inches(10), Inches(0.6),
             title, font_size=28, bold=True, color=BRAND_WHITE)
    if sub:
        add_text(slide, Inches(0.5), Inches(0.67), Inches(10), Inches(0.35),
                 sub, font_size=13, color=RGBColor(0xBF, 0xDB, 0xFE))
    if page:
        add_text(slide, SW - Inches(2.1), Inches(0.3), Inches(1.7), Inches(0.5),
                 f"{page} / {TOTAL}", font_size=14, bold=True, color=RGBColor(0x93, 0xC5, 0xFD),
                 align=PP_ALIGN.RIGHT)


def add_footer(slide, text="Nexus - Gebruikershandleiding"):
    add_shape(slide, 0, SH - Inches(0.35), SW, Inches(0.35), fill_color=BRAND_LIGHT)
    add_shape(slide, 0, SH - Inches(0.35), SW, Inches(0.02), fill_color=BRAND_SECONDARY)
    add_text(slide, Inches(0.4), SH - Inches(0.33), Inches(8), Inches(0.3),
             text, font_size=9, color=TEXT_MUTED)


def add_screenshot(slide, filename, left, top, width=None, height=None, caption=None):
    path = os.path.join(SS_DIR, filename)
    if not os.path.exists(path):
        add_text(slide, left, top, width or Inches(5), height or Inches(3),
                 f"[!] Screenshot niet gevonden:\n{filename}",
                 font_size=12, bold=True, color=ERROR_RED)
        return
    if width and not height:
        pic = slide.shapes.add_picture(path, left, top, width=width)
    elif height and not width:
        pic = slide.shapes.add_picture(path, left, top, height=height)
    elif width and height:
        pic = slide.shapes.add_picture(path, left, top, width=width, height=height)
    else:
        pic = slide.shapes.add_picture(path, left, top)
    if caption:
        add_text(slide, left, top + pic.height + Inches(0.05),
                 pic.width, Inches(0.3), caption,
                 font_size=10, color=TEXT_MUTED, align=PP_ALIGN.CENTER)
    return pic


def add_card_rounded(slide, left, top, width, height, fill=None, line=None):
    return add_shape(slide, left, top, width, height,
                     fill_color=fill, line_color=line,
                     shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)


# ======================================================================
# DIA 1 - TITEL
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s, BRAND_PRIMARY)

tri = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, SW * 0.55, 0, SW * 0.5, SH)
tri.fill.solid()
tri.fill.fore_color.rgb = BRAND_SECONDARY
tri.line.fill.background()

tri2 = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, SW * 0.7, 0, SW * 0.35, SH)
tri2.fill.solid()
tri2.fill.fore_color.rgb = BRAND_ACCENT
tri2.line.fill.background()

add_shape(s, Inches(0.8), Inches(2.3), Inches(3.7), Inches(1.0),
          fill_color=BRAND_ACCENT, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.8), Inches(2.4), Inches(3.7), Inches(0.85),
         "NEXUS", font_size=52, bold=True, color=BRAND_WHITE, align=PP_ALIGN.CENTER)

add_text(s, Inches(0.8), Inches(3.55), Inches(7), Inches(0.6),
         "Gebruikershandleiding",
         font_size=26, bold=False, color=RGBColor(0xBF, 0xDB, 0xFE))

add_text(s, Inches(0.8), Inches(4.35), Inches(8.5), Inches(1.0),
         "Leer in 20 minuten hoe je met Nexus werkt:\nklanten, trackers, sims, abonnementen en facturen.",
         font_size=18, bold=False, color=BRAND_WHITE, line_space=1.4)

add_shape(s, Inches(0.8), Inches(5.9), Inches(5), Inches(0.04), fill_color=BRAND_ACCENT)

add_text(s, Inches(0.8), Inches(6.05), Inches(8), Inches(0.4),
         "Voor (toekomstige) gebruikers • Fleet & M2M dienstverlening",
         font_size=13, color=RGBColor(0x93, 0xC5, 0xFD))

add_text(s, Inches(0.8), Inches(6.45), Inches(8), Inches(0.4),
         "september 2026  •  Gebaseerd op de echte WebGUI",
         font_size=11, color=RGBColor(0x93, 0xC5, 0xFD))


# ======================================================================
# DIA 2 - WAT IS NEXUS?
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Wat is Nexus?", "Kort en bondig: wat kun je ermee als gebruiker?", 2)
add_footer(s)

# Linkerkolom tekst
add_card_rounded(s, Inches(0.4), Inches(1.3), Inches(5.5), Inches(5.7),
                 fill=BRAND_LIGHT)
add_text(s, Inches(0.6), Inches(1.45), Inches(5.1), Inches(0.5),
         "🙋  Waarvoor gebruik je Nexus?",
         font_size=18, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(0.65), Inches(2.05), Inches(5.0), Inches(4.7),
            [
                "Je klantenregister bijhouden (met contact, adres, KvK/BTW)",
                "Je GPS-trackers beheren: serienummers, IMEI's, statussen",
                "Je SIM-kaarten beheren: ICCID, MSISDN, provider, status",
                "Je wagenpark (voertuigen) per klant registreren",
                "Trackers + SIMs + Voertuigen toewijzen via de activatiewizard",
                "Per abonnement automatisch factureren per maand",
                "100% opvolgen wie wat wanneer wijzigde (volledige geschiedenis)",
            ],
            font_size=13.5, bullet_col=BRAND_ACCENT, line_space=1.35, bold_first=True)

# Rechter screenshot: dashboard
add_text(s, Inches(6.2), Inches(1.3), Inches(6.8), Inches(0.4),
         "🖥  Echte interface: Dashboard",
         font_size=15, bold=True, color=BRAND_PRIMARY, align=PP_ALIGN.CENTER)
add_screenshot(s, "02-dashboard.png",
               Inches(6.2), Inches(1.75), width=Inches(6.7))


# ======================================================================
# DIA 3 - INLOGGEN + EERSTE BLik
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Stap 1: Inloggen & Dashboard", "Open je browser en je bent binnen 10 seconden aan het werk.", 3)
add_footer(s)

# Linker screenshot login
add_text(s, Inches(0.4), Inches(1.25), Inches(6), Inches(0.4),
         "1. 🔐 Inlogscherm",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_screenshot(s, "01-login.png",
               Inches(0.4), Inches(1.7), width=Inches(6.0))

add_bullets(s, Inches(0.4), Inches(5.4), Inches(6.0), Inches(1.5),
            [
                "Je ontvangt je inloggegevens van de beheerder.",
                "Vul e-mail + wachtwoord in, druk op Inloggen.",
                "Wachtwoord vergeten? Vraag de beheerder om een reset.",
            ],
            font_size=12, bullet_col=BRAND_ACCENT, line_space=1.25)

# Rechter dashboard
add_text(s, Inches(6.65), Inches(1.25), Inches(6.3), Inches(0.4),
         "2. 📊 Dashboard: je startscherm",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_screenshot(s, "02-dashboard.png",
               Inches(6.65), Inches(1.7), width=Inches(6.25))

add_bullets(s, Inches(6.65), Inches(5.4), Inches(6.2), Inches(1.5),
            [
                "KPI-kaarten: snel overzicht van voorraad en actieve abo's.",
                "Recente activaties: wie wat activeerde, 1 klik naar details.",
                "Klik op de getallen voor directe filtering!",
            ],
            font_size=12, bullet_col=BRAND_ACCENT, line_space=1.25)


# ======================================================================
# DIA 4 - ZIJBALK + NAVIGATIE
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Navigatie: de zijbalk & snelzoeken", "Iedere module is 1 klik verwijderd. Gebruik ⌘K om nóg sneller te werken!", 4)
add_footer(s)

# Linker screenshot (klantenlijst als voorbeeld met zichtbare zijbalk)
add_text(s, Inches(0.4), Inches(1.25), Inches(6), Inches(0.4),
         "📋 Zijbalk - alle modules in beeld",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_screenshot(s, "03-klanten-lijst.png",
               Inches(0.4), Inches(1.7), width=Inches(6.0))

# Rechter uitleg modules
add_card_rounded(s, Inches(6.65), Inches(1.25), Inches(6.25), Inches(5.75),
                 fill=BRAND_LIGHT)
add_text(s, Inches(6.85), Inches(1.4), Inches(5.9), Inches(0.5),
         "🧭 Alle modules op een rij",
         font_size=17, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(6.9), Inches(1.95), Inches(5.85), Inches(4.9),
            [
                "Dashboard - KPI's en recente activaties",
                "Klanten - je klantenbestand (niveau + sub-klanten)",
                "Trackers - GPS hardware, serienr, IMEI, voorraad/status",
                "SIM-kaarten - mobiele data-kaarten, ICCID, provider",
                "Voertuigen - wagenpark per klant (kenteken/VIN)",
                "Producten - je abonnementsvormen en maandprijzen",
                "Abonnementen - alle lopende contracten",
                "Facturen - maandfacturen genereren, verzenden, betalen",
                "Activaties - de 6-stappen wizard (kern van Nexus)",
                "Gebruikers - wie heeft toegang? (alleen Beheerder)",
                "Auditlog - volledige geschiedenis wijzigingen",
                "💡 ⌘K of Ctrl+K = overal direct zoeken!",
            ],
            font_size=12.5, bullet_col=BRAND_ACCENT, line_space=1.18)


# ======================================================================
# DIA 5 - KLANTEN
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Module: Klanten", "Je klantenregister - de basis van alle abonnementen.", 5)
add_footer(s)

# Boven: Lijst screenshot (links) + uitleg (rechts)
add_text(s, Inches(0.4), Inches(1.2), Inches(6.3), Inches(0.4),
         "1. Lijstweergave: alle klanten in 1 oogopslag",
         font_size=14, bold=True, color=BRAND_PRIMARY)
add_screenshot(s, "03-klanten-lijst.png",
               Inches(0.4), Inches(1.65), width=Inches(6.3))

# Uitleg rechts boven
add_card_rounded(s, Inches(6.9), Inches(1.2), Inches(6.0), Inches(3.1),
                 fill=BRAND_LIGHT)
add_text(s, Inches(7.1), Inches(1.32), Inches(5.6), Inches(0.4),
         "💡 Wat je hier kunt doen:",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(7.15), Inches(1.82), Inches(5.55), Inches(2.35),
            [
                "Nieuwe klant aanmaken (rechtsboven, groene knop)",
                "Zoeken op naam, nummer, plaats, e-mail…",
                "CSV Exporteren / Importeren voor bulk",
                "Per klant: menu '⋯' voor Bewerken / Verwijderen",
                "3 bestaande demo-klanten zichtbaar in beeld!",
            ],
            font_size=12.5, bullet_col=BRAND_ACCENT, line_space=1.3)

# Onder: Detail screenshot
add_text(s, Inches(0.4), Inches(4.4), Inches(6.3), Inches(0.4),
         "2. Detailpagina: alles van 1 klant overzichtelijk",
         font_size=14, bold=True, color=BRAND_PRIMARY)
add_screenshot(s, "04-klant-detail.png",
               Inches(0.4), Inches(4.85), width=Inches(6.3))

# Tabs uitleg rechts onder
add_card_rounded(s, Inches(6.9), Inches(4.4), Inches(6.0), Inches(2.5),
                 fill=RGBColor(0xE0, 0xE7, 0xFF))
add_text(s, Inches(7.1), Inches(4.52), Inches(5.6), Inches(0.4),
         "📑 Per klant 8 tabs:",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_text(s, Inches(7.15), Inches(4.97), Inches(5.6), Inches(1.85),
         "Overzicht  •  Bewerken  •  Abonnementen  •  Trackers\n"
         "SIM-kaarten  •  Voertuigen  •  Activaties  •  Geschiedenis\n\n"
         "👉 Hét startpunt als je een specifieke klant wilt opzoeken!",
         font_size=12.5, color=TEXT_DARK, line_space=1.35)


# ======================================================================
# DIA 6 - TRACKERS
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Module: Trackers (GPS hardware)", "Voorraad beheren, unieke IMEI-controle, toewijzingen via wizard.", 6)
add_footer(s)

# Boven: screenshot breed
add_text(s, Inches(0.4), Inches(1.2), Inches(12.5), Inches(0.4),
         "📡 Trackerlijst - merken, modellen, IMEI's en status in 1 oogopslag",
         font_size=14, bold=True, color=BRAND_PRIMARY, align=PP_ALIGN.CENTER)
add_screenshot(s, "05-trackers-lijst.png",
               Inches(0.55), Inches(1.65), width=Inches(12.2))

# Onder: 3 info-blokken
blocks = [
    ("🔢 IMEI validatie",
     "IMEI = 15 cijfers + Luhn check.\n"
     "Verkeerd nummer? Dan weigert Nexus de invoer!\n"
     "Weergave 4-4-4-3: 4901 5420 3237 518",
     BRAND_PRIMARY),
    ("📊 Statussen",
     "IN_STOCK = op voorraad, ACTIVE = in gebruik,\n"
     "RESERVED, SUSPENDED, DEFECTIVE, RMA,\n"
     "RETIRED, LOST - de hele levenscyclus.",
     BRAND_SECONDARY),
    ("⚡ Nieuwe tracker / CSV import",
     "1 tracker = handmatig via Nieuwe tracker.\n"
     "10+ trackers = CSV importeren!\n"
     "Let op: serienummer en IMEI zijn UNIEK.",
     BRAND_ACCENT),
]
bw = Inches(4.15)
bg = Inches(0.15)
bt = Inches(5.0)
bstart = (SW - (bw * 3 + bg * 2)) / 2
for i, (titel, txt, col) in enumerate(blocks):
    left = bstart + i * (bw + bg)
    add_shape(s, left, bt, bw, Inches(0.08), fill_color=col)
    add_card_rounded(s, left, bt + Inches(0.08), bw, Inches(2.0),
                     fill=BRAND_LIGHT)
    add_text(s, left + Inches(0.15), bt + Inches(0.2), bw - Inches(0.3), Inches(0.4),
             titel, font_size=13.5, bold=True, color=col)
    add_text(s, left + Inches(0.15), bt + Inches(0.65), bw - Inches(0.3), Inches(1.3),
             txt, font_size=11.5, color=TEXT_DARK, line_space=1.25)


# ======================================================================
# DIA 7 - SIM-KAARTEN
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Module: SIM-kaarten (IoT / M2M)", "Mobiele data-kaarten voor je trackers – ICCID, MSISDN, provider.", 7)
add_footer(s)

# Rechts: screenshot (5 trackers in beeld)
add_screenshot(s, "06-sims-lijst.png",
               Inches(0.4), Inches(1.3), width=Inches(7.3))

# Rechts: uitleg card
add_card_rounded(s, Inches(7.9), Inches(1.3), Inches(5.0), Inches(2.7),
                 fill=BRAND_LIGHT)
add_text(s, Inches(8.1), Inches(1.42), Inches(4.6), Inches(0.4),
         "💳 Belangrijke kenmerken:",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(8.15), Inches(1.92), Inches(4.5), Inches(2.0),
            [
                "ICCID: 19–20 cijfers, MOET beginnen met '89'",
                "MSISDN: telefoonnummer van de SIM",
                "IMSI: uniek identificatienummer",
                "Provider: KPN IoT M2M, Vodafone, etc.",
                "APN: toegangspunt configuratie (optioneel)",
            ],
            font_size=12, bullet_col=BRAND_ACCENT, line_space=1.25)

# Onder: levenscyclus
add_card_rounded(s, Inches(0.4), Inches(5.25), Inches(12.5), Inches(1.75),
                 fill=RGBColor(0xEC, 0xFD, 0xF5))
add_text(s, Inches(0.6), Inches(5.35), Inches(12.1), Inches(0.45),
         "♻️ SIM levenscyclus (7 statussen) - gebruik deze voorraad-statussen correct!",
         font_size=14, bold=True, color=BRAND_PRIMARY)

flow = [("IN_STOCK", BRAND_SECONDARY), ("RESERVED", WARNING_AMBER),
        ("ACTIVE", SUCCESS_GREEN), ("SUSPENDED", BRAND_PRIMARY),
        ("BLOCKED", ERROR_RED), ("CANCELLED", TEXT_MUTED), ("RETIRED", TEXT_MUTED)]
fw = Inches(1.65)
fg = Inches(0.1)
ft = Inches(5.85)
fs = (SW - (fw * 7 + fg * 6)) / 2
for i, (lbl, col) in enumerate(flow):
    left = fs + i * (fw + fg)
    add_shape(s, left, ft, fw, Inches(0.8), fill_color=col,
              shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, ft + Inches(0.22), fw, Inches(0.4),
             lbl, font_size=11, bold=True, color=BRAND_WHITE, align=PP_ALIGN.CENTER)
    if i < 6:
        add_text(s, left + fw - Inches(0.04), ft + Inches(0.05),
                 Inches(0.18), Inches(0.7), "→",
                 font_size=17, bold=True, color=BRAND_ACCENT,
                 anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)


# ======================================================================
# DIA 8 - VOERTUIGEN
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Module: Voertuigen", "Je wagenpark per klant - kenteken, VIN, merk/model.", 8)
add_footer(s)

# Links screenshot
add_screenshot(s, "12-voertuigen-lijst.png",
               Inches(0.4), Inches(1.25), width=Inches(7.8))

# Rechts uitleg
add_card_rounded(s, Inches(8.4), Inches(1.25), Inches(4.55), Inches(2.7),
                 fill=BRAND_LIGHT)
add_text(s, Inches(8.6), Inches(1.37), Inches(4.15), Inches(0.4),
         "🚗 Wat zet je hier?",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(8.65), Inches(1.87), Inches(4.05), Inches(2.0),
            [
                "Kenteken (NL-formaat, UNIEK)",
                "VIN / chassisnummer (17 tekens, UNIEK)",
                "Merk + model",
                "Optioneel: omschrijving, notities",
                "Altijd gekoppeld aan 1 klant!",
            ],
            font_size=12, bullet_col=BRAND_ACCENT, line_space=1.25)

# Onder: 3 tips
tips = [
    ("👆 Tip 1", "Registreer altijd het VIN nummer, niet alleen het kenteken. Bij verkoop/leasewissel kun je historie volgen!",
     BRAND_PRIMARY),
    ("👆 Tip 2", "Koppel 1 tracker per voertuig via de Activatie Wizard of Abonnement-detailpagina.",
     BRAND_SECONDARY),
    ("👆 Tip 3", "Gebruik de zoekbalk voor snelle kenteken/VIN opzoeking - geen scrollen meer!",
     BRAND_ACCENT),
]
tw = Inches(4.25)
tg = Inches(0.12)
tt = Inches(5.25)
ts = (SW - (tw * 3 + tg * 2)) / 2
for i, (lbl, txt, col) in enumerate(tips):
    left = ts + i * (tw + tg)
    add_shape(s, left, tt, tw, Inches(0.08), fill_color=col)
    add_card_rounded(s, left, tt + Inches(0.08), tw, Inches(1.75), fill=BRAND_LIGHT)
    add_text(s, left + Inches(0.15), tt + Inches(0.2), tw - Inches(0.3), Inches(0.35),
             lbl, font_size=12, bold=True, color=col)
    add_text(s, left + Inches(0.15), tt + Inches(0.58), tw - Inches(0.3), Inches(1.1),
             txt, font_size=11, color=TEXT_DARK, line_space=1.25)


# ======================================================================
# DIA 9 - PRODUCTEN
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Module: Producten (Abonnementsvormen)", "De 'tarieven' die je aan klanten verkoopt.", 9)
add_footer(s)

# Boven screenshot
add_text(s, Inches(0.4), Inches(1.2), Inches(12.5), Inches(0.4),
         "💼 3 voorbeeld-producten in de demo - bepaal zelf je pakketten!",
         font_size=14, bold=True, color=BRAND_PRIMARY, align=PP_ALIGN.CENTER)
add_screenshot(s, "13-producten-lijst.png",
               Inches(1.3), Inches(1.65), width=Inches(10.7))

# Onder: 3 product cards
prds = [
    ("TRK-BASIC", "Basic Tracking", "€ 9,95", BRAND_SECONDARY,
     "Instapniveau - alleen live locatie en basisrapportages."),
    ("TRK-PRO", "Pro Tracking", "€ 19,95", BRAND_PRIMARY,
     "Uitgebreid: rij- en rusttijden, rapporten, alerts."),
    ("TRK-PREMIUM", "Premium Fleet", "€ 49,00", BRAND_ACCENT,
     "Voor wagenparken: 24/7 support, volledige fleet rapportages, API."),
]
pw = Inches(4.15)
pg = Inches(0.15)
pt = Inches(5.05)
ps = (SW - (pw * 3 + pg * 2)) / 2
for i, (code, naam, prijs, col, desc) in enumerate(prds):
    left = ps + i * (pw + pg)
    add_card_rounded(s, left, pt, pw, Inches(1.95),
                     fill=BRAND_WHITE, line=RGBColor(0xE0, 0xE5, 0xEC))
    add_shape(s, left, pt, pw, Inches(0.08), fill_color=col)
    add_text(s, left + Inches(0.2), pt + Inches(0.2), pw - Inches(0.4), Inches(0.3),
             code, font_size=11, bold=True, color=col)
    add_text(s, left + Inches(0.2), pt + Inches(0.5), pw - Inches(0.4), Inches(0.4),
             naam, font_size=16, bold=True, color=TEXT_DARK)
    add_text(s, left + Inches(0.2), pt + Inches(0.95), pw - Inches(0.4), Inches(0.45),
             prijs + " / maand", font_size=16, bold=True, color=col)
    add_text(s, left + Inches(0.2), pt + Inches(1.4), pw - Inches(0.4), Inches(0.55),
             desc, font_size=11, color=TEXT_MUTED, line_space=1.2)


# ======================================================================
# DIA 10 - ABONNEMENTEN
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Module: Abonnementen", "Je lopende contracten - 1 klant + 1 product + hardware.", 10)
add_footer(s)

# Boven: Lijst screenshot
add_screenshot(s, "07-abonnementen-lijst.png",
               Inches(0.4), Inches(1.25), width=Inches(8.3))

# Rechts: Acties
add_card_rounded(s, Inches(8.9), Inches(1.25), Inches(4.05), Inches(3.6),
                 fill=RGBColor(0xFF, 0xED, 0xD5))
add_text(s, Inches(9.1), Inches(1.37), Inches(3.7), Inches(0.4),
         "⚡ Abonnement-acties:",
         font_size=14, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(9.15), Inches(1.87), Inches(3.6), Inches(2.9),
            [
                "⏸ Opschorten (SUSPEND)",
                "▶ Hervatten (RESUME)",
                "✖️ Annuleren (op datum)",
                "🛑 Onmiddellijk beëindigen",
                "🔄 Tracker vervangen (RMA/upgrade)",
                "🔄 SIM vervangen (nieuwe kaart)",
            ],
            font_size=12, bullet_col=BRAND_ACCENT, line_space=1.35)

# Onder: detail screenshot
add_text(s, Inches(0.4), Inches(5.0), Inches(7.5), Inches(0.4),
         "📄 Detailpagina: 6 tabs per abonnement",
         font_size=13, bold=True, color=BRAND_PRIMARY)
add_screenshot(s, "08-abonnement-detail.png",
               Inches(0.4), Inches(5.45), width=Inches(7.9))

add_card_rounded(s, Inches(8.55), Inches(5.0), Inches(4.4), Inches(2.15),
                 fill=RGBColor(0xE0, 0xE7, 0xFF))
add_text(s, Inches(8.75), Inches(5.12), Inches(4.0), Inches(0.4),
         "📑 Tabs op detail:",
         font_size=13, bold=True, color=BRAND_PRIMARY)
add_text(s, Inches(8.75), Inches(5.55), Inches(4.0), Inches(1.5),
         "① Overzicht (klant, tracker, SIM, voertuig)\n"
         "② Bewerken (prijs, periode, notities)\n"
         "③ Tracker  ④ SIM  ⑤ Facturen  ⑥ Geschiedenis",
         font_size=11.5, color=TEXT_DARK, line_space=1.35)


# ======================================================================
# DIA 11 - ACTIVATIE WIZARD
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "De 6-stappen Activatiewizard (kernfunctie!)", "Alles in 1 keer klaar: abonnement + tracker + SIM + voertuig.", 11)
add_footer(s)

# Boven: 6-stappen flow
add_text(s, Inches(0.4), Inches(1.2), Inches(12.5), Inches(0.4),
         "📋 Elke stap sla je gegevens op. Stap 6 = 'Activeer nu' is 100% TRANSACTIONEEL (alles of niets!)",
         font_size=13, bold=True, color=BRAND_PRIMARY, align=PP_ALIGN.CENTER)
steps = [
    ("1", "Klant", BRAND_PRIMARY),
    ("2", "Product", BRAND_SECONDARY),
    ("3", "Tracker", BRAND_PRIMARY),
    ("4", "SIM", BRAND_SECONDARY),
    ("5", "Voertuig", BRAND_PRIMARY),
    ("6", "Controle ✓", BRAND_ACCENT),
]
sw_ = Inches(2.0)
sg = Inches(0.1)
st_ = Inches(1.7)
ss = (SW - (sw_ * 6 + sg * 5)) / 2
for i, (nr, naam, col) in enumerate(steps):
    left = ss + i * (sw_ + sg)
    add_card_rounded(s, left, st_, sw_, Inches(1.35), fill=BRAND_WHITE,
                     line=RGBColor(0xE0, 0xE5, 0xEC))
    add_shape(s, left + (sw_ - Inches(0.55)) / 2, st_ + Inches(0.1),
              Inches(0.55), Inches(0.55), fill_color=col,
              shape_type=MSO_SHAPE.OVAL)
    add_text(s, left, st_ + Inches(0.13), sw_, Inches(0.5),
             nr, font_size=17, bold=True, color=BRAND_WHITE, align=PP_ALIGN.CENTER)
    add_text(s, left, st_ + Inches(0.75), sw_, Inches(0.5),
             naam, font_size=12, bold=True, color=BRAND_PRIMARY, align=PP_ALIGN.CENTER)
    if i < 5:
        add_text(s, left + sw_ - Inches(0.06), st_ + Inches(0.35),
                 Inches(0.22), Inches(0.6), "➜",
                 font_size=18, bold=True, color=BRAND_ACCENT,
                 anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)

# Midden: echte screenshot Stap 1
add_text(s, Inches(0.4), Inches(3.2), Inches(12.5), Inches(0.4),
         "🖥  Echte interface - Stap 1: Een klant selecteren (hoofdklant + evt. subklant)",
         font_size=13, bold=True, color=BRAND_PRIMARY, align=PP_ALIGN.CENTER)
add_screenshot(s, "10-activatie-wizard-stap1.png",
               Inches(1.0), Inches(3.65), width=Inches(11.3))

# Onder: wat gebeurt er bij "Activeer nu"?
add_card_rounded(s, Inches(0.4), Inches(6.0), Inches(12.55), Inches(1.05),
                 fill=RGBColor(0xEC, 0xFD, 0xF5))
add_text(s, Inches(0.6), Inches(6.07), Inches(12.1), Inches(0.35),
         "🔒 Bij Stap 6 (Activeer nu) gebeurt het volgende ATOMAIR in de database:",
         font_size=13, bold=True, color=BRAND_PRIMARY)
add_text(s, Inches(0.6), Inches(6.45), Inches(12.1), Inches(0.6),
         "① Abonnement AANMAKEN (PENDING → ACTIVE)   ② Tracker van IN_STOCK → ASSIGNED   ③ SIM van IN_STOCK → ASSIGNED   ④ Order op COMPLETED\n"
         "   └─ Iets mislukt? Alles wordt teruggedraaid (rollback) - nooit half werk!",
         font_size=11, color=TEXT_DARK, line_space=1.3)


# ======================================================================
# DIA 12 - ACTIVATIES OVERZICHT
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Activaties: Order overzicht", "Alle activaties, hun status, en 1 klik naar details.", 12)
add_footer(s)

add_screenshot(s, "09-activaties-lijst.png",
               Inches(0.55), Inches(1.3), width=Inches(12.2))

# Legenda statussen
add_text(s, Inches(0.4), Inches(5.1), Inches(12.5), Inches(0.4),
         "🔎 Order statussen - wat betekent wat?",
         font_size=14, bold=True, color=BRAND_PRIMARY, align=PP_ALIGN.CENTER)
statussen = [
    ("DRAFT", "Concept", TEXT_MUTED, "Je bent gestopt in de wizard; kan zo verder."),
    ("READY", "Klaar", BRAND_SECONDARY, "Alle stappen afgerond, wacht op 'Activeer nu'."),
    ("PROCESSING", "Bezig", WARNING_AMBER, "Wordt nu verwerkt, wacht af."),
    ("COMPLETED", "Voltooid ✓", SUCCESS_GREEN, "Succesvol geactiveerd! Abonnement bestaat nu."),
    ("FAILED", "Fout ✗", ERROR_RED, "Gaat fout - los probleem op, probeer opnieuw."),
    ("CANCELLED", "Geannuleerd", TEXT_MUTED, "Order geannuleerd (blijft in log)."),
]
cw = Inches(2.05)
cg = Inches(0.08)
ct = Inches(5.55)
cs = (SW - (cw * 6 + cg * 5)) / 2
for i, (st, nl, col, uitleg) in enumerate(statussen):
    left = cs + i * (cw + cg)
    add_card_rounded(s, left, ct, cw, Inches(1.55), fill=BRAND_LIGHT)
    add_shape(s, left, ct, cw, Inches(0.06), fill_color=col)
    add_status = add_text(s, left, ct + Inches(0.15), cw, Inches(0.4),
                          st, font_size=11.5, bold=True, color=col, align=PP_ALIGN.CENTER)
    add_text(s, left + Inches(0.1), ct + Inches(0.55), cw - Inches(0.2), Inches(0.3),
             nl, font_size=11, bold=True, color=TEXT_DARK, align=PP_ALIGN.CENTER)
    add_text(s, left + Inches(0.1), ct + Inches(0.88), cw - Inches(0.2), Inches(0.65),
             uitleg, font_size=9.5, color=TEXT_MUTED, line_space=1.2, align=PP_ALIGN.CENTER)


# ======================================================================
# DIA 13 - FACTUREN
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Module: Facturen", "Automatisch per maand alle abonnementen factureren.", 13)
add_footer(s)

# Boven screenshot
add_screenshot(s, "11-facturen-lijst.png",
               Inches(0.55), Inches(1.25), width=Inches(12.2))

# Workflow
add_card_rounded(s, Inches(0.4), Inches(4.85), Inches(12.55), Inches(2.2),
                 fill=BRAND_LIGHT)
add_text(s, Inches(0.6), Inches(4.95), Inches(12.1), Inches(0.4),
         "🧾 Facturatieflow - gebruik deze 4 stappen elke maand:",
         font_size=14, bold=True, color=BRAND_PRIMARY)
steps = [
    ("① Genereer", WARNING_AMBER, "Klik: Genereer maandfacturen → Kies de maand.\n"
     "Nexus maakt per ACTIEF/SUSPENDED abonnement 1 factuur."),
    ("② Controleer", BRAND_SECONDARY, "Status is DRAFT. Check of alle bedragen kloppen\n"
     "(subtotaal, BTW 21%, totaal)."),
    ("③ Verstuur", BRAND_PRIMARY, "Zet de facturen op SENT.\n"
     "(In toekomst: rechtstreeks mailen naar klant!)"),
    ("④ Betaal ✓", SUCCESS_GREEN, "Zet op PAID wanneer het bedrag binnen is.\n"
     "Bij overschrijding termijn: staat op OVERDUE."),
]
fw = Inches(3.0)
fg = Inches(0.12)
ft = Inches(5.45)
fs = (SW - (fw * 4 + fg * 3)) / 2
for i, (lbl, col, desc) in enumerate(steps):
    left = fs + i * (fw + fg)
    add_card_rounded(s, left, ft, fw, Inches(1.5), fill=BRAND_WHITE)
    add_shape(s, left, ft, fw, Inches(0.08), fill_color=col)
    add_text(s, left + Inches(0.15), ft + Inches(0.2), fw - Inches(0.3), Inches(0.35),
             lbl, font_size=13, bold=True, color=col)
    add_text(s, left + Inches(0.15), ft + Inches(0.58), fw - Inches(0.3), Inches(0.95),
             desc, font_size=10.5, color=TEXT_DARK, line_space=1.2)
    if i < 3:
        add_text(s, left + fw - Inches(0.04), ft + Inches(0.4),
                 Inches(0.2), Inches(0.7), "→",
                 font_size=18, bold=True, color=BRAND_ACCENT,
                 anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)


# ======================================================================
# DIA 14 - CSV IMPORT
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "CSV Importeren & Exporteren", "Voor grote partijen trackers/SIMs: importeer in 3 stappen.", 14)
add_footer(s)

# Links screenshot import
add_text(s, Inches(0.4), Inches(1.2), Inches(6.3), Inches(0.4),
         "📥 CSV Importeren (voorbeeld: Trackers)",
         font_size=14, bold=True, color=BRAND_PRIMARY)
add_screenshot(s, "14-csv-import-trackers.png",
               Inches(0.4), Inches(1.65), width=Inches(6.3))

# Rechts: stappen uitleg
add_card_rounded(s, Inches(6.9), Inches(1.2), Inches(6.05), Inches(4.4),
                 fill=BRAND_LIGHT)
add_text(s, Inches(7.1), Inches(1.32), Inches(5.7), Inches(0.4),
         "💡 3-stappen Import (altijd Preview eerst!)",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(7.15), Inches(1.82), Inches(5.55), Inches(3.7),
            [
                "STAP 1: Kies CSV bestand + kolom-aliassing.\n   Jouw Excel-kolommen matchen met Nexus-velden.",
                "STAP 2: PREVIEW 🔥 (meest belangrijk!).\n   Statistieken: Totaal / Geldig / Fouten.\n   Per rij met fout: zie precies WAAROM.",
                "STAP 3: Alleen VALIDE rijen worden ingevoegd.\n   Fouten? Pas CSV aan, probeer opnieuw.",
                "✅ Tip: Gebruik altijd eerst 1 kleine test-CSV!",
                "✅ Tip: Bekijk de 'Voorbeeld bekijken'-knop!",
                "✅ Exporteer eerst bestaande data → je hebt meteen juiste kolomnamen.",
            ],
            font_size=12, bullet_col=BRAND_ACCENT, line_space=1.2)

# Onder: export tips
add_card_rounded(s, Inches(0.4), Inches(5.8), Inches(12.55), Inches(1.2),
                 fill=RGBColor(0xE0, 0xE7, 0xFF))
add_text(s, Inches(0.6), Inches(5.9), Inches(12.1), Inches(0.4),
         "📤 Exporteren gaat zo: op elke module-lijstpagina: knop 'Exporteer CSV'",
         font_size=13, bold=True, color=BRAND_PRIMARY)
add_text(s, Inches(0.6), Inches(6.3), Inches(12.1), Inches(0.6),
         "👉 UTF-8 BOM + CRLF regeleindes = Excel opent zonder rare tekens.   👉 Bestandsnaam: bv. trackers-20260917-1430.csv   👉 Datums in ISO-formaat (YYYY-MM-DD) voor makkelijke verwerking.",
         font_size=11, color=TEXT_DARK, line_space=1.3)


# ======================================================================
# DIA 15 - ZOEKEN (⌘K)
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "⌘K / Ctrl+K: Supersnel zoeken!", "Sla het menu over - zoek en spring direct naar ieder record.", 15)
add_footer(s)

# Links screenshot
add_screenshot(s, "15-zoekpagina.png",
               Inches(0.4), Inches(1.25), width=Inches(7.3))

# Rechts 3 voorbeelden + uitleg
add_card_rounded(s, Inches(7.9), Inches(1.25), Inches(5.05), Inches(5.7),
                 fill=BRAND_LIGHT)
add_text(s, Inches(8.1), Inches(1.37), Inches(4.7), Inches(0.45),
         "🔍 Wat en hoe zoek je?",
         font_size=16, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(8.15), Inches(1.9), Inches(4.6), Inches(2.2),
            [
                "Typ IMEI, ICCID, kenteken, VIN…",
                "Klantnummer of bedrijfsnaam",
                "Abonnementnummer (SUB-2025-…)",
                "Ordernummer (ACT-2025-…) of Tracker (TRK-…) ",
            ],
            font_size=13, bullet_col=BRAND_ACCENT, line_space=1.3)

add_shape(s, Inches(8.15), Inches(4.4), Inches(4.4), Inches(0.04),
          fill_color=BRAND_SECONDARY)

add_text(s, Inches(8.15), Inches(4.55), Inches(4.6), Inches(0.35),
         "⌨️ Sneltoetsen:",
         font_size=13, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(8.15), Inches(4.95), Inches(4.6), Inches(1.9),
            [
                "⌘K / Ctrl+K - opent zoekvak vanuit ELKE pagina",
                "↑ ↓ pijltjestoetsen - navigeer zoekresultaten",
                "Enter → springt meteen naar de detailpagina",
                "Esc / buiten klikken → sluit zoekvenster",
            ],
            font_size=11.5, bullet_col=BRAND_ACCENT, line_space=1.25)

# Onder: winstmarge-katern
add_card_rounded(s, Inches(0.4), Inches(5.9), Inches(7.3), Inches(1.1),
                 fill=RGBColor(0xFF, 0xED, 0xD5))
add_text(s, Inches(0.6), Inches(5.97), Inches(6.9), Inches(0.4),
         "⏱ Tijdswinst per zoekactie:",
         font_size=12, bold=True, color=BRAND_PRIMARY)
add_text(s, Inches(0.6), Inches(6.35), Inches(6.9), Inches(0.6),
         "Zoeken via zijbalk + typen + filter: ~30 seconden  👉  ⌘K = 3 seconden  = 90% sneller!\n"
         "Bij 20 zoekacties per dag bespaar je al snel 10 minuten per dag.",
         font_size=11, color=TEXT_DARK, line_space=1.3)


# ======================================================================
# DIA 16 - GEBRUIKERS & ROLLEN
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Gebruikers & Rollen (wie mag wat?)", "3 rollen: Beheerder, Medewerker, Alleen-lezen.", 16)
add_footer(s)

# Boven screenshot gebruikerslijst
add_text(s, Inches(0.4), Inches(1.2), Inches(12.5), Inches(0.4),
         "👥 Gebruikersmodule - alleen zichtbaar voor Beheerders",
         font_size=13, bold=True, color=BRAND_PRIMARY, align=PP_ALIGN.CENTER)
add_screenshot(s, "16-gebruikers-lijst.png",
               Inches(1.1), Inches(1.65), width=Inches(11.1))

# Onder: 3 rollen cards
roles = [
    ("⚙️ Beheerder", "ADMIN", BRAND_PRIMARY,
     ["Alles: klanten, trackers, SIMs, abonnementen",
      "Gebruikers aanmaken/wijzigen/verwijderen",
      "Instellingen wijzigen",
      "Facturen genereren (MAAND-facturen)",
      "Prijzen overriden (indien nodig)",
      "Soft-delete data (verwijderen = archiveren)"]),
    ("👩‍💼 Medewerker", "EMPLOYEE", BRAND_SECONDARY,
     ["Klanten / Trackers / SIMs / Voertuigen: CRUD",
      "Abonnementen: aanmaken + wijzigen",
      "Activatiewizard: volgen + activeren",
      "Facturen: op SENT / PAID zetten",
      "CSV Importeren (trackers, sims, klanten)",
      "✗ GEEN gebruikers of instellingen!"]),
    ("👀 Alleen-lezen", "VIEWER", SUCCESS_GREEN,
     ["Dashboard bekijken",
      "Alle modules: alleen-lezen (GEEN wijzigingen)",
      "Zoeken en filteren op records",
      "Auditlog bekijken",
      "✗ GEEN wizard, GEEN writes, GEEN export",
      "Geschikt voor: externen, accountants."]),
]
rw = Inches(4.15)
rg = Inches(0.15)
rt = Inches(4.3)
rs = (SW - (rw * 3 + rg * 2)) / 2
for i, (titel, code, col, items) in enumerate(roles):
    left = rs + i * (rw + rg)
    add_card_rounded(s, left, rt, rw, Inches(2.7), fill=BRAND_WHITE,
                     line=RGBColor(0xE0, 0xE5, 0xEC))
    add_shape(s, left, rt, rw, Inches(0.7), fill_color=col,
              shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, rt + Inches(0.05), rw, Inches(0.35),
             titel, font_size=13, bold=True, color=BRAND_WHITE, align=PP_ALIGN.CENTER)
    add_text(s, left, rt + Inches(0.38), rw, Inches(0.3),
             f"Rolcode: {code}", font_size=10, bold=False,
             color=RGBColor(0xBF, 0xDB, 0xFE), align=PP_ALIGN.CENTER)
    add_bullets(s, left + Inches(0.15), rt + Inches(0.85), rw - Inches(0.3),
                Inches(1.8), items,
                font_size=10.5, bullet_col=col, line_space=1.15)


# ======================================================================
# DIA 17 - EERSTE STAPPEN (CHECKLIST)
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_header(s, "Checklist: Eerste keer werken met Nexus", "Volg deze stappen 1-voor-1 en je bent zo up-and-running.", 17)
add_footer(s)

# Kolom 1: Eerste uur (Setup)
add_card_rounded(s, Inches(0.4), Inches(1.3), Inches(4.15), Inches(5.7),
                 fill=BRAND_LIGHT)
add_shape(s, Inches(0.4), Inches(1.3), Inches(4.15), Inches(0.07),
          fill_color=BRAND_PRIMARY)
add_text(s, Inches(0.6), Inches(1.45), Inches(3.8), Inches(0.5),
         "⏱ Uur 1: De basis opzetten",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_bullets(s, Inches(0.55), Inches(2.05), Inches(3.85), Inches(4.8),
            [
                "☐ Inloggen met je gegevens",
                "☐ Dashboard verkennen (KPI's leren kennen)",
                "☐ ⌘K uitproberen: typ 'TRK' en zie resultaten",
                "☐ Producten controleren: kloppen de huidige producten?",
                "☐ Test-klant aanmaken (eigen gegevens)",
                "☐ Zijbalk: alle modules even openklikken",
            ],
            font_size=12, bullet_col=BRAND_PRIMARY, line_space=1.45)

# Kolom 2: Eerste dag (hardware)
add_card_rounded(s, Inches(4.7), Inches(1.3), Inches(4.15), Inches(5.7),
                 fill=BRAND_LIGHT)
add_shape(s, Inches(4.7), Inches(1.3), Inches(4.15), Inches(0.07),
          fill_color=BRAND_ACCENT)
add_text(s, Inches(4.9), Inches(1.45), Inches(3.8), Inches(0.5),
         "📅 Eerste dag: Voorraad vullen",
         font_size=15, bold=True, color=BRAND_ACCENT)
add_bullets(s, Inches(4.85), Inches(2.05), Inches(3.85), Inches(4.8),
            [
                "☐ 1 tracker handmatig aanmaken + opslaan",
                "☐ 1 SIM-kaart handmatig aanmaken",
                "☐ CSV-import testen met 3 rijen (preview check!)",
                "☐ Klant 'Demo' aanmaken met adres/contact",
                "☐ Voertuig toevoegen (eigen kenteken als test)",
                "☐ Check lijsten: alles verschijnt in overzichten?",
            ],
            font_size=12, bullet_col=BRAND_ACCENT, line_space=1.45)

# Kolom 3: Eerste week (live)
add_card_rounded(s, Inches(9.0), Inches(1.3), Inches(3.95), Inches(5.7),
                 fill=RGBColor(0xEC, 0xFD, 0xF5))
add_shape(s, Inches(9.0), Inches(1.3), Inches(3.95), Inches(0.07),
          fill_color=SUCCESS_GREEN)
add_text(s, Inches(9.2), Inches(1.45), Inches(3.6), Inches(0.5),
         "🚀 Eerste week: Live draaien",
         font_size=15, bold=True, color=SUCCESS_GREEN)
add_bullets(s, Inches(9.15), Inches(2.05), Inches(3.7), Inches(4.8),
            [
                "☐ 1e echte activatie via Wizard (stap 1-6)",
                "☐ Resultaat checken: abonnement + hardware toegewezen?",
                "☐ Abonnement openen: tracker & SIM tonen",
                "☐ Facturen genereren (1e testmaand)",
                "☐ 1 factuur: DRAFT → SENT → PAID",
                "☐ Auditlog checken: alle acties gelogd?",
            ],
            font_size=12, bullet_col=SUCCESS_GREEN, line_space=1.45)


# ======================================================================
# DIA 18 - SLOT + TIPS + CONTACT
# ======================================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s, BRAND_PRIMARY)

tri = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, 0, 0, SW * 0.45, SH)
tri.fill.solid()
tri.fill.fore_color.rgb = BRAND_SECONDARY
tri.line.fill.background()
tri.rotation = 180

tri2 = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, 0, 0, SW * 0.3, SH)
tri2.fill.solid()
tri2.fill.fore_color.rgb = BRAND_ACCENT
tri2.line.fill.background()
tri2.rotation = 180

add_text(s, SW - Inches(9), Inches(1.6), Inches(8.5), Inches(1),
         "Veel succes met Nexus!",
         font_size=44, bold=True, color=BRAND_WHITE, align=PP_ALIGN.RIGHT)

add_text(s, SW - Inches(9), Inches(2.85), Inches(8.5), Inches(0.6),
         "Je kunt aan de slag – je hebt de basiskennis!",
         font_size=18, bold=False, color=RGBColor(0xBF, 0xDB, 0xFE), align=PP_ALIGN.RIGHT)

# 5 tips blok
add_card_rounded(s, SW - Inches(9), Inches(3.65), Inches(8.5), Inches(2.8),
                 fill=BRAND_WHITE)
add_shape(s, SW - Inches(9), Inches(3.65), Inches(8.5), Inches(0.1),
          fill_color=BRAND_ACCENT)
add_text(s, SW - Inches(8.8), Inches(3.82), Inches(8.1), Inches(0.5),
         "⭐ Top-5 tips van ervaren Nexus-gebruikers:",
         font_size=15, bold=True, color=BRAND_PRIMARY)
add_bullets(s, SW - Inches(8.8), Inches(4.35), Inches(8.1), Inches(2.0),
            [
                "Gebruik ⌘K/Ctrl+K voor ELKE zoekopdracht - went het snel!",
                "Bij bulk import: Altijd de PREVIEW controleren voor je opslaat.",
                "Bij twijfel over status: kijk op de Auditlog-pagina.",
                "Gebruik NIEUW-abonnement via Wizard, NIET handmatig (consistentie!).",
                "Zet elke week 5 minuten vrij om OVERDUE facturen op te schonen.",
            ],
            font_size=12, bullet_col=BRAND_ACCENT, line_space=1.3)

# Contact / demo gegevens
add_shape(s, SW - Inches(9), Inches(6.65), Inches(8.5), Inches(0.05),
          fill_color=BRAND_ACCENT)
add_text(s, SW - Inches(9), Inches(6.75), Inches(8.5), Inches(0.35),
         "Demo-omgeving (indien je die gebruikt):",
         font_size=11, bold=True, color=RGBColor(0x93, 0xC5, 0xFD), align=PP_ALIGN.RIGHT)
add_text(s, SW - Inches(9), Inches(7.0), Inches(8.5), Inches(0.3),
         "Beheerder: admin@nexus.local  •  Medewerker: medewerker@nexus.local  •  Viewer: viewer@nexus.local  •  Wachtwoord: Test1234!",
         font_size=10, bold=False, color=RGBColor(0x93, 0xC5, 0xFD), align=PP_ALIGN.RIGHT)


# ======================================================================
# OPSLAAN
# ======================================================================
out = os.path.join(BASE_DIR, "Nexus_Gebruikershandleiding.pptx")
prs.save(out)
print(f"✅ Presentatie opgeslagen: {out}")
print(f"📊 Dias: {len(prs.slides)} / {TOTAL}")
print(f"🖼  Screenshots-map: {SS_DIR} ({len(os.listdir(SS_DIR))} bestanden)")
