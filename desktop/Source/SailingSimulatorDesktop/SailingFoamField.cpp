#include "SailingFoamField.h"
#include "Containers/StaticArray.h"

namespace Sailing
{
namespace
{
struct FStamp { FVector2D Center = FVector2D::ZeroVector; float Radius = 0, Strength = 0; };
using FTracks = TStaticArray<FStamp,5>;

FTracks Tracks(const FFoamPose& P, float Age, float Birth)
{
    FTracks Out;
    if (P.bWaterJet)
    {
        const float Power = FMath::Abs(P.Thrust);
        const float Speed = FMath::Abs(P.PortMps);
        const float Fade = 1.f - FMath::SmoothStep(4.f, 7.f, Age);
        const FVector2D Stern = P.CenterM - P.Bow * 1.55;
        const FVector2D Jet = Stern - P.Bow * FMath::Sign(P.Thrust) * FMath::Min(Age * (1.1f + 1.65f * Power), 5.5f);
        Out[0] = {Stern, .46f + .22f * Age, .75f * FMath::SmoothStep(1.3f, 8.f, Speed) * Fade};
        Out[4] = {Jet, .4f + .19f * Age, Power * FMath::Exp(-.43f * Age) * Fade};
        return Out;
    }
    const FVector2D Beam(-P.Bow.Y,P.Bow.X);
    const double Sign = P.PortMps+P.StarboardMps>=0 ? 1. : -1.;
    const FVector2D Forward = P.Bow*Sign;
    const FVector2D Drift(.035*Age,-.055*Age);
    const float Tail = 1.f-FMath::SmoothStep(16.f,21.f,Age);
    for (int32 Side=0; Side<2; ++Side)
    {
        const float Speed = FMath::Abs(Side ? P.StarboardMps : P.PortMps);
        const float Travel = FMath::Min(Age*Speed,100.f);
        const float Energy = FMath::SmoothStep(.28f,3.3f,Speed)*Tail;
        const FVector2D Outboard = Beam*(Side ? 1. : -1.);
        const FVector2D Hull = P.CenterM+Outboard*1.93+Drift;
        const float Eddy = (.09f+.21f*FMath::Sqrt(Age))*FMath::Sin(.82f*Birth+Age*.39f+Side*2.2f);
        // The two stern boils spread inward as well as outward. A few boat
        // lengths aft their bubble plumes meet and dilute into a single slick.
        Out[Side] = {Hull-Forward*4.7 + Outboard*(.013*Travel+Eddy),
            .65f+.18f*FMath::Sqrt(Travel)+.092f*Travel,Energy*FMath::Exp(-.16f*Age)};
        // The unbroken divergent waves carry no foam. Bow slams emit separate transient fans.
    }
    const float Power = FMath::Abs(P.Thrust);
    const FVector2D Prop = P.CenterM-P.Bow*4.35-P.Bow*FMath::Sign(P.Thrust)*FMath::Min(Age*(1.4+1.8*Power),14.);
    Out[4] = {Prop+Drift,.56f+.19f*FMath::Sqrt(Age)+.055f*Age,Power*FMath::Exp(-.33f*Age)*Tail};
    return Out;
}

void Stroke(TArray<FColor>& Pixels, const FStamp& A, const FStamp& B, int32 Track, FIntPoint Corner)
{
    if (FMath::Max(A.Strength,B.Strength)<.004f) return;
    const float Radius = FMath::Max(A.Radius,B.Radius);
    constexpr float Inv = 1.f/FFoamField::CellM;
    const int32 X0 = FMath::Max(Corner.X,FMath::FloorToInt((FMath::Min(A.Center.X,B.Center.X)-Radius)*Inv));
    const int32 Y0 = FMath::Max(Corner.Y,FMath::FloorToInt((FMath::Min(A.Center.Y,B.Center.Y)-Radius)*Inv));
    const int32 X1 = FMath::Min(Corner.X+FFoamField::Size-1,FMath::FloorToInt((FMath::Max(A.Center.X,B.Center.X)+Radius)*Inv));
    const int32 Y1 = FMath::Min(Corner.Y+FFoamField::Size-1,FMath::FloorToInt((FMath::Max(A.Center.Y,B.Center.Y)+Radius)*Inv));
    const FVector2D Line = B.Center-A.Center;
    const double InvLength2 = 1./FMath::Max(.0001,Line.SizeSquared());
    for (int32 Y=Y0; Y<=Y1; ++Y)
    for (int32 X=X0; X<=X1; ++X)
    {
        const FVector2D Delta = FVector2D((X+.5)*FFoamField::CellM,(Y+.5)*FFoamField::CellM)-A.Center;
        const double U = FMath::Clamp(FVector2D::DotProduct(Delta,Line)*InvLength2,0.,1.);
        const double R = FMath::Lerp(A.Radius,B.Radius,U);
        const double Fall = 1.-(Delta-Line*U).SizeSquared()/(R*R);
        if (Fall<=0) continue;
        const uint8 Value = uint8(FMath::RoundToInt(255*Fall*FMath::Lerp(A.Strength,B.Strength,U)));
        FColor& Cell = Pixels[FFoamField::Texel(X,Y)];
        uint8& Channel = Track<2 ? Cell.R : (Track<4 ? Cell.G : (Track==4 ? Cell.B : Cell.A));
        Channel = FMath::Max(Channel,Value);
    }
}
}

bool FFoamField::Record(const FFoamPose& Pose, float Now)
{
    const bool Reset = !Count || Now<Head.Time || Now-Head.Time>2 || Pose.bWaterJet != Head.Pose.bWaterJet ||
        FVector2D::DistSquared(Pose.CenterM,Head.Pose.CenterM)>625;
    if (Reset)
    {
        for (auto& Impact : Breaks) Impact.Energy = 0;
        Count=Next=0;
        NextTime=Now;
        Head={Pose,Now};
    }
    while (NextTime<=Now)
    {
        const float U = FMath::Clamp((NextTime-Head.Time)/FMath::Max(.0001f,Now-Head.Time),0.f,1.f);
        const FFoamPose& Old = Head.Pose;
        History[Next] = {{FMath::Lerp(Old.CenterM,Pose.CenterM,U), FMath::Lerp(Old.Bow,Pose.Bow,U).GetSafeNormal(),
            FMath::Lerp(Old.PortMps,Pose.PortMps,U), FMath::Lerp(Old.StarboardMps,Pose.StarboardMps,U),
            FMath::Lerp(Old.Thrust,Pose.Thrust,U), Pose.bWaterJet}, NextTime};
        Next = (Next+1)%Capacity;
        Count = FMath::Min(Count+1,Capacity);
        NextTime += Interval;
    }
    Head={Pose,Now};
    return Reset;
}

FVector2D FFoamField::Center() const
{
    const double Surge = .5*(Head.Pose.PortMps+Head.Pose.StarboardMps);
    // Bias the field astern at speed. Swell near neutral must not move its edge across old foam.
    return Head.Pose.CenterM-Head.Pose.Bow*(12.*FMath::Clamp(Surge/3.,-1.,1.));
}

void FFoamField::BreakAtBow(FVector2D OriginM, FVector2D Bow, int32 Side, float ClosingMps, FVector2D DriftMps, float Now)
{
    const float Energy = FMath::SmoothStep(.48f, 3.7f, ClosingMps);
    if (Energy <= 0) return;
    Breaks[NextBreak] = {OriginM, Bow, DriftMps, Side ? 1.f : -1.f, Energy, Now};
    NextBreak = (NextBreak+1) % Breaks.Num();
}

void FFoamField::Rasterize(TArray<FColor>& Pixels) const
{
    Pixels.SetNumUninitialized(Size*Size);
    FMemory::Memzero(Pixels.GetData(),Pixels.Num()*sizeof(FColor));
    if (!Count) return;
    const FVector2D Middle = Center()/CellM;
    const FIntPoint Corner(FMath::FloorToInt(Middle.X)-Size/2,FMath::FloorToInt(Middle.Y)-Size/2);
    FTracks Newer = Tracks(Head.Pose,0,Head.Time);
    for (int32 I=0; I<Count; ++I)
    {
        const FMark& Mark = History[(Next+Capacity-1-I)%Capacity];
        const float Age = Head.Time-Mark.Time;
        if (Age>21) break;
        const FTracks Older = Tracks(Mark.Pose,Age,Mark.Time);
        for (int32 J=0; J<Newer.Num(); ++J) Stroke(Pixels,Newer[J],Older[J],J,Corner);
        Newer=Older;
    }
    for (const auto& Impact : Breaks)
    {
        const float Age = Head.Time-Impact.Born;
        if (Impact.Energy <= 0 || Age < 0 || Age >= 8) continue;
        // The initial fan of aerated water travels out and aft. Its momentum
        // decays while the underlying current and wind carry the foam on.
        const float Spread = (1-FMath::Exp(-.78f*Age))*(1.6f+4.2f*Impact.Energy);
        const float Strength = Impact.Energy*FMath::Exp(-.28f*Age)*(1-FMath::SmoothStep(6.f,8.f,Age));
        const FVector2D Beam = FVector2D(-Impact.Bow.Y,Impact.Bow.X)*Impact.Side;
        const FVector2D Center = Impact.Origin+Impact.Drift*Age;
        const float Rad = .55f+.60f*Impact.Energy+.26f*Age;
        const FStamp Root{Center+Beam*(.25*Spread), Rad, .90f*Strength};
        const FStamp Shoulder{Center+Beam*(.82*Spread)-Impact.Bow*(.48*Spread), 1.32f*Rad, Strength};
        const FStamp End{Center+Beam*Spread-Impact.Bow*(1.40*Spread), Rad, .48f*Strength};
        Stroke(Pixels,Root,Shoulder,5,Corner);
        Stroke(Pixels,Shoulder,End,5,Corner);
    }
}
}
