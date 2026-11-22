#include "SailingFoamField.h"
#include "Containers/StaticArray.h"

namespace Sailing
{
namespace
{
struct FStamp { FVector2D Center; float Radius, Strength; };
using FTracks = TStaticArray<FStamp,5>;

FTracks Tracks(const FFoamPose& P, float Age, float Birth)
{
    FTracks Out;
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
        Out[Side+2] = {Hull+Forward*4.1+Outboard*(.315*Travel),
            .40f+.050f*Travel,Energy*FMath::Exp(-.30f*Age)};
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
        uint8& Channel = Track<2 ? Cell.R : (Track<4 ? Cell.G : Cell.B);
        Channel = FMath::Max(Channel,Value);
    }
}
}

bool FFoamField::Record(const FFoamPose& Pose, float Now)
{
    const bool Reset = !Count || Now<Head.Time || Now-Head.Time>2 ||
        FVector2D::DistSquared(Pose.CenterM,Head.Pose.CenterM)>625;
    if (Reset)
    {
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
            FMath::Lerp(Old.Thrust,Pose.Thrust,U)}, NextTime};
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
}
}
