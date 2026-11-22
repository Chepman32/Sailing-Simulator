"""Paint the two sides of each hull in a shared UV atlas, measured in metres."""

from pathlib import Path
import random

from PIL import Image, ImageChops, ImageDraw, ImageFont


WIDTH, PANEL = 8192, 512
TOP, BOTTOM = 6.8, -4.2
DEST = Path(__file__).resolve().parents[1] / "Saved/CoastalSources/model_maps"
FACE = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"


def paint(key, vessel, length, upper, stencil, seed):
    rng = random.Random(seed)
    sheet = Image.new("RGB", (WIDTH, PANEL*2))
    for side in (0,1):
        image = Image.new("RGB", (WIDTH, PANEL), upper)
        pen = ImageDraw.Draw(image)
        def x(fraction):
            return round((fraction if side == 0 else 1-fraction)*WIDTH)
        def y(height):
            return round(PANEL*(TOP-height)/(TOP-BOTTOM))
        def text(fraction, height, size, value, color=stencil):
            font = ImageFont.truetype(FACE, round(size*PANEL/(TOP-BOTTOM)))
            pen.text((x(fraction),y(height)), value, font=font, fill=color, anchor="mm",
                     stroke_width=0)

        # Antifouling, boot top and alternating steel plates. The seams are
        # narrower than the paint variation between neighbouring plates.
        for row in range(9):
            high = TOP-row*1.48
            for col in range(-1,26):
                start = (col + .51*(row%2))*8.0/length
                a,b = sorted((x(start),x(start+8.0/length)))
                base = upper if high>0 else (112,53,41)
                offset = rng.randint(-5,5)
                color = tuple(max(0,c+offset) for c in base)
                pen.rectangle((a,y(high),b,y(high-1.48)),fill=color)
                pen.line((a,y(high),b,y(high)),fill=tuple(max(0,c-7) for c in color),width=1)
                pen.line((a,y(high),a,y(high-1.48)),fill=tuple(max(0,c-9) for c in color),width=1)
        pen.rectangle((0,y(.05),WIDTH,y(-.32)),fill=(34,44,44))
        # Uneven salt and oxidised paint beneath scuppers, at seams and around the anchors.
        streaks = Image.new("RGBA", image.size)
        brush = ImageDraw.Draw(streaks)
        for i in range(720):
            u = rng.uniform(.018,.983)
            top = rng.choice((rng.uniform(3.7,6.6),rng.uniform(-.35,.43),rng.uniform(.3,4.2)))
            drop = rng.uniform(.12,1.3) * (1.85 if i%19==0 else 1)
            w = rng.choice((1,2,2,3,5,8))
            xx, yy, end = x(u), y(top), y(top-drop)
            brush.polygon(((xx-w,yy),(xx+w,yy),(xx+1,end),(xx-1,end)),
                          fill=(*rng.choice(((158,86,48),(96,67,48),(177,182,159))),rng.randrange(19,64)))
        image.paste(streaks,mask=streaks.getchannel("A"))
        # Stencils are above the boot top and read forwards from either side.
        text(.85,3.0,.89,vessel)
        text(.135,2.9,.69,vessel)
        text(.135,2.30,.34,"CORAL PASS")
        text(.53,2.48,1.63,"PELAGIC" if key=="product" else "OCEAN GAS")
        for fraction in (.09,.905):
            for tick in range(13):
                height = .22+tick*.21
                xx,yy = x(fraction),y(height)
                pen.line((xx,yy,xx+6,yy),fill=stencil,width=2)
                if tick%2==0: text(fraction-.0025,height,.20,str((tick*2)%10 or 10))
        xx,yy=x(.46),y(.50)
        pen.ellipse((xx-9,yy-9,xx+9,yy+9),outline=stencil,width=2)
        pen.line((xx-18,yy,xx+18,yy),fill=stencil,width=2)
        tone = Image.frombytes("L",(280,65),rng.randbytes(280*65)).resize(image.size,Image.Resampling.BICUBIC)
        image = ImageChops.add(image,Image.merge("RGB",(tone,tone,tone)).point(lambda a: a//21),offset=-6)
        sheet.paste(image,(0,PANEL*side))
    DEST.mkdir(parents=True, exist_ok=True)
    sheet.save(DEST / f"{key}_hull_paint.png")


if __name__ == "__main__":
    paint("product","PELAGOS",176,(45,58,64),(204,211,201),5408)
    paint("gas","NERIS LNG",184,(44,79,83),(215,222,211),3697)
