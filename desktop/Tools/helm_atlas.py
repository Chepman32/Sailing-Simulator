"""Rasterize the helm's line icons and nine-slice glass panels in one UI atlas."""
from pathlib import Path
from PIL import Image, ImageDraw

CELL, AA = 96, 4
atlas = Image.new("RGBA", (8*CELL, 4*CELL))


def tile(index, draw):
    image = Image.new("RGBA", (24*AA, 24*AA))
    pen = ImageDraw.Draw(image)
    def box(coords):
        return tuple(round(v*AA) for v in coords)
    def line(*points, width=1.4):
        pen.line(box(points), fill="white", width=round(width*AA), joint="curve")
    def ring(x,y,r):
        pen.ellipse(box((x-r,y-r,x+r,y+r)), outline="white", width=round(1.4*AA))
    def rect(x,y,w,h,r=1.6):
        pen.rounded_rectangle(box((x,y,x+w,y+h)),round(r*AA),outline="white",width=round(1.4*AA))
    draw(line, ring, rect)
    atlas.paste(image, (index%8*CELL, index//8*CELL))


tile(0,lambda l,c,r:(c(12,12,10),r(7,2,10,20,5),l(3,9,21,9),l(3,15,21,15)))
tile(1,lambda l,c,r:(r(1.5,6,21,15,2.6),l(6,6,8,3,15,3,18,6),c(12,13.5,4.6)))
tile(2,lambda l,c,r:(l(2,6,8,3,16,6,22,3,22,18,16,21,8,18,2,21,2,6),l(8,3,8,18),l(16,6,16,21)))
tile(3,lambda l,c,r:(r(1,5,22,14,2),[l(x,y,x+1,y) for x in (4,8,12,16,19) for y in (9,12)],l(7,15,17,15)))
tile(4,lambda l,c,r:(l(2,9,6,9,13,3,13,21,6,15,2,15,2,9),l(16,8,18,10,18,14,16,16),l(19,5,22,9,22,15,19,19)))
tile(5,lambda l,c,r:(r(2,7,20,14,2),l(4,7,16,2),c(15.8,14,3.8),l(5,11,9,11),l(5,15,8,15)))
tile(6,lambda l,c,r:(c(12,12,10),c(12,12,5.2),[l(*q,width=2.3) for q in [(4.9,4.9,8.4,8.4),(19.1,4.9,15.6,8.4),(4.9,19.1,8.4,15.6),(19.1,19.1,15.6,15.6)]]))
tile(7,lambda l,c,r:(l(2,10,9,9,18,4,20,17,10,15,3,16,2,10),l(5,16,7,21,10,21,9,16),l(21,7,23,10,23,13)))
tile(8,lambda l,c,r:(l(3,17,5,15,6,9,7,6,10,4,14,4,17,6,18,9,19,15,21,17,21,18,3,18,3,17),l(10,20,11,21,13,21,14,20),l(12,4,12,2)))
tile(9,lambda l,c,r:(l(3,16,15,4,19,2,22,3,21,7,18,11,8,21,3,16),l(12,7,18,13),l(5,18,2,21,4,23,7,20)))
tile(10,lambda l,c,r:(l(4,7,8,7,10,4,16,4,18,7,20,7,20,11,22,10,23,11,23,17,22,18,19,16,18,19,9,19,6,16,4,16,4,7),l(1,8,1,16),l(1,12,4,12),l(10,2,15,2)))
tile(11,lambda l,c,r:(l(2,9,14,9,16,8,16,6,15,4,13,4,12,5),l(1,13,19,13,21,11,21,9),l(4,17,13,17,15,19,14,21,12,21)))
tile(12,lambda l,c,r:l(2,11,21,3,14,22,11,14,2,11))
for i,fill,edge,radius in [
        (16,(19,38,54,216),(152,182,205,170),19),(17,(20,39,54,219),(146,175,199,165),15),
        (18,(35,49,65,210),(172,188,202,150),10),(19,(20,71,82,235),(105,232,223,240),16),
        (20,(17,72,70,235),(84,217,203,245),14),(21,(32,47,62,214),(153,177,192,180),14),
        (22,(225,235,238,255),(239,248,250,255),16),(23,(23,46,62,210),(116,145,162,195),12)]:
    image=Image.new("RGBA",(CELL,CELL))
    pen=ImageDraw.Draw(image)
    pen.rounded_rectangle((1,1,CELL-2,CELL-2),radius,fill=fill,outline=edge,width=2)
    if i==23:
        for y in range(6,CELL-6):
            t=y/(CELL-1)
            color=(round(39+61*t),round(94+100*t),round(107+77*t)) if t<.51 else (round(101+45*t),round(68-39*t),round(83-21*t))
            pen.line((4,y,CELL-5,y), fill=color+(213,),width=1)
    atlas.paste(image,(i%8*CELL,i//8*CELL))
if __name__=="__main__":
    atlas.save(Path(__file__).resolve().parents[1]/"Saved/CoastalSources/HelmAtlas.png")
