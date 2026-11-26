#include "SailingSharks.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "SailingTrial.h"
#include "SailingEncounter.h"

namespace
{
FVector2D Tangent(FVector2D V) { return {-V.Y, V.X}; }
}

ASailingSharks::ASailingSharks()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Swimmers")));
    Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ReefSharkOne"));
    Body->SetupAttachment(GetRootComponent());
    Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Body->SetCastShadow(false);
    Body->SetRelativeScale3D(FVector(1.25));
    Body->SetVisibility(false);
}

void ASailingSharks::BeginPlay()
{
    Super::BeginPlay();
    Body->SetStaticMesh(SharkMesh);
}

bool ASailingSharks::OpenWater(FVector2D Cm, const ASailingYachtPawn& Yacht) const
{
    // A deck overhead, a reef crown or a beach all interrupt the same water column.
    return !GetWorld()->LineTraceTestByChannel(FVector(Cm, 8000), FVector(Cm, -235), ECC_Visibility,
        FCollisionQueryParams(SCENE_QUERY_STAT(SharkWaterColumn), true, &Yacht));
}

void ASailingSharks::Tick(float Dt)
{
    Super::Tick(Dt);
    const auto* Yacht = Cast<ASailingYachtPawn>(UGameplayStatics::GetPlayerPawn(this,0));
    if (!Yacht || !SharkMesh || Dt<=0) return;
    const double Step = FMath::Min(double(Dt),.05);
    Sailing::FSharkMotion& Swim = S.Motion;
    const FVector2D Center(Yacht->GetActorLocation()), Travel(Yacht->GetVelocity());
    const FVector2D Bow = FVector2D(Yacht->GetActorForwardVector()).GetSafeNormal();
    const double Time = GetWorld()->GetTimeSeconds();
    // A reset can move the yacht by less than the width of the patrol.
    const double PlausibleTravel = Travel.Size()*Dt+600.;
    const bool Relocated = FVector2D::DistSquared(Center,PreviousYacht)>FMath::Square(PlausibleTravel);
    PreviousYacht = Center;
    const double Dive = Sailing::SharkDive(Time);
    const double Cycle = FMath::Fmod(Time,100.);
    // Complete the offshore leg and return to patrol range while still at depth.
    const double Offshore = FMath::SmoothStep(30.,44.,Cycle) * (1.-FMath::SmoothStep(77.,90.,Cycle));
    const double Passing = FMath::SmoothStep(5.,14.,Cycle) * (1.-FMath::SmoothStep(21.,30.,Cycle));
    const double Radius = 3070. - 285.*Passing + 4000.*Offshore;
    const double Cruise = 154. + 28.*Passing;
    if (Dive >= .999 && FMath::Abs(FVector2D::Distance(Center,Swim.Position)-Radius)>950.)
        S.bPlaced = false;
    if (Relocated) S.bPlaced = false;
    if (!S.bPlaced)
    {
        // A relocation at depth can precede the next position probe. Hide the
        // old body immediately, including during that short retry interval.
        Body->SetVisibility(false);
        if (!Relocated && Time < S.NextLook) return;
        S.NextLook = Time + .32;
        for (int32 J=0; J<16; ++J)
        {
            const FVector2D Ray = Bow.GetRotated(-42. + J*22.5);
            const FVector2D Place = Center + Radius*Ray;
            const FVector2D Entry = Travel + Tangent(Ray)*Cruise;
            const FVector2D Heading = Entry.IsNearlyZero() ? Tangent(Ray) : Entry.GetSafeNormal();
            if (!OpenWater(Place, *Yacht) || !OpenWater(Place + Heading*450, *Yacht)) continue;
            // Deep water on the other side of a moored ship is reachable only
            // by swimming around its ends. Start on the yacht's side instead.
            if (GetWorld()->LineTraceTestByChannel(FVector(Center,-80.),FVector(Place,-80.),ECC_Visibility,
                FCollisionQueryParams(SCENE_QUERY_STAT(SharkApproach),true,Yacht))) continue;
            Swim = {};
            Swim.Position = Place;
            Swim.Direction = Heading;
            Swim.Speed = FMath::Clamp(Entry.Size(),Sailing::SharkCruiseFloor,Sailing::SharkTopSpeed);
            S.FilteredSurfaceCm = 100.*Yacht->SurfaceHeightM(Place*.01);
            S.Turn=1;
            S.FollowVelocity=Travel;
            S.Avoidance=FVector2D::ZeroVector;
            S.HoldCourseUntil=0;
            S.bPlaced = S.bHasRoom = S.bForwardClear = true;
            break;
        }
        if (!S.bPlaced) return;
    }
    const FVector2D Offset = Swim.Position - Center;
    const double Range = Offset.Size();
    const FVector2D Radial = Range > 1 ? Offset/Range : Bow;
    S.FollowVelocity = FMath::Lerp(S.FollowVelocity,Travel,1.-FMath::Exp(-2.1*Step));
    const FVector2D Follow = S.FollowVelocity + Radial*FMath::Clamp((Radius-Range)*1.35,-460.,520.);
    const FVector2D Along = Tangent(Radial) * Cruise;
    if (Time >= S.NextLook)
    {
        S.NextLook = Time + .23;
        const double BrakingRoom = .23*Swim.Speed + FMath::Square(Swim.Speed)/(2.*Sailing::SharkBraking);
        S.bForwardClear = OpenWater(Swim.Position+Swim.Direction*FMath::Max(140.,BrakingRoom),*Yacht);
        auto ClearAhead = [&](FVector2D V)
        {
            const FVector2D Ahead = Swim.Position + V*.9 + V.GetSafeNormal()*310.;
            return OpenWater(Ahead,*Yacht) && OpenWater((Swim.Position+Ahead)*.5,*Yacht);
        };
        // Stick to a safe detour long enough to swim it, even when the yacht changes course.
        if (S.Avoidance.IsNearlyZero() || Time>=S.HoldCourseUntil || !ClearAhead(S.Avoidance))
        {
            S.Avoidance = FVector2D::ZeroVector;
            S.bHasRoom = ClearAhead(Follow+Along*S.Turn);
            if (!S.bHasRoom && ClearAhead(Follow-Along*S.Turn))
            {
                S.Turn = -S.Turn;
                S.Avoidance = Follow+Along*S.Turn;
                S.bHasRoom = true;
            }
            if (!S.bHasRoom)
            {
                const FVector2D AlongEdge = (Follow+Along*S.Turn).GetSafeNormal()*FMath::Max(175.,S.FollowVelocity.Size());
                double BestError=TNumericLimits<double>::Max();
                for (double Angle : {45.,-45.,75.,-75.,105.,-105.,145.,-145.,180.})
                {
                    const FVector2D V = AlongEdge.GetRotated(Angle*S.Turn);
                    const double Separation=FVector2D::Distance(Swim.Position+V*1.3,Center+S.FollowVelocity*1.3);
                    const double TurnCost=180.*(1.-FVector2D::DotProduct(Swim.Direction,V.GetSafeNormal()));
                    const double Error=FMath::Abs(Separation-Radius)+.48*FMath::Abs(Angle)+TurnCost;
                    if (Separation<2350 || Error>=BestError || !ClearAhead(V)) continue;
                    BestError=Error;
                    S.Avoidance=V;
                    S.bHasRoom=true;
                }
            }
            S.HoldCourseUntil=Time+.9;
        }
    }
    const FVector2D Desired = S.Avoidance.IsNearlyZero() ? Follow+Along*S.Turn : S.Avoidance;
    constexpr double DiveDepthCm = 1550.;
    const double Climb = DiveDepthCm*(Sailing::SharkDive(FMath::Max(0.,Time-.05))-Sailing::SharkDive(Time+.05))/.1;
    const double SurfaceWeight = 1.-FMath::SmoothStep(.02,.20,Dive);
    const FVector4f PreviousShape = Swim.SwimDeformation();
    Sailing::AdvanceSharkMotion(Swim,Desired,S.bHasRoom && S.bForwardClear,Climb,SurfaceWeight,Step);

    // Keep the dorsal tip near the surface while letting the body ride through smaller waves.
    const double Surface = 100.*Yacht->SurfaceHeightM(Swim.Position*.01);
    S.FilteredSurfaceCm = FMath::Lerp(S.FilteredSurfaceCm,Surface,1.-FMath::Exp(-3.4*Step));
    const double Lag = S.FilteredSurfaceCm-Surface;
    const double NearSurface = Surface + Lag/FMath::Sqrt(1.+FMath::Square(Lag/11.));
    const double Fin = FMath::Lerp(S.FilteredSurfaceCm,NearSurface,SurfaceWeight)+25.+2.*FMath::Sin(Time*.83)-DiveDepthCm*Dive;
    const FRotator Rot(Swim.Pitch,FMath::RadiansToDegrees(FMath::Atan2(Swim.Direction.Y,Swim.Direction.X)),Swim.Bank);
    Body->SetWorldLocationAndRotation(FVector(Swim.Position,Fin),Rot);
    const FVector4f Shape = Swim.SwimDeformation();
    const float Frames[] = {Shape.X,Shape.Y,Shape.Z,Shape.W,PreviousShape.X,PreviousShape.Y,PreviousShape.Z,PreviousShape.W};
    Body->SetCustomPrimitiveDataFloatArray(0,MakeConstArrayView(Frames));
    Body->SetVisibility(Dive < .999);
}
