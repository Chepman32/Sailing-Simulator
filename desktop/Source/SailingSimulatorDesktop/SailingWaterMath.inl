// Used both by the Chaos sampler and by the material authoring tool.
// The coast returns signed cross-shore distance, its XY gradient and the surveyed profile row.
struct SailingWaterMath
{
    Real4 Cay(Real x, Real y, Real cx, Real cy, Real rx, Real ry, Real seed, bool volcano)
    {
        Real reach = min(rx, ry);
        Real u = (x-cx)/rx, v = (y-cy)/ry;
        Real r2 = u*u+v*v, band = 1.27*(1+105/reach);
        if (r2 < .01) return Real4(-.75*reach,0,0,seed);
        if (r2 > band*band) return Real4(1000,0,0,0);
        Real a = atan2(v,u), r = sqrt(r2);
        Real radius, slope;
        if (volcano)
        {
            radius = 1+.13*sin(2*a+1.1)+.075*sin(5*a+.7);
            slope = .26*cos(2*a+1.1)+.375*cos(5*a+.7);
        }
        else
        {
            radius = 1+.129*sin(3*a+seed)+.070*cos(5*a-seed)+.038*sin(8*a+2*seed)+.021*cos(13*a-3*seed);
            slope = .387*cos(3*a+seed)-.350*sin(5*a-seed)+.304*cos(8*a+2*seed)-.273*sin(13*a-3*seed);
        }
        // The terrain survey measures shelf depth against r/radius at this azimuth.
        Real inv=1/(r*radius);
        return Real4((r/radius-1)*reach,(u+slope*v/radius)*inv*reach/rx,
                     (v-slope*u/radius)*inv*reach/ry,seed);
    }

    Real4 Coast(Real x, Real y)
    {
        Real4 near = Real4(1000,0,0,0), probe;
        int row=0;
        #define CORAL_CAY(name,cx,cy,rx,ry,h,ridge,phase) probe=Cay(x,y,cx,cy,rx,ry,phase,false); if(abs(probe.x)<abs(near.x)) { near=probe; near.w=row; } ++row;
        #define CORAL_VOLCANO(cx,cy,r,h) probe=Cay(x,y,cx,cy,r,r,1.1,true); if(abs(probe.x)<abs(near.x)) { near=probe; near.w=row; } ++row;
        #include "CoralPassLayout.inl"
        #undef CORAL_CAY
        #undef CORAL_VOLCANO
        return near;
    }

    // The swell loses energy to shorter shoreward breakers. Each train steepens,
    // runs up the beach and drains back during the longer trough.
    Real Swell(Real d) { return .27*smoothstep(-8,-.5,d)+.73*smoothstep(-.5,28,d); }
    Real SwellSlope(Real d)
    {
        Real runup = saturate((d+8)/7.5), shoal = saturate((d+.5)/28.5);
        return .27*6*runup*(1-runup)/7.5+.73*6*shoal*(1-shoal)/28.5;
    }
    // Long storm waves lose their energy further out on the island shelves.
    Real StormSwell(Real d) { return smoothstep(13,105,d); }
    Real StormSwellSlope(Real d)
    {
        Real shoal = saturate((d-13)/92);
        return 6*shoal*(1-shoal)/92;
    }
    // Same unsigned lattice as coastal_layout.terrain_noise, which bakes the
    // submerged coral heads and sand channels. Return value and XY gradients.
    Real ReefCorner(int i, int j)
    {
        UInt h=UInt(i)*1597334677u ^ UInt(j)*3812015801u;
        h=(h^(h>>16))*2246822519u;
        return (h^(h>>13))*(1./2147483648.)-1.;
    }
    Real4 ReefNoise(Real x, Real y, Real frequency)
    {
        Real px=x*frequency, py=y*frequency;
        int i=int(floor(px)), j=int(floor(py));
        Real fx=px-i, fy=py-j, u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy);
        Real a=ReefCorner(i,j), b=ReefCorner(i+1,j), c=ReefCorner(i,j+1), d=ReefCorner(i+1,j+1);
        Real north=a+(b-a)*u, south=c+(d-c)*u;
        return Real4(north+(south-north)*v,6*fx*(1-fx)*frequency*((b-a)*(1-v)+(d-c)*v),
            6*fy*(1-fy)*frequency*(south-north),0);
    }
    // The submerged reef has no island shoreline. Depth at the yacht's
    // departure is nearly 11 m, while the coral beside it reaches the surface.
    Real4 StormTransfer(Real x, Real y, Real4 coast, Real scale)
    {
        Real coastA=StormSwell(coast.x), coastD=StormSwellSlope(coast.x);
        Real4 offshore=Real4(coastA,coastD*coast.y,coastD*coast.z,0);
        Real u=(x-20)/77, v=(y-19)/39, r2=u*u+v*v;
        if (coast.w<0 || r2>=2.25 || scale<=1.6) return offshore;
        Real r=sqrt(max(.0001,r2)), edge=max(0,r-.80);
        Real4 broad=ReefNoise(x,y,.034), heads=ReefNoise(x,y,.069), detail=ReefNoise(x,y,.22);
        Real depth=3.4+10*r2+75*edge*edge-1.75*broad.x-1.764*heads.x-1.036*detail.x;
        Real depthD=10+75*edge/r;
        Real dx=2*u/77*depthD-1.75*broad.y-1.764*heads.y-1.036*detail.y;
        Real dy=2*v/39*depthD-1.75*broad.z-1.764*heads.z-1.036*detail.z;
        if (depth<.6) { depth=.6; dx=0; dy=0; }
        // The incident wind sea dissipates as it approaches breaker height.
        // A fourth-power soft limit retains the full wave field in deep water.
        Real incident=10.8*smoothstep(1.6,4.5,scale)*(1+.22*smoothstep(3.9,4.5,scale));
        Real ratio=incident/(.72*depth), q=ratio*ratio;
        q*=q;
        Real a=1/sqrt(sqrt(1+q)), da=a*q/((1+q)*depth);
        Real t=saturate((r2-1.25)), blend=t*t*(3-2*t);
        Real gain=a+(1-a)*blend, fadeD=(1-a)*6*t*(1-t);
        return Real4(coastA*gain,offshore.y*gain+coastA*(da*dx*(1-blend)+fadeD*2*u/77),
            offshore.z*gain+coastA*(da*dy*(1-blend)+fadeD*2*v/39),0);
    }
    // Arrival time varies along the reef. Its derivatives keep the lighting normal
    // and the orbital motion on the same oblique crest as the displacement.
    Real4 Peel(Real x, Real y, Real seed)
    {
        Real a = .042*x+.025*y+seed, b = .019*x-.062*y-1.7*seed;
        Real c = .218*x+.143*y+2.3*seed;
        Real pocket=.36*sin(.096*x-.066*y), along=.114*x+.081*y+pocket+seed;
        // The 25 m component lets individual sections of the same long crest pitch at
        // different times. It also bends the leading edge of the sheet on the beach.
        // Small differences in travel time across the bed send tongues of
        // water ahead of the bore. Carry their slopes into the water normal.
        Real bend=.57*x-.36*y+seed, lobe=1.63*x+1.37*y+.61*sin(bend);
        Real delay=.035*sin(lobe), slope=.035*cos(lobe), turn=.61*cos(bend);
        return Real4(.020*x-.013*y + 1.18*sin(a)+.67*sin(b)+.46*sin(c)+.68*sin(along)+delay,
                     .020+.04956*cos(a)+.01273*cos(b)+.10028*cos(c)+.68*cos(along)*(.114+.03456*cos(.096*x-.066*y))+slope*(1.63+.57*turn),
                     -.013+.02950*cos(a)-.04154*cos(b)+.06578*cos(c)+.68*cos(along)*(.081-.02376*cos(.096*x-.066*y))+slope*(1.37-.36*turn), 0);
    }

    // Interior texel coordinates for a surveyed rocky coast. Neighbouring
    // samples are always in this tile, including at its zero outer margin.
    Real4 RockTile(Real x, Real y, Real row)
    {
        #define SURF_TILE(cay,tile,ox,oy,cell) if (row==cay && x>=ox && y>=oy && x<ox+127*cell && y<oy+127*cell) return Real4((x-(ox))/cell,(y-(oy))/cell+128*tile,1./cell,0);
        #include "CoralSurfTiles.inl"
        #undef SURF_TILE
        return Real4(0,0,0,0);
    }

    Real BreakerFrequency() { return 1.16; }
    Real4 BoreWindow(Real d)
    {
        Real land=saturate((d+8)/3), sea=saturate((38-d)/7);
        Real a=land*land*(3-2*land), b=sea*sea*(3-2*sea);
        return Real4(a*b,2*land*(1-land)*b-a*6*sea*(1-sea)/7,0,0);
    }
    // A short reflected bore leaves the waterline of an exposed rock after
    // the incident crest hits. Derivatives are per contact value and per second.
    Real4 RockBore(Real contact, Real clock, Real scale, Real row)
    {
        if (contact<.035 || contact>=1.6) return Real4(0,0,0,0);
        Real period=6.283185307179586/BreakerFrequency();
        Real cycles=(clock+row/BreakerFrequency()-.16)/period;
        Real age=(cycles-floor(cycles))*period;
        if (age>=3.2) return Real4(0,0,0,0);
        Real birth=saturate(age/.38), death=saturate((3.2-age)/2.6);
        Real a=birth*birth*(3-2*birth), b=death*death*(3-2*death);
        Real over=saturate((1.6-contact)/.60), wet=over*over*(3-2*over);
        Real amp=.12*sqrt(min(scale,2.5));
        Real width=.23+.10*age, distance=-1.6*log(min(1.,contact));
        Real q=(distance-.91*age)/width, bell=exp(-.5*q*q);
        Real pulse=(1-.5*q*q)*bell, slope=q*(.5*q*q-2)*bell;
        Real h=amp*a*b*wet;
        Real dc=(contact<1. ? -1.6/contact : 0.)/width;
        Real dh=amp*wet*(6*birth*(1-birth)*b/.38-6*death*(1-death)*a/2.6);
        return Real4(h*pulse, h*slope*dc-amp*a*b*pulse*6*over*(1-over)/.60,
            dh*pulse-h*slope*(.91+.10*q)/width, wet*a*b*bell);
    }
    Real ProfileIndex(Real d) { return max(0,(d+8)*2); }
    // A half-metre Hermite interval, returning the value and derivative per metre.
    Real4 Curve(Real a, Real b, Real da, Real db, Real u)
    {
        Real c=3*(b-a)-da-.5*db, e=2*(a-b)+.5*(da+db);
        return Real4(a+u*(.5*da+u*(c+u*e)), da+u*(4*c+6*u*e),0,0);
    }

    // Cross-shore position, speed, and time since the most recent high run-up.
    Real4 SwashTip(Real t, Real scale, Real seed)
    {
        Real omega = BreakerFrequency(), phase = omega*t+seed-.95;
        Real shape = phase-.43*(1-cos(phase));
        Real pulse = .5+.5*cos(shape);
        Real pulseT = -.5*sin(shape)*(1-.43*sin(phase))*omega;
        Real group = .72+.28*cos(.32*t+seed);
        Real reach = 2.8+3.5*sqrt(scale)*group;
        Real reachT = -3.5*sqrt(scale)*.28*.32*sin(.32*t+seed);
        Real cycle = phase/6.283185307179586;
        return Real4(1.25-reach*pulse,-reachT*pulse-reach*pulseT,
                     (cycle-floor(cycle))*6.283185307179586/omega,pulse);
    }

    // A thin sheet follows the bore onto the beach. Keep its derivatives in
    // the same frame as the incoming wave when applying the shoreline gradient.
    Real4 SwashLayer(Real d, Real t, Real scale, Real seed)
    {
        if (d >= 5 || d <= -8) return Real4(0,0,0,0);
        Real4 tip = SwashTip(t,scale,seed);
        Real front = saturate((d-tip.x)/.60);
        Real cover = front*front*(3-2*front), coverD = 6*front*(1-front)/.60;
        Real land = saturate((d+8)/2.8), sea = saturate((5-d)/5);
        Real a = land*land*(3-2*land), b = sea*sea*(3-2*sea);
        Real window = a*b, windowD = 6*land*(1-land)/2.8*b - a*6*sea*(1-sea)/5;
        Real lift = .145*sqrt(scale);
        Real ripple = smoothstep(0,.13,d-tip.x)*(1-smoothstep(.22,.72,d-tip.x));
        Real froth = .49*window*ripple*smoothstep(.42,1.45,abs(tip.y));
        // The leading water piles up into a small bore. Its steeper, convex
        // front refracts the sand before the trailing sheet crosses it.
        Real omega=BreakerFrequency(), phase=omega*t+seed-.95;
        Real pulse=.5-.5*sin(phase), pulseT=-.5*omega*cos(phase);
        Real q=(d-tip.x-.32)/.28, ridge=exp(-q*q);
        Real ridgeD=-2*q*ridge/.28;
        Real cap=.074*sqrt(scale);
        Real crest=lift*cover+cap*pulse*ridge;
        Real crestD=lift*coverD+cap*pulse*ridgeD;
        return Real4(window*crest,windowD*crest+window*crestD,
                     window*(cap*pulseT*ridge-crestD*tip.y),froth);
    }

    // Height, cross-shore slope, rise speed and aerated water. The leading face
    // pitches forward in the shoal and spills into a lower, longer-lived bore.
    Real4 Roller(Real d, Real t, Real scale, Real seed, Real4 lo, Real4 hi, Real4 dlo, Real4 dhi, Real u)
    {
        if (lo.y <= 0 || hi.y <= 0 || lo.z <= 0 || hi.z <= 0) return Real4(0,0,0,0);
        Real4 travel=Curve(lo.x,hi.x,dlo.x,dhi.x,u);
        Real4 shoaling=Curve(lo.y,hi.y,dlo.y,dhi.y,u);
        Real4 depth=Curve(lo.z,hi.z,dlo.z,dhi.z,u);
        Real runup = saturate((d+8)/10), offshore = saturate((38-d)/27);
        Real shape = runup*runup*(3-2*runup), shoal = offshore*offshore*(3-2*offshore);
        Real window = shape*shoal;
        Real windowD = 6*runup*(1-runup)/10*shoal-shape*6*offshore*(1-offshore)/27;
        Real omega=BreakerFrequency(), phase=travel.x+omega*t+seed, k=travel.y;
        Real beat=.21*travel.x+.29*t+seed, swellBeat=seed+.113*t-.09*travel.x;
        Real group=.79+.19*cos(beat)+.10*cos(swellBeat);
        Real groupD=(-.19*.21*sin(beat)+.10*.09*sin(swellBeat))*k;
        Real groupT=-.19*.29*sin(beat)-.10*.113*sin(swellBeat);
        Real incident=.62*sqrt(scale)*group*shoaling.x;
        // Energy flux gives the unbroken amplitude. A depth-limited wave can carry
        // approximately H=0.78h. Excess energy feeds the front and the trailing bore.
        Real limit=.39*depth.x, ratio=incident/limit, r2=ratio*ratio, r4=r2*r2;
        Real broken=r4/(1+r4), amplitude=incident/sqrt(sqrt(1+r4));
        Real ampD=amplitude*((1-broken)*(shoaling.y/shoaling.x+groupD/group)+broken*depth.y/depth.x);
        Real ampT=amplitude*(1-broken)*groupT/group;
        // As the shoal steepens the wave, concentrate slope on its leading face
        // and stretch its back. The fold grows with depth-limited breaking.
        Real fold=.69*broken, bend=1-cos(phase);
        Real frontPhase=phase-fold*bend;
        Real phaseGain=1-fold*sin(phase);
        Real brokenD=4*broken*(1-broken)*(groupD/group+shoaling.y/shoaling.x-depth.y/depth.x);
        Real brokenT=4*broken*(1-broken)*groupT/group;
        Real c = cos(frontPhase), s = sin(frontPhase);
        Real steep = .29+.13*shoal;
        Real cusp = 4*c*c*c-3*c;
        Real crest = c+steep*(c*c-.5)+.24*s*c+.035*shoal*cusp;
        Real crestSlope = -s*(1+2*steep*c+.035*shoal*(12*c*c-3))+.24*(c*c-s*s);
        Real shapeD = -6*offshore*(1-offshore)/27*(.13*(c*c-.5)+.035*cusp);
        Real h = amplitude*window;
        Real lip = smoothstep(.80,.985,c+.19*s)*smoothstep(-.27,.05,s);
        Real spent = smoothstep(.02,.58,s)*smoothstep(-.60,.64,c);
        Real foam = window*smoothstep(.57,1.40,ratio)*(.92*lip+.37*spent)*(.83+.17*group);
        Real4 sheet = SwashLayer(d,t,scale,seed);
        return Real4(h*crest+sheet.x,(ampD*window+amplitude*windowD)*crest
                        +h*(crestSlope*(k*phaseGain-.69*brokenD*bend)+shapeD)+sheet.y,
                     ampT*window*crest+h*crestSlope*(omega*phaseGain-.69*brokenT*bend)+sheet.z,max(foam,sheet.w));
    }

    // a is distance aft of the transoms, b the lateral offset. Two divergent
    // bow waves and their troughs travel with the yacht. Width grows down-wake.
    Real HullWeight(Real beam, Real bias) { return 1+bias*beam/sqrt(beam*beam+1); }

    // Height and derivatives along the aft and beam axes. Evaluate both
    // shoulders once, including the change in their width behind the hull.
    Real4 HullWave(Real a, Real b, Real speed, Real bias)
    {
        if (a < -10 || a > 24 || abs(b) > 16 || speed < .35) return Real4(0,0,0,0);
        Real aft=max(a+8,0.), run=a>-8 ? 1 : 0, width=.63+.048*aft;
        Real spread=.26+.047*smoothstep(2.1,6.2,speed);
        Real k=min(2.6,9.81/max(1.0,speed*speed)), phase=2.05+.30*k;
        Real cross=abs(b)-1.92-spread*aft, outer=cross/width;
        Real inner=(abs(b)+1.92-spread*aft)/width;
        // The outer bow shoulders reinforce; crests from the inboard sides of
        // the two demihulls cross in the tunnel and then pass through one another.
        Real e0=exp(-.83*outer*outer), e1=.54*exp(-.90*inner*inner);
        Real c0=cos(phase*outer), c1=cos(phase*inner);
        Real divergent=e0*c0+e1*c1;
        Real d0=-e0*(1.66*outer*c0+phase*sin(phase*outer));
        Real d1=-e1*(1.80*inner*c1+phase*sin(phase*inner));
        Real along=-(d0*(spread+.048*outer)+d1*(spread+.048*inner))*run/width;
        Real across=(d0+d1)*(b>0 ? 1 : b<0 ? -1 : 0)/width;
        Real beamWidth=2.+.22*aft, middle=b/beamWidth, center=.25*exp(-middle*middle);
        Real crossPhase=k*(a+2.4), c=cos(crossPhase);
        Real u=saturate((a+5)/7), ramp=u*u*(3-2*u);
        Real transverse=center*c*ramp;
        Real transverseA=center*((2*middle*middle*.22*run/beamWidth*c-k*sin(crossPhase))*ramp+c*6*u*(1-u)/7);
        Real transverseB=-2*middle/beamWidth*transverse;
        Real enter=saturate((a+10)/4), leave=saturate((a-9)/15);
        Real front=enter*enter*(3-2*enter), back=1-leave*leave*(3-2*leave);
        Real weight=.41*smoothstep(.35,4.6,speed)*exp(-.037*aft);
        Real amp=weight*front*back;
        Real ampA=weight*(6*enter*(1-enter)/4*back-front*6*leave*(1-leave)/15)-.037*run*amp;
        Real norm=sqrt(1+b*b), side=1+bias*b/norm;
        Real shape=side*divergent+transverse;
        return Real4(amp*shape,ampA*shape+amp*(side*along+transverseA),
                     amp*(side*across+bias*divergent/(norm*norm*norm)+transverseB),0);
    }

    // A pair of divergent wave packets and their transverse interference, shed
    // at the two sterns. Coordinates stay in the emission frame through a turn.
    // Returns height and derivatives with respect to along, beam and age.
    Real4 ShedWake(Real along, Real beam, Real age, Real speed, Real bias)
    {
        if (age <= 0 || age >= 12 || speed <= .55) return Real4(0,0,0,0);
        Real drift = .34*speed, length = 1.6+.67*speed;
        Real u = (along-drift*age)/length;
        if (abs(u)>=1) return Real4(0,0,0,0);
        Real ax = 1-u*u, envelope = ax*ax, axialSlope = -4*u*ax/length;
        Real aft = speed*age-along, width = 1.38+.11*speed+.055*age;
        Real side = beam<0 ? -1 : 1;
        Real spread=.29+.068*smoothstep(2.,6.,speed);
        Real v = (abs(beam)-1.93-spread*aft)/width;
        Real opposite=(abs(beam)+1.93-spread*aft)/width;
        Real edge = max(0,1-v*v/6.25), c = cos(3.75*v);
        Real wing = edge*edge*c;
        Real wingSlope = -4*v/6.25*edge*c - 3.75*edge*edge*sin(3.75*v);
        Real inner=max(0,1-opposite*opposite/6.25), ci=cos(3.75*opposite);
        wing+=.49*inner*inner*ci;
        Real innerSlope=.49*(-4*opposite/6.25*inner*ci-3.75*inner*inner*sin(3.75*opposite));
        Real middle = 4.0+.22*age, q = beam/middle;
        Real inside = max(0,1-q*q), transverse = .48*inside*inside;
        Real k = min(1.65,9.81/max(1,speed*speed));
        Real kt = k*aft+.35, ct = cos(kt), st = sin(kt);
        Real crest = wing+transverse*ct;
        Real enter = saturate(age/1.5), leave = saturate((12-age)/4);
        Real rise = enter*enter*(3-2*enter), fall = leave*leave*(3-2*leave);
        Real energy = .28*smoothstep(.55,4.3,speed)*exp(-.088*age);
        Real denom = sqrt(beam*beam+1), hull = 1+bias*beam/denom;
        Real amp = energy*rise*fall, weight = amp*envelope*hull;
        Real ampT = energy*(4*enter*(1-enter)*fall - 1.5*rise*leave*(1-leave))-.088*amp;
        Real midSlope = -1.92*q*inside*ct/middle;
        return Real4(weight*crest,
            amp*axialSlope*hull*crest + weight*((wingSlope+innerSlope)*spread/width+transverse*k*st),
            weight*((wingSlope+innerSlope)*side/width+midSlope) + amp*envelope*crest*bias/(denom*denom*denom),
            (ampT*envelope-amp*drift*axialSlope)*hull*crest
              +weight*((wingSlope*(-spread*speed-.055*v)+innerSlope*(-spread*speed-.055*opposite))/width - midSlope*.22*q - transverse*k*speed*st));
    }

    // Stationary gravity-wave branches. For beam/aft = s their propagation
    // directions satisfy 2*s*tan(theta)^2 - tan(theta) + s = 0.
    // The envelope is smooth through the Kelvin cusp. The finite hull filters
    // short, steep waves and narrows the visible wedge of a planing craft.
    Real4 WaveBranch(Real aft, Real beam, Real speed, Real hull, Real breadth, Real footprint)
    {
        Real range=max(36.,2.7*hull+8*speed);
        if (aft<=0 || aft>=range) return Real4(0,0,0,0);
        Real lateral=sqrt(beam*beam+.0025), run=aft+.30*breadth+.018*hull;
        Real s=lateral/run;
        if (s>=.375) return Real4(0,0,0,0);
        Real fr=speed/sqrt(9.81*hull), planing=smoothstep(.48,1.28,fr);
        Real apparent=min(.354,.23/max(.5,fr));
        Real edge=(1-smoothstep(.326,.375,s))*(1-.88*planing*smoothstep(.76*apparent,1.65*apparent,s));
        Real q=min(s,.3534), k=9.81/(speed*speed), root=sqrt(1-8*q*q);
        Real t1=2*q/(1+root), t2=min(9.,(1+root)/max(.03,4*q));
        Real c1=sqrt(1+t1*t1), c2=sqrt(1+t2*t2);
        Real k1=k*c1*c1, k2=k*c2*c2;
        Real resolve1=1-smoothstep(.85,2.8,k1*footprint), resolve2=1-smoothstep(.85,2.8,k2*footprint);
        if (resolve1+resolve2<=0) return Real4(0,0,0,0);
        Real phase1=k*c1*(run-t1*lateral)-.7854;
        Real phase2=k*c2*(run-t2*lateral)+.7854;
        Real wing=resolve2*1.28*smoothstep(.018,.13,s)*exp(-.031*breadth*k2);
        Real cross=resolve1*.76*(1-.85*planing)*(1-.38*smoothstep(.14,.36,s));
        Real birth=smoothstep(0,max(1.35,.49*breadth),aft);
        Real gain=min(.025*speed*speed,.14+.029*breadth)*smoothstep(.65,3.6,speed)*birth*edge
                 *(1-smoothstep(.67*range,range,aft))/sqrt(1+aft/(3.+.42*hull));
        // At a stationary phase point d(phase)/d(theta) vanishes; gradients
        // therefore use the local physical wave vectors on each branch. A
        // small bound harmonic sharpens divergent crests and widens their troughs.
        Real face=cos(phase2);
        Real d1=-gain*cross*sin(phase1)*k*c1, d2=-gain*wing*sin(phase2)*k*c2*(1+.24*face);
        return Real4(gain*(cross*cos(phase1)+wing*(face+.12*(face*face-.5))),d1+d2,
                     -(d1*t1+d2*t2)*beam/lateral,0);
    }

    Real4 Kelvin(Real aft, Real beam, Real speed, Real hull, Real breadth, Real footprint)
    {
        if (speed<.65 || hull<=0 || breadth<=0) return Real4(0,0,0,0);
        // The bow parts the water. At the stern the same displaced water closes in.
        // The spacing between the two pressure sources sets their interference.
        Real fromBow=aft+.92*hull;
        Real4 bow=WaveBranch(fromBow,beam,speed,hull,breadth,footprint);
        Real4 stern=WaveBranch(aft,beam,speed,hull,breadth,footprint);
        Real hullWidth=breadth*(.32+.68*smoothstep(0,.21*hull,fromBow));
        Real side=smoothstep(.17*hullWidth,.50*hullWidth,abs(beam));
        Real weight=side+(1-side)*smoothstep(-.37*breadth,.48*breadth,aft);
        // Air is entrained on steep crests by the bow shoulder. The free wave
        // train carries its shape into the distance after the bubbles disperse.
        Real cap=.36*side*smoothstep(.08,.52,bow.x)*(1-smoothstep(.36*breadth,1.50*breadth,fromBow));
        return Real4(bow.x*weight-.56*stern.x,bow.y*weight-.56*stern.y,bow.z*weight-.56*stern.z,cap);
    }

    // A finite wave packet emitted at a fixed world position. Its rings spread
    // after the bow or swimmer has moved on. Return height, XY slope and vertical speed.
    Real4 Impact(Real dx, Real dy, Real age, Real strength)
    {
        Real radius = 2.35*age, r2 = dx*dx+dy*dy;
        if (strength <= 0 || age <= 0 || age >= 6 || r2 > (radius+4)*(radius+4))
            return Real4(0,0,0,0);
        Real r = sqrt(r2+.0025), width = .51+.10*age, q = (r-radius)/width;
        if (abs(q)>4) return Real4(0,0,0,0);
        Real enter = saturate(age/.18), leave = saturate(6-age);
        Real decay = strength*exp(-.49*age);
        Real envelope = smoothstep(0,.18,age)*smoothstep(0,1,6-age);
        Real envT = 6*enter*(1-enter)/.18*smoothstep(0,1,6-age) - smoothstep(0,.18,age)*6*leave*(1-leave);
        Real bell = exp(-q*q*.78), c = cos(2.6*q);
        Real shape = bell*c, slope = bell*(-1.56*q*c-2.6*sin(2.6*q));
        Real dr = decay*envelope*slope/width;
        return Real4(decay*envelope*shape, dr*dx/r, dr*dy/r,
                     decay*((envT-.49*envelope)*shape - envelope*slope*(2.35+.10*q)/width));
    }
    // A fluke displaces a wider patch than a bow. Stretch the packet in both
    // space and time, including the derivative factors for buoyancy and light.
    Real4 WhaleRing(Real dx, Real dy, Real age, Real strength)
    {
        if (strength<=0 || age<=0 || age>=12) return Real4(0,0,0,0);
        // Wave energy spreads over a circumference growing from a 2.2 m
        // fluke radius at 2.5 m/s. Amplitude falls with its inverse square root.
        Real radius=2.2+2.5*age;
        Real4 w=Impact(.47*dx,.47*dy,.50*age,.82*strength*sqrt(2.2/radius));
        return Real4(w.x,.47*w.y,.47*w.z,.50*w.w-1.25*w.x/radius);
    }
};
