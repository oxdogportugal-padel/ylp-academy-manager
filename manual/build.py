#!/usr/bin/env python3
"""Builds the academy user manual as an illustrated PDF."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Image, PageBreak, KeepTogether, Table, TableStyle)
from PIL import Image as PILImage
import os

SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Padel-Academy-Planner-Guide.pdf")

INK      = colors.HexColor("#12222B")
INK2     = colors.HexColor("#53646E")
LINE     = colors.HexColor("#D7DDD4")
HONEY    = colors.HexColor("#E09A2B")
HONEYBG  = colors.HexColor("#FBF1E6")
TURF     = colors.HexColor("#4F8A5B")
SUNKEN   = colors.HexColor("#F4F6F2")

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

S = {
    "title":   ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=30, leading=34,
                              textColor=INK, spaceAfter=6),
    "sub":     ParagraphStyle("sub", fontName="Helvetica", fontSize=13, leading=18,
                              textColor=INK2, spaceAfter=18),
    "h1":      ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=19, leading=23,
                              textColor=INK, spaceBefore=4, spaceAfter=8),
    "h2":      ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13, leading=17,
                              textColor=INK, spaceBefore=12, spaceAfter=5),
    "body":    ParagraphStyle("body", fontName="Helvetica", fontSize=10.5, leading=15.5,
                              textColor=INK, spaceAfter=8, alignment=TA_LEFT),
    "caption": ParagraphStyle("caption", fontName="Helvetica-Oblique", fontSize=9, leading=12.5,
                              textColor=INK2, spaceBefore=5, spaceAfter=14),
    "step":    ParagraphStyle("step", fontName="Helvetica", fontSize=10.5, leading=15.5,
                              textColor=INK, leftIndent=16, spaceAfter=6,
                              bulletIndent=2, bulletFontName="Helvetica-Bold"),
    "notehead": ParagraphStyle("notehead", fontName="Helvetica-Bold", fontSize=10.5, leading=15,
                               textColor=colors.HexColor("#7A5210"), spaceAfter=3),
    "notebody": ParagraphStyle("notebody", fontName="Helvetica", fontSize=10, leading=14.5,
                               textColor=colors.HexColor("#7A5210")),
}


def shot(name, width_frac=1.0, max_h=None):
    """Place a screenshot scaled to the content width, preserving aspect."""
    path = os.path.join(SHOTS, name + ".png")
    iw, ih = PILImage.open(path).size
    w = CONTENT_W * width_frac
    h = w * ih / iw
    if max_h and h > max_h:
        h = max_h
        w = h * iw / ih
    img = Image(path, width=w, height=h)
    img.hAlign = "CENTER"
    return img


def figure(name, caption, width_frac=1.0, max_h=430):
    return KeepTogether([shot(name, width_frac, max_h), Paragraph(caption, S["caption"])])


def section(title, first_para):
    """A heading never sits alone at the foot of a page."""
    return KeepTogether([Paragraph(title, S["h1"]), Paragraph(first_para, S["body"])])


def note(head, body):
    inner = [[Paragraph(head, S["notehead"])], [Paragraph(body, S["notebody"])]]
    t = Table(inner, colWidths=[CONTENT_W - 18])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HONEYBG),
        ("LEFTPADDING", (0, 0), (-1, -1), 11),
        ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (0, 0), 9),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 10),
        ("TOPPADDING", (0, 1), (-1, -1), 0),
        ("LINEBEFORE", (0, 0), (0, -1), 3, HONEY),
    ]))
    return KeepTogether([Spacer(1, 4), t, Spacer(1, 12)])


def steps(items):
    out = []
    for i, text in enumerate(items, 1):
        out.append(Paragraph(text, S["step"], bulletText=f"{i}."))
    return out


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, PAGE_H - MARGIN + 6 * mm, PAGE_W - MARGIN, PAGE_H - MARGIN + 6 * mm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(INK2)
        canvas.drawString(MARGIN, PAGE_H - MARGIN + 8 * mm, "Padel Academy Planner")
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - MARGIN + 8 * mm, "Getting started")
        canvas.setFont("Helvetica", 9)
        canvas.drawCentredString(PAGE_W / 2, MARGIN - 9 * mm, str(doc.page))
    canvas.restoreState()


def build():
    doc = BaseDocTemplate(OUT, pagesize=A4,
                          leftMargin=MARGIN, rightMargin=MARGIN,
                          topMargin=MARGIN, bottomMargin=MARGIN,
                          title="Padel Academy Planner - Getting started",
                          author="YouLovePadel")
    frame = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN, id="body")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=header_footer)])

    f = []

    # ---------- cover ----------
    f.append(Spacer(1, 30 * mm))
    f.append(Paragraph("Padel Academy Planner", S["title"]))
    f.append(Paragraph("A short guide to planning your classes", S["sub"]))
    f.append(Paragraph(
        "This planner exists to answer one question quickly: <b>where does this player fit?</b> "
        "It keeps your clubs, coaches, players and weekly classes in one place, and when somebody "
        "asks for lessons it tells you which classes suit them and why.", S["body"]))
    f.append(Paragraph(
        "Everything you see here is a real screen from the system. It takes about ten minutes to "
        "read, and you can set your academy up in about the same.", S["body"]))
    f.append(Spacer(1, 6))
    f.append(figure("calendar", "Your week at a glance. Colour is the class level, height is how long it runs, "
                                "and the dots are the seats.", 1.0, 400))
    f.append(PageBreak())

    # ---------- getting in ----------
    f.append(Paragraph("1. Getting in", S["h1"]))
    f.append(Paragraph(
        "You will receive an email invitation from Catalyst, the platform the planner runs on. "
        "It contains a link that lets you set your own password.", S["body"]))
    f.extend(steps([
        "Open the invitation email and follow its link.",
        "Choose a password. Nobody else sees it, including us.",
        "You are taken to the planner and signed in.",
    ]))
    f.append(Paragraph(
        "After that, the planner lives at one address and you simply sign in with your email and "
        "password. There is nothing else to type and no code to remember.", S["body"]))
    f.append(note("Your academy is chosen by your login",
                  "Everyone uses the same web address. What you see is decided by who you are, "
                  "so you cannot land in another academy's schedule by accident, and nobody can "
                  "land in yours."))
    f.append(Paragraph("Who should have an account", S["h2"]))
    f.append(Paragraph(
        "Anyone who needs to see or change the schedule. Usually that is whoever organises the "
        "timetable, plus the coaches. Your plan includes a set number of people. Ask us when you "
        "need another and we will send them an invitation.", S["body"]))
    # ---------- reading the calendar ----------
    f.append(Paragraph("2. Reading the calendar", S["h1"]))
    f.append(Paragraph(
        "The calendar is the main screen. One week, your opening hours down the side, one column "
        "per day.", S["body"]))
    f.append(Paragraph(
        "<b>Colour is the level.</b> Greens are beginners, blues the middle, purples and reds the "
        "strongest players. You can see at a glance whether your week is balanced or crowded at "
        "one level.", S["body"]))
    f.append(Paragraph(
        "<b>Height is the duration.</b> A 90 minute class is taller than a 60 minute one, so the "
        "shape of the week is the shape of your court time.", S["body"]))
    f.append(Paragraph(
        "<b>The dots are the seats.</b> Filled dots are players, hollow dots are places still free. "
        "Two cards side by side are two classes running at the same time on different courts.", S["body"]))
    f.append(Paragraph(
        "The three figures at the top right are worth a daily glance: the most courts you use at "
        "any one moment against what you have, how many seats are unsold, and how many new classes "
        "could be opened from your waiting list.", S["body"]))
    f.append(figure("class-detail", "Clicking a class shows who is in it. You can add or remove players here, "
                                    "and the note at the bottom tells you which levels this class accepts.", 1.0, 420))
    f.append(Paragraph("Narrowing the view", S["h1"]))
    f.append(Paragraph(
        "With a full timetable it helps to see less. <b>Filters</b> hides everything except what "
        "you are looking for: a level range, one coach, a class length, or only classes that still "
        "have a free seat.", S["body"]))
    f.append(figure("filters", "Filters narrow the calendar. \"Only classes with seats\" is the one you will "
                               "use most when somebody is waiting for a place.", 1.0, 430))
    f.append(Paragraph(
        "If your academy runs at more than one club, the buttons above the filters switch between "
        "them. Each club has its own courts and its own week.", S["body"]))
    # ---------- setting up ----------
    f.append(Paragraph("3. Setting your academy up", S["h1"]))
    f.append(Paragraph(
        "Everything lives under <b>Manage</b>. Do it in this order, because each step uses the one "
        "before it.", S["body"]))
    f.extend(steps([
        "<b>Clubs.</b> Where you teach, and how many courts you actually have for lessons there. "
        "If you rent three courts at a venue with eight, put three.",
        "<b>Coaches.</b> Their name and certification level, and which clubs they work at. "
        "The certification caps the level they are offered for.",
        "<b>Players.</b> Name and playing level. Contact details and notes are optional.",
        "<b>Classes.</b> The weekly slots themselves.",
    ]))
    f.append(figure("manage-players", "Players are sorted by level, so you can see the shape of your academy "
                                      "at a glance. The number beside each one is how many classes they attend.", 1.0, 300))
    f.append(note("Levels are the one thing worth getting right",
                  "Every recommendation the planner makes rests on them. Before you enter your "
                  "players, it is worth one session agreeing as a team what each level means, so "
                  "two coaches grade the same player the same way. Half levels are allowed."))
    # ---------- classes ----------
    f.append(Paragraph("4. Creating a class", S["h1"]))
    f.append(Paragraph(
        "A class is a weekly slot: a club, a coach, a day and time, a length, and the level it is "
        "aimed at. Seats default to your academy setting, and you can override it for one class.",
        S["body"]))
    f.append(figure("new-class", "Creating a class. If something does not work the planner says so before saving.", 1.0, 400))
    f.append(Paragraph("When it refuses", S["h2"]))
    f.append(Paragraph(
        "The planner checks the obvious conflicts and tells you all of them at once rather than one "
        "at a time: every court already busy, the coach teaching elsewhere, or the coach not "
        "certified for that level. You can still save anyway, because sometimes you know something "
        "it does not.", S["body"]))
    # ---------- placing a player ----------
    f.append(Paragraph("5. Placing a player", S["h1"]))
    f.append(Paragraph(
        "This is what the planner is really for. Somebody calls wanting lessons; instead of reading "
        "the whole timetable, you describe them once and the planner does the reading.", S["body"]))
    f.append(figure("place-form", "Name, level, club, how many classes a week, which days and between what hours.",
                    1.0, 290))
    f.append(Paragraph("What comes back", S["h1"]))
    f.append(Paragraph(
        "A list of classes that fit, best first, each with a percentage and the reasons behind it. "
        "The reasons matter more than the number, because they let you disagree with it.", S["body"]))
    f.append(figure("place-results", "Green reasons count in favour, amber ones against. Here the best match is "
                                     "the right level with players of the same standard, but on a day the player "
                                     "did not ask for.", 1.0, 440))
    f.append(Paragraph(
        "Press <b>Book</b> and they are in the class. If they wanted two classes a week and only one "
        "fits, book the one and put the rest on the waiting list. The planner keeps track of what is "
        "still owed to them.", S["body"]))
    # ---------- waiting list ----------
    f.append(Paragraph("6. The waiting list", S["h1"]))
    f.append(Paragraph(
        "Everyone you could not place lands here. On its own that is just a list, but the planner "
        "watches it for a particular thing: the moment enough waiting players could form a class "
        "together.", S["body"]))
    f.append(Paragraph(
        "It only suggests a class when four things line up at once. Enough players at compatible "
        "levels, a time they can all make, a free court, and a coach qualified for that level and "
        "not teaching. Three out of four is not a suggestion, so when one appears it is genuinely "
        "worth acting on.", S["body"]))
    f.append(figure("waitlist", "A suggested class, with the players it would be made of. One click opens it "
                                "and moves them in.", 1.0, 330))
    f.append(note("This is where the money is",
                  "A class that would never otherwise have formed is new revenue from players you "
                  "already had. If you only check one screen each week, check this one."))
    # ---------- rules ----------
    f.append(Paragraph("7. Making it work your way", S["h1"]))
    f.append(Paragraph(
        "Academies do not agree about any of this, so the rules are yours to set under "
        "<b>Manage &gt; Academy</b>. Change them and every recommendation changes with them.", S["body"]))
    f.append(figure("settings", "Your rules. The level scale, how far from a class level a player may sit, "
                                "class size, the lengths you run, and what each coach grade may teach.", 1.0, 420))
    f.append(Paragraph(
        "<b>Level tolerance</b> is the one to think about. At 1, a level 5 player is offered classes "
        "at 4, 5 and 6. At 0 they are only offered 5, which keeps groups tight but fills classes "
        "slowly. At 2 they fill quickly and play with a wider spread.", S["body"]))
    # ---------- phone ----------
    f.append(Paragraph("8. On a phone", S["h1"]))
    f.append(Paragraph(
        "The same address works on a phone, with the week shown a day at a time. It is meant for "
        "checking and small changes at the club rather than setting up from scratch.", S["body"]))
    f.append(shot("mobile", 0.40, 420))
    f.append(Paragraph("The day view. Tap a day along the top, tap a class to see who is in it.", S["caption"]))
    # ---------- feedback ----------
    f.append(Paragraph("9. What we would like to know", S["h1"]))
    f.append(Paragraph(
        "You are among the first academies using this, and the point of the trial is to find out "
        "where it does not fit. Anything at all is useful, but these four in particular:", S["body"]))
    f.extend(steps([
        "<b>Is the calendar readable?</b> Can you see your week faster here than in whatever you "
        "use today?",
        "<b>Is placing a player quicker?</b> Time it once against your current way.",
        "<b>Were the recommendations sensible?</b> If you disagreed with one, we would like to know "
        "which and why. That is the most valuable thing you can tell us.",
        "<b>Did the waiting list ever find you a class you would have missed?</b>",
    ]))
    f.append(Paragraph(
        "Anything that felt clumsy, confusing or simply wrong is worth mentioning. So is anything "
        "missing that you expected to find.", S["body"]))

    f.append(Paragraph("A note on player data", S["h2"]))
    f.append(Paragraph(
        "During the trial, please use initials or invented names rather than real players, "
        "particularly for anyone under 18. The system works exactly the same either way, and it "
        "keeps the trial clean while the data protection agreement is being settled.", S["body"]))
    f.append(note("Something looks wrong?",
                  "If a change does not save, the planner tells you in a red bar at the top of the "
                  "screen rather than failing quietly. If you see one, a screenshot of it is the "
                  "most useful thing you can send us."))

    doc.build(f)
    print("built:", OUT)


if __name__ == "__main__":
    build()
