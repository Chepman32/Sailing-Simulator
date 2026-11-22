#include "SailingExplorer.h"

#include "Components/SpotLightComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "SailingTrial.h"
#include "SailingEntryBubbles.h"

namespace
{
constexpr double EyeHeight = 162;
constexpr double StepUp = 42;
constexpr double DeepBed = -4100;

double WaterAt(const ASailingYachtPawn& Yacht, FVector Point)
{
    return 100 * Yacht.SurfaceHeightM(FVector2D(Point) / 100);
}
} // namespace

USailingExplorer::USailingExplorer()
{
    SetAutoActivate(false);
    SetFieldOfView(83);
    SetAbsolute(true, true, true);
    PostProcessBlendWeight = 0;
    PostProcessSettings.bOverride_SceneColorTint = true;
    PostProcessSettings.SceneColorTint = FLinearColor(.33f, .68f, .90f);
    PostProcessSettings.bOverride_ColorSaturation = true;
    PostProcessSettings.ColorSaturation = FVector4(.76, .85, .9, 1);
}

void USailingExplorer::PrepareFooting()
{
    if (bPrepared) return;
    bPrepared = true;
    // These authored meshes have triangles but intentionally have no rigid-body
    // collision. Enable visibility queries alone so a diver meets the visible reef.
    for (TActorIterator<AStaticMeshActor> It(GetWorld()); It; ++It)
    {
        UStaticMeshComponent* Mesh = It->GetStaticMeshComponent();
        if (!Mesh || !Mesh->GetStaticMesh() || Mesh->GetCollisionEnabled() != ECollisionEnabled::NoCollision) continue;
        const FName Name = Mesh->GetStaticMesh()->GetFName();
        if (Name != TEXT("SM_ReefShelf") && Name != TEXT("SM_Boulder") && Name != TEXT("SM_CoastRocks") &&
            Name != TEXT("SM_Lighthouse"))
            continue;
        Mesh->SetCollisionResponseToAllChannels(ECR_Ignore);
        Mesh->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
        Mesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
    }
    Torch = NewObject<USpotLightComponent>(GetOwner(), TEXT("DiveTorch"));
    Torch->SetupAttachment(this);
    Torch->SetMobility(EComponentMobility::Movable);
    Torch->SetCastShadows(false);
    Torch->SetIntensityUnits(ELightUnits::Lumens);
    Torch->SetIntensity(2400);
    Torch->SetAttenuationRadius(2100);
    Torch->SetInnerConeAngle(11);
    Torch->SetOuterConeAngle(28);
    Torch->SetVisibility(false);
    Torch->RegisterComponent();
}

void USailingExplorer::Leave(ASailingYachtPawn& Yacht)
{
    PrepareFooting();
    State = ESkipperMode::Leap;
    bFrozen = false;
    ClearInput();
    LeapTime = 0;
    PendingImpact = EntryGlide = 0;
    Yaw = Yacht.GetActorRotation().Yaw;
    Pitch = -3;
    Depth = 0;
    bCrouched = false;
    Air = 1;
    SetActive(true);
    StepLeap(Yacht, 0);
}

void USailingExplorer::Return()
{
    State = ESkipperMode::Helm;
    ClearInput();
    if (Torch) Torch->SetVisibility(false);
    Depth = 0;
    Air = 1;
    PostProcessBlendWeight = 0;
    SetActive(false);
}

void USailingExplorer::ClearInput()
{
    SetMovement(FVector2D::ZeroVector, false, false, false);
}

void USailingExplorer::SetMovement(FVector2D Axes, bool bFast, bool bRise, bool bSink)
{
    Movement = Axes.GetClampedToMaxSize(1);
    bSprint = bFast;
    bUp = bRise;
    bDown = bSink;
}

void USailingExplorer::Look(float YawDelta, float PitchDelta)
{
    if (State == ESkipperMode::Leap) return;
    Yaw = FRotator::NormalizeAxis(Yaw + YawDelta * .13f);
    Pitch = FMath::Clamp(Pitch + PitchDelta * .13f, -84.f, 84.f);
    SetWorldRotation(FRotator(Pitch, Yaw, 0));
}

FVector USailingExplorer::MoveDirection() const
{
    return FRotator(0, Yaw, 0).RotateVector(FVector(Movement.X, Movement.Y, 0));
}

double USailingExplorer::GroundAt(const FVector& Point, double Top) const
{
    FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingGround), true, GetOwner());
    FHitResult Hit;
    const FVector Start(Point.X, Point.Y, Top);
    if (GetWorld()->LineTraceSingleByChannel(Hit, Start, FVector(Point.X, Point.Y, DeepBed - 200), ECC_Visibility,
                                             Query))
        return Hit.ImpactPoint.Z;
    return DeepBed;
}

void USailingExplorer::StepLeap(const ASailingYachtPawn& Yacht, float Dt)
{
    LeapTime += Dt;
    const float Turn = FMath::SmoothStep(.15f, 1.45f, LeapTime);
    const float Flight = FMath::Max(0.f, LeapTime - 1.72f);
    const float Crouch = FMath::SmoothStep(1.05f, 1.53f, LeapTime) * (1 - FMath::SmoothStep(1.53f, 1.75f, LeapTime));
    const FVector Eye = Yacht.GetActorTransform().TransformPosition(
        FVector(-416 - 29 * Turn - 100 * Flight, 145 + 75 * Turn + 240 * Flight,
                294 - 39 * Crouch + 310 * Flight - 490.5f * Flight * Flight));
    Yaw = Yacht.GetActorRotation().Yaw + 113 * Turn;
    Pitch = -3 - 19 * Turn;
    SetWorldLocationAndRotation(Eye, FRotator(Pitch, Yaw, 0));
    if (Flight > .32f && (Eye.Z < WaterAt(Yacht, Eye) - 12 || LeapTime >= 3.25f))
    {
        const float Impact = FMath::Max(260.f,981.f*Flight-310.f);
        EnterWater(Yacht, Eye, -.48f*Impact, Impact);
    }
}

void USailingExplorer::Splash(const ASailingYachtPawn& Yacht, FVector Eye)
{
    Yacht.EntryBubbles().Splash(Yacht,Eye,FRotator(0,Yaw,0).Vector(),PendingImpact);
    const float Strength = FMath::Clamp(PendingImpact / 600.f, 0.f, 1.f);
    EntryGlide = .90f * Strength;
    Velocity.Z = FMath::Min(Velocity.Z, -300. * Strength);
    PendingImpact = 0;
}

void USailingExplorer::EnterWater(const ASailingYachtPawn& Yacht, FVector Eye, float EntrySpeed, float Impact)
{
    State = ESkipperMode::Swim;
    Velocity = FVector(0, 0, EntrySpeed);
    bFloating = true;
    bGrounded = bCrouched = false;
    SetWorldLocation(Eye);
    PendingImpact = Impact;
    if (PendingImpact>0 && Eye.Z<=WaterAt(Yacht,Eye)+22) Splash(Yacht,Eye);
}

void USailingExplorer::StepSwim(const ASailingYachtPawn& Yacht, float Dt)
{
    const FVector Old = GetComponentLocation();
    const double Water = WaterAt(Yacht, Old);
    if (bDown && Air > 0) bFloating = false;
    if (Air <= 0 || (!bDown && Old.Z >= Water - 7)) bFloating = true;
    const double Speed = bFloating ? (bSprint ? 240 : 115) : (bSprint ? 370 : 175);
    FVector Target = MoveDirection() * Speed;
    if (!bFloating) Target.Z = FMath::Sin(FMath::DegreesToRadians(Pitch)) * Movement.X * Speed;
    Target.Z += 135 * (int32(bUp) - int32(bDown));
    EntryGlide = FMath::Max(0.f,EntryGlide-Dt);
    Velocity = FMath::Lerp(Velocity, Target, 1.0 - FMath::Exp(-(EntryGlide>0 ? 1.35 : 3.0) * Dt));
    if (bFloating && EntryGlide<=0) Velocity.Z += ((Water + 19 - Old.Z) * 16 - Velocity.Z * 4) * Dt;
    // Re-engage buoyancy at eye depth, even if a trough crosses the entry.
    if (EntryGlide > 0 && Water-Old.Z >= 150)
    {
        EntryGlide = 0;
        Velocity.Z = FMath::Max(Velocity.Z, -35.);
    }
    FVector Next = Old + Velocity * Dt;
    FHitResult Wall;
    if (GetWorld()->SweepSingleByChannel(Wall, Old, Next, FQuat::Identity, ECC_Camera,
        FCollisionShape::MakeSphere(23.f), FCollisionQueryParams(SCENE_QUERY_STAT(SailingSwimHull), true, GetOwner()))
        && FMath::Abs(Wall.Normal.Z) < .80 && FVector::DotProduct(Velocity, Wall.Normal) < 0)
    {
        // The same plated shell stops the yacht, the chase camera and the swimmer.
        Velocity = FVector::VectorPlaneProject(Velocity, Wall.Normal);
        Next = Wall.Location + Wall.Normal + Velocity * (Dt * (1.0 - Wall.Time));
    }
    const FVector Local = Yacht.GetActorTransform().InverseTransformPosition(Next);
    if (Local.Z > -100 && Local.Z < 160 && Local.X > -545 && Local.X < 530 &&
        FMath::Abs(FMath::Abs(Local.Y) - 190) < 77)
    {
        FVector Outside = Local;
        const double HullY = FMath::Sign(Local.Y) * 190;
        Outside.Y = HullY + (Local.Y >= HullY ? 78 : -78);
        Next = Yacht.GetActorTransform().TransformPosition(Outside);
    }
    const double Ground = GroundAt(Next, FMath::Max(Old.Z + 100, Water + 125));
    if (Water - Ground < 105 && Ground <= Old.Z + 49)
    {
        State = ESkipperMode::Shore;
        Feet = FVector(Next.X, Next.Y, Ground);
        Velocity = FVector::ZeroVector;
        bGrounded = true;
        SetWorldLocation(Feet + FVector::UpVector * EyeHeight);
        return;
    }
    if (Ground > Old.Z + 49)
        Next = Old;
    else
        Next.Z = FMath::Max(Next.Z, Ground + 55);
    SetWorldLocation(Next);
    if (PendingImpact>0 && Velocity.Z<0 && Next.Z<=Water+24) Splash(Yacht,Next);
}

void USailingExplorer::StepWalk(const ASailingYachtPawn& Yacht, float Dt)
{
    const bool bDeck = State == ESkipperMode::Deck;
    const FTransform Pose = Yacht.GetActorTransform();
    const FVector OldWorld = bDeck ? Pose.TransformPosition(Feet) : Feet;
    const double Water = WaterAt(Yacht, OldWorld);
    const double Speed = bCrouched ? 135 : bSprint ? 450 : 290;
    FVector Direction = MoveDirection();
    if (bDeck) Direction = FRotator(0, -Yacht.GetActorRotation().Yaw, 0).RotateVector(Direction);
    FVector Next = Feet + Direction * (Speed * Dt * (!bDeck && Feet.Z < Water ? .65 : 1.0));
    double Ground;
    if (bDeck)
    {
        Ground = Yacht.DeckFloor(Next, Feet.Z + StepUp);
        if (Yacht.DeckWall(Feet, Next))
        {
            Next = Feet;
            Ground = Yacht.DeckFloor(Feet, Feet.Z + StepUp);
        }
        if (Ground < -80)
        {
            const FVector Eye = Pose.TransformPosition(Next + FVector::UpVector * EyeHeight);
            const float Impact = FMath::Sqrt(2.f*981.f*FMath::Max(0.,Eye.Z-Water));
            EnterWater(Yacht, Eye, FMath::Min(0.0, Velocity.Z), Impact);
            return;
        }
    }
    else
    {
        Ground = GroundAt(Next, Feet.Z + 260);
        FHitResult Wall;
        const FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingWalk), true, GetOwner());
        const FVector Chest(0, 0, 75);
        const bool bBlocked = !Direction.IsNearlyZero() &&
                              GetWorld()->SweepSingleByChannel(Wall, Feet + Chest, Next + Chest, FQuat::Identity,
                                                               ECC_Visibility, FCollisionShape::MakeSphere(20), Query);
        if (Ground > Feet.Z + StepUp || (bBlocked && Wall.ImpactNormal.Z < .65))
        {
            Next = Feet;
            Ground = GroundAt(Feet, Feet.Z + StepUp);
        }
        if (Water - Ground > 142 && Feet.Z < Water + 15)
        {
            EnterWater(Yacht, Next + FVector::UpVector * EyeHeight, 0, bGrounded ? 0 : FMath::Max(0.,-Velocity.Z));
            return;
        }
    }
    Velocity.Z -= 981 * Dt;
    Next.Z += Velocity.Z * Dt;
    bGrounded = Next.Z <= Ground + 1;
    if (bGrounded)
    {
        Next.Z = Ground;
        Velocity.Z = 0;
    }
    Feet = Next;
    const FVector Eye = Feet + FVector::UpVector * (bCrouched ? 103 : EyeHeight);
    SetWorldLocation(bDeck ? Pose.TransformPosition(Eye) : Eye);
}

void USailingExplorer::Advance(ASailingYachtPawn& Yacht, float Dt)
{
    if (!Away() || bFrozen) return;
    // Substep jumps and shore contact on long render frames.
    float Remaining = FMath::Min(Dt, .15f);
    while (Remaining > UE_SMALL_NUMBER)
    {
        const float Step = FMath::Min(Remaining, 1.f / 45.f);
        if (State == ESkipperMode::Leap)
            StepLeap(Yacht, Step);
        else if (State == ESkipperMode::Swim)
            StepSwim(Yacht, Step);
        else
            StepWalk(Yacht, Step);
        Remaining -= Step;
    }
    const FVector Eye = GetComponentLocation();
    Depth = State == ESkipperMode::Swim ? FMath::Max(0.0, (WaterAt(Yacht, Eye) - Eye.Z) * .01) : 0;
    Air = FMath::Clamp(Air + Dt * (Depth > .5f ? -(1 + Depth / 10) / 220.f : .085f), 0.f, 1.f);
    PostProcessBlendWeight = FMath::SmoothStep(0.f, .43f, Depth);
}

void USailingExplorer::Jump()
{
    if ((State == ESkipperMode::Deck || State == ESkipperMode::Shore) && bGrounded)
    {
        bCrouched = false;
        bGrounded = false;
        Velocity.Z = 426;
    }
    else if (State == ESkipperMode::Swim && bFloating && Depth < .15f && PendingImpact<=0 && EntryGlide<=0)
    {
        Velocity.Z = 260;
        PendingImpact = 230;
    }
}

void USailingExplorer::Crouch()
{
    if (State == ESkipperMode::Shore) bCrouched = !bCrouched;
}

void USailingExplorer::ToggleTorch()
{
    if (Torch && Away()) Torch->SetVisibility(!Torch->IsVisible());
}
bool USailingExplorer::TorchOn() const
{
    return Torch && Torch->IsVisible();
}

bool USailingExplorer::AtLadder(const ASailingYachtPawn& Yacht) const
{
    const FVector P = Yacht.GetActorTransform().InverseTransformPosition(GetComponentLocation());
    return State == ESkipperMode::Swim && Depth < 1.65f && P.X < -385 && P.X > -800 &&
           FMath::Abs(FMath::Abs(P.Y) - 190) < 169;
}

const TCHAR* USailingExplorer::Prompt(const ASailingYachtPawn& Yacht) const
{
    if (AtLadder(Yacht)) return TEXT("E   Climb aboard");
    if (State == ESkipperMode::Deck && FVector2D::Distance(FVector2D(Feet), {-416, 145}) < 148)
        return TEXT("E   Take the helm");
    return nullptr;
}

void USailingExplorer::Interact(ASailingYachtPawn& Yacht)
{
    if (!Prompt(Yacht)) return;
    if (State == ESkipperMode::Deck)
    {
        Yacht.ToggleExplorer();
        return;
    }
    const FVector Local = Yacht.GetActorTransform().InverseTransformPosition(GetComponentLocation());
    Feet = FVector(-506, Local.Y < 0 ? -190 : 190, 70);
    Feet.Z = Yacht.DeckFloor(Feet, 115);
    Velocity = FVector::ZeroVector;
    bGrounded = true;
    bCrouched = false;
    State = ESkipperMode::Deck;
    Yaw = Yacht.GetActorRotation().Yaw;
    Pitch = -4;
    SetWorldLocationAndRotation(Yacht.GetActorTransform().TransformPosition(Feet + FVector::UpVector * EyeHeight),
                                FRotator(Pitch, Yaw, 0));
}
