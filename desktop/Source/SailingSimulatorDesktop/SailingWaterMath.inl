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
    // Arrival time varies along the reef. Its derivatives keep the lighting normal
    // and the orbital motion on the same oblique crest as the displacement.
    Real4 Peel(Real x, Real y, Real seed)
    {
        Real a = .042*x+.025*y+seed, b = .019*x-.062*y-1.7*seed;
        return Real4(.020*x-.013*y + .86*sin(a)+.42*sin(b),
                     .020+.03612*cos(a)+.00798*cos(b),
                     -.013+.0215*cos(a)-.02604*cos(b), 0);
    }

    Real BreakerFrequency() { return 1.16; }
    Real ProfileIndex(Real d) { return max(0,(d+8)*2); }
    // A half-metre Hermite interval, returning the value and derivative per metre.
    Real4 Curve(Real a, Real b, Real da, Real db, Real u)
    {
        Real c=3*(b-a)-da-.5*db, e=2*(a-b)+.5*(da+db);
        return Real4(a+u*(.5*da+u*(c+u*e)), da+u*(4*c+6*u*e),0,0);
    }

    // Signed distance of the swash tip from the still-water line, in metres.
    Real SwashFront(Real t, Real scale, Real seed)
    {
        Real phase = BreakerFrequency()*t+seed-.95;
        Real pulse = .5+.5*cos(phase+.44*(1-cos(phase)));
        Real set = .73+.27*cos(.32*t+seed);
        return 1.4-(3.1+3.4*sqrt(scale)*set)*pulse;
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
        Real beat=.21*travel.x+.29*t+seed, group=.79+.21*cos(beat), groupSlope=-.21*sin(beat);
        Real incident=.62*sqrt(scale)*group*shoaling.x;
        // Energy flux gives the unbroken amplitude. A depth-limited wave can carry
        // approximately H=0.78h. Excess energy feeds the front and the trailing bore.
        Real limit=.39*depth.x, ratio=incident/limit, r2=ratio*ratio, r4=r2*r2;
        Real broken=r4/(1+r4), amplitude=incident/sqrt(sqrt(1+r4));
        Real ampD=amplitude*((1-broken)*(shoaling.y/shoaling.x+groupSlope*.21*k/group)+broken*depth.y/depth.x);
        Real ampT=amplitude*(1-broken)*groupSlope*.29/group;
        Real c = cos(phase), s = sin(phase);
        Real steep = .35+.20*shoal;
        Real crest = c + steep*(c*c-.5) - .35*s*c;
        Real crestSlope = -s*(1+2*steep*c) - .35*(c*c-s*s);
        Real steepD = -.20*6*offshore*(1-offshore)/27;
        Real h = amplitude*window;
        Real lip = smoothstep(.30,.94,c-.25*s);
        Real spent = smoothstep(-.35,.82,s)*(.68+.32*c);
        Real foam = window*smoothstep(.45,1.15,ratio)*(.95*lip+.67*spent)*(.82+.18*group);
        return Real4(h*crest,(ampD*window+amplitude*windowD)*crest+h*(crestSlope*k+steepD*(c*c-.5)),
                     ampT*window*crest+h*crestSlope*omega,foam);
    }

    // a is distance aft of the transoms, b the lateral offset. Two divergent
    // bow waves and their troughs travel with the yacht. Width grows down-wake.
    Real HullWeight(Real beam, Real bias) { return 1+bias*beam/sqrt(beam*beam+1); }

    Real HullWave(Real a, Real b, Real speed, Real bias)
    {
        if (a < -10 || a > 24 || abs(b) > 16 || speed < .35) return 0;
        Real aft = max(a+8,0.0), width = .82+.036*aft;
        Real cross = abs(b)-1.92-.285*aft;
        Real envelope = exp(-cross*cross/(width*width) - aft*.044);
        Real amp = .38*smoothstep(.35,4.6,speed)*smoothstep(-10,-6,a)*(1-smoothstep(9,24,a));
        return HullWeight(b,bias)*amp*envelope*cos(cross*2.75/width);
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
        Real v = (abs(beam)-1.93-.335*aft)/width;
        Real edge = max(0,1-v*v/6.25), c = cos(3.75*v);
        Real wing = edge*edge*c;
        Real wingSlope = -4*v/6.25*edge*c - 3.75*edge*edge*sin(3.75*v);
        Real middle = 4.0+.22*age, q = beam/middle;
        Real inside = max(0,1-q*q), transverse = .34*inside*inside;
        Real k = min(1.65,9.81/max(1,speed*speed));
        Real kt = k*aft+.35, ct = cos(kt), st = sin(kt);
        Real crest = wing+transverse*ct;
        Real enter = saturate(age/1.5), leave = saturate((12-age)/4);
        Real rise = enter*enter*(3-2*enter), fall = leave*leave*(3-2*leave);
        Real energy = .28*smoothstep(.55,4.3,speed)*exp(-.088*age);
        Real denom = sqrt(beam*beam+1), hull = 1+bias*beam/denom;
        Real amp = energy*rise*fall, weight = amp*envelope*hull;
        Real ampT = energy*(4*enter*(1-enter)*fall - 1.5*rise*leave*(1-leave))-.088*amp;
        Real midSlope = -1.36*q*inside*ct/middle;
        return Real4(weight*crest,
            amp*axialSlope*hull*crest + weight*(wingSlope*.335/width+transverse*k*st),
            weight*(wingSlope*side/width+midSlope) + amp*envelope*crest*bias/(denom*denom*denom),
            (ampT*envelope-amp*drift*axialSlope)*hull*crest
              +weight*(wingSlope*(-.335*speed-.055*v)/width - midSlope*.22*q - transverse*k*speed*st));
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
};
