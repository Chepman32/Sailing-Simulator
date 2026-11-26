#include "SailingExplorer.h"

#include "Components/SpotLightComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Materials/Material.h"
#include "SailingTrial.h"
#include "SailingEntryBubbles.h"
#include "SailingJetSki.h"

namespace
{
constexpr double EyeHeight = 162;
constexpr double CrouchEyeHeight = 103;
constexpr double StepUp = 42;
constexpr double StepDown = 19;
constexpr double WalkableFloorZ = .68;
constexpr double BodyRadius = 23;
constexpr double WadingDepthCm = 105;
constexpr double DeepBed = -4100;
constexpr float GravityCmS2 = 981.f;
constexpr double FloatingEyeCm = 46;
constexpr double SurfaceClearanceCm = 32;
constexpr double CameraFootprintM = .20;
constexpr double EntryDepthCm = 200;
constexpr double EntryContactCm = 22;
constexpr double MovementSpeedScale = 1.5;
constexpr double VerticalSwimSpeedCmS = 135 * MovementSpeedScale;
constexpr double WadeStepDepthCm = 5;
constexpr float DuckDiveSeconds = .9f;
constexpr float FullTankSeconds = 220.f;

float AirConsumptionAtDepth(float DepthM) { return (1.f + DepthM / 10.f) / FullTankSeconds; }

double WaterAt(const ASailingYachtPawn& Yacht, FVector Point)
{
    return 100 * Yacht.RenderedSurfaceHeightM(FVector2D(Point) / 100);
}

USailingExplorer::EFootSurface GroundFootSurface(const FHitResult& Hit, double WaterDepthCm)
{
    using ESurface = USailingExplorer::EFootSurface;
    if (WaterDepthCm > WadeStepDepthCm) return ESurface::Water;
    const auto* Actor = Hit.GetActor();
    if (Actor && Actor->ActorHasTag(TEXT("SailingPirate"))) return ESurface::Wood;
    const auto* Component = Hit.GetComponent();
    int32 Section = INDEX_NONE;
    const UMaterialInterface* Material = Component && Hit.FaceIndex != INDEX_NONE
        ? Component->GetMaterialFromCollisionFaceIndex(Hit.FaceIndex, Section) : nullptr;
    if (!Material && Component) Material = Component->GetMaterial(0);
    const UMaterial* Base = Material ? Material->GetMaterial() : nullptr;
    const FName Name = Base ? Base->GetFName() : NAME_None;
    static const FName Timber(TEXT("M_CoastalTimber")), StationTimber(TEXT("M_StationTimber"));
    static const FName Boulder(TEXT("M_Boulder")), TidalRock(TEXT("M_TidalRock")), Volcano(TEXT("M_VolcanicRock"));
    static const FName Quay(TEXT("M_QuayConcrete")), Masonry(TEXT("M_LighthouseStone")), Ground(TEXT("M_CoastalGround"));
    if (Name == Timber || Name == StationTimber) return ESurface::Wood;
    if (Name == Boulder || Name == TidalRock || Name == Volcano || Name == Quay || Name == Masonry)
        return ESurface::Rock;
    if (Name == Ground && Hit.ImpactPoint.Z > 310.)
        return Hit.ImpactNormal.Z < .74 ? ESurface::Rock : ESurface::Grass;
    return WaterDepthCm > -35. ? ESurface::WetSand : ESurface::Sand;
}
} // namespace

USailingExplorer::USailingExplorer()
{
    SetAutoActivate(false);
    SetFieldOfView(83);
    SetAbsolute(true, true, true);
    PostProcessBlendWeight = 0;
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
    bLeapContactReported = false;
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
    if (auto* Ski = Ride.Get()) Ski->SetRidden(false);
    Ride.Reset();
    State = ESkipperMode::Helm;
    ClearInput();
    if (Torch) Torch->SetVisibility(false);
    Depth = 0;
    Air = 1;
    bSurfaceSwim = false;
    SetActive(false);
}

void USailingExplorer::ClearInput()
{
    SetMovement(FVector2D::ZeroVector, false, false, false);
    StepTravelCm = 0;
    DuckDiveTime = 0;
    bDivePressedLast = false;
}

void USailingExplorer::SetMovement(FVector2D Axes, bool bFast, bool bRise, bool bSink)
{
    if (auto* Ski = Ride.Get()) Ski->SetInput(Axes.X, Axes.Y);
    Movement = Axes.GetClampedToMaxSize(1);
    bSprint = bFast;
    bUp = bRise;
    bDown = bSink;
}

void USailingExplorer::Look(float YawDelta, float PitchDelta)
{
    if (State == ESkipperMode::Leap) return;
    if (Ride.IsValid())
    {
        Yaw = FMath::Clamp(Yaw + YawDelta * .13f, -122.f, 122.f);
        Pitch = FMath::Clamp(Pitch + PitchDelta * .13f, -66.f, 44.f);
        // Advance updates the camera after the interpolated hull pose.
        return;
    }
    Yaw = FRotator::NormalizeAxis(Yaw + YawDelta * .13f);
    Pitch = FMath::Clamp(Pitch + PitchDelta * .13f, -84.f, 84.f);
    SetWorldRotation(FRotator(Pitch, Yaw, 0));
}

FVector USailingExplorer::MoveDirection() const
{
    return FRotator(0, Yaw, 0).RotateVector(FVector(Movement.X, Movement.Y, 0));
}

double USailingExplorer::GroundAt(const FVector& Point, double Top, FHitResult* Contact) const
{
    FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingGround), true, GetOwner());
    Query.bReturnFaceIndex = Contact != nullptr;
    FHitResult LocalHit;
    FHitResult& Hit = Contact ? *Contact : LocalHit;
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
                294 - 39 * Crouch + 310 * Flight - .5f * GravityCmS2 * FMath::Square(Flight)));
    Yaw = Yacht.GetActorRotation().Yaw + 113 * Turn;
    Pitch = -3 - 19 * Turn;
    SetWorldLocationAndRotation(Eye, FRotator(Pitch, Yaw, 0));
    if (Flight <= .32f) return;
    const double Water = WaterAt(Yacht,Eye);
    const FVector Travel = Yacht.GetActorTransform().TransformVectorNoScale({-100,240,0});
    const float Impact = FMath::Max(260.f, GravityCmS2 * Flight - 310.f);
    if (!bLeapContactReported && Eye.Z-124. <= Water)
    {
        // The feet throw spray while the camera is still clear of the crest.
        RecordWaterContact(Yacht,Eye,{Travel.X,Travel.Y,-Impact},Impact);
        bLeapContactReported = true;
    }
    if (Eye.Z < Water - 12 || LeapTime >= 3.25f)
        EnterWater(Yacht, Eye, {Travel.X,Travel.Y,-.48*Impact}, Impact);
}

void USailingExplorer::RecordWaterContact(const ASailingYachtPawn& Yacht,FVector Point,FVector ImpactVelocity,float Impact)
{
    ++WaterEntry.Sequence;
    Point.Z = WaterAt(Yacht, Point);
    WaterEntry.ContactCm = Point;
    WaterEntry.VelocityCmS = ImpactVelocity;
    WaterEntry.ImpactCmS = Impact;
}

void USailingExplorer::Splash(const ASailingYachtPawn& Yacht, FVector Eye)
{
    if (!bLeapContactReported) RecordWaterContact(Yacht,Eye,Velocity,PendingImpact);
    bLeapContactReported = false;
    Yacht.EntryBubbles().Splash(Yacht,Eye,FRotator(0,Yaw,0).Vector(),PendingImpact);
    const float Strength = FMath::Clamp(PendingImpact / 540.f, 0.f, 1.f);
    EntryGlide = DuckDiveTime > 0 ? 0.f : 1.1f * Strength;
    Velocity.Z = FMath::Min(Velocity.Z, -360. * Strength);
    PendingImpact = 0;
}

void USailingExplorer::EnterWater(const ASailingYachtPawn& Yacht, FVector Eye, FVector EntryVelocity, float Impact)
{
    State = ESkipperMode::Swim;
    Velocity = EntryVelocity;
    bFloating = true;
    bSurfaceSwim = false;
    bGrounded = bCrouched = false;
    StepTravelCm = 0;
    SetWorldLocation(Eye);
    EntryGlide = DuckDiveTime = 0;
    BreathTime = 0;
    bDivePressedLast = false;
    PendingImpact = Impact;
    if (PendingImpact > 0 && Eye.Z <= WaterAt(Yacht, Eye) + EntryContactCm) Splash(Yacht, Eye);
}

void USailingExplorer::StepSwim(const ASailingYachtPawn& Yacht, float Dt)
{
    const FVector Old = GetComponentLocation();
    const double Water = WaterAt(Yacht, Old);
    const double DepthCm = Water - Old.Z;
    // A tap during a surface kick starts its stroke when the swimmer hits the water.
    if (Air <= 0) DuckDiveTime = 0;
    // Start the timed underwater stroke when the eyes cross the actual wave.
    // A receding crest can expose the swimmer for longer than the whole kick.
    else if (PendingImpact <= 0 && DepthCm >= 0.) DuckDiveTime = FMath::Max(0.f, DuckDiveTime - Dt);
    const bool bDiving = Air > 0 && (DuckDiveTime > 0 || (bDown && (!bUp || bDivePressedLast)));
    const bool bRising = bUp && !bDiving;
    const bool bSwimDown = Air > 0 && !bUp && Movement.X > .3 && Pitch < -28.;
    if (bDiving || bSwimDown) bFloating = false;
    else if (Air <= 0 || DepthCm <= 7.) bFloating = true;
    const double Speed = MovementSpeedScale * (bFloating ? (bSprint ? 240 : 115) : (bSprint ? 370 : 175));
    FVector Target = MoveDirection() * Speed;
    if (bDiving) Target.Z = -VerticalSwimSpeedCmS;
    else if (bRising && !bFloating) Target.Z = VerticalSwimSpeedCmS;
    else if (!bFloating) Target.Z = FMath::Sin(FMath::DegreesToRadians(Pitch)) * Movement.X * Speed;
    EntryGlide = bRising ? 0.f : FMath::Max(0.f, EntryGlide - Dt);
    if (EntryGlide > 0 && DepthCm >= EntryDepthCm)
    {
        EntryGlide = 0;
        Velocity.Z = FMath::Max(Velocity.Z, -35.);
    }
    const double VerticalSpeed = Velocity.Z;
    const double Response = EntryGlide > 0 ? 1.35 : (bSprint ? 6. : 3.);
    Velocity = FMath::Lerp(Velocity, Target, 1. - FMath::Exp(-Response * Dt));
    if (PendingImpact > 0)
        Velocity.Z = VerticalSpeed - GravityCmS2 * Dt;
    else if (bDiving || (bRising && !bFloating))
        Velocity.Z = FMath::Lerp(VerticalSpeed, Target.Z, 1. - FMath::Exp(-7.5 * Dt));
    else if (bFloating && EntryGlide <= 0)
        Velocity.Z += ((Water + FloatingEyeCm - Old.Z) * 16 - Velocity.Z * 4) * Dt;
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
    if (Water - Ground <= WadingDepthCm && Ground <= Old.Z + 49)
    {
        State = ESkipperMode::Shore;
        StandAt({Next.X, Next.Y, Ground}, FVector(Velocity.X, Velocity.Y, 0));
        SetWorldLocation(Feet + FVector::UpVector * EyeHeight);
        return;
    }
    if (Ground > Old.Z + 49)
        Next = Old;
    else
        Next.Z = FMath::Max(Next.Z, Ground + 55);
    SetWorldLocation(Next);
    if (PendingImpact > 0 && Velocity.Z < 0 && Next.Z <= WaterAt(Yacht, Next) + EntryContactCm) Splash(Yacht, Next);
}

void USailingExplorer::StandAt(FVector Footing, FVector WalkingVelocity)
{
    Feet = Footing;
    Velocity = WalkingVelocity;
    FloorNormal = FVector::UpVector;
    bGrounded = true;
    bCrouched = false;
    EyeHeightCm = EyeHeight;
    StepTravelCm = StepOffsetCm = LandingOffsetCm = WalkSway = 0.;
}

void USailingExplorer::StepWalk(const ASailingYachtPawn& Yacht, float Dt)
{
    const bool bDeck = State == ESkipperMode::Deck;
    const FTransform Pose = Yacht.GetActorTransform();
    const FVector OldWorld = bDeck ? Pose.TransformPosition(Feet) : Feet;
    const double Water = WaterAt(Yacht, OldWorld);
    const double Wade = bDeck ? 0. : FMath::SmoothStep(4.,142.,Water-Feet.Z);
    FVector Direction = MoveDirection();
    if (bDeck) Direction = FRotator(0, -Yacht.GetActorRotation().Yaw, 0).RotateVector(Direction);
    const double Uphill = bGrounded ? FMath::Clamp(-FVector::DotProduct(Direction, FloorNormal), 0., .75) : 0.;
    const double Run = bSprint && !bCrouched ? FMath::Clamp(Movement.X,0.,1.) : 0.;
    const double Speed = MovementSpeedScale * (bCrouched ? 135. : 290.+160.*Run) * (1-.55*Wade) * (1-.54*Uphill);
    FVector Target = Direction*Speed;
    // A planted foot holds in ankle-deep wash. Deeper water pushes against
    // the legs even between steps, with the direction reversing in backwash.
    if (bGrounded && Wade>.08)
    {
        const auto Frame=Yacht.SeaFrame();
        const auto Flow=Sailing::SampleSea(FVector2D(Feet)*.01,Frame.TimeS,
            .005*FMath::Max(0.,Water-Feet.Z),Frame.Scale,Yacht.HasCoralCoast());
        Target+=FVector(FVector2D(Flow.VelocityMps).GetClampedToMaxSize(2.4),0.)*(48.*Wade*Wade);
    }
    FVector Horizontal(Velocity.X, Velocity.Y, 0);
    const bool bInput = !Direction.IsNearlyZero();
    const double Acceleration = bGrounded ? (bInput ? 1980. : 2650.) * (1-.32*Wade) : 385.;
    if (bGrounded || bInput)
        Horizontal = FMath::VInterpConstantTo(Horizontal, Target, Dt, Acceleration);
    FVector Next = Feet + Horizontal*Dt;
    double Ground;
    FHitResult GroundContact;
    const FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingWalk), true, GetOwner());
    if (bDeck)
    {
        Ground = Yacht.DeckFloor(Next, Feet.Z + StepUp);
        if (Yacht.DeckWall(Feet, Next))
        {
            Next = Feet;
            Horizontal = FVector::ZeroVector;
            Ground = Yacht.DeckFloor(Feet, Feet.Z + StepUp);
        }
        if (Ground < -80)
        {
            const FVector Eye = Pose.TransformPosition(Next + FVector::UpVector * EyeHeight);
            const float Impact = FMath::Sqrt(2.f * GravityCmS2 * FMath::Max(0., Eye.Z - Water));
            FVector EntryVelocity = Pose.TransformVectorNoScale(Horizontal)*.73;
            EntryVelocity.Z = FMath::Min(0.,Velocity.Z);
            EnterWater(Yacht, Eye, EntryVelocity, Impact);
            return;
        }
    }
    else
    {
        const double Head = (bCrouched ? CrouchEyeHeight : EyeHeight) + 12.;
        const double Bottom = StepUp - 1.;
        const FVector Centre(0,0,.5*(Head+Bottom));
        const FCollisionShape Body = FCollisionShape::MakeCapsule(BodyRadius, .5*(Head-Bottom));
        FHitResult Wall;
        if (!Horizontal.IsNearlyZero() && GetWorld()->SweepSingleByChannel(Wall, Feet+Centre, Next+Centre,
            FQuat::Identity, ECC_Visibility, Body, Query) && Wall.ImpactNormal.Z < WalkableFloorZ)
        {
            const FVector Normal = Wall.ImpactNormal.GetSafeNormal2D();
            const FVector Stopped = Feet + Horizontal*(Dt*Wall.Time);
            Horizontal -= Normal*FMath::Min(0.,FVector::DotProduct(Horizontal, Normal));
            Next = Stopped + Horizontal*(Dt*(1.-Wall.Time));
            FHitResult Corner;
            if (GetWorld()->SweepSingleByChannel(Corner, Stopped+Centre+Normal, Next+Centre+Normal,
                FQuat::Identity, ECC_Visibility, Body, Query) && Corner.ImpactNormal.Z < WalkableFloorZ)
            {
                Next = FMath::Lerp(Stopped,Next,Corner.Time);
                Horizontal = FVector::ZeroVector;
            }
        }
        Ground = GroundAt(Next, Feet.Z + StepUp + 1., &GroundContact);
        if (Ground > Feet.Z + StepUp || (Ground > Feet.Z + 1 && GroundContact.ImpactNormal.Z < WalkableFloorZ))
        {
            Next = Feet;
            Horizontal = FVector::ZeroVector;
            Ground = GroundAt(Feet, Feet.Z + StepUp, &GroundContact);
        }
        const double WaterAhead = FVector::DistSquared2D(Feet,Next) > 1 ? WaterAt(Yacht, Next) : Water;
        if (WaterAhead - Ground > 142 && Feet.Z < WaterAhead + 15)
        {
            EnterWater(Yacht, Next + FVector::UpVector * EyeHeight, Horizontal*.73,
                bGrounded ? 0 : FMath::Max(0.,-Velocity.Z));
            return;
        }
    }
    Velocity.X = Horizontal.X;
    Velocity.Y = Horizontal.Y;
    Velocity.Z -= GravityCmS2 * Dt;
    Next.Z += Velocity.Z * Dt;
    if (!bDeck && Velocity.Z > 0.)
    {
        const FVector HeadCentre(Next.X,Next.Y,Feet.Z + EyeHeightCm-10.);
        FHitResult Ceiling;
        if (GetWorld()->SweepSingleByChannel(Ceiling,HeadCentre,HeadCentre+FVector(0,0,Velocity.Z*Dt),
            FQuat::Identity,ECC_Visibility,FCollisionShape::MakeSphere(BodyRadius),Query)
            && Ceiling.ImpactNormal.Z < -.15)
        {
            Next.Z = Feet.Z + Velocity.Z*Dt*Ceiling.Time;
            Velocity.Z = 0.;
        }
    }
    const bool bWasGrounded = bGrounded;
    const bool bWalkable = bDeck || GroundContact.ImpactNormal.Z >= WalkableFloorZ;
    bGrounded = Next.Z <= Ground+1 || (bWasGrounded && bWalkable && Velocity.Z <= 0. && Ground >= Feet.Z-StepDown);
    const bool bLanded = bGrounded && !bWasGrounded && Velocity.Z < -160.;
    const bool bRunning = Run>.5;
    const double Stride = MovementSpeedScale * (bCrouched ? 78. : bRunning ? 150. : 100.);
    const double TravelCm = FVector::Dist2D(Feet, Next);
    if (bGrounded)
    {
        StepTravelCm += TravelCm;
        if (bLanded || StepTravelCm >= Stride)
        {
            StepTravelCm = bLanded ? 0. : StepTravelCm - Stride;
            const double WaterDepthCm = bDeck ? 0. : WaterAt(Yacht, Next) - Ground;
            const FVector Contact(Next.X,Next.Y,Ground);
            ++Footfall.Sequence;
            Footfall.Surface = bDeck ? EFootSurface::Deck : GroundFootSurface(GroundContact, WaterDepthCm);
            const FVector Side = FRotator(0,Yaw,0).RotateVector(FVector::RightVector)*((Footfall.Sequence&1) ? 9. : -9.);
            Footfall.ContactCm = bDeck ? Pose.TransformPosition(Contact) : Contact+Side;
            Footfall.VelocityCmS = bDeck ? Pose.TransformVectorNoScale(Velocity) : Velocity;
            Footfall.WaterDepthM = FMath::Max(0., WaterDepthCm * .01);
            Footfall.Strength = bCrouched ? .64f : 1.f;
            Footfall.bRunning = bRunning || bLanded;
        }
        if (bLanded) LandingOffsetCm = -FMath::Clamp((-Velocity.Z-125.)*.017, 1., 9.);
        if (bWasGrounded) StepOffsetCm = FMath::Clamp(StepOffsetCm+Feet.Z-Ground, -24., 24.);
        FloorNormal = bDeck || !GroundContact.bBlockingHit ? FVector::UpVector : GroundContact.ImpactNormal;
        Next.Z = Ground;
        Velocity.Z = 0;
    }
    Feet = Next;
    const double Response = 1.-FMath::Exp(-14.*Dt);
    EyeHeightCm = FMath::Lerp(EyeHeightCm,bCrouched ? CrouchEyeHeight : EyeHeight,Response);
    StepOffsetCm *= 1.-Response;
    LandingOffsetCm *= FMath::Exp(-8.*Dt);
    const double Gait = bGrounded ? FMath::Clamp(TravelCm/(Dt*435.),0.,1.25) : 0.;
    WalkSway = FMath::Lerp(WalkSway,Gait,Response);
    const double Phase = UE_PI*(StepTravelCm/Stride + (Footfall.Sequence&1));
    const double Bob = -1.25*WalkSway*FMath::Cos(2.*Phase);
    const FVector Eye = Feet + FVector::UpVector*(EyeHeightCm + StepOffsetCm + LandingOffsetCm + Bob);
    SetWorldLocation(bDeck ? Pose.TransformPosition(Eye) : Eye);
    SetWorldRotation(FRotator(Pitch,Yaw,.34*WalkSway*FMath::Sin(Phase)));
}

void USailingExplorer::Advance(ASailingYachtPawn& Yacht, float Dt)
{
    if (!Away() || bFrozen) return;
    if (State == ESkipperMode::JetSki)
    {
        Air = FMath::Min(1.f, Air + Dt * .085f);
        if (const auto* Ski = Ride.Get()) UpdateJetSkiView(*Ski, Dt);
        else Yacht.ToggleExplorer();
        return;
    }
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
    FVector Eye = GetComponentLocation();
    const bool bSwimming = State == ESkipperMode::Swim;
    const FVector2D XYm = FVector2D(Eye)*.01;
    const double WaterM = bSwimming ? Yacht.RenderedSurfaceHeightM(XYm) : 0.;
    // Wait for the swimmer to emerge before holding the camera above crests.
    // The entry plunge, a hop and a deliberate dive may cross the waterline.
    bSurfaceSwim = bSwimming && bFloating && EntryGlide<=0 && PendingImpact<=0 &&
        (bSurfaceSwim || Eye.Z >= 100.*WaterM+20.);
    if (bSurfaceSwim)
    {
        // The near plane has width and height. Clear the wave around the eye
        // as well as directly beneath it, including when looking down.
        double CrestM = WaterM;
        for (double X : {-CameraFootprintM, CameraFootprintM})
        for (double Y : {-CameraFootprintM, CameraFootprintM})
            CrestM = FMath::Max(CrestM, Yacht.RenderedSurfaceHeightM(XYm+FVector2D(X,Y)));
        const double ClearEyeZ = 100.*CrestM+SurfaceClearanceCm;
        if (Eye.Z < ClearEyeZ)
        {
            Eye.Z = ClearEyeZ;
            SetWorldLocation(Eye);
            Velocity.Z = FMath::Max(0., Velocity.Z);
        }
    }
    Depth = bSwimming ? FMath::Max(0., WaterM-Eye.Z*.01) : 0.;
    Air = FMath::Clamp(Air + Dt * (Depth > .5f ? -AirConsumptionAtDepth(Depth) : .085f), 0.f, 1.f);
    if (bSwimming && Depth > .9f && Air > 0.)
    {
        BreathTime += Dt;
        const float BreathInterval = bSprint ? 2.65f : 4.1f;
        if (BreathTime >= BreathInterval)
        {
            BreathTime -= BreathInterval;
            Yacht.EntryBubbles().Exhale(Yacht, Eye, FRotator(Pitch,Yaw,0), Velocity);
        }
    }
    else BreathTime = 0;
}

void USailingExplorer::Jump()
{
    if ((State == ESkipperMode::Deck || State == ESkipperMode::Shore) && bGrounded)
    {
        bGrounded = false;
        Velocity.Z = 426;
    }
    else if (State == ESkipperMode::Swim)
    {
        bDivePressedLast = false;
        DuckDiveTime = 0;
        if (bFloating && Depth < .15f && PendingImpact <= 0 && EntryGlide <= 0)
        {
            Velocity.Z = 260;
            PendingImpact = 230;
        }
    }
}

void USailingExplorer::CrouchOrDive(const ASailingYachtPawn& Yacht)
{
    if (State == ESkipperMode::Shore)
    {
        if (Air <= 0 || WaterAt(Yacht, Feet) - Feet.Z <= WadingDepthCm)
        {
            if (bCrouched && GetWorld()->SweepTestByChannel(Feet + FVector(0,0,CrouchEyeHeight-13),
                Feet + FVector(0,0,EyeHeight-11), FQuat::Identity, ECC_Visibility, FCollisionShape::MakeSphere(BodyRadius),
                FCollisionQueryParams(SCENE_QUERY_STAT(SailingStandUp), true, GetOwner()))) return;
            bCrouched = !bCrouched;
            return;
        }
        EnterWater(Yacht, GetComponentLocation(), FVector::ZeroVector, 0);
    }
    if (State == ESkipperMode::Swim && Air > 0)
    {
        bDivePressedLast = true;
        if (bFloating || Depth < .15f)
        {
            // Start the stroke even if a wave has exposed the eye before buoyancy re-engages.
            DuckDiveTime = DuckDiveSeconds;
            EntryGlide = 0;
            bFloating = false;
            if (PendingImpact <= 0) Velocity.Z = FMath::Min(Velocity.Z, -VerticalSwimSpeedCmS);
        }
    }
}

void USailingExplorer::ToggleTorch()
{
    if (Torch && Away()) Torch->SetVisibility(!Torch->IsVisible());
}
bool USailingExplorer::TorchOn() const
{
    return Torch && Torch->IsVisible();
}

float USailingExplorer::AirSecondsAtDepth() const
{
    return Air / AirConsumptionAtDepth(Depth);
}

bool USailingExplorer::AtLadder(const ASailingYachtPawn& Yacht) const
{
    const FVector P = Yacht.GetActorTransform().InverseTransformPosition(GetComponentLocation());
    return State == ESkipperMode::Swim && Depth < 1.65f && P.X < -385 && P.X > -800 &&
           FMath::Abs(FMath::Abs(P.Y) - 190) < 169;
}

bool USailingExplorer::AtHelm() const
{
    return State == ESkipperMode::Deck && FVector2D::DistSquared(FVector2D(Feet), {-416., 145.}) < FMath::Square(148.);
}

ASailingJetSki* USailingExplorer::MountedJetSki() const
{
    return Ride.Get();
}

ASailingJetSki* USailingExplorer::NearbyJetSki(const ASailingYachtPawn& Yacht) const
{
    const FVector Eye = GetComponentLocation();
    const bool bAtSurface = State == ESkipperMode::Swim && Eye.Z >= WaterAt(Yacht, Eye) - 100.;
    if (State == ESkipperMode::Shore || State == ESkipperMode::Deck || bAtSurface)
    {
        const FCollisionQueryParams Query(SCENE_QUERY_STAT(JetSkiBoard), true, &Yacht);
        ASailingJetSki* Closest = nullptr;
        double Distance = FMath::Square(480.);
        for (ASailingJetSki* Ski : Yacht.JetSkis())
        {
            if (!IsValid(Ski) || !Ski->CanDismount()) continue;
            const FVector Seat = Ski->Seat();
            const double Reach = FVector::DistSquaredXY(Eye, Seat);
            if (Reach >= Distance || FMath::Abs(Eye.Z - Seat.Z) > 375. ||
                GetWorld()->LineTraceTestByChannel(Eye, Seat + FVector(0,0,45), ECC_Visibility, Query)) continue;
            Distance = Reach;
            Closest = Ski;
        }
        return Closest;
    }
    return nullptr;
}

void USailingExplorer::MountJetSki(ASailingJetSki& Ski)
{
    Ride = &Ski;
    State = ESkipperMode::JetSki;
    Ski.SetRidden(true);
    RideHeight = Ski.Seat().Z + 85.;
    RidePitch = RideRoll = 0.;
    ClearInput();
    if (Torch) Torch->SetVisibility(false);
    Velocity = FVector::ZeroVector;
    PendingImpact = EntryGlide = Depth = 0;
    RecenterJetSkiView();
}

void USailingExplorer::RecenterJetSkiView()
{
    if (const auto* Ski = Ride.Get())
    {
        Yaw = 0.;
        Pitch = -12.;
        UpdateJetSkiView(*Ski);
    }
}

void USailingExplorer::UpdateJetSkiView(const ASailingJetSki& Ski, float Dt)
{
    const FRotator Hull = Ski.GetActorRotation();
    FVector Eye = Ski.Seat();
    // Keep the seat directly under the rider in a turn. Knees absorb heave
    // and the rider stabilises the horizon independently of the hull.
    const double Height = Eye.Z + 85.;
    RideHeight = Dt > 0 ? FMath::Lerp(RideHeight, Height, 1. - FMath::Exp(-3.2 * Dt)) : Height;
    Eye.Z = FMath::Clamp(RideHeight, Height - 32., Height + 32.);
    const double Lean = Dt > 0 ? 1. - FMath::Exp(-2.6 * Dt) : 1.;
    RidePitch = FMath::Lerp(RidePitch, .12 * Hull.Pitch, Lean);
    RideRoll = FMath::Lerp(RideRoll, .22 * Ski.Drive().BankDegrees, Lean);
    SetWorldLocationAndRotation(Eye, FRotator(Pitch + RidePitch, Yaw + Hull.Yaw, RideRoll));
    SetFieldOfView(84.f + 10.f * Ski.Drive().Planing());
}

void USailingExplorer::Arrive(const ASailingYachtPawn& Yacht, FVector Point, bool bWalking)
{
    ClearInput();
    if (auto* Ski = MountedJetSki())
    {
        Ski->Arrive(Yacht,FVector2D(Point)*.01);
        UpdateJetSkiView(*Ski);
    }
    else if (bWalking)
    {
        State = ESkipperMode::Shore;
        StandAt(Point,FVector::ZeroVector);
        Depth = 0;
        SetWorldLocation(Point + FVector(0,0,EyeHeight));
    }
    else
    {
        EnterWater(Yacht,Point + FVector(0,0,24.),FVector::ZeroVector,0.);
        Depth = 0;
    }
}

void USailingExplorer::DismountJetSki(const ASailingYachtPawn& Yacht, ASailingJetSki& Ski)
{
    if (!Ski.CanDismount()) return;
    const FVector Side = Ski.GetActorRightVector().GetSafeNormal2D();
    const FVector Aft = -Ski.GetActorForwardVector().GetSafeNormal2D();
    const FCollisionQueryParams Query(SCENE_QUERY_STAT(JetSkiDismount), true, &Ski);
    for (const FVector& Direction : {Side, -Side, Aft})
    {
        FVector Point = Ski.Seat() + Direction * 183.;
        const double Water = WaterAt(Yacht, Point);
        const double Bed = GroundAt(Point, Water + 240.);
        if (Bed > Water + 52.) continue;
        const bool bCanStand = Bed >= Water - WadingDepthCm;
        Point.Z = bCanStand ? Bed + EyeHeight : Water + FloatingEyeCm;
        if (GetWorld()->SweepTestByChannel(Ski.Seat(), Point, FQuat::Identity, ECC_Visibility,
            FCollisionShape::MakeSphere(18.), Query)) continue;

        Ski.SetRidden(false);
        Ride.Reset();
        ClearInput();
        Velocity = FVector::ZeroVector;
        Yaw = FRotator::NormalizeAxis(Yaw + Ski.GetActorRotation().Yaw);
        SetFieldOfView(83.f);
        SetWorldLocationAndRotation(Point, FRotator(Pitch, Yaw, 0));
        if (bCanStand)
        {
            State = ESkipperMode::Shore;
            StandAt({Point.X,Point.Y,Bed}, FVector::ZeroVector);
        }
        else EnterWater(Yacht, Point, FVector::ZeroVector, 0);
        return;
    }
}

const TCHAR* USailingExplorer::Prompt(const ASailingYachtPawn& Yacht) const
{
    if (const auto* Ski = Ride.Get()) return Ski->CanDismount() ? TEXT("E   Dismount") : TEXT("Slow down to dismount");
    if (AtLadder(Yacht)) return TEXT("E   Climb aboard");
    if (AtHelm()) return TEXT("E   Take the helm");
    if (NearbyJetSki(Yacht)) return TEXT("Press E to ride the jet ski");
    return nullptr;
}

void USailingExplorer::Interact(ASailingYachtPawn& Yacht)
{
    if (auto* Ski = Ride.Get())
    {
        DismountJetSki(Yacht, *Ski);
        return;
    }
    if (AtHelm())
    {
        Yacht.ToggleExplorer();
        return;
    }
    if (!AtLadder(Yacht))
    {
        if (auto* Ski = NearbyJetSki(Yacht)) MountJetSki(*Ski);
        return;
    }
    const FVector Local = Yacht.GetActorTransform().InverseTransformPosition(GetComponentLocation());
    FVector LadderFeet(-506, Local.Y < 0 ? -190 : 190, 70);
    LadderFeet.Z = Yacht.DeckFloor(LadderFeet, 115);
    StandAt(LadderFeet, FVector::ZeroVector);
    State = ESkipperMode::Deck;
    Yaw = Yacht.GetActorRotation().Yaw;
    Pitch = -4;
    SetWorldLocationAndRotation(Yacht.GetActorTransform().TransformPosition(Feet + FVector::UpVector * EyeHeight),
                                FRotator(Pitch, Yaw, 0));
}
