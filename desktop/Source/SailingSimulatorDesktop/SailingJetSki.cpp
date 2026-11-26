#include "SailingJetSki.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "SailingTrial.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
constexpr double StepSeconds = 1. / 60.;
constexpr double MinimumDepthCm = 40.;
constexpr double HalfHullCm = 132.;

struct FBerth
{
    const TCHAR* Name;
    FVector2D PositionM;
    double Yaw;
    const TCHAR* Model;
    double SeatHeightCm;
};

// The separate harbour quay and the beaches facing the pass in CoralPassLayout.
const FBerth Berths[] = {
    {TEXT("Long Cay"), {213.37, 103.21}, -154.2, TEXT("Futurealiti"), 55.},
    {TEXT("Cloud Head"), {421.12, -308.82}, 143.7, TEXT("Rwb"), 66.},
    {TEXT("East Cay"), {615.85, 187.49}, -163.1, TEXT("Cm21"), 64.},
    {TEXT("Outer Cay"), {980.50, -205.22}, 168.2, TEXT("Collection01"), 74.},
    {TEXT("South Cay"), {-173.46, 164.12}, -43.4, TEXT("Collection02"), 74.},
    {TEXT("Light Cay"), {231.83, -111.79}, 154.3, TEXT("Collection03"), 74.},
    {TEXT("Volcano"), {706.92, -1575.20}, 114.2, TEXT("Collection04"), 74.},
    {TEXT("Harbour quay"), {458.9, -131.}, -90., TEXT("Collection05"), 74.}
};
}

ASailingJetSki::ASailingJetSki()
{
    Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Watercraft"));
    SetRootComponent(Body);
    Body->SetMobility(EComponentMobility::Movable);
    Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    if (HasAnyFlags(RF_ClassDefaultObject))
    {
        AvailableModels.Reserve(UE_ARRAY_COUNT(Berths));
        for (const FBerth& Site : Berths)
        {
            const FString Path = FString::Printf(TEXT("/Game/Coastal/Meshes/JetSkis/%s/SM_JetSki%s.SM_JetSki%s"),
                Site.Model, Site.Model, Site.Model);
            ConstructorHelpers::FObjectFinder<UStaticMesh> Model(*Path);
            AvailableModels.Add(Model.Object);
        }
    }
}

void ASailingJetSki::SpawnFleet(ASailingYachtPawn& Yacht, TArray<TObjectPtr<ASailingJetSki>>& Fleet)
{
    FActorSpawnParameters Spawn;
    Spawn.Owner = &Yacht;
    Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    const auto& Models = GetDefault<ASailingJetSki>()->AvailableModels;
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(Berths); ++Index)
    {
        const FBerth& Site = Berths[Index];
        if (!Models.IsValidIndex(Index) || !Models[Index]) continue;
        auto* Ski = Yacht.GetWorld()->SpawnActor<ASailingJetSki>(
            FVector(Site.PositionM * 100., 0.), FRotator(0., Site.Yaw, 0.), Spawn);
        if (!Ski) continue;
        Ski->Berth = FName(Site.Name);
        Ski->Body->SetStaticMesh(Models[Index]);
        Ski->SeatHeightCm = Site.SeatHeightCm;
        Ski->PositionM = Site.PositionM;
        Ski->Motion.YawRad = FMath::DegreesToRadians(Site.Yaw);
        for (int32 Offset = 0; Offset < 5 && !Ski->HasWaterClearance(); ++Offset)
            Ski->PositionM += Ski->Motion.Bow() * 2.;
        Ski->UpdatePose(Yacht, 0.);
        Fleet.Add(Ski);
    }
}

FVector ASailingJetSki::Seat() const
{
    return GetActorTransform().TransformPositionNoScale({-38., 0., SeatHeightCm});
}

bool ASailingJetSki::HasWaterClearance() const
{
    return HasWaterClearance(PositionM, Motion.Bow());
}

bool ASailingJetSki::HasWaterClearance(FVector2D AtM, FVector2D Bow) const
{
    const FCollisionQueryParams Query(SCENE_QUERY_STAT(JetSkiDepth), true, this);
    for (double Along : {-HalfHullCm, 0., HalfHullCm})
    {
        const FVector2D At = AtM * 100. + Bow * Along;
        if (GetWorld()->LineTraceTestByChannel(FVector(At, 115.), FVector(At, -MinimumDepthCm), ECC_Visibility, Query))
            return false;
    }
    return true;
}

void ASailingJetSki::SetRidden(bool bValue)
{
    bRidden = bValue;
    SetInput(0., 0.);
    if (!bRidden) Motion.Jet = 0.;
}

void ASailingJetSki::Advance(const ASailingYachtPawn& Yacht, float Dt)
{
    if (bRidden || Motion.SpeedMps() > .045 || FMath::Abs(Motion.YawRate) > .01)
    {
        Accumulator += FMath::Min(double(Dt), .12);
        const FCollisionQueryParams Query(SCENE_QUERY_STAT(JetSkiHull), true, this);
        const FCollisionShape Hull = FCollisionShape::MakeBox(FVector(145., 60., 27.));
        while (Accumulator >= StepSeconds)
        {
            Accumulator -= StepSeconds;
            Motion.Advance(Throttle, Steering, StepSeconds);
            if (!bRidden) Motion.VelocityMps *= FMath::Exp(-3.8 * StepSeconds);
            const FVector2D Next = PositionM + Motion.VelocityMps * StepSeconds;
            if (Next.Equals(PositionM, .0001)) continue;

            const double Z = GetActorLocation().Z + 20.;
            const FQuat Heading(FVector::UpVector, Motion.YawRad);
            const bool bBlocked = !HasWaterClearance(Next, Motion.Bow()) ||
                GetWorld()->SweepTestByChannel(FVector(PositionM * 100., Z), FVector(Next * 100., Z),
                    Heading, ECC_Visibility, Hull, Query);
            if (bBlocked) Motion.VelocityMps = FVector2D::ZeroVector;
            else PositionM = Next;
        }
    }
    UpdatePose(Yacht, Dt);
}

void ASailingJetSki::UpdatePose(const ASailingYachtPawn& Yacht, float Dt)
{
    const FVector2D Bow = Motion.Bow();
    const FVector2D Beam(-Bow.Y, Bow.X);
    const auto Height = [&](FVector2D At) { return Yacht.RenderedSurfaceHeightM(At); };
    const double Fore = Height(PositionM + Bow * 1.2), Aft = Height(PositionM - Bow * 1.2);
    const double Left = Height(PositionM - Beam * .50), Right = Height(PositionM + Beam * .50);
    const double Plane = Motion.Planing();
    const double Pitch = FMath::RadiansToDegrees(FMath::Atan2(Fore - Aft, 2.4));
    const double Roll = FMath::RadiansToDegrees(FMath::Atan2(Left - Right, 1.));
    const double Trim = FMath::Max(0., Motion.Jet) * FMath::Lerp(7., 2.6, Plane);
    const double Rise = 100. * ((Fore + Aft + Left + Right) * .25 + .15 * Plane);
    const double Z = Dt > 0 ? FMath::FInterpTo(GetActorLocation().Z, Rise, double(Dt), 13.) : Rise;
    const FRotator Pose(FMath::Clamp(Pitch + Trim, -18., 18.), FMath::RadiansToDegrees(Motion.YawRad),
        FMath::Clamp(Roll + Motion.BankDegrees, -32., 32.));
    SetActorLocationAndRotation(FVector(PositionM * 100., Z), Pose);
}
