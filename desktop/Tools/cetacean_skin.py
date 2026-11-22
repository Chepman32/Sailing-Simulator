"""Bake the dolphin flank in its longitudinal / vertical swim coordinates at native 4K."""
from pathlib import Path
import math
import random
from PIL import Image, ImageChops, ImageDraw, ImageOps


def bake(folder: Path):
    size = 4096
    rng = random.Random(1049)
    skin = Image.new("L", (size, size))
    # V=0 is the fin side after FBX import. The cape drops towards the melon
    # and rises over the pectoral fin before blending into the tail stock.
    for x in range(size):
        u = x / (size - 1)
        mid = .49 + .045 * math.exp(-((u-.16)/.10)**2) - .035 * math.sin(math.pi*u)
        shoulder = .009 * math.sin(u*24) * math.exp(-((u-.38)/.22)**2)
        column = bytes(round(73 + 42/(1+math.exp(-min(50,(v/size-mid-shoulder)*39)))
                             + 61/(1+math.exp(-min(50,(v/size-mid-.10)*36)))) for v in range(0,size,8))
        skin.paste(Image.frombytes('L',(1,len(column)),column).resize((1,size),Image.Resampling.BICUBIC),(x,0))
    def noise(width, height):
        return Image.frombytes('L',(width,height),bytes(rng.randrange(256) for _ in range(width*height))).resize(
            (size,size),Image.Resampling.BICUBIC)
    for w,h,strength in [(58,74,.09),(370,480,.045),(1500,1850,.025)]:
        skin = ImageChops.add(skin, noise(w,h).point(lambda v: round(128+(v-128)*strength)), offset=-128)
    marks = ImageDraw.Draw(skin)
    for _ in range(26):
        x,y=rng.randint(640,3650),rng.randint(1300,2400)
        length=rng.randint(16,72)
        value=skin.getpixel((x,y))+rng.randint(4,12)
        for j in range(rng.randrange(1,4)):
            marks.line([(x,y+j*5),(x+length//2,y+j*5-5),(x+length,y+j*5-14)], fill=value,width=2)
    # Slate back, neutral grey flank and a warm pale belly. No baked lighting.
    rgb=ImageOps.colorize(skin,black=(6,11,18),white=(244,238,221),mid=(117,128,135),midpoint=128)
    rgb.save(folder/'dolphin_skin_4k.png')
    relief=noise(1730,2050)
    rough=ImageChops.add(skin.point(lambda v: 93+v//11),relief.point(lambda v: 128+(v-128)//14),offset=-128)
    rough.save(folder/'dolphin_rough_4k.png')


if __name__ == '__main__':
    bake(Path(__file__).resolve().parents[1]/'Saved/CoastalSources/model_maps')
