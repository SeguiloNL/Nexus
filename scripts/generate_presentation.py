#!/usr/bin/env python3
"""
Nexus Systeem - PowerPoint Presentatie Generator
Gebruik: python3 scripts/generate_presentation.py
Output: Nexus_Systeem_Presentatie.pptx
"""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from pptx.oxml import parse_xml
import os

# ------------------------------
# Kleurenschema (zakelijk, professioneel)
# ------------------------------
BRAND_PRIMARY = RGBColor(0x1E, 0x3A, 0x5F)   # Diepblauw
BRAND_SECONDARY = RGBColor(0x2E, 0x86, 0xC1)  # Blauw accent
BRAND_ACCENT = RGBColor(0xE8, 0x6C, 0x00)     # Oranje accent
BRAND_LIGHT = RGBColor(0xF5, 0xF7, 0xFA)      # Lichtgrijs
BRAND_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
TEXT_DARK = RGBColor(0x1A, 0x1A, 0x1A)
TEXT_MUTED = RGBColor(0x55, 0x55, 0x55)
SUCCESS_GREEN = RGBColor(0x16, 0xA3, 0x4A)
WARNING_AMBER = RGBColor(0xD9, 0x77, 0x06)
ERROR_RED = RGBColor(0xDC, 0x26, 0x26)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
SW = prs.slide_width
SH = prs.slide_height


def add_background(slide, color=BRAND_WHITE):
    background = slide.background
    fill = background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_shape(slide, left, top, width, height, fill_color=None, line_color=None, line_width=None, shape_type=MSO_SHAPE.RECTANGLE):
    shape = slide.shapes.add_shape(shape_type, left, top, width, height)
    shape.shadow.inherit = False
    if fill_color:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill_color
    else:
        shape.fill.background()
    if line_color:
        shape.line.color.rgb = line_color
        if line_width:
            shape.line.width = line_width
    else:
        shape.line.fill.background()
    return shape


def add_text(slide, left, top, width, height, text, font_size=18, bold=False,
             color=TEXT_DARK, alignment=PP_ALIGN.LEFT, font_name="Calibri",
             line_spacing=1.2, anchor=MSO_ANCHOR.TOP):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(0.05)
    tf.margin_right = Inches(0.05)
    tf.margin_top = Inches(0.02)
    tf.margin_bottom = Inches(0.02)
    tf.vertical_anchor = anchor
    lines = text.split("\n") if isinstance(text, str) else text
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = alignment
        p.line_spacing = line_spacing
        run = p.add_run()
        run.text = line
        run.font.name = font_name
        run.font.size = Pt(font_size)
        run.font.bold = bold
        run.font.color.rgb = color
    return txBox


def add_bullet_list(slide, left, top, width, height, items, font_size=16,
                    color=TEXT_DARK, bullet_color=BRAND_SECONDARY,
                    line_spacing=1.3, bold_first_word=False):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    tf.margin_left = Inches(0.1)
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        p.line_spacing = line_spacing
        p.space_after = Pt(6)
        # Bulletsymbool
        run0 = p.add_run()
        run0.text = "▸ "
        run0.font.name = "Calibri"
        run0.font.size = Pt(font_size)
        run0.font.color.rgb = bullet_color
        run0.font.bold = True
        # Tekst
        if bold_first_word and " " in item:
            parts = item.split(" ", 1)
            run1 = p.add_run()
            run1.text = parts[0] + " "
            run1.font.name = "Calibri"
            run1.font.size = Pt(font_size)
            run1.font.bold = True
            run1.font.color.rgb = color
            run2 = p.add_run()
            run2.text = parts[1]
            run2.font.name = "Calibri"
            run2.font.size = Pt(font_size)
            run2.font.color.rgb = color
        else:
            run = p.add_run()
            run.text = item
            run.font.name = "Calibri"
            run.font.size = Pt(font_size)
            run.font.color.rgb = color
    return txBox


def add_header_bar(slide, title_text, subtitle_text=None, show_logo=True):
    add_shape(slide, 0, 0, SW, Inches(1.15), fill_color=BRAND_PRIMARY)
    # Oranje accent streep
    add_shape(slide, 0, Inches(1.15), SW, Inches(0.06), fill_color=BRAND_ACCENT)
    # Titel
    add_text(slide, Inches(0.5), Inches(0.12), Inches(11), Inches(0.7),
             title_text, font_size=30, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.LEFT)
    if subtitle_text:
        add_text(slide, Inches(0.5), Inches(0.75), Inches(11), Inches(0.4),
                 subtitle_text, font_size=14, bold=False, color=RGBColor(0xBF, 0xDB, 0xFE),
                 alignment=PP_ALIGN.LEFT)
    if show_logo:
        # Logo-vlak
        add_shape(slide, SW - Inches(2.2), Inches(0.15), Inches(1.9), Inches(0.85),
                  fill_color=BRAND_ACCENT, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
        add_text(slide, SW - Inches(2.2), Inches(0.3), Inches(1.9), Inches(0.55),
                 "NEXUS", font_size=24, bold=True, color=BRAND_WHITE,
                 alignment=PP_ALIGN.CENTER)


def add_footer(slide, page_num, total_pages):
    # Voettekstbalk
    add_shape(slide, 0, SH - Inches(0.4), SW, Inches(0.4), fill_color=BRAND_LIGHT)
    add_text(slide, Inches(0.4), SH - Inches(0.38), Inches(6), Inches(0.35),
             "Nexus – Activation & Subscription Manager", font_size=10,
             color=TEXT_MUTED, alignment=PP_ALIGN.LEFT)
    add_text(slide, SW - Inches(2.4), SH - Inches(0.38), Inches(2), Inches(0.35),
             f"Pagina {page_num} / {total_pages}", font_size=10,
             color=TEXT_MUTED, alignment=PP_ALIGN.RIGHT)
    # Scheidingslijn
    add_shape(slide, 0, SH - Inches(0.4), SW, Inches(0.02), fill_color=BRAND_SECONDARY)


def add_info_card(slide, left, top, width, height, title, items,
                  header_color=BRAND_SECONDARY, icon_char="ℹ️"):
    # Card achtergrond
    card = add_shape(slide, left, top, width, height,
                     fill_color=BRAND_WHITE, line_color=RGBColor(0xE0, 0xE5, 0xEC),
                     line_width=Pt(0.75), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    # Header
    add_shape(slide, left + Inches(0.1), top + Inches(0.1),
              width - Inches(0.2), Inches(0.55),
              fill_color=header_color, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(slide, left + Inches(0.25), top + Inches(0.18),
             width - Inches(0.5), Inches(0.4),
             f"{icon_char}  {title}", font_size=15, bold=True,
             color=BRAND_WHITE)
    # Content
    content_top = top + Inches(0.75)
    content_h = height - Inches(0.9)
    add_bullet_list(slide, left + Inches(0.25), content_top,
                    width - Inches(0.5), content_h,
                    items, font_size=13, line_spacing=1.25, bold_first_word=True)


def add_status_chip(slide, left, top, width, height, label, color=BRAND_SECONDARY):
    chip = add_shape(slide, left, top, width, height, fill_color=color,
                     shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(slide, left, top, width, height, label,
             font_size=11, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


def add_two_col_header(slide, page_num, total, title, subtitle=None):
    add_header_bar(slide, title, subtitle)
    add_footer(slide, page_num, total)


# ============================================================
# Totaal aantal pagina's
# ============================================================
TOTAL_PAGES = 22

# ============================================================
# 1. TITELDIAS
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s, BRAND_PRIMARY)
# Oranje diagonaal accent
tri = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, SW * 0.55, 0, SW * 0.5, SH)
tri.fill.solid()
tri.fill.fore_color.rgb = BRAND_SECONDARY
tri.line.fill.background()
tri.rotation = 0

tri2 = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, SW * 0.7, 0, SW * 0.35, SH)
tri2.fill.solid()
tri2.fill.fore_color.rgb = BRAND_ACCENT
tri2.line.fill.background()

# Naam badge
add_shape(s, Inches(0.8), Inches(2.3), Inches(3.8), Inches(1.1),
          fill_color=BRAND_ACCENT, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.8), Inches(2.45), Inches(3.8), Inches(0.8),
         "NEXUS", font_size=60, bold=True, color=BRAND_WHITE,
         alignment=PP_ALIGN.CENTER)

add_text(s, Inches(0.8), Inches(3.7), Inches(7), Inches(0.7),
         "Activation & Subscription Manager",
         font_size=28, bold=False, color=RGBColor(0xBF, 0xDB, 0xFE))

add_text(s, Inches(0.8), Inches(4.7), Inches(7), Inches(1.2),
         "Gebruikershandleiding & Systeemintroductie",
         font_size=22, bold=False, color=BRAND_WHITE)

# Lijn
add_shape(s, Inches(0.8), Inches(6), Inches(5), Inches(0.04), fill_color=BRAND_ACCENT)

add_text(s, Inches(0.8), Inches(6.15), Inches(6), Inches(0.4),
         "Voor toekomstige gebruikers • Fleet & M2M dienstverlening",
         font_size=14, color=RGBColor(0x93, 0xC5, 0xFD), alignment=PP_ALIGN.LEFT)

add_text(s, Inches(0.8), Inches(6.55), Inches(6), Inches(0.4),
         "Versie 1.0  •  september 2026",
         font_size=12, color=RGBColor(0x93, 0xC5, 0xFD), alignment=PP_ALIGN.LEFT)


# ============================================================
# 2. AGENDA
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 2, TOTAL_PAGES, "Agenda", "Wat komen vandaag aan bod?")

agenda_items = [
    ("01", "Systeemoverzicht", "Wat is Nexus, voor wie en waarom?"),
    ("02", "Architectuur & Tech Stack", "Hoe zit het systeem technisch in elkaar?"),
    ("03", "Gebruikersrollen & Rechten", "ADMIN, EMPLOYEE, VIEWER – wie mag wat?"),
    ("04", "Dashboard & Navigatie", "Startscherm, zijbalk en snelzoeken (⌘K)"),
    ("05", "Hoofdmodules", "Klanten • Trackers • SIMs • Voertuigen • Producten"),
    ("06", "Activaties: 6-stappen Wizard", "Transactionele activatie-flow"),
    ("07", "Abonnementen Beheren", "Levenscyclus, wijzigingen en vervangingen"),
    ("08", "Facturatie", "Genereren, verzenden en betalen van facturen"),
    ("09", "CSV Import & Export", "Data bulksgewijs in- en uitvoeren"),
    ("10", "Audit Log & Beveiliging", "Traceerbaarheid, soft-delete en validatie"),
    ("11", "Eerste Stappen & Tips", "Hoe begin je, handige truuks en FAQ"),
]

col_w = Inches(6)
left_col = Inches(0.4)
right_col = Inches(6.75)
top_start = Inches(1.5)
row_h = Inches(0.5)
gap = Inches(0.08)

for idx, (num, title, sub) in enumerate(agenda_items):
    col = left_col if idx < 6 else right_col
    row = idx if idx < 6 else idx - 6
    top = top_start + row * (row_h + gap)
    # Nummerbadge
    add_shape(s, col, top, Inches(0.6), row_h,
              fill_color=BRAND_PRIMARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, col, top, Inches(0.6), row_h, num,
             font_size=15, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    # Titel
    add_text(s, col + Inches(0.7), top, Inches(5.6), Inches(0.28),
             title, font_size=15, bold=True, color=BRAND_PRIMARY)
    # Subtitel
    add_text(s, col + Inches(0.7), top + Inches(0.25), Inches(5.6), Inches(0.25),
             sub, font_size=10.5, color=TEXT_MUTED)


# ============================================================
# 3. SYSTEEMOVERZICHT
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 3, TOTAL_PAGES, "Systeemoverzicht",
                   "Wat is Nexus en welke problemen lost het op?")

# Linker kolom: Doel & Doelgroep
add_info_card(s, Inches(0.4), Inches(1.45), Inches(6.2), Inches(2.6),
              "Doel van Nexus",
              [
                  "Telematica-hardware (GPS trackers + SIMs) beheren en toewijzen aan klanten",
                  "Per abonnement factureren op maandelijkse basis",
                  "Transactionele 6-stappen activaties met 100% data-consistentie",
                  "Volledige traceerbaarheid van elke wijziging via AuditLog",
                  "Rollensgewijze toegang (wie ziet/wijzigt wat)",
              ],
              header_color=BRAND_PRIMARY, icon_char="🎯")

# Rechter kolom: Doelgroep
add_info_card(s, Inches(6.75), Inches(1.45), Inches(6.2), Inches(2.6),
              "Doelgroep",
              [
                  "Fleet-managers met wagenparken (auto, vrachtauto, vaartuigen)",
                  "MDM / M2M dienstverleners (IoT, Machine-to-Machine)",
                  "Telematica-leveranciers die hardware als service aanbieden",
                  "Backoffice medewerkers (order entry, facturatie)",
                  "Administrateurs en auditors (traceerbaarheid)",
              ],
              header_color=BRAND_ACCENT, icon_char="👥")

# Onder: Kernvoordelen 4 bloks
items_row = [
    ("100%", "Transactioneel", BRAND_PRIMARY),
    ("6-staps", "Activatie Wizard", BRAND_SECONDARY),
    ("3 Rollen", "RBAC Beveiligd", SUCCESS_GREEN),
    ("Full", "Audit Traceerbaar", BRAND_ACCENT),
]
col_width = Inches(3.05)
gap_between = Inches(0.1)
total_w = col_width * 4 + gap_between * 3
start_left = (SW - total_w) / 2

for i, (big_text, label, color) in enumerate(items_row):
    left = start_left + i * (col_width + gap_between)
    add_shape(s, left, Inches(4.3), col_width, Inches(2.3),
              fill_color=color, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, Inches(4.45), col_width, Inches(1.1),
             big_text, font_size=38, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    add_text(s, left, Inches(5.6), col_width, Inches(0.8),
             label, font_size=15, bold=False, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)


# ============================================================
# 4. ARCHITECTUUR & TECH STACK
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 4, TOTAL_PAGES, "Architectuur & Tech Stack",
                   "Hoe zit Nexus technisch in elkaar?")

# 3 kolommen: Frontend, Backend, Deployment
cols = [
    ("Frontend / UI", BRAND_PRIMARY, [
        "Next.js 14.2 (App Router)",
        "TypeScript 5.7 (strict mode)",
        "Tailwind CSS 3",
        "shadcn/ui + Radix UI",
        "TanStack DataTable v8",
        "React Server Components",
        "Server Actions (beveiligd)",
        "Sonner notificaties",
    ]),
    ("Backend / Data", BRAND_SECONDARY, [
        "PostgreSQL 16 database",
        "Prisma 5 ORM (client gegenereerd)",
        "Auth.js V5 (NextAuth 5)",
        "Zod validatie (incl. preprocess)",
        "BCryptjs (cost factor 12)",
        "Transactionele services",
        "Automatische AuditLogs",
        "Soft-delete (deletedAt)",
    ]),
    ("Deployment / Hosting", BRAND_ACCENT, [
        "Docker multi-stage build",
        "Next.js standalone output",
        "Docker Compose stack (3 services)",
        "Caddy 2 (reverse proxy)",
        "Let's Encrypt HTTPS (auto)",
        "Linux VPS (Ubuntu LTS)",
        "Named volumes voor DB data",
        "Non-root container gebruiker",
    ]),
]

col_w = Inches(4.15)
gap_col = Inches(0.2)
total_col_w = col_w * 3 + gap_col * 2
col_start = (SW - total_col_w) / 2

for i, (title, color, items) in enumerate(cols):
    left = col_start + i * (col_w + gap_col)
    # Card
    add_shape(s, left, Inches(1.4), col_w, Inches(5.6),
              fill_color=BRAND_WHITE,
              line_color=RGBColor(0xE0, 0xE5, 0xEC), line_width=Pt(0.75),
              shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    # Header
    add_shape(s, left + Inches(0.15), Inches(1.5),
              col_w - Inches(0.3), Inches(0.65),
              fill_color=color, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left + Inches(0.15), Inches(1.58),
             col_w - Inches(0.3), Inches(0.5),
             title, font_size=17, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    # Items
    add_bullet_list(s, left + Inches(0.35), Inches(2.3),
                    col_w - Inches(0.7), Inches(4.5),
                    items, font_size=13, line_spacing=1.35,
                    bullet_color=color)

# Footer diagram: Data flow indicatie
add_text(s, Inches(0.5), Inches(6.75), Inches(12.5), Inches(0.4),
         "↗️ Data-flow: Browser → Caddy (HTTPS) → Next.js (Server Actions) → Prisma → PostgreSQL  •  Auth via Auth.js V5  •  SSL: Let's Encrypt (auto)",
         font_size=11, color=TEXT_MUTED, alignment=PP_ALIGN.CENTER)


# ============================================================
# 5. GEBRUIKERSROLLEN & RECHTEN (RBAC)
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 5, TOTAL_PAGES, "Gebruikersrollen & Rechten",
                   "Role-Based Access Control (RBAC) – wie mag wat?")

# 3 rollen naast elkaar
roles = [
    ("ADMIN", BRAND_PRIMARY, [
        "Volledige CRUD op alle modules",
        "Gebruikers beheren (uitnodigen)",
        "Instellingen wijzigen",
        "Facturatie: genereren & beheren",
        "Override prijzen (producten/abonnementen)",
        "Verwijderen (soft-delete) van data",
        "Wizard activeren & afmaken",
        "CSV Import & Export alles",
    ]),
    ("EMPLOYEE", BRAND_SECONDARY, [
        "CRUD op Klanten, Trackers, SIMs",
        "CRUD op Voertuigen & Producten",
        "Abonnementen aanmaken/wijzigen",
        "Wizard volgen en activeren",
        "Facturen bewerken (verzenden)",
        "CSV Import (trackers/sims/klanten)",
        "CSV Export (geanonimiseerd)",
        "✗ GEEN Gebruikers/Instellingen",
        "✗ GEEN delete (verwijderen)",
    ]),
    ("VIEWER", SUCCESS_GREEN, [
        "Alleen-lezen toegang",
        "Dashboard bekijken",
        "Klanten/Trackers/SIMS raadplegen",
        "Abonnementen en facturen bekijken",
        "Audit log inzien",
        "Zoeken en filteren",
        "✗ GEEN wijzigingen",
        "✗ GEEN wizard/activaties",
        "✗ GEEN import/export",
    ]),
]

col_w = Inches(4.15)
gap_col = Inches(0.2)
total_w = col_w * 3 + gap_col * 2
start_left = (SW - total_w) / 2

for i, (role, color, items) in enumerate(roles):
    left = start_left + i * (col_w + gap_col)
    # Rol-badge boven
    add_shape(s, left, Inches(1.4), col_w, Inches(0.8),
              fill_color=color, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, Inches(1.4), col_w, Inches(0.8),
             role, font_size=24, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    # Card onder
    add_shape(s, left, Inches(2.3), col_w, Inches(4.6),
              fill_color=BRAND_WHITE,
              line_color=RGBColor(0xE0, 0xE5, 0xEC), line_width=Pt(0.75),
              shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_bullet_list(s, left + Inches(0.3), Inches(2.5),
                    col_w - Inches(0.6), Inches(4.3),
                    items, font_size=13, line_spacing=1.3,
                    bullet_color=color)

# Voetnoot
add_shape(s, Inches(0.5), Inches(6.85), Inches(12.35), Inches(0.45),
          fill_color=BRAND_LIGHT, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.7), Inches(6.87), Inches(12), Inches(0.4),
         "💡 Alle Server Actions worden expliciet beveiligd via `withAuth()` wrapper. Toegang zonder juiste rol → foutcode 403 (Permission Denied).",
         font_size=12, bold=False, color=TEXT_DARK)


# ============================================================
# 6. DASHBOARD & NAVIGATIE
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 6, TOTAL_PAGES, "Dashboard & Navigatie",
                   "Het startscherm, de zijbalk en snelzoeken")

# Mock dashboard layout: zijbalk + content
# Zijbalk
add_shape(s, Inches(0.4), Inches(1.4), Inches(2.6), Inches(5.55),
          fill_color=RGBColor(0x0F, 0x17, 0x2A), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)

sidebar_items = [
    ("📊", "Dashboard", True),
    ("🚚", "Activaties", False),
    ("📋", "Abonnementen", False),
    ("🏢", "Klanten", False),
    ("📡", "Trackers", False),
    ("💳", "SIM-kaarten", False),
    ("🚗", "Voertuigen", False),
    ("📦", "Producten", False),
    ("🧾", "Facturen", False),
    ("👤", "Gebruikers", False),
    ("📜", "Audit Log", False),
    ("⚙️", "Instellingen", False),
]
cur_top = Inches(1.55)
for icon, label, active in sidebar_items:
    if active:
        add_shape(s, Inches(0.5), cur_top, Inches(2.4), Inches(0.38),
                  fill_color=BRAND_SECONDARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, Inches(0.65), cur_top + Inches(0.04), Inches(2.2), Inches(0.3),
             f"{icon}  {label}", font_size=11.5, bold=active,
             color=BRAND_WHITE if active else RGBColor(0xA9, 0xB4, 0xCA))
    cur_top += Inches(0.43)

# Hoofd contentvlak
content_left = Inches(3.2)
content_w = Inches(9.7)

# KPI cards (4 stuks)
kpis = [
    ("42", "Actieve abonnementen", BRAND_PRIMARY),
    ("128", "Trackers op voorraad", BRAND_SECONDARY),
    ("7", "Openstaande activaties", WARNING_AMBER),
    ("€ 12.450", "Maandomzet (MRR)", SUCCESS_GREEN),
]
kpi_w = Inches(2.3)
kpi_gap = Inches(0.1)
kpi_total_w = kpi_w * 4 + kpi_gap * 3
kpi_start = content_left + (content_w - kpi_total_w) / 2

for i, (val, label, color) in enumerate(kpis):
    left = kpi_start + i * (kpi_w + kpi_gap)
    add_shape(s, left, Inches(1.4), kpi_w, Inches(1.3),
              fill_color=BRAND_WHITE, line_color=RGBColor(0xE0, 0xE5, 0xEC),
              line_width=Pt(0.75), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    # Kleurstreepje bovenaan
    add_shape(s, left, Inches(1.4), kpi_w, Inches(0.06), fill_color=color,
              shape_type=MSO_SHAPE.RECTANGLE)
    add_text(s, left, Inches(1.55), kpi_w, Inches(0.6),
             val, font_size=24, bold=True, color=color,
             alignment=PP_ALIGN.CENTER)
    add_text(s, left, Inches(2.15), kpi_w, Inches(0.4),
             label, font_size=10.5, color=TEXT_MUTED,
             alignment=PP_ALIGN.CENTER)

# Recente activaties tabel mock
add_shape(s, content_left, Inches(2.9), content_w, Inches(0.5),
          fill_color=BRAND_PRIMARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, content_left + Inches(0.3), Inches(2.95),
         content_w - Inches(0.6), Inches(0.4),
         "📋 Recente Activaties", font_size=14, bold=True, color=BRAND_WHITE)

# Tabel header
tbl_top = Inches(3.5)
add_shape(s, content_left, tbl_top, content_w, Inches(0.4),
          fill_color=BRAND_LIGHT)
cols_def = [
    ("Order", content_left + Inches(0.3), Inches(1.6)),
    ("Klant", content_left + Inches(1.9), Inches(2.8)),
    ("Tracker", content_left + Inches(4.7), Inches(1.8)),
    ("SIM", content_left + Inches(6.5), Inches(1.5)),
    ("Status", content_left + Inches(8.0), Inches(1.7)),
]
for hdr, left, w in cols_def:
    add_text(s, left, tbl_top + Inches(0.05), w, Inches(0.3),
             hdr, font_size=11, bold=True, color=BRAND_PRIMARY)

# Rijen
sample_rows = [
    ("ACT-2026-00124", "Van der Logistics B.V.", "TRK-00101-ST", "89310...", "COMPLETED", SUCCESS_GREEN),
    ("ACT-2026-00123", "Jansen Transport", "TRK-00098-ST", "89310...", "COMPLETED", SUCCESS_GREEN),
    ("ACT-2026-00122", "FleetCo Holding", "TRK-00095-ST", "89310...", "PROCESSING", WARNING_AMBER),
    ("ACT-2026-00121", "Bakker & Zn", "TRK-00092-ST", "89310...", "READY", BRAND_SECONDARY),
    ("ACT-2026-00120", "De Vries Expeditie", "TRK-00089-ST", "89310...", "FAILED", ERROR_RED),
]
row_top = tbl_top + Inches(0.45)
for order, klant, tracker, sim, status, status_color in sample_rows:
    vals = [order, klant, tracker, sim]
    for i, (_, left, w) in enumerate(cols_def[:4]):
        add_text(s, left, row_top + Inches(0.03), w, Inches(0.3),
                 vals[i], font_size=10.5, color=TEXT_DARK)
    # Status chip
    chip_left = cols_def[4][1]
    add_status_chip(s, chip_left, row_top - Inches(0.02), Inches(1.2), Inches(0.35),
                    status, color=status_color)
    # Scheidingslijn
    add_shape(s, content_left, row_top + Inches(0.36), content_w, Inches(0.01),
              fill_color=RGBColor(0xE5, 0xE7, 0xEB))
    row_top += Inches(0.4)

# CMDK tip
add_shape(s, content_left, Inches(6.15), content_w, Inches(0.6),
          fill_color=RGBColor(0xFD, 0xBA, 0x74),
          shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, content_left + Inches(0.3), Inches(6.22),
         content_w - Inches(0.6), Inches(0.45),
         "⌘ Tip: Gebruik Cmd+K (Mac) of Ctrl+K (Windows) voor bliksemsnel zoeken naar Klant, Tracker, SIM, Abonnement of Order!",
         font_size=13, bold=False, color=BRAND_PRIMARY, anchor=MSO_ANCHOR.MIDDLE)


# ============================================================
# 7. HOOFDMODULES - Klanten & Producten
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 7, TOTAL_PAGES, "Hoofdmodules (1/3)",
                   "Klanten (Customer) & Producten")

# Klanten
add_info_card(s, Inches(0.4), Inches(1.4), Inches(6.2), Inches(3.2),
              "🏢 Klanten (Customers)",
              [
                  "Klantnummer formaat: K-<JJJJ>-NNNNN (bv. K-2026-00001)",
                  "Statussen: PROSPECT → ACTIVE → SUSPENDED → INACTIVE",
                  "Hiërarchie: hoofdklant + sub-klanten (parentCustomerId)",
                  "BTW- en KvK-nummers opgeslagen",
                  "Inserve integratie: inserveCompanyId (optioneel)",
                  "Per klant tabs: Abonnementen, Trackers, SIMs, Voertuigen, Activaties, Geschiedenis",
                  "Soft-delete (deletedAt) – data gaat niet verloren",
              ],
              header_color=BRAND_PRIMARY)

# Producten
add_info_card(s, Inches(6.75), Inches(1.4), Inches(6.2), Inches(3.2),
              "📦 Producten",
              [
                  "Unieke productCode (handmatig te kiezen)",
                  "Maandprijs (€) met 2 decimalen via Decimal(10,2)",
                  "BTW-percentage (standaard 21%)",
                  "Actief/inactief via isActive toggle",
                  "Billing cycles: MONTHLY / QUARTERLY / YEARLY",
                  "Inserve integratie: inserveArticleId (optioneel)",
                  "Wordt gebruikt in abonnementen en activatiewizard",
              ],
              header_color=BRAND_SECONDARY)

# Klant statussen visueel
statuses_cust = [
    ("PROSPECT", WARNING_AMBER),
    ("ACTIVE", SUCCESS_GREEN),
    ("SUSPENDED", BRAND_SECONDARY),
    ("INACTIVE", TEXT_MUTED),
]
status_w = Inches(2.6)
status_total_w = status_w * 4 + Inches(0.2) * 3
status_start = (SW - status_total_w) / 2
status_top = Inches(4.9)
for i, (st, color) in enumerate(statuses_cust):
    left = status_start + i * (status_w + Inches(0.2))
    add_shape(s, left, status_top, status_w, Inches(1.1),
              fill_color=color, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, status_top + Inches(0.35), status_w, Inches(0.45),
             st, font_size=16, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
# Arrow indicators
add_shape(s, Inches(0.5), Inches(6.3), SW - Inches(1), Inches(0.3),
          fill_color=BRAND_LIGHT, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.5), Inches(6.32), SW - Inches(1), Inches(0.28),
         "⬅️ Klant levenscyclus (van links naar rechts)   |   Inactieve klanten en abonnementen blijven zichtbaar in het archief via soft-delete.",
         font_size=11, color=TEXT_MUTED, alignment=PP_ALIGN.CENTER)


# ============================================================
# 8. HOOFDMODULES - Trackers & SIMs
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 8, TOTAL_PAGES, "Hoofdmodules (2/3)",
                   "Trackers (GPS) & SIM-kaarten")

# Trackers
add_info_card(s, Inches(0.4), Inches(1.4), Inches(6.2), Inches(3.6),
              "📡 Trackers (GPS Hardware)",
              [
                  "Tracker ID: TRK-<XXXXXX>-ST (bv. TRK-00001-ST)",
                  "IMEI: 15 cijfers, Luhn-validatie, weergave 4-4-4-3",
                  "Voorbeelden: 4901 5420 3237 518",
                  "Uniek serienummer en IMEI per tracker",
                  "Merk, model, firmwareversie, leverancier",
                  "Status: IN_STOCK, RESERVED, ACTIVE, SUSPENDED, DEFECTIVE, RMA, RETIRED, LOST",
                  "Soft-delete – voorraad blijft traceerbaar",
                  "Auto-normalisatie (streepjes/spaties verwijderd)",
              ],
              header_color=BRAND_PRIMARY)

# SIMs
add_info_card(s, Inches(6.75), Inches(1.4), Inches(6.2), Inches(3.6),
              "💳 SIM-kaarten (M2M/IoT)",
              [
                  "ICCID: 19–20 cijfers, MOET beginnen met 89",
                  "Optioneel: MSISDN (telefoonnummer), IMSI",
                  "Provider en SIM-type opgeslagen",
                  "APN-configuratie per SIM",
                  "Provider activerings- en deactiveringsdatum",
                  "Status: IN_STOCK, RESERVED, ACTIVE, SUSPENDED, BLOCKED, CANCELLED, RETIRED",
                  "Partial unique: 1 SIM kan max. 1 actieve assignment hebben",
              ],
              header_color=BRAND_ACCENT)

# Statussen trackers 4 blokken
s_row_top = Inches(5.2)
tracker_statusses = [
    ("IN_STOCK", BRAND_SECONDARY, "Beschikbaar"),
    ("ACTIVE", SUCCESS_GREEN, "In gebruik"),
    ("DEFECT / RMA", ERROR_RED, "Reparatie"),
    ("RETIRED / LOST", TEXT_MUTED, "Uit omloop"),
]
block_w = Inches(3.05)
gap_b = Inches(0.1)
total_bl = block_w * 4 + gap_b * 3
start_bl = (SW - total_bl) / 2

for i, (lbl, col, sub) in enumerate(tracker_statusses):
    left = start_bl + i * (block_w + gap_b)
    add_shape(s, left, s_row_top, block_w, Inches(1.2),
              fill_color=col, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, s_row_top + Inches(0.2), block_w, Inches(0.5),
             lbl, font_size=14, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    add_text(s, left, s_row_top + Inches(0.72), block_w, Inches(0.4),
             sub, font_size=11, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)


# ============================================================
# 9. HOOFDMODULES - Voertuigen & Abonnementen
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 9, TOTAL_PAGES, "Hoofdmodules (3/3)",
                   "Voertuigen & Abonnementen")

# Voertuigen
add_info_card(s, Inches(0.4), Inches(1.4), Inches(6.2), Inches(5.5),
              "🚗 Voertuigen (Vehicles)",
              [
                  "Altijd gekoppeld aan 1 klant (verplicht)",
                  "Kenteken: optioneel, UNIEK indien ingevuld",
                  "VIN (chassisnummer): 17 tekens, UNIEK indien ingevuld",
                  "Merk en model vrij in te vullen",
                  "Koppeling met trackers via TrackerAssignment",
                  "Per voertuig: historische tracker-koppelingen zichtbaar",
                  "Acties: Nieuwe, Bewerken, Soft-delete",
                  "In de wizard: optioneel toewijzen aan tracker",
              ],
              header_color=BRAND_PRIMARY)

# Abonnementen
add_info_card(s, Inches(6.75), Inches(1.4), Inches(6.2), Inches(5.5),
              "📋 Abonnementen (Subscriptions)",
              [
                  "Nummerformaat: SUB-<JJJJ>-NNNNN (bv. SUB-2026-000001)",
                  "Koppeling: 1 Klant + 1 Product",
                  "Periode: startDate + optioneel endDate",
                  "Maandprijs: afzonderlijk opgeslagen (wijzigbaar per abo)",
                  "Facturatiecyclus: MONTHLY / QUARTERLY / YEARLY",
                  "Status: DRAFT → PENDING_ACTIVATION → ACTIVE → SUSPENDED → CANCELLED / TERMINATED",
                  "Acties: Suspend, Resume, Annuleren, Beëindigen",
                  "Acties: Tracker Vervangen, SIM Vervangen, Ontkoppelen",
              ],
              header_color=BRAND_SECONDARY)

# Abonnementen flow onder
flow_items = ["DRAFT", "PENDING_ACTIVATION", "ACTIVE", "SUSPENDED", "TERMINATED"]
flow_colors = [TEXT_MUTED, WARNING_AMBER, SUCCESS_GREEN, BRAND_SECONDARY, ERROR_RED]
flow_w = Inches(2.35)
flow_gap = Inches(0.15)
flow_total = flow_w * 5 + flow_gap * 4
flow_start = (SW - flow_total) / 2
flow_top = Inches(5.15)
for i, (st, col) in enumerate(zip(flow_items, flow_colors)):
    left = flow_start + i * (flow_w + flow_gap)
    add_shape(s, left, flow_top, flow_w, Inches(0.55),
              fill_color=col, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, flow_top + Inches(0.1), flow_w, Inches(0.35),
             st, font_size=11.5, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    if i < 4:
        add_text(s, left + flow_w - Inches(0.02), flow_top - Inches(0.05),
                 Inches(0.2), Inches(0.65),
                 "➜", font_size=22, bold=True, color=BRAND_ACCENT,
                 alignment=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


# ============================================================
# 10. ACTIVATIE WIZARD
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 10, TOTAL_PAGES, "Activaties: 6-Stappen Wizard",
                   "Transactionele activatie – atomair & veilig")

# 6 stappen als blokken
steps = [
    ("1", "Klant", "Kies of maak hoofd- en subklant", BRAND_PRIMARY),
    ("2", "Product", "Kies abonnementstype en prijs", BRAND_SECONDARY),
    ("3", "Tracker", "Kies beschikbare tracker (IN_STOCK)", BRAND_PRIMARY),
    ("4", "SIM", "Kies SIM-kaart (IN_STOCK)", BRAND_SECONDARY),
    ("5", "Voertuig", "Optioneel: voertuig toekennen", BRAND_PRIMARY),
    ("6", "Controle", "Alles controleren → Activeer nu!", BRAND_ACCENT),
]

step_w = Inches(2.0)
step_gap = Inches(0.1)
step_total = step_w * 6 + step_gap * 5
step_start = (SW - step_total) / 2
step_top = Inches(1.45)

for i, (num, title, sub, color) in enumerate(steps):
    left = step_start + i * (step_w + step_gap)
    # Card
    add_shape(s, left, step_top, step_w, Inches(2.0),
              fill_color=BRAND_WHITE, line_color=RGBColor(0xE0, 0xE5, 0xEC),
              line_width=Pt(0.75), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    # Nummer cirkel
    add_shape(s, left + (step_w - Inches(0.7)) / 2, step_top + Inches(0.15),
              Inches(0.7), Inches(0.7), fill_color=color,
              shape_type=MSO_SHAPE.OVAL)
    add_text(s, left, step_top + Inches(0.22), step_w, Inches(0.6),
             num, font_size=22, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    # Titel
    add_text(s, left, step_top + Inches(0.95), step_w, Inches(0.4),
             title, font_size=15, bold=True, color=BRAND_PRIMARY,
             alignment=PP_ALIGN.CENTER)
    # Sub
    add_text(s, left + Inches(0.1), step_top + Inches(1.3),
             step_w - Inches(0.2), Inches(0.6),
             sub, font_size=10.5, color=TEXT_MUTED,
             alignment=PP_ALIGN.CENTER)
    # Arrow naar volgende
    if i < 5:
        add_text(s, left + step_w - Inches(0.08), step_top + Inches(0.7),
                 Inches(0.26), Inches(0.6),
                 "→", font_size=20, bold=True, color=BRAND_ACCENT,
                 alignment=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

# Order statussen
add_text(s, Inches(0.5), Inches(3.7), Inches(12.3), Inches(0.4),
         "Activatie Order Levenscyclus (DRAFT → COMPLETED):",
         font_size=14, bold=True, color=BRAND_PRIMARY)

order_flow = [
    ("DRAFT", TEXT_MUTED, "Concept"),
    ("READY", BRAND_SECONDARY, "Klaar"),
    ("PROCESSING", WARNING_AMBER, "Bezig"),
    ("COMPLETED", SUCCESS_GREEN, "Succes ✓"),
    ("FAILED", ERROR_RED, "Fout ✗"),
    ("CANCELLED", ERROR_RED, "Geannuleerd"),
]
of_w = Inches(2.0)
of_gap = Inches(0.08)
of_total = of_w * 6 + of_gap * 5
of_start = (SW - of_total) / 2
of_top = Inches(4.15)
for i, (st, col, sub) in enumerate(order_flow):
    left = of_start + i * (of_w + of_gap)
    add_shape(s, left, of_top, of_w, Inches(0.9),
              fill_color=col, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, of_top + Inches(0.1), of_w, Inches(0.4),
             st, font_size=12, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    add_text(s, left, of_top + Inches(0.5), of_w, Inches(0.35),
             sub, font_size=10, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)

# Transactie uitleg
add_shape(s, Inches(0.4), Inches(5.25), Inches(12.55), Inches(1.8),
          fill_color=RGBColor(0xEC, 0xFD, 0xF5), line_color=RGBColor(0xA7, 0xF3, 0xD0),
          line_width=Pt(1), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.7), Inches(5.35), Inches(12), Inches(0.4),
         "🔒 Transactionele 'Activeer nu' – Stap 6 gebeurt atomair in 1 database-transactie:",
         font_size=14, bold=True, color=BRAND_PRIMARY)
add_bullet_list(s, Inches(0.8), Inches(5.8), Inches(11.8), Inches(1.2),
                [
                    "Assert: order is READY + tracker/SIM zijn op voorraad (IN_STOCK)",
                    "Aanmaken Subscription (PENDING_ACTIVATION → ACTIVE)",
                    "Tracker: IN_STOCK → ASSIGNED (met unique partial index: geen dubbele assignments!)",
                    "SIM: IN_STOCK → ASSIGNED, ActivationOrder → COMPLETED met completedAt timestamp",
                ],
                font_size=12, bullet_color=SUCCESS_GREEN, line_spacing=1.2)


# ============================================================
# 11. ABONNEMENTEN BEHEREN
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 11, TOTAL_PAGES, "Abonnementen Beheren",
                   "Wijzigen, schorsen, vervangen van hardware")

# Detailpagina uitleg
add_info_card(s, Inches(0.4), Inches(1.45), Inches(6.2), Inches(2.6),
              "Abonnement – Detailpagina",
              [
                  "Tab 1: Bewerken (gegevens, prijs, periode)",
                  "Tab 2: Tracker (huidig + geschiedenis assignments)",
                  "Tab 3: SIM (huidig + geschiedenis assignments)",
                  "Tab 4: Facturen (genereer, bekijk PDFs)",
                  "Tab 5: Geschiedenis (wijzigingen & audit log)",
              ],
              header_color=BRAND_PRIMARY, icon_char="📄")

# Acties
add_info_card(s, Inches(6.75), Inches(1.45), Inches(6.2), Inches(2.6),
              "Beschikbare Acties",
              [
                  "⏸ Suspend – tijdelijk pauzeren (niet factureren)",
                  "▶️ Resume – hervatten na opschorting",
                  "✖️ Annuleren – per einddatum beeindigen",
                  "🛑 Beëindigen – onmiddellijk stopzetten",
                  "🔄 Tracker Vervangen – RMA of upgrade",
                  "🔄 SIM Vervangen – nieuwe SIM uitgeven",
              ],
              header_color=BRAND_ACCENT, icon_char="⚙️")

# Assignments regels
add_shape(s, Inches(0.4), Inches(4.3), Inches(6.2), Inches(2.75),
          fill_color=BRAND_PRIMARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.6), Inches(4.4), Inches(5.8), Inches(0.5),
         "📋 TrackerAssignment – Regels",
         font_size=16, bold=True, color=BRAND_WHITE)
add_bullet_list(s, Inches(0.7), Inches(4.95), Inches(5.6), Inches(2),
                [
                    "1 tracker tegelijkertijd ACTIEF (partial unique index)",
                    "Redenen: INITIAL / REPLACEMENT / REMOVED / RMA / UPGRADE",
                    "Altijd: startAt timestamp, endAt leeg = actief",
                    "Vervangen = oude endAt zetten + nieuwe INSERT",
                    "Gemaakt door: userId (wie voerde uit)",
                ],
                font_size=12.5, color=BRAND_WHITE,
                bullet_color=BRAND_ACCENT, line_spacing=1.3)

# SIM assignments
add_shape(s, Inches(6.75), Inches(4.3), Inches(6.2), Inches(2.75),
          fill_color=BRAND_SECONDARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(6.95), Inches(4.4), Inches(5.8), Inches(0.5),
         "📋 SimAssignment – Regels",
         font_size=16, bold=True, color=BRAND_WHITE)
add_bullet_list(s, Inches(7.05), Inches(4.95), Inches(5.6), Inches(2),
                [
                    "1 SIM maximaal 1 actieve assignment",
                    "Zelfde reden-codering als trackers",
                    "Koppeling met provider (activeringsdatums)",
                    "Bij vervangen: oude SIM -> CANCELLED of RETIRED",
                    "Audit log: UNASSIGN_SIM + ASSIGN_SIM acties",
                ],
                font_size=12.5, color=BRAND_WHITE,
                bullet_color=BRAND_ACCENT, line_spacing=1.3)


# ============================================================
# 12. FACTURATIE
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 12, TOTAL_PAGES, "Facturatie (Invoices)",
                   "Automatisch genereren, verzenden en bijhouden")

# Factuur generatie proces links
add_info_card(s, Inches(0.4), Inches(1.45), Inches(6.2), Inches(2.8),
              "Maandelijkse Generatie",
              [
                  "Kies jaar + maand (bv. september 2026)",
                  "Selecteert automatisch alle ACTIVE + SUSPENDED abonnementen",
                  "Per abonnement: berekening subtotaal + BTW (21%)",
                  "Periode: 1e t/m laatste dag van de maand",
                  "Issue date = 1e dag, Due date = +14 werkdagen",
                  "Uniek: per abonnement max 1 factuur per periode",
              ],
              header_color=BRAND_PRIMARY, icon_char="🧮")

# Factuur statussen
add_info_card(s, Inches(6.75), Inches(1.45), Inches(6.2), Inches(2.8),
              "Factuur Formaat (Nexus)",
              [
                  "Factuurnummer: automatisch gegenereerd",
                  "Unique: subscriptionId + periodStart + periodEnd",
                  "Velden: Subtotaal, BTW%, BTW-bedrag, Totaal",
                  "Munteenheid: EUR (€) – Decimal(10,2) precisie",
                  "Gekoppeld aan: 1 Klant + 1 Abonnement",
                  "Factuurdata: issueDate + dueDate (14 dagen netto)",
              ],
              header_color=BRAND_SECONDARY, icon_char="💶")

# Statusflow facturen
add_text(s, Inches(0.5), Inches(4.5), Inches(12.3), Inches(0.45),
         "Factuur Lifecycle (DRAFT → SENT → PAID):",
         font_size=15, bold=True, color=BRAND_PRIMARY)

invoice_flow = [
    ("DRAFT", TEXT_MUTED, "Concept"),
    ("SENT", BRAND_SECONDARY, "Verzonden"),
    ("PAID", SUCCESS_GREEN, "Betaald ✓"),
    ("OVERDUE", WARNING_AMBER, "Te laat ⚠"),
    ("CANCELLED", ERROR_RED, "Geannuleerd"),
]
if_w = Inches(2.4)
if_gap = Inches(0.1)
if_total = if_w * 5 + if_gap * 4
if_start = (SW - if_total) / 2
if_top = Inches(5.05)
for i, (st, col, sub) in enumerate(invoice_flow):
    left = if_start + i * (if_w + if_gap)
    add_shape(s, left, if_top, if_w, Inches(0.95),
              fill_color=col, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, if_top + Inches(0.1), if_w, Inches(0.4),
             st, font_size=14, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    add_text(s, left, if_top + Inches(0.5), if_w, Inches(0.4),
             sub, font_size=11, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    if i < 4:
        add_text(s, left + if_w - Inches(0.05), if_top + Inches(0.2),
                 Inches(0.2), Inches(0.55),
                 "→", font_size=18, bold=True, color=BRAND_ACCENT,
                 anchor=MSO_ANCHOR.MIDDLE)

# Resultaat voorbeeld
add_shape(s, Inches(0.5), Inches(6.25), Inches(12.35), Inches(0.6),
          fill_color=RGBColor(0xEC, 0xFD, 0xF5),
          shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.7), Inches(6.3), Inches(12), Inches(0.5),
         "✅ Resultaat weergave na generatie:  238 in scope  •  235 aangemaakt  •  3 overgeslagen (reeds bestaand)  •  0 fouten",
         font_size=12, bold=False, color=BRAND_PRIMARY, anchor=MSO_ANCHOR.MIDDLE)


# ============================================================
# 13. CSV IMPORT & EXPORT
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 13, TOTAL_PAGES, "CSV Import & Export",
                   "Data bulksgewijs in- en uitvoeren (Excel-compatibel)")

# Export
add_info_card(s, Inches(0.4), Inches(1.45), Inches(6.2), Inches(2.6),
              "📤 CSV Export",
              [
                  "Beschikbaar voor: Klanten, Trackers, SIMs, Voertuigen, Abonnementen, Activaties, Facturen, AuditLog",
                  "UTF-8 BOM + CRLF regeleindes (Excel 100% compatibel)",
                  "RFC 4180 compliant: quotes, escapes, trailing CRLF",
                  "Datums: expliciet toISOString() – machineleesbaar",
                  "Bestandsnaam: entiteit-YYYYMMDD-HHMM.csv",
              ],
              header_color=BRAND_PRIMARY)

# Import
add_info_card(s, Inches(6.75), Inches(1.45), Inches(6.2), Inches(2.6),
              "📥 CSV Import",
              [
                  "Beschikbaar voor: Klanten, Trackers, SIM-kaarten",
                  "3-staps flow: Upload → Preview (aliasing) → Toepassen",
                  "Stap 1: CSV uploaden + kolom-aliasing (Excel kolommen mappen)",
                  "Stap 2: Preview met statistieken: Totaal / Geldig / Fouten",
                  "Stap 3: Per-rij foutrapportage (regel + foutomschrijving)",
              ],
              header_color=BRAND_ACCENT)

# Import preview visualisatie
add_shape(s, Inches(0.4), Inches(4.3), Inches(12.55), Inches(2.7),
          fill_color=BRAND_LIGHT, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)

add_text(s, Inches(0.6), Inches(4.4), Inches(12), Inches(0.4),
         "📋 Import Preview – voorbeeldscherm (trackers):",
         font_size=14, bold=True, color=BRAND_PRIMARY)

# Stats 4 blokjes
stats = [
    ("Totaal", "124", BRAND_PRIMARY),
    ("Geldig", "119", SUCCESS_GREEN),
    ("Fouten", "5", ERROR_RED),
    ("Wordt ingevoegd", "119", BRAND_SECONDARY),
]
stat_w = Inches(2.5)
stat_gap = Inches(0.15)
stat_tot = stat_w * 4 + stat_gap * 3
stat_start = (SW - stat_tot) / 2
stat_top = Inches(4.95)
for i, (lbl, val, col) in enumerate(stats):
    left = stat_start + i * (stat_w + stat_gap)
    add_shape(s, left, stat_top, stat_w, Inches(0.8),
              fill_color=col, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left, stat_top + Inches(0.05), stat_w, Inches(0.4),
             lbl, font_size=11, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    add_text(s, left, stat_top + Inches(0.38), stat_w, Inches(0.4),
             val, font_size=20, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)

# Foutvoorbeelden
fouten_top = Inches(5.95)
add_text(s, Inches(0.6), fouten_top, Inches(5), Inches(0.35),
         "⚠  Voorbeeld per-rij foutrapportage:",
         font_size=12, bold=True, color=ERROR_RED)

fouten = [
    "Regel 17: IMEI '49015420323751' ongeldig – moet 15 cijfers zijn",
    "Regel 29: ICCID '49883...' ongeldig – moet beginnen met 89",
    "Regel 42: Merk is verplicht (mag niet leeg zijn)",
    "Regel 67: serialNumber 'TRK-00042-ST' bestaat al (duplicaat)",
    "Regel 103: firmwareVersion heeft ongeldige tekens",
]
add_bullet_list(s, Inches(0.7), fouten_top + Inches(0.35),
                Inches(12), Inches(1.0),
                fouten, font_size=11, bullet_color=ERROR_RED,
                line_spacing=1.15)


# ============================================================
# 14. AUDIT LOG
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 14, TOTAL_PAGES, "Audit Log & Traceerbaarheid",
                   "Elke wijziging automatisch vastgelegd – inclusief diff")

# Hoe werkt het?
add_info_card(s, Inches(0.4), Inches(1.45), Inches(6.2), Inches(2.8),
              "🔍 Hoe werkt de Audit Log?",
              [
                  "Automatisch per service-call (geen handmatig loggen)",
                  "Via includeDetail() + logAudit() pattern in services",
                  "Oude waarden (oldValues) + Nieuwe waarden (newValues) als JSON",
                  "Diff-weergave: precies wat is gewijzigd per rij",
                  "Wie (userId) • Wanneer (timestamp) • Wat (entity, action)",
                  "Globaal overzicht + per-entiteit Geschiedenis-tab",
              ],
              header_color=BRAND_PRIMARY)

# Acties die gelogd worden
add_info_card(s, Inches(6.75), Inches(1.45), Inches(6.2), Inches(2.8),
              "📋 Geregistreerde Acties (AuditAction)",
              [
                  "CREATE / UPDATE / DELETE – standaard CRUD",
                  "ACTIVATE / SUSPEND / RESUME – abonnement statussen",
                  "CANCEL / TERMINATE – beeindigen abonnementen",
                  "ASSIGN_TRACKER / UNASSIGN_TRACKER – hardware",
                  "ASSIGN_SIM / UNASSIGN_SIM – sims",
                  "REPLACE_TRACKER / REPLACE_SIM – vervangingen",
                  "COMPLETE_ACTIVATION / FAIL_ACTIVATION – wizard",
                  "INSERVE_SYNCED / INSERVE_SYNC_FAILED – integratie",
              ],
              header_color=BRAND_ACCENT)

# Mock audit log tabel
tabel_top = Inches(4.5)
add_shape(s, Inches(0.4), tabel_top, Inches(12.55), Inches(0.5),
          fill_color=BRAND_PRIMARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.6), tabel_top + Inches(0.08), Inches(12), Inches(0.35),
         "🗂 Voorbeeld: Recente Audit Log regels",
         font_size=14, bold=True, color=BRAND_WHITE)

# Tabel header
hdr_top = tabel_top + Inches(0.6)
add_shape(s, Inches(0.4), hdr_top, Inches(12.55), Inches(0.4), fill_color=BRAND_LIGHT)
hdr_cols = [
    ("Tijdstip", Inches(0.6), Inches(1.8)),
    ("Gebruiker", Inches(2.4), Inches(1.8)),
    ("Actie", Inches(4.2), Inches(2.2)),
    ("Entiteit", Inches(6.4), Inches(2.2)),
    ("Details (Diff)", Inches(8.6), Inches(4.2)),
]
for hdr, left, w in hdr_cols:
    add_text(s, left, hdr_top + Inches(0.06), w, Inches(0.3),
             hdr, font_size=11, bold=True, color=BRAND_PRIMARY)

# Rijen
rows = [
    ("17-09 14:23", "admin@nexus", "UPDATE", "Klant (K-2026-00012)",
     "companyName: 'Van der Logistiek' → 'Van der Logistics B.V.'",
     BRAND_SECONDARY),
    ("17-09 13:45", "medewerker@nexus", "CREATE", "Tracker (TRK-00102-ST)",
     "Nieuwe tracker: imei=490154203237518, status=IN_STOCK",
     SUCCESS_GREEN),
    ("17-09 11:12", "admin@nexus", "COMPLETE_ACTIVATION", "ACT-2026-00124",
     "Status: PROCESSING → COMPLETED, abonnement=SUB-2026-000031",
     SUCCESS_GREEN),
    ("17-09 10:02", "medewerker@nexus", "ASSIGN_SIM", "SIM (89310...)",
     "Abonnement SUB-2026-000030, reden=INITIAL",
     BRAND_ACCENT),
]
row_t = hdr_top + Inches(0.45)
for tijd, user, actie, entiteit, diff, col in rows:
    vals = [tijd, user, actie, entiteit, diff]
    for i, (_, left, w) in enumerate(hdr_cols):
        if i == 2:
            add_status_chip(s, left, row_t - Inches(0.02), Inches(1.8), Inches(0.3),
                            vals[i], color=col)
        else:
            add_text(s, left, row_t + Inches(0.02), w, Inches(0.3),
                     vals[i], font_size=10.5, color=TEXT_DARK)
    add_shape(s, Inches(0.4), row_t + Inches(0.35), Inches(12.55), Inches(0.01),
              fill_color=RGBColor(0xE5, 0xE7, 0xEB))
    row_t += Inches(0.4)


# ============================================================
# 15. VALIDATIE REGELS
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 15, TOTAL_PAGES, "Validatieregels & Identifiers",
                   "Hoe Nexus data-kwaliteit bewaakt (Zod + Luhn + normalisatie)")

# IMEI
add_info_card(s, Inches(0.4), Inches(1.45), Inches(4.0), Inches(2.8),
              "📱 IMEI Validatie",
              [
                  "Lengte: PRECIES 15 cijfers",
                  "Luhn-10 algoritme (check digit)",
                  "Weergave 4-4-4-3: bv. 4901 5420 3237 518",
                  "In DB: zonder opmaak (15 tekens)",
                  "Normalisatie: spaties/streepjes gestript",
              ],
              header_color=BRAND_PRIMARY)

# ICCID
add_info_card(s, Inches(4.65), Inches(1.45), Inches(4.0), Inches(2.8),
              "💳 ICCID Validatie",
              [
                  "Lengte: 19 of 20 cijfers",
                  "MOET beginnen met '89' (standaard)",
                  "In DB: zonder opmaak opgeslagen",
                  "MSISDN (telefoonnr): optioneel UNIEK",
                  "Auto-normalisatie (streepjes/spaties)",
              ],
              header_color=BRAND_ACCENT)

# Identifiers
add_info_card(s, Inches(8.9), Inches(1.45), Inches(4.0), Inches(2.8),
              "🔢 Nummerreeksen (Identifiers)",
              [
                  "Klant:   K-<JJJJ>-NNNNN",
                  "Abonnement:   SUB-<JJJJ>-NNNNN",
                  "Activatie:   ACT-<JJJJ>-NNNNN",
                  "Tracker:   TRK-<NNNNN>-ST",
                  "Factuur:   automatisch (oplopend)",
              ],
              header_color=BRAND_SECONDARY)

# Waarom normalisatie?
add_shape(s, Inches(0.4), Inches(4.5), Inches(12.55), Inches(0.55),
          fill_color=RGBColor(0xFD, 0xBA, 0x74),
          shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.7), Inches(4.57), Inches(12), Inches(0.45),
         "⚙️ Normalisatie via Z.preprocess – de gebruiker typt wat hij wil, Nexus zorgt voor correct formaat:",
         font_size=14, bold=True, color=BRAND_PRIMARY, anchor=MSO_ANCHOR.MIDDLE)

# Voorbeelden normalisatie
examples = [
    ("Gebruikersinvoer", "Gevalideerd & Opgeslagen"),
    ("4901-5420-3237-518", "490154203237518"),
    ("4901 5420 3237 518  ", "490154203237518"),
    ("89-310-4201234567890", "893104201234567890"),
    ("   K-2026 - 00012  ", "K-2026-00012"),
    ("  TRK 00042 / ST   ", "TRK-00042-ST"),
]

tabel_left = Inches(1.8)
col1_w = Inches(5.0)
col2_w = Inches(5.0)
tabel_w = col1_w + col2_w
tbl_top = Inches(5.25)

for i, (c1, c2) in enumerate(examples):
    row_top = tbl_top + i * Inches(0.36)
    is_header = (i == 0)
    # Rij achtergrond
    if is_header:
        add_shape(s, tabel_left, row_top, tabel_w, Inches(0.38), fill_color=BRAND_PRIMARY)
        color = BRAND_WHITE
        bold = True
    else:
        if i % 2 == 0:
            add_shape(s, tabel_left, row_top, tabel_w, Inches(0.34), fill_color=BRAND_LIGHT)
        color = TEXT_DARK if not is_header else BRAND_WHITE
        bold = is_header
    add_text(s, tabel_left + Inches(0.3), row_top + Inches(0.03),
             col1_w - Inches(0.5), Inches(0.3),
             c1, font_size=12, color=color, bold=bold)
    add_text(s, tabel_left + col1_w + Inches(0.3), row_top + Inches(0.03),
             col2_w - Inches(0.5), Inches(0.3),
             c2, font_size=12, color=color if not is_header else BRAND_WHITE,
             bold=bold)


# ============================================================
# 16. BEVEILIGING
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 16, TOTAL_PAGES, "Beveiliging & Data-bescherming",
                   "Auth, wachtwoorden, rechten en soft-delete")

# Auth
add_info_card(s, Inches(0.4), Inches(1.45), Inches(4.0), Inches(3.0),
              "🔐 Authenticatie (Auth.js V5)",
              [
                  "E-mail + Wachtwoord (Credentials)",
                  "Wachtwoorden: bcrypt cost-factor=12",
                  "Sessie-cookie: HttpOnly, Secure, SameSite",
                  "AUTH_SECRET: 32+ bytes (openssl rand)",
                  "Nieuwe gebruikers: uitnodiging door ADMIN",
              ],
              header_color=BRAND_PRIMARY)

# RBAC
add_info_card(s, Inches(4.65), Inches(1.45), Inches(4.0), Inches(3.0),
              "🛡 Role-Based Access Control",
              [
                  "3 Rollen: ADMIN / EMPLOYEE / VIEWER",
                  "withAuth() wrapper op elke Server Action",
                  "requirePermission() expliciet per actie",
                  "403 PermissionError + Forbidden pagina",
                  "Frontend UI: knoppen verborgen waar nodig",
              ],
              header_color=BRAND_SECONDARY)

# Deployment security
add_info_card(s, Inches(8.9), Inches(1.45), Inches(4.0), Inches(3.0),
              "🚀 Deployment Beveiliging",
              [
                  "Docker containers: non-root user 'nextjs'",
                  "Caddy: HTTPS (Let's Encrypt auto)",
                  "Security headers (HSTS, X-Frame-Options)",
                  "Database: NIET publiek toegankelijk",
                  "App-DB communicatie binnen Docker netwerk",
              ],
              header_color=BRAND_ACCENT)

# Soft delete
add_shape(s, Inches(0.4), Inches(4.7), Inches(6.2), Inches(2.3),
          fill_color=RGBColor(0xEC, 0xFD, 0xF5),
          line_color=RGBColor(0xA7, 0xF3, 0xD0), line_width=Pt(1),
          shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.6), Inches(4.8), Inches(5.8), Inches(0.45),
         "♻️ Soft-Delete – Data gaat NOOIT verloren",
         font_size=16, bold=True, color=BRAND_PRIMARY)
add_bullet_list(s, Inches(0.7), Inches(5.3), Inches(5.6), Inches(1.6),
                [
                    "deletedAt DateTime? veld op alle entiteiten (behalve Producten: isActive)",
                    "Standaard queries: WHERE deletedAt IS NULL",
                    "Audit log registreert DELETE actie met userId",
                    "Herstel mogelijk via database (geen UI, bewust)",
                ],
                font_size=12, bullet_color=SUCCESS_GREEN, line_spacing=1.25)

# Middleware
add_shape(s, Inches(6.75), Inches(4.7), Inches(6.2), Inches(2.3),
          fill_color=RGBColor(0xE0, 0xE7, 0xFF),
          line_color=RGBColor(0x81, 0x8C, 0xF2), line_width=Pt(1),
          shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(6.95), Inches(4.8), Inches(5.8), Inches(0.45),
         "🧱 Middleware & Server Actions",
         font_size=16, bold=True, color=BRAND_PRIMARY)
add_bullet_list(s, Inches(7.05), Inches(5.3), Inches(5.6), Inches(1.6),
                [
                    "Next.js Middleware checkt sessie op alle /(app) routes",
                    "Ongeauthentiseerd → redirect naar /login",
                    "Server Actions = backend-code: NOOIT in client bundle",
                    "Geen anonieme toegang tot data (geen publieke API)",
                ],
                font_size=12, bullet_color=BRAND_SECONDARY, line_spacing=1.25)


# ============================================================
# 17. INTEGRATIE INSERVE
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 17, TOTAL_PAGES, "Inserve Integratie",
                   "Optionele koppeling met Inserve (telecom/MDM platform)")

# Wat is Inserve?
add_info_card(s, Inches(0.4), Inches(1.45), Inches(6.2), Inches(2.6),
              "ℹ️ Wat is Inserve?",
              [
                  "Extern telecom/M2M platform voor SIM-management",
                  "Leverancier van M2M SIM-kaarten en activeringen",
                  "Nexus synchroniseert abonnementen 1-richting naar Inserve",
                  "Optioneel: uit te zetten per abonnement (status PENDING/IN_PROGRESS/SYNCED/FAILED)",
              ],
              header_color=BRAND_PRIMARY)

# Sync statussen
add_info_card(s, Inches(6.75), Inches(1.45), Inches(6.2), Inches(2.6),
              "🔄 Sync Statussen (per abonnement)",
              [
                  "PENDING: Nieuw abonnement – nog niet gesynchroniseerd",
                  "IN_PROGRESS: Sync wordt nu uitgevoerd",
                  "SYNCED: Succesvol – Abonnement bekend in Inserve",
                  "FAILED: Fout – foutmelding opgeslagen in inserveSyncError",
                  "SKIPPED: Handmatig overgeslagen (geen actie nodig)",
              ],
              header_color=BRAND_SECONDARY)

# Wat wordt gesynchroniseerd?
add_shape(s, Inches(0.4), Inches(4.3), Inches(12.55), Inches(0.55),
          fill_color=BRAND_PRIMARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.7), Inches(4.37), Inches(12), Inches(0.45),
         "⬇️  Velden die per abonnement naar Inserve worden gestuurd:",
         font_size=14, bold=True, color=BRAND_WHITE, anchor=MSO_ANCHOR.MIDDLE)

fields = [
    ("🏢 Klant", "CompanyId (Inserve) / Klantgegevens"),
    ("📋 Abonnement", "Abonnement ID (inserveSubscriptionId)"),
    ("📦 Product", "ArticleId (Inserve) / Productcode"),
    ("📅 Periode", "Startdatum + einddatum abonnement"),
    ("💳 SIM", "ICCID + MSISDN bij wijzigingen"),
    ("💶 Prijs", "Maandprijs (pro rata bij wijzigingen)"),
]
fld_w = Inches(4.0)
fld_gap = Inches(0.2)
fld_top = Inches(5.1)
fld_cols_start = [
    (SW - (fld_w * 3 + fld_gap * 2)) / 2,
    (SW - (fld_w * 3 + fld_gap * 2)) / 2 + fld_w + fld_gap,
    (SW - (fld_w * 3 + fld_gap * 2)) / 2 + (fld_w + fld_gap) * 2,
]
for idx, (label, value) in enumerate(fields):
    col = idx // 2
    row = idx % 2
    left = fld_cols_start[col]
    top = fld_top + row * Inches(1.0)
    add_shape(s, left, top, fld_w, Inches(0.85),
              fill_color=BRAND_LIGHT, line_color=RGBColor(0xE0, 0xE5, 0xEC),
              line_width=Pt(0.75), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left + Inches(0.25), top + Inches(0.08), fld_w - Inches(0.5), Inches(0.35),
             label, font_size=13, bold=True, color=BRAND_PRIMARY)
    add_text(s, left + Inches(0.25), top + Inches(0.45), fld_w - Inches(0.5), Inches(0.35),
             value, font_size=11, color=TEXT_MUTED)


# ============================================================
# 18. ZOEKFUNCTIE CMD+K
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 18, TOTAL_PAGES, "Snelzoeken: ⌘K / Ctrl+K",
                   "Bliksemsnel naar elke entiteit – overal in de app")

# Groot zoekvenster mock
add_shape(s, Inches(1.5), Inches(1.45), Inches(10.3), Inches(0.9),
          fill_color=BRAND_PRIMARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(1.8), Inches(1.58), Inches(9.5), Inches(0.6),
         "🔍  Zoek naar klant, tracker, SIM, abonnement of order...",
         font_size=16, bold=False, color=RGBColor(0xC7, 0xD2, 0xFE))

# Resultaten mock
res_top = Inches(2.5)
add_shape(s, Inches(1.5), res_top, Inches(10.3), Inches(4.6),
          fill_color=BRAND_WHITE,
          line_color=RGBColor(0xE0, 0xE5, 0xEC), line_width=Pt(1),
          shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)

results = [
    ("🏢", "Van der Logistics B.V.", "Klant • K-2026-00012 • KvK 34235235", BRAND_PRIMARY, True),
    ("🚚", "ACT-2026-00124 – Van der Logistics", "ActivatieOrder • COMPLETED 17-09-2026", BRAND_ACCENT, False),
    ("📋", "SUB-2026-000031 – Premium Fleet", "Abonnement • ACTIVE • € 39,95/mnd", SUCCESS_GREEN, False),
    ("📡", "TRK-00101-ST – Teltonika FMB920", "Tracker • IMEI 4901 5420 3237 518", BRAND_SECONDARY, False),
    ("💳", "SIM 89310 420 123456789", "SIM-kaart • KPN M2M • ACTIVE", BRAND_ACCENT, False),
]
r_top = res_top + Inches(0.2)
for i, (icon, title, sub, col, first) in enumerate(results):
    left = Inches(1.7)
    width = Inches(9.9)
    top = r_top + i * Inches(0.82)
    if first:
        add_shape(s, left, top, width, Inches(0.72),
                  fill_color=RGBColor(0xE0, 0xF2, 0xFE),
                  shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left + Inches(0.25), top + Inches(0.05), Inches(0.7), Inches(0.55),
             icon, font_size=24, alignment=PP_ALIGN.CENTER,
             anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, left + Inches(1.0), top + Inches(0.05), Inches(8), Inches(0.35),
             title, font_size=13, bold=True, color=col if first else TEXT_DARK)
    add_text(s, left + Inches(1.0), top + Inches(0.38), Inches(8), Inches(0.3),
             sub, font_size=10.5, color=TEXT_MUTED)

# Shortcuts
add_shape(s, Inches(0.4), Inches(6.0), Inches(6.2), Inches(1.0),
          fill_color=BRAND_LIGHT, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(0.65), Inches(6.07), Inches(5.8), Inches(0.35),
         "⌨️  Handige sneltoetsen:",
         font_size=13, bold=True, color=BRAND_PRIMARY)
add_bullet_list(s, Inches(0.8), Inches(6.4), Inches(5.6), Inches(0.55),
                [
                    "⌘K of Ctrl+K: Open zoekvenster (overal)",
                    "↑ ↓ pijltjestoetsen: Navigeer resultaten",
                    "Enter: Spring naar geselecteerd item",
                ],
                font_size=11, bullet_color=BRAND_ACCENT, line_spacing=1.15)

# Waar te gebruiken
add_shape(s, Inches(6.75), Inches(6.0), Inches(6.2), Inches(1.0),
          fill_color=RGBColor(0xFF, 0xED, 0xD5), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, Inches(7.0), Inches(6.07), Inches(5.8), Inches(0.35),
         "💡 Gebruik zoekfunctie als je weet wat je zoekt:",
         font_size=13, bold=True, color=BRAND_PRIMARY)
add_bullet_list(s, Inches(7.15), Inches(6.4), Inches(5.6), Inches(0.55),
                [
                    "Klantnummer, IMEI, ICCID, ordernummer direct intikken",
                    "Geen 8 klikken nodig via menu's – direct naar detail",
                    "1 resultaat = direct doorgestuurd (geen tussenstap)",
                ],
                font_size=11, bullet_color=BRAND_ACCENT, line_spacing=1.15)


# ============================================================
# 19. EERSTE STAPPEN
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 19, TOTAL_PAGES, "Eerste Stappen – Aan de Slag!",
                   "Volg dit stappenplan om je eerste activatie te doen")

# 6 stappen
stappen = [
    ("STAP 1", "Inloggen",
     "Gebruik je e-mail + wachtwoord. \nTestaccounts (demo): admin@nexus.local, medewerker@nexus.local, viewer@nexus.local • Wachtwoord: Test1234!",
     BRAND_PRIMARY),
    ("STAP 2", "Bekijk Dashboard",
     "Overzicht van actieve abo's, voorraad en openstaande activaties. \nLeer de zijbalk kennen en probeer ⌘K/Ctrl+K snelzoeken.",
     BRAND_SECONDARY),
    ("STAP 3", "Klanten aanmaken",
     "Maak een testklant aan via Klanten → Nieuw. \nVul bedrijfnaam, adres, KvK/BTW en evt. subklanten voor hiërarchie.",
     BRAND_ACCENT),
    ("STAP 4", "Voorraad opzetten",
     "Trackers/SIMs toevoegen: handmatig of via CSV Import. \nControleer IMEI/ICCID via preview – alleen VALIDE rijen worden ingevoegd.",
     SUCCESS_GREEN),
    ("STAP 5", "Activeer via Wizard",
     "Activaties → Nieuwe activatie → 6 stappen doorlopen. \nStap 6 = Controle → Klik op 'Activeer nu' (transactioneel, atomair).",
     WARNING_AMBER),
    ("STAP 6", "Facturen genereren",
     "Facturen → Genereer facturen → Kies maand. \nControleer DRAFT facturen → Zet op SENT om te 'verzenden' → Markeer als PAID.",
     ERROR_RED),
]

stap_w = Inches(4.1)
stap_gap = Inches(0.2)
stap_total_w = stap_w * 3 + stap_gap * 2
stap_start_left = (SW - stap_total_w) / 2

for idx, (stap, titel, desc, kleur) in enumerate(stappen):
    col = idx % 3
    row = idx // 3
    left = stap_start_left + col * (stap_w + stap_gap)
    top = Inches(1.45) + row * Inches(3.0)
    # Card
    add_shape(s, left, top, stap_w, Inches(2.75),
              fill_color=BRAND_WHITE, line_color=RGBColor(0xE0, 0xE5, 0xEC),
              line_width=Pt(0.75), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    # Header
    add_shape(s, left + Inches(0.1), top + Inches(0.1),
              stap_w - Inches(0.2), Inches(0.7),
              fill_color=kleur, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left + Inches(0.2), top + Inches(0.15), Inches(1.8), Inches(0.3),
             stap, font_size=11, bold=True, color=RGBColor(0xF0, 0xF0, 0xF0))
    add_text(s, left + Inches(0.2), top + Inches(0.38), stap_w - Inches(0.4), Inches(0.35),
             titel, font_size=17, bold=True, color=BRAND_WHITE)
    # Body
    add_text(s, left + Inches(0.25), top + Inches(0.95),
             stap_w - Inches(0.5), Inches(1.7),
             desc, font_size=11.5, color=TEXT_DARK, line_spacing=1.35)


# ============================================================
# 20. TIPS & BEST PRACTICES
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 20, TOTAL_PAGES, "Tips & Best Practices",
                   "Slim werken met Nexus – hierop letten")

# 3 kolommen tips
tips_cols = [
    ("Data Invoer", BRAND_PRIMARY, [
        "Gebruik CSV Import voor grote partijen trackers/SIMs",
        "Controleer ALTIJD de preview bij import (fouten eerst oplossen)",
        "Bij weinig data: handmatig aanmaken is sneller",
        "Kopieer IMEI/ICCID zonder streepjes – normalisatie doet de rest",
        "Identifiers: NIET zelf bedenken – Nexus genereert ze!",
    ]),
    ("Facturatie", BRAND_SECONDARY, [
        "Genereer facturen altijd op de 1e van de maand",
        "Check 'Overgeslagen' – bestaan al facturen voor deze periode?",
        "Alleen DRAFT facturen zijn nog te bewerken",
        "Markeer PAID zodra betaling binnen is (audit!),",
        "OVERDUE = automatische提醒; bekijk lijk wekelijks",
    ]),
    ("Abonnementen", BRAND_ACCENT, [
        "Gebruik SUSPEND (niet CANCEL) bij tijdelijke pauze",
        "Tracker/SIM vervangen = wizard REPLACEMENT reden",
        "RMA = markeer DEFECT, voeg nieuwe tracker toe via vervangen",
        "Bij Beeindigen (TERMINATE): hardware gaat terug naar voorraad",
        "Wijzig prijzen alleen als er wijzigingsovereenkomst is!",
    ]),
]

tcol_w = Inches(4.15)
tcol_gap = Inches(0.2)
tcol_total = tcol_w * 3 + tcol_gap * 2
tcol_start = (SW - tcol_total) / 2

for i, (titel, kleur, items) in enumerate(tips_cols):
    left = tcol_start + i * (tcol_w + tcol_gap)
    add_shape(s, left, Inches(1.4), tcol_w, Inches(5.6),
              fill_color=BRAND_WHITE, line_color=RGBColor(0xE0, 0xE5, 0xEC),
              line_width=Pt(0.75), shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_shape(s, left + Inches(0.1), Inches(1.5),
              tcol_w - Inches(0.2), Inches(0.65),
              fill_color=kleur, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, left + Inches(0.1), Inches(1.57), tcol_w - Inches(0.2), Inches(0.5),
             f"💡 {titel}", font_size=16, bold=True, color=BRAND_WHITE,
             alignment=PP_ALIGN.CENTER)
    add_bullet_list(s, left + Inches(0.3), Inches(2.3),
                    tcol_w - Inches(0.6), Inches(4.5),
                    items, font_size=12, bullet_color=kleur,
                    line_spacing=1.3)


# ============================================================
# 21. FAQ
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s)
add_two_col_header(s, 21, TOTAL_PAGES, "Veelgestelde Vragen (FAQ)",
                   "Antwoorden op de meest voorkomende vragen")

faqs = [
    ("Q1: Wat gebeurt er als een activatie halverwege faalt?",
     "Alle stappen in de wizard stap 6 ('Activeer nu') draaien in 1 database-transactie. Gaat 1 stap fout (bv. SIM niet op voorraad), dan wordt de HELLE transactie gerollback – dus geen half werk, geen abonnement zonder tracker, etc. De order blijft staan op FAILED met de foutreden, herstel en probeer opnieuw."),
    ("Q2: Kan ik per ongeluk een factuur 2x genereren?",
     "Nee. Op invoices zit een UNIQUE-constraint op (subscriptionId, periodStart, periodEnd). Per abonnement per periode kan maximaal 1 factuur bestaan. Bij opnieuw genereren zie je 'skipped = aantal dat al bestond' in het resultaat."),
    ("Q3: Wat als ik een tracker of SIM kwijtraak?",
     "Markeer de tracker als LOST of de SIM als RETIRED. Gebruik daarna 'Vervang Tracker' of 'Vervang SIM' op het abonnement om een nieuwe toe te wijzen. De audit log houdt precies bij wie wat wanneer heeft gewijzigd (met reden REPLACEMENT of RMA)."),
    ("Q4: Waarom kan ik niet gewoon hard-deleten?",
     "Nexus gebruikt soft-delete (deletedAt) voor bijna alle entiteiten. Dit is bewust: voor de audit trail (wie deed wat), voor facturen die verwijzen naar oude data, en voor wettelijke bewaarplicht. Data terugzetten doe je via DB (geen UI – bewust)."),
    ("Q5: Hoe kan ik CSV bestanden voorbereiden in Excel?",
     "Gebruik de kolomnamen uit de import-preview (laat Nexus je aliassen). Sla Excel op als 'CSV (door komma's gescheiden)' – let op: UTF-8! Controleer in de preview-stap: alleen rijen zonder fouten (GROEN vinkje) worden ingevoegd. Fouten? Pas CSV aan en probeer opnieuw."),
]

faq_top = Inches(1.4)
for idx, (vraag, antwoord) in enumerate(faqs):
    top = faq_top + idx * Inches(1.15)
    # Vraag card
    add_shape(s, Inches(0.4), top, Inches(12.55), Inches(0.42),
              fill_color=BRAND_PRIMARY, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, Inches(0.6), top + Inches(0.04), Inches(12), Inches(0.35),
             vraag, font_size=12.5, bold=True, color=BRAND_WHITE)
    # Antwoord
    add_shape(s, Inches(0.55), top + Inches(0.42), Inches(12.25), Inches(0.68),
              fill_color=BRAND_LIGHT, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(s, Inches(0.8), top + Inches(0.47), Inches(11.8), Inches(0.6),
             antwoord, font_size=11, color=TEXT_DARK, line_spacing=1.25)


# ============================================================
# 22. SLOTDIA
# ============================================================
s = prs.slides.add_slide(prs.slide_layouts[6])
add_background(s, BRAND_PRIMARY)

# Oranje accent
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

add_text(s, SW - Inches(9), Inches(2.2), Inches(8.5), Inches(1),
         "Bedankt!", font_size=60, bold=True, color=BRAND_WHITE,
         alignment=PP_ALIGN.RIGHT)

add_text(s, SW - Inches(9), Inches(3.4), Inches(8.5), Inches(0.7),
         "Voor vragen, opmerkingen of support:",
         font_size=20, bold=False, color=RGBColor(0xBF, 0xDB, 0xFE),
         alignment=PP_ALIGN.RIGHT)

# Contact card
card_l = SW - Inches(8.2)
card_w = Inches(7.8)
add_shape(s, card_l, Inches(4.3), card_w, Inches(2.3),
          fill_color=BRAND_WHITE, shape_type=MSO_SHAPE.ROUNDED_RECTANGLE)
add_text(s, card_l, Inches(4.45), card_w, Inches(0.4),
         "📬  Contact & Bronnen", font_size=17, bold=True,
         color=BRAND_PRIMARY, alignment=PP_ALIGN.CENTER)

contacts = [
    ("📘", "Documentatie", "README.md • docs/ folder"),
    ("🧪", "Demo Data", "Seed: admin@nexus.local / Test1234!"),
    ("🏠", "Applicatie", "https://nexus.jouwdomein.nl"),
]
c_top = Inches(4.95)
for i, (icon, label, value) in enumerate(contacts):
    top = c_top + i * Inches(0.5)
    add_text(s, card_l + Inches(0.4), top, Inches(0.6), Inches(0.4),
             icon, font_size=18, alignment=PP_ALIGN.CENTER,
             anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, card_l + Inches(1.0), top, Inches(2.5), Inches(0.4),
             label, font_size=13, bold=True, color=BRAND_PRIMARY,
             anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, card_l + Inches(3.5), top, Inches(4.0), Inches(0.4),
             value, font_size=13, color=TEXT_MUTED,
             anchor=MSO_ANCHOR.MIDDLE)

add_text(s, SW - Inches(9), Inches(6.9), Inches(8.5), Inches(0.4),
         "Nexus – Activation & Subscription Manager • © 2026",
         font_size=12, color=RGBColor(0x93, 0xC5, 0xFD),
         alignment=PP_ALIGN.RIGHT)


# ============================================================
# OPSLAAN
# ============================================================
output_path = os.path.join(os.path.dirname(__file__), "..", "Nexus_Systeem_Presentatie.pptx")
output_path = os.path.abspath(output_path)
prs.save(output_path)
print(f"✅ Presentatie succesvol gegenereerd: {output_path}")
print(f"📊 Aantal dias: {len(prs.slides)}")
