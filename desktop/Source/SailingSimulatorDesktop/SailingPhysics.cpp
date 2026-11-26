#include "SailingPhysics.h"

#include "Containers/StaticArray.h"
#include "Math/Float16Color.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include <cmath>

namespace Sailing
{
namespace
{
constexpr double Gravity = 9.81;
constexpr double WaterDensity = 1025.0;
constexpr double AirDensity = 1.225;
constexpr double SailAreaM2 = 80.0;
constexpr double StationsX[] = {-4.0, -1.4, 1.4, 4.0};
constexpr double StationsY[] = {-1.9, 1.9};
constexpr double WaterplanePerStationM2 = 1.75;
constexpr int32 StationCount = UE_ARRAY_COUNT(StationsX) * UE_ARRAY_COUNT(StationsY);
constexpr double StaticDraftM = MassKg / (WaterDensity * WaterplanePerStationM2 * StationCount);

using Real = double;
using UInt = uint32;
struct Real4 { Real x, y, z, w; };
using std::abs;
using std::atan2;
using std::cos;
using std::exp;
using std::floor;
using std::log;
using std::sin;
using std::sqrt;
Real min(Real a, Real b) { return FMath::Min(a,b); }
Real max(Real a, Real b) { return FMath::Max(a,b); }
Real saturate(Real x) { return FMath::Clamp(x,0.,1.); }
Real smoothstep(Real a, Real b, Real x) { return FMath::SmoothStep(a,b,x); }
#include "SailingWaterMath.inl"

struct FWave
{
    double WavelengthM;
    double AmplitudeM;
    double DirectionDegrees;
    double PhaseRad;
    double GaleGrowth;
    bool bStorm = false;
};

// Cross-seas include both travelling swell and locally generated wind waves.
constexpr FWave Waves[] = {
    { 108.0, 0.161, 155.0, 0.7, 1.0 }, { 63.0, 0.112, 202.0, 1.4, .74 },
    { 33.5, 0.117, 139.0, 3.3, .38 }, { 24.4, 0.084, 104.0, 4.1, .29 },
    // Close frequencies in each swell band form traveling sets separated by quieter water.
    { 90.5, 0.089, 162.0, 2.35, .78 }, { 72.0, 0.062, 194.0, 5.45, .72 },
    // Dispersive pairs on either side of the wind build short-crested trains on the crossing swell.
    { 7.20, 0.067, -121.0, 5.6, .05 }, { 4.90, 0.063, -77.0, 1.9, 0 },
    { 3.72, 0.049, -61.0, .37, 0 }, { 3.04, 0.046, -120.0, 2.7, 0 },
    { 2.48, 0.034, -129.0, 5.97, 0 }, { 2.08, 0.033, -88.0, 0.9, 0 },
    { 1.75, 0.026, -110.0, 2.75, 0 }, { 1.46, 0.020, -69.0, 4.85, 0 },
    // Nearby frequencies form groups; the shorter, oblique wind seas break across their faces.
    { 224.0, 2.30, -95.0, 1.15, 0, true }, { 128.0, 1.92, -78.0, 4.65, 0, true },
    { 172.0, 1.38, -109.0, 2.57, 0, true }, { 78.0, .99, -87.0, .36, 0, true },
    { 48.0, 1.13, -111.0, 5.21, 0, true }, { 31.0, .73, -76.0, 3.69, 0, true },
    { 21.0, .48, -98.0, 1.78, 0, true }, { 13.5, .30, -120.0, 5.57, 0, true },
};
static_assert(UE_ARRAY_COUNT(Waves) == SeaWaveCount);

struct FWaveMode
{
    FVector2D Direction;
    double K;
    double Omega;
};

const auto WaveModes = []
{
    TStaticArray<FWaveMode, UE_ARRAY_COUNT(Waves)> Modes;
    for (int32 Index = 0; Index < Modes.Num(); ++Index)
    {
        const FWave& Wave = Waves[Index];
        const double Angle = FMath::DegreesToRadians(Wave.DirectionDegrees);
        const double K = 2.0 * UE_DOUBLE_PI / Wave.WavelengthM;
        Modes[Index] = { { FMath::Cos(Angle), FMath::Sin(Angle) }, K,
            FMath::Sqrt(Gravity * K) };
    }
    return Modes;
}();

// Integrate the finite-depth dispersion relation along the same shelf profiles
// that build the island meshes. Both Chaos and the Metal material read these samples.
struct FShelf { double Reach; bool bVolcanic; };
constexpr FShelf Shelves[] = {
#define CORAL_CAY(name,cx,cy,rx,ry,h,ridge,phase) {rx < ry ? rx : ry, false},
#define CORAL_VOLCANO(cx,cy,r,h) {r, true},
#include "CoralPassLayout.inl"
#undef CORAL_CAY
#undef CORAL_VOLCANO
};

FLinearColor ShoalingAt(const FShelf& Shelf, double D)
{
    const double Offshore=FMath::Max(0.,D);
    const double R=FMath::Min(1.,Offshore/(.86*Shelf.Reach));
    // The swash is a thin wet layer. Ease the survey's square-root toe into it.
    const double Bed=Shelf.bVolcanic ? .6+93.*Offshore/Shelf.Reach
        : .1+23.*FMath::Pow(R,1.55)+4.8*FMath::Sqrt(R);
    const double H=FMath::Max(.46,Bed);
    const double Omega=SailingWaterMath().BreakerFrequency(), K0=Omega*Omega/Gravity;
    double Low=K0, High=2.;
    for (int32 I=0; I<35; ++I)
    {
        const double K=(Low+High)*.5;
        if (K*std::tanh(K*H)<K0) Low=K;
        else High=K;
    }
    const double K=(Low+High)*.5, KH=K*H;
    const double Cg=.5*Omega/K*(1+2*KH/std::sinh(2*KH));
    return FLinearColor(0,FMath::Sqrt((.5*Omega/K0)/Cg),H,K);
}

FVector RightOf(const FVector& Forward)
{
    return FVector::CrossProduct(FVector::UpVector, Forward);
}
}

TConstArrayView<FLinearColor> SurfProfileTexels()
{
    static const TArray<FLinearColor> Table=[] {
        TArray<FLinearColor> Out;
        Out.SetNumZeroed(2*UE_ARRAY_COUNT(Shelves)*SurfProfileWidth);
        for (int32 Row=0; Row<int32(UE_ARRAY_COUNT(Shelves)); ++Row)
        {
            FLinearColor* P=Out.GetData()+2*Row*SurfProfileWidth;
            FLinearColor* Slope=P+SurfProfileWidth;
            for (int32 I=0; I<SurfProfileWidth; ++I)
            {
                const double D=-8.+.5*I;
                P[I]=ShoalingAt(Shelves[Row],D);
                if (I) P[I].R=P[I-1].R+(P[I-1].A+4*ShoalingAt(Shelves[Row],D-.25).A+P[I].A)/12.;
            }
            const float AtShore=P[16].R;
            for (int32 I=0; I<SurfProfileWidth; ++I)
            {
                const int32 L=FMath::Max(0,I-1), R=FMath::Min(SurfProfileWidth-1,I+1);
                const float Span=.5f*(R-L);
                Slope[I]=FLinearColor(P[I].A,(P[R].G-P[L].G)/Span,(P[R].B-P[L].B)/Span,0);
                P[I].R-=AtShore;
            }
        }
        return Out;
    }();
    return Table;
}

TConstArrayView<FFloat16Color> RockSurfTexels()
{
    static const auto Atlas=[] {
        constexpr int32 Tiles = 0
            #define SURF_TILE(...) +1
            #include "CoralSurfTiles.inl"
            #undef SURF_TILE
            ;
        TArray<FFloat16Color> Texels;
        Texels.SetNum(Tiles*RockTileWidth*RockTileWidth);
        TArray<uint8> File;
        const FString Path=FPaths::ProjectContentDir()/TEXT("Coastal/Surf/RockFlow.bin");
        const int32 Bytes=Texels.Num()*sizeof(FFloat16Color);
        if (FFileHelper::LoadFileToArray(File,*Path) && File.Num()==Bytes)
            FMemory::Memcpy(Texels.GetData(),File.GetData(),Bytes);
        else
        {
            UE_LOG(LogTemp,Error,TEXT("Missing or incomplete rock surf survey: %s"),*Path);
            FMemory::Memzero(Texels.GetData(),Bytes);
        }
        return Texels;
    }();
    return Atlas;
}

static Real4 ShoreArrival(SailingWaterMath& Water, FVector2D P, double Row, Real4& Flow, FVector2D& ContactSlope)
{
    Real4 Peel=Water.Peel(P.X,P.Y,Row);
    const Real4 Grid=Water.RockTile(P.X,P.Y,Row);
    if (Grid.z==0) return Peel;
    const int32 X=int32(Grid.x), Y=int32(Grid.y);
    const double U=Grid.x-X, V=Grid.y-Y;
    const auto* Corner=RockSurfTexels().GetData()+Y*RockTileWidth+X;
    const auto A=Corner[0].GetFloats(), B=Corner[1].GetFloats();
    const auto C=Corner[RockTileWidth].GetFloats(), D=Corner[RockTileWidth+1].GetFloats();
    const auto Blend=[U,V](double A0,double B0,double C0,double D0) {
        return FMath::Lerp(FMath::Lerp(A0,B0,U),FMath::Lerp(C0,D0,U),V);
    };
    Flow={Blend(A.R,B.R,C.R,D.R),Blend(A.G,B.G,C.G,D.G),Blend(A.B,B.B,C.B,D.B),Blend(A.A,B.A,C.A,D.A)};
    Peel.x+=Flow.x;
    Peel.y+=Grid.z*FMath::Lerp(B.R-A.R,D.R-C.R,V);
    Peel.z+=Grid.z*FMath::Lerp(C.R-A.R,D.R-B.R,U);
    ContactSlope=Grid.z*FVector2D(FMath::Lerp(B.A-A.A,D.A-C.A,V),FMath::Lerp(C.A-A.A,D.A-B.A,U));
    return Peel;
}

bool FindShoreLip(FVector2D ProbeM, FSeaFrame Frame, FShoreLip& Out)
{
    SailingWaterMath Water;
    // Follow the phase gradient to the nearby crest instead of emitting into
    // random troughs. Reject dry land, deep water and non-breaking waves.
    for (int32 Step=0; Step<2; ++Step)
    {
        const Real4 Coast=Water.Coast(ProbeM.X,ProbeM.Y);
        if (Coast.x<.65 || Coast.x>22.) return false;
        Real4 Flow{};
        FVector2D ContactSlope=FVector2D::ZeroVector;
        const Real4 Peel=ShoreArrival(Water,ProbeM,Coast.w,Flow,ContactSlope);
        if (Flow.w>=1.) return false;
        const double Index=Water.ProfileIndex(Coast.x);
        const int32 I=int32(Index), Row=int32(Coast.w);
        const FLinearColor* P=SurfProfileTexels().GetData()+2*Row*SurfProfileWidth+I;
        const double Fraction=Index-I;
        const double Frequency=Water.BreakerFrequency();
        const double T=Frame.TimeS+Peel.x;
        const Real4 Travel=Water.Curve(P[0].R,P[1].R,P[SurfProfileWidth].R,P[SurfProfileWidth+1].R,Fraction);
        const double Phase=FMath::UnwindRadians(Travel.x+Frequency*T+Coast.w);
        const FVector2D Gradient=Travel.y*FVector2D(Coast.y,Coast.z)+Frequency*FVector2D(Peel.y,Peel.z);
        if (Step==0)
        {
            const FVector2D Shift=Gradient*(Phase/FMath::Max(.001,Gradient.SizeSquared()));
            if (Shift.SizeSquared()>36.) return false;
            ProbeM-=Shift;
            continue;
        }
        if (FMath::Abs(Phase)>.28) return false;
        const auto Coeff=[](const FLinearColor& V){return Real4(V.R,V.G,V.B,V.A);};
        const Real4 Surf=Water.Roller(Coast.x,T,Frame.Scale,Coast.w,Coeff(P[0]),Coeff(P[1]),
            Coeff(P[SurfProfileWidth]),Coeff(P[SurfProfileWidth+1]),Fraction);
        if (Surf.w<.22) return false;
        const double WaveNumber=Gradient.Size();
        if (WaveNumber<.08) return false;
        Out={FVector(ProbeM,SeaHeight(ProbeM,Frame,true)),-Gradient/WaveNumber,float(Surf.w),float(Frequency/WaveNumber)};
        return true;
    }
    return false;
}

double SeaWaveAmplitude(int32 Index, double Scale)
{
    const FWave& Wave = Waves[Index];
    const double Factor = Wave.bStorm ? FMath::SmoothStep(1.6, double(HurricaneSeaScale), Scale)
        * (1. + .22*FMath::SmoothStep(double(StormSeaScale), double(HurricaneSeaScale), Scale))
        : Scale <= 1.0 ? Scale : 1.0 + (Scale - 1.0) * Wave.GaleGrowth;
    return Wave.AmplitudeM * Factor;
}

template<bool Motion,bool Hull = false>
static FSeaSample EvaluateSea(FVector2D XYm, double TimeS, double DepthM, double Scale, bool bCoralPass,
                              FVector2D TravelMps = FVector2D::ZeroVector)
{
    FSeaSample Result, Storm;
    double DepthHeight = 0., StormDepthHeight = 0.;
    FVector2D DepthSlope = FVector2D::ZeroVector, StormDepthSlope = FVector2D::ZeroVector;
    for (int32 Index = 0; Index < SeaWaveCount; ++Index)
    {
        const double Amplitude = SeaWaveAmplitude(Index, Scale);
        if (Amplitude == 0.0) continue;
        const FWaveMode& Mode = WaveModes[Index];
        FSeaSample& Band = Waves[Index].bStorm ? Storm : Result;
        const double Phase = Mode.K * FVector2D::DotProduct(Mode.Direction, XYm)
            - Mode.Omega * TimeS + Waves[Index].PhaseRad;
        double Sin, Cos;
        FMath::SinCos(&Sin, &Cos, Phase);
        // Deep-water second-order Stokes elevation: the bound harmonic has
        // amplitude k*a*a/2 and follows the phase of its parent wave.
        const double Steepness = Mode.K * Amplitude;
        const double Height = Amplitude * (Cos + Steepness * (Cos * Cos - 0.5));
        Band.HeightM += Height;
        if constexpr (!Motion) continue;
        Band.Compression += Mode.K*Amplitude*Cos;
        const double CrestSlope = Sin * (1.0 + 2.0 * Steepness * Cos);
        const FVector2D Slope = -Mode.Direction * (Steepness * CrestSlope);
        Band.Gradient += Slope;
        Band.SurfaceRiseMps += Mode.Omega * Amplitude * CrestSlope;

        const double Attenuation = DepthM > 0.0 ? FMath::Exp(-Mode.K * DepthM) : 1.0;
        (Waves[Index].bStorm ? StormDepthHeight : DepthHeight) += Height * Attenuation;
        (Waves[Index].bStorm ? StormDepthSlope : DepthSlope) += Slope * Attenuation;
        const double Speed = Mode.Omega * Amplitude * Attenuation;
        Band.VelocityMps += FVector(Mode.Direction.X * Cos, Mode.Direction.Y * Cos, CrestSlope) * Speed;
        if constexpr (Hull)
        {
            if (Waves[Index].WavelengthM >= 14.)
            {
                const double Encounter = Mode.Omega - Mode.K*FVector2D::DotProduct(Mode.Direction,TravelMps);
                const double Curvature = Cos + 2.*Steepness*(Cos*Cos-Sin*Sin);
                Band.SwellRiseMps += Amplitude*Encounter*CrestSlope;
                Band.SwellAccelerationMps2 -= Amplitude*Encounter*Encounter*Curvature;
            }
        }
    }
    if (bCoralPass)
    {
        SailingWaterMath Water;
        const Real4 Coast = Water.Coast(XYm.X, XYm.Y);
        if (Coast.x <= -8.0) return {};
        const Real4 Transmission = Water.StormTransfer(XYm.X, XYm.Y, Coast, Scale);
        const double StormSwell = Transmission.x;
        if constexpr (Motion)
        {
            const FVector2D TransmissionSlope(Transmission.y,Transmission.z);
            Storm.Gradient = StormSwell*Storm.Gradient + TransmissionSlope*Storm.HeightM;
            StormDepthSlope = StormDepthSlope*StormSwell + TransmissionSlope*StormDepthHeight;
            Storm.SurfaceRiseMps *= StormSwell;
            Storm.VelocityMps *= StormSwell;
            Storm.Compression *= StormSwell;
            if constexpr (Hull)
            {
                Storm.SwellRiseMps = Storm.SwellRiseMps*StormSwell + Storm.HeightM
                    * FVector2D::DotProduct(TravelMps,TransmissionSlope);
                Storm.SwellAccelerationMps2 *= StormSwell;
            }
        }
        Storm.HeightM *= StormSwell;
        if (Coast.x < 38.0)
        {
            Real4 Flow{};
            FVector2D ContactSlope=FVector2D::ZeroVector;
            const Real4 Peel = ShoreArrival(Water,XYm,Coast.w,Flow,ContactSlope);
            const double Sample=Water.ProfileIndex(Coast.x);
            const int32 I=int32(Sample), Row=int32(Coast.w);
            const FLinearColor* P=SurfProfileTexels().GetData()+2*Row*SurfProfileWidth+I;
            const auto Coeff=[](const FLinearColor& V){return Real4(V.R,V.G,V.B,V.A);};
            Real4 Surf = Water.Roller(Coast.x,TimeS+Peel.x,Scale,Coast.w,Coeff(P[0]),Coeff(P[1]),
                Coeff(P[SurfProfileWidth]),Coeff(P[SurfProfileWidth+1]),Sample-I);
            double BoreContactSlope=0.;
            if (Flow.w>.035)
            {
                const Real4 Travel=Water.Curve(P[0].R,P[1].R,P[SurfProfileWidth].R,P[SurfProfileWidth+1].R,Sample-I);
                const Real4 Bore=Water.RockBore(Flow.w,TimeS+Peel.x+Travel.x/Water.BreakerFrequency(),Scale,Coast.w);
                const Real4 Gate=Water.BoreWindow(Coast.x);
                Surf.x+=Gate.x*Bore.x;
                Surf.y+=Gate.x*Bore.z*Travel.y/Water.BreakerFrequency()+Gate.y*Bore.x;
                Surf.z+=Gate.x*Bore.z;
                BoreContactSlope=Gate.x*Bore.y;
            }
            const double Swell = Water.Swell(Coast.x);
            if constexpr (Motion)
            {
                const FVector2D Normal(Coast.y, Coast.z);
                Result.Compression *= Swell;
                if constexpr (Hull)
                {
                    Result.SwellRiseMps = Result.SwellRiseMps*Swell + Surf.z +
                        (Surf.y + Result.HeightM*Water.SwellSlope(Coast.x))*FVector2D::DotProduct(TravelMps,Normal)
                        + FVector2D::DotProduct(TravelMps,FVector2D(Peel.y,Peel.z)*Surf.z+ContactSlope*BoreContactSlope);
                    Result.SwellAccelerationMps2 *= Swell;
                }
                Result.Gradient = Swell*Result.Gradient + Normal*(Surf.y + Result.HeightM*Water.SwellSlope(Coast.x))
                    + FVector2D(Peel.y, Peel.z)*Surf.z+ContactSlope*BoreContactSlope;
                const double K=FMath::Lerp(P[0].A,P[1].A,Sample-I), H=FMath::Lerp(P[0].B,P[1].B,Sample-I);
                const double KH=K*H, AboveBed=K*FMath::Clamp(H-DepthM,0.,H);
                const double Denom=std::sinh(KH);
                const double VerticalTransfer = std::sinh(AboveBed)/Denom;
                DepthSlope = DepthSlope*Swell + Normal*(DepthHeight*Water.SwellSlope(Coast.x))
                    + (Normal*Surf.y + FVector2D(Peel.y,Peel.z)*Surf.z+ContactSlope*BoreContactSlope)*VerticalTransfer;
                Result.SurfaceRiseMps = Result.SurfaceRiseMps*Swell + Surf.z;
                Result.VelocityMps = Result.VelocityMps*Swell +
                    FVector(-(Normal.GetSafeNormal()+FVector2D(Flow.y,Flow.z))*(Surf.x*Water.BreakerFrequency()*std::cosh(AboveBed)/Denom),
                            Surf.z*VerticalTransfer);
            }
            Result.HeightM = Result.HeightM*Swell + Surf.x;
        }
    }
    Result.HeightM += Storm.HeightM;
    if constexpr (Motion)
    {
        Result.Gradient += Storm.Gradient;
        Result.Compression += Storm.Compression;
        Result.VelocityMps += Storm.VelocityMps;
        Result.SurfaceRiseMps += Storm.SurfaceRiseMps;
        // At the free surface the particle must move up the face as it travels
        // horizontally: w = eta_t + u*eta_x + v*eta_y. Extend that term below
        // the surface using the orbital attenuation of each participating mode.
        Result.VelocityMps.Z += FVector2D::DotProduct(FVector2D(Result.VelocityMps),
            DepthSlope + StormDepthSlope);
        if constexpr (Hull)
        {
            Result.SwellRiseMps += Storm.SwellRiseMps;
            Result.SwellAccelerationMps2 += Storm.SwellAccelerationMps2;
        }
    }
    return Result;
}

FSeaSample SampleSea(FVector2D XYm, double TimeS, double DepthM, double Scale, bool bCoralPass)
{
    return EvaluateSea<true>(XYm, TimeS, DepthM, Scale, bCoralPass);
}

double SeaHeight(FVector2D XYm, FSeaFrame Frame, bool bCoralPass)
{
    return EvaluateSea<false>(XYm, Frame.TimeS, 0, Frame.Scale, bCoralPass).HeightM;
}

FBoatWake FBoatWake::FromMotion(FVector2D CenterM, FVector2D Bow, FVector2D VelocityMps, double YawRadPerSec)
{
    const double Surge = FVector2D::DotProduct(VelocityMps, Bow);
    const FVector2D Travel = Surge >= 0 ? Bow : -Bow;
    const double Speed = FMath::Abs(Surge);
    const double Differential = 1.93*YawRadPerSec;
    const double PortPower = FMath::Square(Speed+Differential), StarboardPower = FMath::Square(Speed-Differential);
    const double Bias = (StarboardPower-PortPower)/FMath::Max(.01,StarboardPower+PortPower);
    return { CenterM-Travel*4.7, Travel, Speed, FMath::Clamp(Bias,-.7,.7) };
}

double FBoatWake::HeightAt(FVector2D XYm) const
{
    const FVector2D Delta = XYm - SternM;
    return SailingWaterMath().HullWave(-FVector2D::DotProduct(Delta, Forward),
        Forward.X*Delta.Y - Forward.Y*Delta.X, SpeedMps, HullBias);
}

void FWakeHistory::Record(const FBoatWake& Wake, float TimeS)
{
    if (bHasPosition && (PreviousStern-Wake.SternM).SizeSquared() > 25*25)
    {
        for (FLinearColor& Mark : Marks) Mark = FLinearColor::Transparent;
        NextTime = TimeS;
        ++Revision;
    }
    PreviousStern = Wake.SternM;
    bHasPosition = true;
    if (TimeS < NextTime || Wake.SpeedMps <= .55) return;
    Marks[Next] = FLinearColor(Wake.SternM.X, Wake.SternM.Y, TimeS, Wake.SpeedMps);
    Directions[Next] = FVector2f(Wake.Forward);
    HullBias[Next] = Wake.HullBias;
    Next = (Next+1)%Count;
    NextTime = TimeS + 1.5f;
    ++Revision;
}

FSeaSample FWakeHistory::At(FVector2D XYm, double TimeS) const
{
    FSeaSample Result;
    for (int32 I = 0; I < Count; ++I)
    {
        const FLinearColor& Mark = Marks[I];
        const double Age = TimeS-Mark.B;
        if (Mark.A <= .55f || Age <= 0 || Age >= 12) continue;
        const FVector2D Forward(Directions[I]), Beam(-Forward.Y,Forward.X);
        const FVector2D Delta = XYm-FVector2D(Mark.R,Mark.G);
        const Real4 Packet = SailingWaterMath().ShedWake(FVector2D::DotProduct(Delta,Forward),
            FVector2D::DotProduct(Delta,Beam),Age,Mark.A,HullBias[I]);
        Result.HeightM += Packet.x;
        Result.Gradient += Forward*Packet.y + Beam*Packet.z;
        Result.SurfaceRiseMps += Packet.w;
        Result.VelocityMps.Z += Packet.w;
    }
    return Result;
}

void FWaterImpacts::Emit(FVector2D CenterM, float TimeS, float HeightM)
{
    int32 Oldest = 0;
    for (int32 I = 0; I < Count; ++I)
    {
        if (Rings[I].A <= 0 || TimeS-Rings[I].B >= 6) { Oldest=I; break; }
        if (Rings[I].B < Rings[Oldest].B) Oldest=I;
    }
    Rings[Oldest] = FLinearColor(CenterM.X,CenterM.Y,TimeS,HeightM);
}

FSeaSample FWaterImpacts::At(FVector2D XYm, double TimeS, double DepthM) const
{
    FSeaSample Result;
    for (const FLinearColor& Ring : Rings)
    {
        const auto Wave = SailingWaterMath().Impact(XYm.X-Ring.R, XYm.Y-Ring.G, TimeS-Ring.B, Ring.A);
        Result.HeightM += Wave.x;
        Result.Gradient += FVector2D(Wave.y,Wave.z);
        Result.SurfaceRiseMps += Wave.w;
        Result.VelocityMps.Z += Wave.w;
    }
    for (const FLinearColor& Print : WhalePrints)
    {
        if (Print.A<=0 || TimeS-Print.B>=12.) continue;
        const auto Wave = SailingWaterMath().WhaleRing(XYm.X-Print.R, XYm.Y-Print.G, TimeS-Print.B, Print.A);
        Result.HeightM += Wave.x;
        Result.Gradient += FVector2D(Wave.y, Wave.z);
        Result.SurfaceRiseMps += Wave.w;
        Result.VelocityMps.Z += Wave.w;
    }
    if (DepthM>0) Result.VelocityMps.Z *= FMath::Exp(-1.4*DepthM);
    return Result;
}
FLinearColor SeaWaveParameter(int32 Index, FSeaFrame Frame)
{
    const FWaveMode& Mode = WaveModes[Index];
    return FLinearColor(Mode.Direction.X * Mode.K, Mode.Direction.Y * Mode.K, SeaWaveAmplitude(Index, Frame.Scale),
        FMath::Fmod(Waves[Index].PhaseRad - Mode.Omega * Frame.TimeS, 2.0 * UE_DOUBLE_PI));
}

double SignificantWaveHeight(double Scale)
{
    double Variance = 0;
    for (int32 Index = 0; Index < SeaWaveCount; ++Index)
    {
        const double Amplitude = SeaWaveAmplitude(Index, Scale);
        Variance += Amplitude * Amplitude * (.5 + FMath::Square(WaveModes[Index].K * Amplitude) / 8.);
    }
    return 4.0 * FMath::Sqrt(Variance);
}

FVector TrueWind(double TimeS, double SeaScale)
{
    const double TowardRad = FMath::DegreesToRadians(-93.0 + 4.0 * FMath::Sin(TimeS * 0.041));
    const double Speed = 8.5 * (1.0 + 0.12 * FMath::Sin(TimeS * 0.091) + 0.04 * FMath::Sin(TimeS * 0.37));
    const double Gale = FMath::SmoothStep(2.,double(HurricaneSeaScale),SeaScale);
    const double WindScale = SeaScale<=1. ? SeaScale : FMath::Sqrt(SeaScale)+1.95*Gale*Gale;
    return FVector(FMath::Cos(TowardRad), FMath::Sin(TowardRad), 0.0) * (Speed*WindScale);
}

float AdvanceSeaScale(float Current, float Target, float DeltaSeconds)
{
    // A passing rain band changes the light quickly. Limit the energy added to
    // the wave field so a weather change cannot grow a crest through the deck.
    const float Change = Target-Current;
    const float BuildRate = FMath::Lerp(.19f, .103f, FMath::SmoothStep(1.f, 2.f, Current));
    const float Rate = Change>0 ? FMath::Lerp(BuildRate,.075f,FMath::SmoothStep(3.7f,4.15f,Current)) : .10f;
    const float Dt = FMath::Max(0.f,DeltaSeconds);
    return Current + FMath::Clamp(Change*(1.f-FMath::Exp(-.35f*Dt)),-Rate*Dt,Rate*Dt);
}

FSail SolveSail(const FVector& Forward, const FVector& RelativeAir, const FHelm& Helm)
{
    FSail Result;
    const FVector Right = RightOf(Forward);
    const double AirForward = FVector::DotProduct(RelativeAir, Forward);
    const double AirRight = FVector::DotProduct(RelativeAir, Right);
    const double SpeedSquared = FMath::Square(AirForward) + FMath::Square(AirRight);
    if (SpeedSquared < 1e-6)
    {
        return Result;
    }

    Result.ApparentSpeedMps = FMath::Sqrt(SpeedSquared);
    Result.ApparentAngleRad = FMath::Atan2(-AirRight, -AirForward);
    const double AngleDeg = FMath::RadiansToDegrees(FMath::Abs(Result.ApparentAngleRad));
    // Ease the automatic sheet when backing under power so a filled sail
    // cannot cancel the propellers during a stern-first manoeuvre.
    const double ReverseEase = Helm.bEngineOn ? FMath::SmoothStep(0., .65, -Helm.Throttle) : 0.;
    const double SheetDeg = Helm.bAutoTrim ? FMath::Clamp(AngleDeg - 16.0 * (1.0 - ReverseEase), 7.0, 87.0)
        : FMath::Lerp(7.0, 87.0, FMath::Clamp(Helm.SheetEase, 0.0, 1.0));
    Result.SheetAngleRad = FMath::DegreesToRadians(SheetDeg);

    const double Alpha = FMath::DegreesToRadians(FMath::Clamp(AngleDeg - SheetDeg, 0.0, 90.0));
    constexpr double Stall = UE_DOUBLE_PI * 18.0 / 180.0;
    const double Attached = 1.22 * FMath::Sin(0.5 * UE_DOUBLE_PI * FMath::Min(Alpha / Stall, 1.0));
    const double Separation = FMath::SmoothStep(Stall, 0.62, Alpha);
    const double Fill = FMath::SmoothStep(28.0, 46.0, AngleDeg) * FMath::SmoothStep(0.0, 0.12, Alpha);
    const double Lift = Fill * FMath::Lerp(Attached, 1.12 * FMath::Sin(2.0 * Alpha), Separation);
    const double Drag = 0.025 + Fill * (0.08 * FMath::Square(Lift) + 1.10 * FMath::Square(FMath::Sin(Alpha)));

    const FVector DragDir = (Forward * AirForward + Right * AirRight) / Result.ApparentSpeedMps;
    const double Tack = AirRight >= 0.0 ? 1.0 : -1.0;
    const FVector LiftDir = (Forward * FMath::Abs(AirRight) - Right * (Tack * AirForward)) / Result.ApparentSpeedMps;
    // Spill increasing pressure from the rig above a fresh breeze. Drive and heel still
    // rise in gusts, but the full sail cannot lever a hull out of the water in a gale.
    constexpr double ReefPressureSpeedSq = 12.*12.;
    const double Excess = FMath::Max(0.,SpeedSquared - ReefPressureSpeedSq);
    const double WorkingSpeedSq = FMath::Min(SpeedSquared,ReefPressureSpeedSq) + Excess/(1.+Excess/80.);
    Result.WorkingAreaFraction = WorkingSpeedSq/SpeedSquared;
    Result.ForceN = 0.5 * AirDensity * WorkingSpeedSq * SailAreaM2 * (Lift * LiftDir + Drag * DragDir);
    return Result;
}

FLoads CalculateLoads(const FRigidState& State, const FHelm& Helm, double TimeS, double SeaScale,
                      bool bCoralPass, const FWaterImpacts* Impacts, const FWakeHistory* Wake)
{
    FLoads Loads;
    const auto Point = [&State](const FVector& LocalM) { return State.OriginM + State.Rotation.RotateVector(LocalM); };
    const auto VelocityAt = [&State](const FVector& WorldM)
    {
        return State.VelocityMps + FVector::CrossProduct(State.AngularVelocityRad, WorldM - State.CenterOfMassM);
    };
    const auto Apply = [&State, &Loads](const FVector& ForceN, const FVector& WorldM)
    {
        Loads.ForceN += ForceN;
        Loads.TorqueNm += FVector::CrossProduct(WorldM - State.CenterOfMassM, ForceN);
    };

    const FVector Forward = State.Rotation.GetForwardVector().GetSafeNormal2D(UE_SMALL_NUMBER,
        FVector::CrossProduct(State.Rotation.GetRightVector(),FVector::UpVector).GetSafeNormal2D());
    const FVector Right = RightOf(Forward);
    double Waterline = 0., Rise = 0., WaveAcceleration = 0., WetStations = 0.;
    double BowMoment = 0., BeamMoment = 0., BowSpanSq = 0., BeamSpanSq = 0.;
    double BowRiseMoment = 0., BeamRiseMoment = 0.;
    double BowEntrySq = 0.;
    for (const double X : StationsX)
    {
        for (const double Y : StationsY)
        {
            const FVector Station = Point({ X, Y, -StaticDraftM });
            const FVector2D XY(State.OriginM + Forward*X + Right*Y);
            FSeaSample Sea = EvaluateSea<true,true>(XY,TimeS,StaticDraftM,SeaScale,bCoralPass,FVector2D(State.VelocityMps));
            if (Impacts)
            {
                const FSeaSample Ripple = Impacts->At(XY, TimeS);
                Sea.HeightM += Ripple.HeightM;
            }
            if (Wake)
            {
                const FSeaSample Trail = Wake->At(XY,TimeS);
                Sea.HeightM += Trail.HeightM;
            }
            const double Wet = FMath::SmoothStep(0.,StaticDraftM*.55,Sea.HeightM-Station.Z);
            WetStations += Wet;
            if (X == StationsX[UE_ARRAY_COUNT(StationsX)-1])
            {
                const double Entry = FMath::Clamp(Sea.SwellRiseMps-VelocityAt(Station).Z,0.,6.);
                BowEntrySq += Wet*Entry*Entry;
            }
            Waterline += Sea.HeightM;
            WaveAcceleration += Sea.SwellAccelerationMps2;
            // Only the sustained rise of the supporting plane entrains both hulls.
            // Short ripples and the boat's own wash still contribute displacement.
            Rise += Sea.SwellRiseMps;
            BowMoment += X*Sea.HeightM;
            BeamMoment += Y*Sea.HeightM;
            BowRiseMoment += X*Sea.SwellRiseMps;
            BeamRiseMoment += Y*Sea.SwellRiseMps;
            BowSpanSq += X*X;
            BeamSpanSq += Y*Y;
        }
    }

    // Fit one supporting waterplane to both hulls. Short crests at one bow cannot
    // kick the entire rigid body. The loaded draft still puts the model at its authored waterline.
    const double AbovePlane = State.OriginM.Z-Waterline/StationCount;
    // Keep the loaded hull coupled through the crest of a fast head sea.
    // Once it has cleared its own draft the pressure falls away into free flight.
    const double WaveCoupling = (1.-FMath::SmoothStep(StaticDraftM*.48,StaticDraftM*1.9,AbovePlane))
        * FMath::SmoothStep(1.6,3.8,SeaScale);
    const double Contact = FMath::Max(WaveCoupling,FMath::Min(1.,WetStations*.5));
    const double HeaveFrequency = 3.4 + 1.8*WaveCoupling; // rad/s, including the water accelerated with the hulls
    // Long-wave pressure starts slowing the ascent before the crest passes underneath.
    const double Heave = FMath::Clamp(WaveAcceleration/StationCount,-Gravity*(1.+1.25*WaveCoupling),Gravity*(1.+.75*WaveCoupling))
        + HeaveFrequency*HeaveFrequency*(Waterline/StationCount-State.OriginM.Z)
        + 1.85*HeaveFrequency*(Rise/StationCount-State.VelocityMps.Z);
    Loads.ForceN.Z += Contact * MassKg * FMath::Clamp(Gravity+Heave,-(.30+1.45*WaveCoupling)*Gravity,(2.15+1.1*WaveCoupling)*Gravity);
    const FVector CenterOfEffort = Point({ 0.25, 0.0, 4.4 });
    if (Helm.bHoveTo)
    {
        const FVector2D Offset = Helm.AnchorM - FVector2D(State.OriginM);
        const FVector2D Holding = (Offset * 780.0 - FVector2D(State.VelocityMps) * 6100.0).GetClampedToMaxSize(21000.0);
        Loads.ForceN += FVector(Holding, 0);
    }
    else
    {
        const FSail Sail = SolveSail(Forward,TrueWind(TimeS,SeaScale)-VelocityAt(CenterOfEffort),Helm);
        const double EffortHeight = 2.6 + 1.8*FMath::Sqrt(Sail.WorkingAreaFraction);
        Apply(Sail.ForceN,Point({.25,0.,EffortHeight}));
    }

    const FVector Keel = Point({ 0.0, 0.0, -0.78 });
    const FVector Slope = Forward*(BowMoment/BowSpanSq) + Right*(BeamMoment/BeamSpanSq);
    // Orbital motion decays below the local waterplane, including at the top of a high crest.
    const auto Immersion = [&](const FVector& At)
    {
        return FMath::Max(0.,Waterline/StationCount + FVector::DotProduct(Slope,At-State.OriginM) - At.Z);
    };
    const FSeaSample KeelSea = SampleSea({ Keel.X, Keel.Y }, TimeS, Immersion(Keel), SeaScale, bCoralPass);
    const double HullWet = FMath::SmoothStep(-0.12, 0.35, KeelSea.HeightM - Keel.Z);
    const FVector Flow = VelocityAt(Keel) - KeelSea.VelocityMps;
    const double U = FVector::DotProduct(Flow, Forward);
    const double V = FVector::DotProduct(Flow, Right);
    const double KeelLimit = 750.0 * (U * U + V * V);
    const double KeelLift = FMath::Clamp(-1550.0 * FMath::Abs(U) * V, -KeelLimit, KeelLimit);
    // Evaluate the resistance curve at the equivalent original cruising speed.
    // At equal engine thrust both the linear and quadratic terms balance at 1.5x speed.
    const double ResistanceSpeed = U / CruisingSpeedScale;
    const double CruiseDrag = (65.0 + 165.0*FMath::Abs(ResistanceSpeed))*ResistanceSpeed;
    // Above the full-power cruising point the two displacement hulls make
    // steep bow waves. Each bow also loses headway as it meets a rising face.
    const double AboveCruise = FMath::Max(0.,FMath::Abs(U)-8.);
    const double WaveMaking = .95*WaterDensity*AboveCruise*AboveCruise;
    const double BowDrag = .5*WaterDensity*1.7*(BowEntrySq/UE_ARRAY_COUNT(StationsY))
        * FMath::SmoothStep(0.,4.,U);
    const double Surge = -CruiseDrag-FMath::Sign(U)*WaveMaking-BowDrag;
    const double Sway = KeelLift - (280.0 * V + 900.0 * V * FMath::Abs(V));
    Apply(HullWet * (Forward * Surge + Right * Sway), Keel);

    const double Throttle = FMath::Clamp(Helm.Throttle, -1.0, 1.0);
    // Near zero sternway the propellers can deliver their static pull even
    // against a filled sail. Thrust falls to the cruising value as inflow builds.
    const double AsternThrust = FMath::Lerp(4750., 2900., FMath::SmoothStep(0., 3., -U));
    const double Thrust = Helm.bEngineOn ? (Throttle >= 0.0 ? 5000.0 : AsternThrust) * Throttle : 0.0;
    Apply(HullWet * Forward * Thrust, Point({ -3.8, 0.0, -0.55 }));

    const FVector Rudder = Point({ -4.7, 0.0, -0.62 });
    const FSeaSample RudderSea = SampleSea({ Rudder.X, Rudder.Y }, TimeS, Immersion(Rudder), SeaScale, bCoralPass);
    const double RudderWet = FMath::SmoothStep(-0.08, 0.35, RudderSea.HeightM - Rudder.Z);
    const FVector SternFlow = VelocityAt(Rudder) - RudderSea.VelocityMps;
    const double PropWash = 0.35 * FMath::Sqrt(2.0 * FMath::Max(0.0, Thrust) / (WaterDensity * 0.42));
    const double RawAxial = FVector::DotProduct(SternFlow, Forward) + PropWash;
    const double AxialSpeed = FMath::Abs(RawAxial);
    const double EffectiveAxial = FMath::Sign(RawAxial) * (FMath::Min(AxialSpeed, 3.8) + 0.25 * FMath::Max(0.0, AxialSpeed - 3.8));
    const double Delta = FMath::DegreesToRadians(MaxRudderDegrees) * FMath::Clamp(Helm.Rudder, -1.0, 1.0);
    const double SteeredFlow = FMath::Sin(Delta) * FMath::Cos(Delta) * EffectiveAxial;
    const double SideForceScale = -520.0 * FMath::Abs(EffectiveAxial);
    const double OpposingSide = SideForceScale * (SteeredFlow + 0.42 * FVector::DotProduct(SternFlow, Right));
    const double RudderDrag = -FMath::Sign(U) * FMath::Abs(OpposingSide * FMath::Sin(Delta)) * 0.65;
    Apply(RudderWet * (Right * OpposingSide + Forward * RudderDrag), Rudder);


    // A short, steep face runs under the boat before the full waterplane can heel to it.
    // Limit the slope the yacht takes up smoothly while leaving the swell's full height.
    // At speed the head sea arrives several times faster than its earth-fixed period.
    // Let the bows follow more of the fore-and-aft rise without increasing beam roll.
    const double HeadSea=FMath::SmoothStep(3.,8.,FMath::Abs(FVector::DotProduct(State.VelocityMps,Forward)))
        *FMath::SmoothStep(1.6,3.8,SeaScale);
    const double MaxRideSlope = .49+.13*HeadSea*FMath::Abs(FVector::DotProduct(Slope.GetSafeNormal(),Forward));
    const double Response = FMath::InvSqrt(1.+Slope.SizeSquared()/(MaxRideSlope*MaxRideSlope));
    const FVector WaterNormal = FVector::UpVector - Slope*Response;
    const FVector TargetUp = WaterNormal.GetSafeNormal();
    // Damp rotation relative to the moving long-wave plane. A short chop crossing
    // one bow still has to raise the loaded hull through the restoring moment.
    const FVector SlopeRate = Forward*(BowRiseMoment/BowSpanSq) + Right*(BeamRiseMoment/BeamSpanSq);
    const FVector NormalRate = -Response*(SlopeRate-Slope*(FVector::DotProduct(Slope,SlopeRate)*
        FMath::Square(Response/MaxRideSlope)));
    const FVector WaterSpin = FVector::CrossProduct(WaterNormal,NormalRate)/WaterNormal.SizeSquared();
    const FVector Up = State.Rotation.GetUpVector();
    const FVector TowardLevel = FVector::CrossProduct(Up,TargetUp);
    const double SinTilt = TowardLevel.Size();
    const double Tilt = FMath::Atan2(SinTilt,FVector::DotProduct(Up,TargetUp));
    const FVector Axis = SinTilt > 1e-5 ? TowardLevel / SinTilt : Forward;
    const FVector TiltError = Axis * FMath::Min(Tilt,1.2);
    const auto RightingMoment = [&](const FVector& Direction,double LeverM,double Damping)
    {
        const double Rate = FVector::DotProduct(State.AngularVelocityRad-WaterSpin,Direction);
        return MassKg*Gravity*LeverM*FVector::DotProduct(TiltError,Direction) - Damping*FMath::Clamp(Rate,-2.,2.);
    };
    Loads.TorqueNm += Contact * (Forward*RightingMoment(Forward,4.1,155000.) + Right*RightingMoment(Right,8.0+3.5*HeadSea,320000.+45000.*HeadSea));
    Loads.TorqueNm.Z -= HullWet*5600.*State.AngularVelocityRad.Z;
    if (!Helm.bHoveTo)
    {
        // Close the loop on yaw in the world frame. A passing crest can lift
        // the rudder or reverse local flow without reversing the helm command.
        const double SurgeOverGround = FVector::DotProduct(State.VelocityMps, Forward);
        const double Drive = Helm.bEngineOn ? Throttle : 0.;
        const double Authority = FMath::Max(FMath::SmoothStep(0., 1.5, FMath::Abs(SurgeOverGround)), FMath::Abs(Drive));
        const double Direction = FMath::Abs(SurgeOverGround) > .55 ? FMath::Sign(SurgeOverGround) : FMath::Sign(Drive);
        const double Target = Direction * Helm.Rudder * FMath::Lerp(.42, .34, FMath::SmoothStep(3., 10., FMath::Abs(SurgeOverGround)));
        const double YawMoment = 175000. * (Target - State.AngularVelocityRad.Z);
        Loads.TorqueNm.Z = FMath::Lerp(Loads.TorqueNm.Z, FMath::Clamp(YawMoment,-90000.,90000.), Authority);
        if (Drive != 0.)
        {
            // Give commanded thrust its low-speed response even across a trough.
            const double SpeedDemand = Drive * (Drive > 0. ? 7.92 : 3.9);
            const double Accel = FMath::Clamp((SpeedDemand-SurgeOverGround)*1.2,-2.8,2.8);
            const double Along = FVector::DotProduct(Loads.ForceN,Forward);
            Loads.ForceN += Forward*((MassKg*Accel-Along)*FMath::Abs(Drive));
        }
    }
    return Loads;
}
}
