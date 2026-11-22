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
    if (!Yacht || !SharkMesh) return;
    const FVector2D Center(Yacht->GetActorLocation()), Travel(Yacht->GetVelocity());
    const FVector2D Bow = FVector2D(Yacht->GetActorForwardVector()).GetSafeNormal();
    const double Time = GetWorld()->GetTimeSeconds();
    const bool Relocated = FVector2D::DistSquared(Center, PreviousYacht) > FMath::Square(6000.);
    PreviousYacht = Center;
    const double Dive = Sailing::SharkDive(Time);
    const double Cycle = FMath::Fmod(Time,100.);
    // Complete the offshore leg and return to patrol range while still at depth.
    const double Offshore = FMath::SmoothStep(30.,44.,Cycle) * (1.-FMath::SmoothStep(77.,90.,Cycle));
    const double Radius = 3000. + 65.*FMath::Sin(Time*.17) + 4000.*Offshore;
    if (Dive >= .999 && FMath::Abs(FVector2D::Distance(Center,S.Position)-Radius)>950.)
        S.bPlaced = false;
    if (Relocated) S.bPlaced = false;
    if (!S.bPlaced)
    {
        if (!Relocated && Time < S.NextLook) return;
        S.NextLook = Time + .32;
        for (int32 J=0; J<16; ++J)
        {
            const FVector2D Ray = Bow.GetRotated(-42. + J*22.5);
            const FVector2D Place = Center + Radius*Ray;
            if (!OpenWater(Place, *Yacht) || !OpenWater(Place + Tangent(Ray)*250, *Yacht)) continue;
            S.Position = Place;
            S.Direction = Tangent(Ray);
            S.bPlaced = S.bHasRoom = true;
            break;
        }
        Body->SetVisibility(S.bPlaced);
        if (!S.bPlaced) return;
    }
    const FVector2D Offset = S.Position - Center;
    const double Range = Offset.Size();
    const FVector2D Radial = Range > 1 ? Offset/Range : Bow;
    const double Cruise = 156. + 38.*FMath::Sin(Time*.22);
    const FVector2D Follow = Travel + Radial * FMath::Clamp((Radius-Range)*1.65, -510., 640.);
    const FVector2D Along = Tangent(Radial) * Cruise;
    if (Time >= S.NextLook)
    {
        S.NextLook = Time + .27;
        auto ClearAhead = [&](FVector2D V)
        {
            const FVector2D Ahead = S.Position + V*.72 + V.GetSafeNormal()*220.;
            return OpenWater(Ahead,*Yacht) && OpenWater((S.Position+Ahead)*.5,*Yacht);
        };
        S.Avoidance = FVector2D::ZeroVector;
        S.bHasRoom = ClearAhead(Follow+Along*S.Turn);
        if (!S.bHasRoom && ClearAhead(Follow-Along*S.Turn))
        {
            S.Turn = -S.Turn;
            S.bHasRoom = true;
        }
        if (!S.bHasRoom)
        {
            // If both courses point into a hull or headland, follow its edge
            // until there is a clear way back onto the near-yacht circuit.
            const FVector2D AlongEdge = (Follow+Along*S.Turn).GetSafeNormal()*FMath::Max(175.,Travel.Size());
            for (double Angle : {45.,-45.,75.,-75.,105.,-105.,145.,-145.,180.})
            {
                const FVector2D V = AlongEdge.GetRotated(Angle*S.Turn);
                if (FVector2D::Distance(S.Position+V*1.3,Center+Travel*1.3)<2350 || !ClearAhead(V)) continue;
                S.Avoidance=V;
                S.bHasRoom=true;
                break;
            }
        }
    }
    FVector2D Desired = S.Avoidance.IsNearlyZero() ? Follow + Along*S.Turn : S.Avoidance;
    const double Aim = Desired.IsNearlyZero() ? 0 : FMath::Atan2(
        FVector2D::CrossProduct(S.Direction,Desired), FVector2D::DotProduct(S.Direction,Desired));
    S.Direction = S.Direction.GetRotated(FMath::Clamp(FMath::RadiansToDegrees(Aim),-95.*Dt,95.*Dt));
    const double Speed = S.bHasRoom ? Desired.Size()*FMath::Max(.05,FMath::Cos(Aim)) : 0.;
    S.Speed = FMath::Lerp(S.Speed,Speed,1.-FMath::Exp(-5.*Dt));
    S.Position += S.Direction * (S.Speed*Dt);
    S.Phase = FMath::Fmod(S.Phase + Dt*(3.0 + FMath::Min(5., S.Speed*.009)), UE_TWO_PI);
    // The mesh pivot is the dorsal tip. Pitch the body into the descent.
    const double Fin = 31. + 5.*FMath::Sin(Time*.95) - 1550.*Dive;
    const double Pitch = -18.*(Dive - Sailing::SharkDive(FMath::Max(0., Time-.1)))/.03;
    Body->SetVisibility(Dive < .999);
    const double Surface = 100.*Yacht->SurfaceHeightM(S.Position*.01);
    const FRotator Rot(Pitch, FMath::RadiansToDegrees(FMath::Atan2(S.Direction.Y,S.Direction.X)), 0);
    Body->SetWorldLocationAndRotation(FVector(S.Position,Surface+Fin), Rot);
    Body->SetCustomPrimitiveDataFloat(0, S.Phase);
    Body->SetCustomPrimitiveDataVector3(1,FVector(Tangent(S.Direction)*1.25,0));
}
