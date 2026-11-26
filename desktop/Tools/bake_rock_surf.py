"""Bake the rock waterline and no-through-flow shore current from the placed Coral Pass scans.

Run this file with the Unreal Editor's ExecutePythonScript after changing the coastal rocks.
The packed half floats are phase correction in seconds, current correction in XY, and rock contact.
"""
from collections import deque
import math
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coastal_layout import CAYS, LAYOUT, shore_scale

SIZE = 128
COUNT = SIZE * SIZE
OUTPUT = LAYOUT.parents[2] / "Content/Coastal/Surf/RockFlow.bin"


def rock_heights(rocks, x0, y0, cell):
    heights = [-100.] * COUNT
    for vertices, triangles in rocks:
        if (max(p[0] for p in vertices) < x0 or min(p[0] for p in vertices) > x0 + SIZE*cell
                or max(p[1] for p in vertices) < y0 or min(p[1] for p in vertices) > y0 + SIZE*cell
                or max(p[2] for p in vertices) < -.65):
            continue
        grid = [((x-x0)/cell, (y-y0)/cell, z) for x,y,z in vertices]
        for i in range(0,len(triangles),3):
            a,b,c = (grid[j] for j in triangles[i:i+3])
            if max(a[2],b[2],c[2]) < -.65:
                continue
            ax,ay,az = a
            bx,by,bz = (b[j]-a[j] for j in range(3))
            cx,cy,cz = (c[j]-a[j] for j in range(3))
            det = bx*cy-cx*by
            if abs(det) < 1e-7:
                continue
            for y in range(max(0,math.ceil(min(ay,b[1],c[1]))), min(SIZE-1,math.floor(max(ay,b[1],c[1])))+1):
                for x in range(max(0,math.ceil(min(ax,b[0],c[0]))), min(SIZE-1,math.floor(max(ax,b[0],c[0])))+1):
                    u = ((x-ax)*cy-(y-ay)*cx)/det
                    v = (bx*(y-ay)-by*(x-ax))/det
                    if u >= 0 and v >= 0 and u+v <= 1:
                        index = y*SIZE+x
                        heights[index] = max(heights[index], az+u*bz+v*cz)
    return heights


def solve_tile(rocks, row, x0, y0, cell):
    h = rock_heights(rocks,x0,y0,cell)
    blocked = [z > .035 for z in h]
    # A closed pocket between scan triangles has no incoming shoreline wave.
    # Giving it the coastal potential would make a one-texel standing jet.
    connected = bytearray(COUNT)
    sea = deque(i for i in range(COUNT) if not blocked[i] and
                (i < SIZE or i >= COUNT-SIZE or i%SIZE in (0,SIZE-1)))
    for i in sea:
        connected[i] = 1
    while sea:
        i = sea.popleft()
        for j in (i-SIZE,i+SIZE,i-1,i+1):
            if 0 <= j < COUNT and abs(i%SIZE-j%SIZE) <= 1 and not blocked[j] and not connected[j]:
                connected[j] = 1
                sea.append(j)
    blocked = [not wet for wet in connected]
    cay = CAYS[row]
    def shelf(x,y):
        u,v = (x-cay.x)/cay.length,(y-cay.y)/cay.width
        return (math.hypot(u,v)/shore_scale(math.atan2(v,u),cay.phase)-1)*min(cay.width,cay.length)
    base = [shelf(x0+i%SIZE*cell,y0+i//SIZE*cell) for i in range(COUNT)]
    offsets = (-1,1,-SIZE,SIZE)
    phi = [0.] * COUNT
    distance = [100.] * COUNT
    queue = deque()
    rows = []
    for i in range(SIZE,COUNT-SIZE):
        if not 0 < i%SIZE < SIZE-1:
            continue
        if blocked[i]:
            distance[i] = 0.
            queue.append(i)
            continue
        neighbours = tuple(i+j for j in offsets if not blocked[i+j])
        # Total potential has zero normal flux at rock walls. Fade the perturbation
        # over about 7 m so adjacent stretches of open beach keep their own swell.
        forcing = sum(base[i]-base[i+j] for j in offsets if blocked[i+j])
        rows.append((i,neighbours,forcing,1./(len(neighbours)+(cell/7.)**2)))
    for sweep in range(225):
        residual = 0.
        for i,edges,forcing,inv in rows:
            value = forcing
            for j in edges:
                value += phi[j]
            change = (value*inv-phi[i])*1.72
            phi[i] += change
            residual = max(residual,abs(change))
        if residual < .0005:
            break
    # Carry the *total* crest phase smoothly across the stone. A high wave can
    # overtop a ledge that was dry at mean sea level. A zero phase inside it
    # would crease that thin layer along the survey's square texels.
    border = [(i, [i+j for j in offsets if not blocked[i+j]]) for i in queue]
    for i,wet in border:
        if wet:
            phi[i] = sum(base[j]+phi[j]-base[i] for j in wet)/len(wet)
    solid_phase = [base[i]+phi[i] for i in range(COUNT)]
    for sweep in range(120):
        residual = 0.
        for i,wet in border:
            if wet:
                continue
            avg = .25*sum(solid_phase[i+j] for j in offsets)
            change = (avg-solid_phase[i])*1.6
            solid_phase[i] += change
            residual = max(residual,abs(change))
        if residual < .0005:
            break
    for i,wet in border:
        phi[i] = solid_phase[i]-base[i]
    while queue:
        i = queue.popleft()
        if distance[i] > 12*cell or i < SIZE or i >= COUNT-SIZE or not 0 < i%SIZE < SIZE-1:
            continue
        for j in offsets:
            if distance[i+j] > distance[i]+cell:
                distance[i+j] = distance[i]+cell
                queue.append(i+j)
    out = bytearray(COUNT*8)
    for i,edges,forcing,inv in rows:
        dx = (base[i+1]-base[i-1])/(2*cell)
        dy = (base[i+SIZE]-base[i-SIZE])/(2*cell)
        norm = max(.35,math.hypot(dx,dy))
        def current(offset):
            p = base[i]+phi[i]
            plus = p if blocked[i+offset] else base[i+offset]+phi[i+offset]
            minus = p if blocked[i-offset] else base[i-offset]+phi[i-offset]
            return (plus-minus)/(2*cell)
        contact = math.exp(-distance[i]/1.6) if distance[i]<99 else 0.
        fade = min(1.,min(i%SIZE,SIZE-1-i%SIZE,i//SIZE,SIZE-1-i//SIZE)/5.)
        struct.pack_into('<4e',out,8*i, fade*phi[i]/2.7,
                         fade*(current(1)-dx)/norm, fade*(current(SIZE)-dy)/norm, fade*contact)
    for i,wet in border:
        struct.pack_into('<4e',out,8*i,phi[i]/2.7,0,0,1.+max(0.,min(1.,h[i])))
    return out, h


def bake(rocks):
    data = bytearray()
    seabed = bytearray()
    for line in (LAYOUT.parent/'CoralSurfTiles.inl').read_text().splitlines():
        if line.startswith('SURF_TILE('):
            row,tile,x,y,cell = map(float,line[10:-1].split(','))
            assert int(tile)*COUNT*8 == len(data)
            survey, heights = solve_tile(rocks,int(row),x,y,cell)
            data.extend(survey)
            seabed.extend(struct.pack(f'<{COUNT}f', *heights))
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_bytes(data)
    (OUTPUT.parents[3]/'Saved/CoastalSources/RockBed.f32').write_bytes(seabed)


def run_editor():
    import unreal
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).load_level('/Game/Maps/CoralPass')
    meshes, rocks = {}, []
    for actor in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors():
        if not isinstance(actor,unreal.StaticMeshActor):
            continue
        component = actor.static_mesh_component
        mesh = component.static_mesh
        if not mesh or mesh.get_name() not in ('SM_Boulder','SM_CoastRocks'):
            continue
        name = mesh.get_name()
        if name not in meshes:
            verts,triangles,*_ = unreal.ProceduralMeshLibrary.get_section_from_static_mesh(mesh,0,0)
            meshes[name] = verts,list(triangles)
        verts,triangles = meshes[name]
        transform = component.get_world_transform()
        points = [transform.transform_location(p) for p in verts]
        if max(p.z for p in points) >= -65:
            rocks.append(([(p.x*.01,p.y*.01,p.z*.01) for p in points],triangles))
    bake(rocks)


if __name__ == '__main__':
    run_editor()
