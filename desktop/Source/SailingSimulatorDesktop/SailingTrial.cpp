#include "SailingTrial.h"
#include "SailingMarineTraffic.h"
#include "SailingCrabs.h"
#include "SailingEncounter.h"
#include "SailingExplorer.h"
#include "SailingJetSki.h"
#include "SailingEntryBubbles.h"

#include "Camera/CameraComponent.h"
#include "Camera/CameraActor.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/BoxComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "Kismet/GameplayStatics.h"
#include "KismetProceduralMeshLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/ScopeLock.h"
#include "PhysicsProxy/SingleParticlePhysicsProxy.h"
#include "ProceduralMeshComponent.h"
#include "Engine/Texture2D.h"
#include "SailingPlayerController.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
constexpr double CmPerM = 100.0;
constexpr int32 SeaCells = 112;
constexpr double CellM = 0.36;
constexpr double SeaRadiusM = SeaCells * CellM * 0.5;
constexpr double FootCellM = .10;
// Concentrate the same vertex budget around the feet. The outer square shares
// its perimeter vertices with the existing annular LODs.
double WaterCoordinate(int32 Index)
{
    const double T=(Index-SeaCells*.5)/(SeaCells*.5);
    return (SeaCells*.5*FootCellM)*T + (SeaRadiusM-SeaCells*.5*FootCellM)*T*T*T;
}
// Four quadrants in the dense lattice, eight octants in each of two outer bands.
constexpr int32 SeaTileCount = 4 + 8 * 2;
int32 SeaTileAt(const FVector& Center)
{
    const double X = Center.X, Y = Center.Y;
    const int32 Quadrant = (X < 0 ? 1 : 0) + (Y < 0 ? 2 : 0);
    const double Radius = FMath::Max(FMath::Abs(X), FMath::Abs(Y)) / CmPerM;
    if (Radius <= SeaRadiusM) return Quadrant;
    const int32 Octant = 2 * Quadrant + (FMath::Abs(X) > FMath::Abs(Y) ? 1 : 0);
    return 4 + Octant + (Radius > 115. ? 8 : 0);
}
constexpr double ChasePitch = -4.4;
constexpr double ChaseYawOffset = -46.0;
constexpr float CloseChaseCm = 3730;
constexpr float WideChaseCm = 5040;

UMaterialInterface* FindTrialMaterial(const TCHAR* Path)
{
    ConstructorHelpers::FObjectFinderOptional<UMaterialInterface> Material(Path, LOAD_Quiet | LOAD_NoWarn);
    return Material.Get();
}

void BuildHullMesh(UProceduralMeshComponent& Mesh)
{
    constexpr int32 Sides = 20;
    constexpr double X[] = { -545, -510, -430, -300, -100, 100, 290, 410, 500, 550 };
    constexpr double Width[] = { 0, 39, 55, 59, 62, 61, 54, 38, 18, 0 };
    constexpr double Height[] = { 0, 38, 57, 66, 68, 67, 60, 44, 29, 0 };
    constexpr double CenterZ[] = { 34, 16, 10, 8, 8, 8, 13, 23, 33, 51 };
    TArray<FVector> Vertices, Normals;
    TArray<int32> Indices;
    for (double HullY : { -190.0, 190.0 })
    {
        const int32 Base = Vertices.Num();
        for (int32 Row = 0; Row < UE_ARRAY_COUNT(X); ++Row)
        {
            for (int32 Side = 0; Side < Sides; ++Side)
            {
                const double Angle = 2.0 * UE_DOUBLE_PI * Side / Sides;
                const double Cos = FMath::Cos(Angle);
                const double Sin = FMath::Sin(Angle);
                Vertices.Emplace(X[Row], HullY + Width[Row] * Cos, CenterZ[Row] + Height[Row] * Sin);
                const double End = Row == 0 ? -1.0 : (Row == UE_ARRAY_COUNT(X) - 1 ? 1.0 : 0.0);
                Normals.Add(FVector(End, Cos, Sin).GetSafeNormal());
                if (Row + 1 < UE_ARRAY_COUNT(X))
                {
                    const int32 A = Base + Row * Sides + Side;
                    const int32 B = Base + Row * Sides + (Side + 1) % Sides;
                    Indices.Append({ A, A + Sides, B, B, A + Sides, B + Sides });
                }
            }
        }
    }
    Mesh.CreateMeshSection_LinearColor(0, Vertices, Indices, Normals, {}, {}, {}, false);
}

void BuildSailMesh(UProceduralMeshComponent& Mesh)
{
    constexpr int32 Rows = 14;
    TArray<FVector> Vertices;
    TArray<FVector2D> UVs;
    TArray<int32> Indices;
    for (int32 Row = 0; Row <= Rows; ++Row)
    {
        const int32 Segments = Rows - Row;
        const double V = static_cast<double>(Row) / Rows;
        const int32 Base = Vertices.Num();
        for (int32 Col = 0; Col <= Segments; ++Col)
        {
            const double U = Segments > 0 ? static_cast<double>(Col) / Segments : 0.0;
            const double Belly = 62.0 * FMath::Sin(UE_DOUBLE_PI * 0.5 * U) * (1.0 - V);
            Vertices.Emplace(-418.0 * U * (1.0 - V) - 27.0 * V, Belly, 845.0 * V);
            UVs.Emplace(U * (1.0 - V), V);
            if (Col < Segments)
            {
                const int32 A = Base + Col;
                const int32 B = A + Segments + 1;
                Indices.Append({ A, B, A + 1 });
                if (Col + 1 < Segments)
                {
                    Indices.Append({ A + 1, B, B + 1 });
                }
            }
        }
    }
    TArray<FVector> Normals;
    TArray<FProcMeshTangent> Tangents;
    UKismetProceduralMeshLibrary::CalculateTangentsForMesh(Vertices, Indices, UVs, Normals, Tangents);
    Mesh.CreateMeshSection_LinearColor(0, Vertices, Indices, Normals, UVs, {}, Tangents, false);
}
}

ASailingYachtPawn::ASailingYachtPawn()
{
    MarineTraffic=CreateDefaultSubobject<USailingMarineTraffic>(TEXT("Marine traffic"));
    ShoreCrabs=CreateDefaultSubobject<USailingCrabs>(TEXT("Littoral crabs"));
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    bAsyncPhysicsTickEnabled = true;

    Hull = CreateDefaultSubobject<UBoxComponent>(TEXT("HullCollision"));
    SetRootComponent(Hull);
    Hull->InitBoxExtent(FVector(Sailing::HullHalfLengthM, Sailing::HullHalfBeamM, .62)*CmPerM);
    Hull->SetCollisionProfileName(TEXT("PhysicsActor"));
    Hull->BodyInstance.bUseCCD = true;
    Hull->SetLinearDamping(0.0f);
    Hull->SetAngularDamping(0.0f);

    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
    static ConstructorHelpers::FObjectFinderOptional<UStaticMesh> DetailedYacht(TEXT("/Game/Coastal/Meshes/SM_Catamaran.SM_Catamaran"), LOAD_Quiet | LOAD_NoWarn);
    static ConstructorHelpers::FObjectFinderOptional<UStaticMesh> DetailedRig(TEXT("/Game/Coastal/Meshes/SM_CatamaranRig.SM_CatamaranRig"), LOAD_Quiet | LOAD_NoWarn);
    static ConstructorHelpers::FObjectFinderOptional<UStaticMesh> ForeSail(TEXT("/Game/Coastal/Meshes/SM_CatamaranJib.SM_CatamaranJib"), LOAD_Quiet | LOAD_NoWarn);
    static ConstructorHelpers::FObjectFinderOptional<UStaticMesh> Helmsman(TEXT("/Game/Coastal/Meshes/SM_Skipper.SM_Skipper"), LOAD_Quiet | LOAD_NoWarn);
    UMaterialInterface* Gelcoat = FindTrialMaterial(TEXT("/Game/Materials/M_TrialGelcoat.M_TrialGelcoat"));
    UMaterialInterface* Teak = FindTrialMaterial(TEXT("/Game/Materials/M_TrialTeak.M_TrialTeak"));
    UMaterialInterface* Fabric = FindTrialMaterial(TEXT("/Game/Materials/M_TrialFabric.M_TrialFabric"));
    const bool bDetailed = DetailedYacht.Get() && DetailedRig.Get();
    const auto Part = [this](FName Name, USceneComponent* Parent, UStaticMesh* Shape,
        UMaterialInterface* Material, FVector Center, FVector Scale)
    {
        UStaticMeshComponent* Mesh = CreateDefaultSubobject<UStaticMeshComponent>(Name);
        Mesh->SetupAttachment(Parent);
        Mesh->SetStaticMesh(Shape);
        Mesh->SetMaterial(0, Material);
        Mesh->SetRelativeLocation(Center);
        Mesh->SetRelativeScale3D(Scale);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        return Mesh;
    };

    HullVisual = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("TwinHulls"));
    HullVisual->SetupAttachment(Hull);
    HullVisual->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    HullVisual->SetMaterial(0, Gelcoat);
    Part(TEXT("Deck"), Hull, Cube.Object, Teak, { -94, 0, 66 }, { 6.20, 4.22, 0.19 })->SetHiddenInGame(bDetailed);
    Part(TEXT("Cabin"), Hull, Cube.Object, Gelcoat, { -20, 0, 108 }, { 2.55, 2.58, 0.74 })->SetHiddenInGame(bDetailed);
    Part(TEXT("Mast"), Hull, Cylinder.Object, Gelcoat, { 58, 0, 552 }, { 0.12, 0.12, 9.88 })->SetHiddenInGame(bDetailed);
    Catamaran = Part(TEXT("Catamaran"), Hull, DetailedYacht.Get(), nullptr, FVector::ZeroVector, FVector::OneVector);
    SkipperModel = Part(TEXT("Skipper"), Hull, Helmsman.Get(), nullptr, FVector::ZeroVector, FVector::OneVector);
    SkipperView = CreateDefaultSubobject<USailingExplorer>(TEXT("SkipperView"));
    SkipperView->SetupAttachment(Hull);
    Bubbles = CreateDefaultSubobject<USailingEntryBubbles>(TEXT("WaterEntryBubbles"));
    Bubbles->SetupAttachment(Hull);
    Jib = Part(TEXT("Jib"), Hull, ForeSail.Get(), nullptr, FVector::ZeroVector, FVector::OneVector);

    Boom = CreateDefaultSubobject<USceneComponent>(TEXT("Gooseneck"));
    Boom->SetupAttachment(Hull);
    Boom->SetRelativeLocation(bDetailed ? FVector(165.365, 0, 322.334) : FVector(58, 0, 153));
    Part(TEXT("Boom"), Boom, Cube.Object, Gelcoat, { -204, 0, 0 }, { 4.30, 0.12, 0.12 })->SetHiddenInGame(bDetailed);
    Rig = Part(TEXT("CatamaranRig"), Boom, DetailedRig.Get(), nullptr, FVector::ZeroVector, FVector::OneVector);
    MainSail = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Mainsail"));
    MainSail->SetupAttachment(Boom);
    MainSail->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    MainSail->SetMaterial(0, Fabric);

    ChaseArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("ChaseArm"));
    ChaseArm->SetupAttachment(Hull);
    ChaseArm->SetUsingAbsoluteRotation(true);
    ChaseArm->SetRelativeRotation(FRotator(ChasePitch, ChaseYawOffset, 0));
    ChaseArm->TargetOffset = FVector(0, 0, 150);
    ChaseArm->TargetArmLength = CloseChaseCm;
    ChaseArm->ProbeSize = 28.f;
    ChaseArm->bEnableCameraLag = true;
    ChaseArm->CameraLagSpeed = 2.7f;
    ChaseArm->bEnableCameraRotationLag = true;
    ChaseArm->CameraRotationLagSpeed = 2.25f;
    ChaseCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ChaseCamera"));
    ChaseCamera->SetupAttachment(ChaseArm, USpringArmComponent::SocketName);
    ChaseCamera->SetFieldOfView(61.0f);

    HelmCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("HelmCamera"));
    HelmCamera->SetupAttachment(Hull);
    HelmCamera->SetRelativeLocation(bDetailed ? FVector(-416, 145, 294) : FVector(-273, 155, 226));
    HelmCamera->SetRelativeRotation(FRotator(-3.0, 0.0, 0.0));
    HelmCamera->SetAutoActivate(false);
    HelmCamera->SetFieldOfView(81.0f);

    const auto Lamp = [this](FName Name, FVector Position, FLinearColor Color, float Radius)
    {
        UPointLightComponent* Light = CreateDefaultSubobject<UPointLightComponent>(Name);
        Light->SetupAttachment(Hull);
        Light->SetRelativeLocation(Position);
        Light->SetIntensityUnits(ELightUnits::Lumens);
        Light->SetAttenuationRadius(Radius);
        Light->SetSourceRadius(5);
        Light->SetCastShadows(false);
        Light->SetLightColor(Color);
        Light->SetIntensity(0);
        return Light;
    };
    CockpitLamp = Lamp(TEXT("CockpitLamp"), {-340, 10, 255}, {1.0f, 0.56f, 0.27f}, 520);
    PortLamp = Lamp(TEXT("PortLamp"), {430, -203, 148}, {1.0f, 0.017f, 0.006f}, 260);
    StarboardLamp = Lamp(TEXT("StarboardLamp"), {430, 200, 148}, {0.01f, 0.67f, 0.22f}, 260);
}

void ASailingYachtPawn::BeginPlay()
{
    Super::BeginPlay();
    bCoralPass = GetWorld()->GetMapName().EndsWith(TEXT("CoralPass"));
    if (TActorIterator<ASailingSea> Sea{GetWorld()}; Sea) SurfaceForSampling=*Sea;
    auto Coast=MakeShared<Sailing::FShoreMap,ESPMode::ThreadSafe>(*GetWorld());
    {
        FScopeLock Lock(&HelmMutex);
        ShoreMap=MoveTemp(Coast);
    }
    Hull->SetSimulatePhysics(true);
    // Account for the load carried low in both hulls and the water entrained as they roll and pitch.
    Hull->BodyInstance.InertiaTensorScale = FVector(1.8, 1.35, 1.0);
    Hull->SetCenterOfMass(FVector(0,0,-30));
    Hull->SetMassOverrideInKg(NAME_None, Sailing::MassKg);
    if (bCoralPass)
    {
        Hull->SetPhysicsLinearVelocity(GetActorForwardVector() * (345.0 * Sailing::CruisingSpeedScale));
    }
    ChaseArm->SetWorldRotation(FRotator(ChasePitch, GetActorRotation().Yaw + ChaseYawOffset, 0));
    ViewYaw = ChaseYawOffset;
    ViewPitch = ChasePitch;
    ViewDistanceCm = FParse::Param(FCommandLine::Get(), TEXT("SailingWide")) ? WideChaseCm : CloseChaseCm;
    ChaseArm->TargetArmLength = ViewDistanceCm;
    if (FParse::Param(FCommandLine::Get(), TEXT("SailingHelm")))
    {
        View = EYachtView::Helm;
        RecenterView();
    }
    ActivateView();
    if (!Catamaran->GetStaticMesh() || !Rig->GetStaticMesh())
    {
        BuildHullMesh(*HullVisual);
        BuildSailMesh(*MainSail);
    }
    if (bCoralPass)
    {
        ASailingJetSki::SpawnFleet(*this, JetSkiFleet);
        MarineTraffic->Launch(*this);
        ShoreCrabs->Populate();
    }
}

void ASailingYachtPawn::EndPlay(const EEndPlayReason::Type Reason)
{
    if (Reason == EEndPlayReason::Destroyed)
        for (ASailingJetSki* Ski : JetSkiFleet)
            if (IsValid(Ski)) Ski->Destroy();
    JetSkiFleet.Reset();
    Super::EndPlay(Reason);
}

void ASailingYachtPawn::SetDeckLights(float Strength)
{
    CockpitLamp->SetIntensity(Strength * 125.0f);
    PortLamp->SetIntensity(Strength * 32.0f);
    StarboardLamp->SetIntensity(Strength * 30.0f);
}

void ASailingYachtPawn::SetSurfaceWetness(float Wetness)
{
    // The hull finish and both sailcloth meshes read slot zero in their materials.
    Catamaran->SetCustomPrimitiveDataFloat(0,Wetness);
    Rig->SetCustomPrimitiveDataFloat(0,Wetness);
    Jib->SetCustomPrimitiveDataFloat(0,Wetness);
}

void ASailingYachtPawn::SetRudder(double Value)
{
    Helm.Rudder = FMath::Clamp(Value, -1.0, 1.0);
    bKeyboardRudder = false;
}

void ASailingYachtPawn::SetEngineRunning(bool bRunning)
{
    if (bRunning && !Helm.bEngineOn && FMath::Abs(Helm.Throttle) <= 0.08)
    {
        SetThrottle(0.12);
    }
    Helm.bEngineOn = bRunning;
}

void ASailingYachtPawn::DriveHelm(float DeltaSeconds, int32 Steering, int32 Throttle, int32 Ease)
{
    constexpr double RudderRate = 6.5;
    constexpr double RudderCenteringRate = 8.0;
    if (Steering != 0)
    {
        Helm.Rudder = FMath::Clamp(Helm.Rudder + Steering * DeltaSeconds * RudderRate, -1.0, 1.0);
        bKeyboardRudder = true;
    }
    else if (bKeyboardRudder)
    {
        Helm.Rudder = FMath::FInterpConstantTo(Helm.Rudder, 0.0, DeltaSeconds, RudderCenteringRate);
        bKeyboardRudder = Helm.Rudder != 0;
    }
    SetThrottle(Helm.Throttle + Throttle * DeltaSeconds * 1.25);
    if (Ease != 0)
    {
        if (Helm.bAutoTrim)
        {
            Helm.SheetEase = (FMath::RadiansToDegrees(ReadSail().SheetAngleRad) - 7.0) / 80.0;
            Helm.bAutoTrim = false;
        }
        Helm.SheetEase = FMath::Clamp(Helm.SheetEase + Ease * DeltaSeconds * 0.35, 0.0, 1.0);
    }
}

const TCHAR* ASailingYachtPawn::ViewName() const
{
    switch (View)
    {
    case EYachtView::Helm: return TEXT("Helm");
    case EYachtView::Orbit: return TEXT("Orbit");
    case EYachtView::Drone: return TEXT("Drone");
    default: return TEXT("Chase");
    }
}

void ASailingYachtPawn::ActivateView()
{
    if (SkipperView->Away())
    {
        ChaseCamera->SetActive(false);
        HelmCamera->SetActive(false);
        return;
    }
    const bool bAtHelm = View == EYachtView::Helm && !bCinematic;
    ChaseCamera->SetActive(!bAtHelm);
    HelmCamera->SetActive(bAtHelm);
}

TOptional<FVector> ASailingYachtPawn::FindTravelSpot(FVector2D PinM) const
{
    const auto Mode = SkipperView->Mode();
    const bool bWalking = Mode == ESkipperMode::Deck || Mode == ESkipperMode::Shore;
    const auto* Ski = SkipperView->MountedJetSki();
    const FVector2D Bow(GetActorForwardVector().GetSafeNormal2D());
    const FQuat Heading = FRotator(0.,GetActorRotation().Yaw,0.).Quaternion();
    FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingArrival),true,this);
    const auto Try = [&](FVector2D P) -> TOptional<FVector>
    {
        const FVector Water(P*100., SurfaceHeightM(P)*100.);
        if (Mode != ESkipperMode::Helm)
        {
            const FVector Local = GetActorTransform().InverseTransformPosition(Water);
            if (FMath::Abs(Local.X)<720. && FMath::Abs(Local.Y)<360.) return {};
        }
        FHitResult Hit;
        const bool bGround = GetWorld()->LineTraceSingleByChannel(Hit, FVector(Water.X,Water.Y,100000.),
            FVector(Water.X,Water.Y,-15000.), ECC_Visibility,Query);
        if (bWalking)
        {
            if (!bGround || Hit.ImpactPoint.Z < Water.Z-15. || Hit.ImpactNormal.Z < .72) return {};
            if (GetWorld()->OverlapBlockingTestByChannel(Hit.ImpactPoint+FVector(0,0,95),FQuat::Identity,
                ECC_Visibility,FCollisionShape::MakeCapsule(29.,87.),Query)) return {};
            return Hit.ImpactPoint;
        }
        const double Depth = Mode == ESkipperMode::Helm ? 170. : Ski ? 80. : 165.;
        if (bGround && Hit.ImpactPoint.Z > FMath::Min(0.,Water.Z)-Depth) return {};
        if (Ski && !Ski->CanArrive(*this,P)) return {};
        if (Mode == ESkipperMode::Helm)
        {
            if (ShoreMap && ShoreMap->AtHull(P,Bow).ClearanceM < 2.) return {};
            if (GetWorld()->OverlapBlockingTestByChannel(Water,Heading,Hull->GetCollisionObjectType(),
                FCollisionShape::MakeBox(FVector(595,300,100)),Query)) return {};
        }
        return Water;
    };
    if (auto Spot = Try(PinM)) return Spot;
    for (const double Radius : {2.,5.,10.,18.,32.,55.,90.,145.,230.,360.,540.,800.,1200.,1800.})
    {
        for (int32 I=0; I<24; ++I)
        {
            const double Angle = I*UE_TWO_PI/24.;
            if (auto Spot=Try(PinM+Radius*FVector2D(FMath::Cos(Angle),FMath::Sin(Angle)))) return Spot;
        }
    }
    return {};
}

bool ASailingYachtPawn::TravelTo(FVector ApprovedSpot)
{
    const auto Spot = FindTravelSpot(FVector2D(ApprovedSpot)*.01);
    if (!Spot || FVector::DistSquared2D(*Spot,ApprovedSpot)>1.) return false;
    if (SkipperView->Away())
    {
        const auto Mode = SkipperView->Mode();
        SkipperView->Arrive(*this,*Spot,Mode==ESkipperMode::Deck || Mode==ESkipperMode::Shore);
    }
    else
    {
        const FRotator Heading(0,GetActorRotation().Yaw,0);
        if (!SetActorLocationAndRotation(*Spot+FVector(0,0,12),Heading,false,nullptr,ETeleportType::TeleportPhysics)) return false;
        SetRudder(0);
        SetThrottle(0);
        Hull->SetPhysicsLinearVelocity(FVector::ZeroVector);
        Hull->SetPhysicsAngularVelocityInRadians(FVector::ZeroVector);
        Hull->WakeRigidBody();
        Impacts = {};
        const uint32 NextRevision = WakeTrail.Revision+1;
        WakeTrail = {};
        WakeTrail.Revision = NextRevision;
        for (int32 Side=0; Side<2; ++Side) { BowWater[Side]={}; LastBowClearance[Side]=0.; }
        FScopeLock Lock(&HelmMutex);
        PhysicsTraffic = MarineTraffic->Field();
        PhysicsHelm = Helm;
        PhysicsImpacts = Impacts;
        bResetPhysicsTravel.store(true);
        bRefloatRequested.store(false);
    }
    ++TravelSerial;
    return true;
}

void ASailingYachtPawn::ToggleExplorer()
{
    if (SkipperView->Away()) SkipperView->Return();
    else
    {
        bCinematic = false;
        SetRudder(0);
        SetEngineRunning(false);
        SetThrottle(0);
        Helm.AnchorM = FVector2D(GetActorLocation()) * .01;
        Catamaran->SetCollisionResponseToAllChannels(ECR_Ignore);
        Catamaran->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
        Catamaran->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
        SkipperView->Leave(*this);
    }
    Helm.bHoveTo = SkipperView->Away();
    if (!Helm.bHoveTo) Catamaran->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SkipperModel->SetVisibility(!Helm.bHoveTo);
    ActivateView();
}

FVector ASailingYachtPawn::WorldFocus() const
{
    return SkipperView->Away() ? SkipperView->GetComponentLocation() : GetActorLocation();
}

double ASailingYachtPawn::DeckFloor(FVector Feet, double Top) const
{
    FHitResult Hit;
    const FTransform Pose = GetActorTransform();
    const FCollisionQueryParams Query(SCENE_QUERY_STAT(SailingDeck), true);
    if (Catamaran->LineTraceComponent(Hit, Pose.TransformPosition({Feet.X,Feet.Y,Top}),
        Pose.TransformPosition({Feet.X,Feet.Y,-80}), Query))
        return Pose.InverseTransformPosition(Hit.ImpactPoint).Z;
    // The rope lattice has gaps between its strands. The trial hull also has
    // no imported mesh; its cockpit and steps use the authored local dimensions.
    if (Feet.X > 260 && Feet.X < 444 && FMath::Abs(Feet.Y)<135 && Top >= 137) return 137;
    if (!Catamaran->GetStaticMesh() && Feet.X >= -545 && Feet.X < 420 && FMath::Abs(Feet.Y) < 220)
        return Feet.X < -480 ? 60 : 84;
    return -1000;
}

bool ASailingYachtPawn::DeckWall(FVector From, FVector To) const
{
    if (From.Equals(To, .01)) return false;
    const FTransform Pose = GetActorTransform();
    const FVector Chest(0,0,85);
    FHitResult Hit;
    return Catamaran->LineTraceComponent(Hit, Pose.TransformPosition(From + Chest),
        Pose.TransformPosition(To + Chest + (To-From).GetSafeNormal2D()*19), FCollisionQueryParams(SCENE_QUERY_STAT(SailingCabin),true))
        && FVector::DotProduct(Hit.ImpactNormal, Pose.GetUnitAxis(EAxis::Z)) < .65;
}

void ASailingYachtPawn::CycleView()
{
    SelectView(static_cast<EYachtView>((int32(View)+1)%4));
}

void ASailingYachtPawn::SelectView(EYachtView Next)
{
    bCinematic = false;
    View = Next;
    ViewDistanceCm = View == EYachtView::Drone ? 4200.f : View == EYachtView::Orbit ? 2400.f : CloseChaseCm;
    RecenterView();
    ActivateView();
}

void ASailingYachtPawn::RecenterView()
{
    if (bCinematic)
    {
        CinematicYaw = 0;
        CinematicPitch = -13.f;
        return;
    }
    ViewYaw = 0;
    switch (View)
    {
    case EYachtView::Helm: ViewPitch = -3; break;
    case EYachtView::Orbit: ViewPitch = -14; break;
    case EYachtView::Drone: ViewPitch = -33; break;
    default: ViewPitch = ChasePitch; break;
    }
}

void ASailingYachtPawn::OrbitView(FVector2D Pixels)
{
    const bool bAtHelm = View == EYachtView::Helm && !bCinematic;
    float& Yaw = bCinematic ? CinematicYaw : ViewYaw;
    float& Pitch = bCinematic ? CinematicPitch : ViewPitch;
    const float NewYaw = Yaw + FMath::RadiansToDegrees(Pixels.X * 0.0047);
    Yaw = bAtHelm ? FMath::Clamp(NewYaw, -83.f, 83.f) : FRotator::NormalizeAxis(NewYaw);
    Pitch = FMath::Clamp<float>(Pitch - FMath::RadiansToDegrees(Pixels.Y * 0.0038), -62.f, bAtHelm ? 18.f : -2.f);
}

void ASailingYachtPawn::ZoomView(double WheelDelta)
{
    if (!bCinematic && View == EYachtView::Helm) return;
    const float Minimum = !bCinematic && View == EYachtView::Drone ? 3400.f : 700.f;
    float& Distance = bCinematic ? CinematicDistanceCm : ViewDistanceCm;
    Distance = FMath::Clamp<float>(Distance - WheelDelta * 160, Minimum, 6800.f);
}

void ASailingYachtPawn::SetCinematic(bool bEnabled)
{
    bCinematic = bEnabled;
    if (bEnabled)
    {
        CinematicYaw = ViewYaw;
        CinematicPitch = -13.f;
        CinematicDistanceCm = WideChaseCm;
    }
    ActivateView();
}

void ASailingYachtPawn::UpdateView(float DeltaSeconds)
{
    if (View == EYachtView::Helm && !bCinematic)
    {
        HelmCamera->SetRelativeRotation(FRotator(ViewPitch, ViewYaw, 0));
        return;
    }
    if (bCinematic) CinematicYaw = FRotator::NormalizeAxis(CinematicYaw + DeltaSeconds * 3.5f);
    const float Distance = bCinematic ? CinematicDistanceCm : ViewDistanceCm;
    ChaseArm->TargetArmLength = FMath::FInterpTo(ChaseArm->TargetArmLength, Distance, DeltaSeconds, 3.f);
    const float Wide = FMath::Clamp((ChaseArm->TargetArmLength - CloseChaseCm) / (WideChaseCm - CloseChaseCm), 0.f, 1.f);
    ChaseArm->TargetOffset.Z = FMath::Lerp(150.f, -28.f, Wide);
    ChaseCamera->SetFieldOfView(FMath::Lerp(61.f, 68.f, Wide));
    const float Pitch = bCinematic ? CinematicPitch : ViewPitch - 1.6f * Wide;
    const float Yaw = GetActorRotation().Yaw + (bCinematic ? CinematicYaw : ViewYaw);
    ChaseArm->SetWorldRotation(FRotator(Pitch, Yaw, 0));
}

void ASailingYachtPawn::CalcCamera(float DeltaSeconds, FMinimalViewInfo& OutView)
{
    Super::CalcCamera(DeltaSeconds,OutView);
    if (SkipperView->Away() || !ChaseCamera->IsActive()) return;
    // The spring arm collides with solid scenery. The displaced sea has no collision mesh.
    const double FloorCm = 100.*SurfaceHeightM(FVector2D(OutView.Location)*.01) + 65.;
    if (OutView.Location.Z < FloorCm)
    {
        const FVector Aim = OutView.Location + OutView.Rotation.Vector()*ChaseArm->TargetArmLength;
        OutView.Location.Z = FloorCm;
        OutView.Rotation = (Aim-OutView.Location).Rotation();
    }
    if (bCinematic)
    {
        const FVector Subject = GetActorLocation() + FVector(0, 0, 350);
        auto& Settings = OutView.PostProcessSettings;
        Settings.bOverride_DepthOfFieldFocalDistance = true;
        Settings.DepthOfFieldFocalDistance = FMath::Max(100., FVector::DotProduct(Subject-OutView.Location, OutView.Rotation.Vector()));
        Settings.bOverride_DepthOfFieldSensorWidth = true;
        Settings.DepthOfFieldSensorWidth = 54.f;
        OutView.PostProcessBlendWeight = 1.f;
    }
}

void ASailingYachtPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Controller) Helm = {};
    if (bRefloatRequested.exchange(false)) RefloatIfGrounded();
    MarineTraffic->Advance(*this,SeaFrame().TimeS);
    ShoreCrabs->Advance(*this,DeltaSeconds);
    UpdateBowContact();
    {
        FScopeLock Lock(&HelmMutex);
        PhysicsTraffic = MarineTraffic->Field();
        PhysicsHelm = Helm;
        PhysicsImpacts = Impacts;
        if (WakeTrail.Revision != PhysicsWakeTrail.Revision) WakeTrail = PhysicsWakeTrail;
    }

    const Sailing::FSail Sail = ReadSail();
    if (FMath::Abs(FMath::Sin(Sail.ApparentAngleRad)) > 0.12)
    {
        LeewardSide = FMath::Sign(Sail.ApparentAngleRad);
    }
    BoomAngle = FMath::FInterpTo(BoomAngle, FMath::RadiansToDegrees(Sail.SheetAngleRad) * LeewardSide, DeltaSeconds, 3.2);
    Boom->SetRelativeRotation(FRotator(0, BoomAngle, 0));
    // Ease the visual reef over several seconds. The cloth draws in towards
    // the gooseneck, leaving the boom and standing rigging at their full size.
    SailSpan = FMath::Lerp(SailSpan,FMath::Sqrt(Sail.WorkingAreaFraction),1.-FMath::Exp(-DeltaSeconds*.48));
    MainSail->SetRelativeScale3D(FVector(SailSpan,-LeewardSide*SailSpan,SailSpan));
    Rig->SetRelativeScale3D(FVector(1.0, -LeewardSide, 1.0));
    Rig->SetCustomPrimitiveDataFloat(1,1.-SailSpan);
    // Scale about the authored tack. The shorter working jib still follows the forestay.
    Jib->SetRelativeLocation(FVector(567,0,159)*(1.-SailSpan));
    Jib->SetRelativeScale3D(FVector(SailSpan,-LeewardSide*SailSpan,SailSpan));
    for (ASailingJetSki* Ski : JetSkiFleet)
        if (IsValid(Ski)) Ski->Advance(*this, DeltaSeconds);
    if (SkipperView->Away()) SkipperView->Advance(*this, DeltaSeconds);
    else UpdateView(DeltaSeconds);
}

void ASailingYachtPawn::AsyncPhysicsTickActor(float DeltaSeconds, float SimTime)
{
    FBodyInstanceAsyncPhysicsTickHandle Body = Hull->BodyInstance.GetBodyInstanceAsyncPhysicsTickHandle();
    if (!Body)
    {
        return;
    }

    Sailing::FHelm Controls;
    Sailing::FWaterImpacts ContactWaves;
    Sailing::FTrafficWater TrafficWaves;
    TSharedPtr<const Sailing::FShoreMap,ESPMode::ThreadSafe> Coast;
    const FVector OriginCm = Body->X();
    const FQuat Rotation = Body->R();
    const auto Wake = Sailing::FBoatWake::FromMotion(FVector2D(OriginCm)*.01,
        FVector2D(Rotation.GetForwardVector().GetSafeNormal2D()), FVector2D(Body->V())*.01, Body->W().Z);
    {
        FScopeLock Lock(&HelmMutex);
        Controls = PhysicsHelm;
        ContactWaves = PhysicsImpacts;
        TrafficWaves = PhysicsTraffic;
        Coast = ShoreMap;
        if (bResetPhysicsTravel.exchange(false))
        {
            PhysicsShoreGuard = {};
            PhysicsWakeTrail = {};
        }
        PhysicsWakeTrail.Record(Wake, SimTime);
    }
    const FVector CenterOfMassCm = OriginCm + Rotation.RotateVector(Body->CenterOfMass());
    const Sailing::FRigidState State = {
        OriginCm / CmPerM, CenterOfMassCm / CmPerM, Rotation, Body->V() / CmPerM, Body->W()
    };
    const float Scale = SeaScale.load(std::memory_order_relaxed);
    Sailing::FLoads Loads = Sailing::CalculateLoads(State, Controls, SimTime, Scale, bCoralPass, &ContactWaves, &PhysicsWakeTrail, &TrafficWaves);
    if (Coast && PhysicsShoreGuard.Constrain(*Coast,State,Controls,DeltaSeconds,Loads))
        bRefloatRequested.store(true);
    Body->AddForce(Loads.ForceN * CmPerM);
    Body->AddTorque(Loads.TorqueNm * FMath::Square(CmPerM));
    WaterFrame.store({ SimTime, Scale }, std::memory_order_relaxed);
}

void ASailingYachtPawn::RefloatIfGrounded()
{
    const FVector2D Center=FVector2D(GetActorLocation())/CmPerM;
    const FVector2D Bow(GetActorForwardVector().GetSafeNormal2D());
    const Sailing::FShoreContact Contact=ShoreMap->AtHull(Center,Bow);
    if (Contact.ClearanceM>1.15) return;
    const FVector2D Edge=Center-Contact.Seaward*Contact.ClearanceM;
    const FVector2D Along(-Contact.Seaward.Y,Contact.Seaward.X);
    const FQuat Attitude=FRotator(0,GetActorRotation().Yaw,0).Quaternion();
    const auto Frame=SeaFrame();
    // Start beside the grounding. Check both hulls and the actual blocking scene
    // before refloating, so a quay or moored ship cannot become the destination.
    for (const double Off : {3.,6.,12.,24.,48.,96.})
    for (const double Side : {0.,-1.,1.})
    {
        const FVector2D Spot=Edge+(Contact.Seaward+Along*Side)*Off;
        if (ShoreMap->AtHull(Spot,Bow).ClearanceM<2.) continue;
        const auto Sea=Sailing::SampleSea(Spot,Frame.TimeS,0,Frame.Scale,bCoralPass);
        const FVector Afloat=FVector(Spot,Sea.HeightM+.12)*CmPerM;
        if (GetWorld()->OverlapBlockingTestByChannel(Afloat,Attitude,Hull->GetCollisionObjectType(),
            FCollisionShape::MakeBox(FVector(565,278,80)),FCollisionQueryParams(SCENE_QUERY_STAT(SailingRefloat),false,this)))
            continue;
        SetActorLocationAndRotation(Afloat,Attitude,false,nullptr,ETeleportType::TeleportPhysics);
        Hull->SetPhysicsLinearVelocity(FVector(Contact.Seaward*1.2,Sea.VelocityMps.Z)*CmPerM);
        Hull->SetPhysicsAngularVelocityInRadians(FVector::ZeroVector);
        Hull->WakeRigidBody();
        if (Helm.bHoveTo) Helm.AnchorM=Spot;
        return;
    }
}

Sailing::FBoatWake ASailingYachtPawn::BoatWake() const
{
    return Sailing::FBoatWake::FromMotion(FVector2D(GetActorLocation())*.01,
        FVector2D(GetActorForwardVector().GetSafeNormal2D()), FVector2D(GetVelocity())*.01, Hull->GetPhysicsAngularVelocityInRadians().Z);
}

double ASailingYachtPawn::SurfaceHeightM(FVector2D XYm) const
{
    const auto Frame = SeaFrame();
    return Sailing::SeaHeight(XYm, Frame, bCoralPass) + BoatWake().HeightAt(XYm)
        + Impacts.At(XYm,Frame.TimeS).HeightM + WakeTrail.At(XYm,Frame.TimeS).HeightM + MarineTraffic->Field().At(XYm,Frame.TimeS).HeightM;
}

double ASailingYachtPawn::RenderedSurfaceHeightM(FVector2D XYm,Sailing::FSeaFrame Frame) const
{
    const auto Wake=BoatWake();
    const auto Height=[&](FVector2D P) {
        return Sailing::SeaHeight(P,Frame,bCoralPass)+Wake.HeightAt(P)+Impacts.At(P,Frame.TimeS).HeightM+WakeTrail.At(P,Frame.TimeS).HeightM + MarineTraffic->Field().At(P,Frame.TimeS).HeightM;
    };
    // Barycentric interpolation on the same cell and diagonal as BuildSurface.
    // The diver can sit within a centimetre of the water/air boundary.
    const FVector2D Center=SurfaceForSampling.IsValid() ? FVector2D(SurfaceForSampling->GetActorLocation())/CmPerM : FVector2D::ZeroVector;
    const FVector2D Local=XYm-Center;
    if (FMath::Max(FMath::Abs(Local.X),FMath::Abs(Local.Y))>=SeaRadiusM) return Height(XYm);
    const auto Interval=[](double Value)
    {
        int32 Low=0,High=SeaCells;
        while (High-Low>1)
        {
            const int32 Mid=(Low+High)/2;
            if (WaterCoordinate(Mid)<=Value) Low=Mid;
            else High=Mid;
        }
        return FVector2D(WaterCoordinate(Low),WaterCoordinate(High));
    };
    const FVector2D X=Interval(Local.X)+FVector2D(Center.X,Center.X);
    const FVector2D Y=Interval(Local.Y)+FVector2D(Center.Y,Center.Y);
    const FVector2D UV((XYm.X-X.X)/(X.Y-X.X),(XYm.Y-Y.X)/(Y.Y-Y.X));
    const double East=Height({X.Y,Y.X}),North=Height({X.X,Y.Y});
    if (UV.X+UV.Y<=1.) return Height({X.X,Y.X})*(1.-UV.X-UV.Y)+East*UV.X+North*UV.Y;
    return Height({X.Y,Y.Y})*(UV.X+UV.Y-1.)+East*(1.-UV.Y)+North*(1.-UV.X);
}

void ASailingYachtPawn::DisturbSurface(FVector PositionCm, float HeightM)
{
    Impacts.Emit(FVector2D(PositionCm)*.01, SeaFrame().TimeS, HeightM);
}

void ASailingYachtPawn::WhaleContact(FVector PositionCm, float Strength, bool bDistant)
{
    Impacts.WhalePrints[bDistant ? 1 : 0] = FLinearColor(PositionCm.X*.01, PositionCm.Y*.01, SeaFrame().TimeS, Strength);
}

void ASailingYachtPawn::UpdateBowContact()
{
    const auto Frame = SeaFrame();
    for (int32 Side = 0; Side < 2; ++Side)
    {
        const FVector Bow = GetActorTransform().TransformPositionNoScale({445., Side ? 193. : -193., 19.});
        const auto Sea = Sailing::SampleSea(FVector2D(Bow)*.01, Frame.TimeS, 0, Frame.Scale, bCoralPass);
        const double Clearance = Bow.Z*.01-Sea.HeightM;
        const FVector Velocity = Hull->GetPhysicsLinearVelocityAtPoint(Bow)*.01;
        // The stem meets the moving surface at dH/dt + grad(H) dot Vbow.
        const double Closing = Sea.SurfaceRiseMps+FVector2D::DotProduct(Sea.Gradient,FVector2D(Velocity))-Velocity.Z;
        const double Surge = FVector::DotProduct(Velocity-Sea.VelocityMps,GetActorForwardVector().GetSafeNormal2D());
        auto& Contact = BowWater[Side];
        Contact.WaterlineM = FVector(Bow.X*.01,Bow.Y*.01,Sea.HeightM);
        Contact.Sheet = FMath::SmoothStep(1.1,4.5,Surge)*FMath::SmoothStep(.17,1.85,Closing)
            * FMath::SmoothStep(-1.05,-.4,Clearance)*(1-FMath::SmoothStep(.08,.39,Clearance));
        if (LastBowClearance[Side] > 0 && Clearance <= 0 && Frame.TimeS-Contact.LastStrikeS > 1.15)
        {
            if (Closing > .48)
            {
                DisturbSurface(Bow,FMath::Clamp(Closing*.115,.065,.31));
                Contact.StrikeM = Contact.WaterlineM;
                Contact.LastStrikeS = Frame.TimeS;
                Contact.StrikeMps = Closing;
                // Orbital displacement is also applied by the water material.
                // Only the wind-driven surface drift persists over the life of the foam.
                Contact.FoamDriftMps = .035*FVector2D(Sailing::TrueWind(Frame.TimeS, Frame.Scale));
            }
        }
        LastBowClearance[Side] = Clearance;
    }
}

Sailing::FSail ASailingYachtPawn::ReadSail() const
{
    const FVector CenterOfEffort = GetActorTransform().TransformPositionNoScale(FVector(25, 0, 440));
    const Sailing::FSeaFrame Frame = SeaFrame();
    const FVector RelativeAir = Sailing::TrueWind(Frame.TimeS, Frame.Scale) - Hull->GetPhysicsLinearVelocityAtPoint(CenterOfEffort) / CmPerM;
    return Sailing::SolveSail(GetActorForwardVector().GetSafeNormal2D(), RelativeAir, Helm);
}

ASailingSea::ASailingSea()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("OceanOrigin")));
    for (int32 I = 0; I < SeaTileCount; ++I)
    {
        // Keep the original subobject name for maps saved with the one-piece grid.
        const FName Name = I == 0 ? FName(TEXT("WaterSurface")) : FName(*FString::Printf(TEXT("SeaTile%d"), I));
        auto* Tile = CreateDefaultSubobject<UProceduralMeshComponent>(Name);
        Tile->SetupAttachment(RootComponent);
        Tile->bForceMipStreaming = true;
        Tile->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Tile->SetCastShadow(false);
        Tile->SetCastContactShadow(false);
        Tile->SetAffectDistanceFieldLighting(false);
        Tile->SetVisibleInRayTracing(false);
        SurfaceTiles.Add(Tile);
    }
    WaterMaterial = FindTrialMaterial(TEXT("/Game/Coastal/Materials/M_CoralWater.M_CoralWater"));
    if (!WaterMaterial)
    {
        WaterMaterial = FindTrialMaterial(TEXT("/Game/Materials/M_TrialWater.M_TrialWater"));
    }
}

void ASailingSea::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform);
    Water = UMaterialInstanceDynamic::Create(WaterMaterial, this);
    BuildSurface();
    BindSurfProfile();
    SetSurfaceFrame({});
}

void ASailingSea::SetPrecipitation(float Intensity, float Wetness)
{
    if (Water) Water->SetScalarParameterValue(TEXT("RainIntensity"),Intensity);
    if (Shore) Shore->SetScalarParameterValue(TEXT("RainWetness"),Wetness);
}

void ASailingSea::BeginPlay()
{
    Super::BeginPlay();
    // Placed actors can load from a cooked map without running construction.
    if (!Water)
    {
        Water = UMaterialInstanceDynamic::Create(WaterMaterial, this);
        BuildSurface();
    }
    BindSurfProfile();
    TMap<UMaterialInterface*,UMaterialInstanceDynamic*> StoneInstances;
    // Shared instances put exposed stone and sand on the same tide clock.
    for (TActorIterator<AStaticMeshActor> It(GetWorld()); It; ++It)
    {
        UStaticMeshComponent* Mesh = It->GetStaticMeshComponent();
        UMaterialInterface* Base = Mesh ? Mesh->GetMaterial(0) : nullptr;
        if (Mesh && Mesh->Mobility == EComponentMobility::Movable && It->ActorHasTag(TEXT("SailingChannelBuoy")))
            ChannelBuoys.Add({*It, It->GetActorTransform()});
        if (Base && Base->GetFName() == TEXT("M_CoastalGround"))
        {
            if (!Shore)
            {
                Shore = UMaterialInstanceDynamic::Create(Base, this);
                Shore->SetTextureParameterValue(TEXT("RockFlow"),RockFlow);
            }
            Mesh->SetMaterial(0, Shore);
        }
        else if (Base && (Base->GetFName()==TEXT("M_TidalRock") || Base->GetFName()==TEXT("M_Boulder")))
        {
            auto*& WetStone=StoneInstances.FindOrAdd(Base);
            if (!WetStone)
            {
                WetStone=UMaterialInstanceDynamic::Create(Base,this);
                WetStone->SetTextureParameterValue(TEXT("SurfProfile"),SurfProfile);
                WetStone->SetTextureParameterValue(TEXT("RockFlow"),RockFlow);
                WetStone->SetTextureParameterValue(TEXT("RockWash"),RockWash);
                TidalStone.Add(WetStone);
            }
            Mesh->SetMaterial(0,WetStone);
        }
    }
    SetSurfaceFrame({});
}

void ASailingSea::UpdateChannelBuoys(const ASailingYachtPawn& Yacht, float DeltaSeconds)
{
    const auto Frame = Yacht.SeaFrame();
    const double HeaveResponse = 1. - FMath::Exp(-4.5 * DeltaSeconds);
    const double TiltResponse = 1. - FMath::Exp(-3.2 * DeltaSeconds);
    for (const FChannelBuoy& Buoy : ChannelBuoys)
    {
        auto* Actor = Buoy.Actor.Get();
        if (!Actor) continue;
        FVector Position = Buoy.Mooring.GetLocation();
        const FVector2D XYm = FVector2D(Position) / CmPerM;
        const auto Sea = Sailing::SampleSea(XYm, Frame.TimeS, 0., Frame.Scale, Yacht.HasCoralCoast());
        Position.Z += FMath::Lerp(Actor->GetActorLocation().Z - Position.Z,
                                  Yacht.RenderedSurfaceHeightM(XYm) * CmPerM, HeaveResponse);
        const FVector2D Slope = (Sea.Gradient * .72).GetClampedToMaxSize(.32);
        const FVector Up = FVector(-Slope.X, -Slope.Y, 1.).GetSafeNormal();
        const FQuat Attitude = FQuat::FindBetweenNormals(FVector::UpVector, Up) * Buoy.Mooring.GetRotation();
        Actor->SetActorLocationAndRotation(Position, FQuat::Slerp(Actor->GetActorQuat(), Attitude, TiltResponse));
    }
}

void ASailingSea::BindSurfProfile()
{
    if (!Water) return;
    if (!SurfProfile)
    {
        const auto Table=Sailing::SurfProfileTexels();
        const TConstArrayView64<uint8> Bytes(reinterpret_cast<const uint8*>(Table.GetData()),Table.Num()*sizeof(FLinearColor));
        SurfProfile=UTexture2D::CreateTransient(Sailing::SurfProfileWidth,Table.Num()/Sailing::SurfProfileWidth,
            PF_A32B32G32R32F,NAME_None,Bytes);
        SurfProfile->SRGB=false;
        SurfProfile->NeverStream=true;
        SurfProfile->Filter=TF_Nearest;
        SurfProfile->UpdateResource();
    }
    Water->SetTextureParameterValue(TEXT("SurfProfile"),SurfProfile);
    if (!RockFlow)
    {
        const auto Atlas=Sailing::RockSurfTexels();
        const TConstArrayView64<uint8> Bytes(reinterpret_cast<const uint8*>(Atlas.GetData()),Atlas.Num()*sizeof(FFloat16Color));
        RockFlow=UTexture2D::CreateTransient(Sailing::RockTileWidth,Atlas.Num()/Sailing::RockTileWidth,PF_FloatRGBA,NAME_None,Bytes);
        RockFlow->SRGB=false;
        RockFlow->NeverStream=true;
        RockFlow->Filter=TF_Bilinear;
        RockFlow->UpdateResource();
    }
    Water->SetTextureParameterValue(TEXT("RockFlow"),RockFlow);
    if (!RockWash)
    {
        const auto Bytes=Sailing::RockWashTexels();
        if (Bytes.IsEmpty()) return;
        RockWash=UTexture2D::CreateTransient(Sailing::RockTileWidth*Sailing::RockTileCount,
            Sailing::RockTileWidth*Sailing::RockWashFrames,PF_R8G8B8A8,NAME_None,TConstArrayView64<uint8>(Bytes.GetData(),Bytes.Num()));
        RockWash->SRGB=false;
        RockWash->NeverStream=true;
        RockWash->Filter=TF_Bilinear;
        RockWash->UpdateResource();
    }
    Water->SetTextureParameterValue(TEXT("RockWash"),RockWash);
}

void ASailingSea::BuildSurface()
{
    constexpr int32 Stride = SeaCells + 1;
    constexpr int32 Perimeter = 4 * SeaCells;
    TArray<FVector> Vertices;
    TArray<FVector2D> UVs;
    TArray<int32> Indices;
    for (int32 Y = 0; Y <= SeaCells; ++Y)
    {
        for (int32 X = 0; X <= SeaCells; ++X)
        {
            const double Px=WaterCoordinate(X), Py=WaterCoordinate(Y);
            const int32 A = Vertices.Add(FVector(Px,Py,0)*CmPerM);
            const double Dx=.5*(WaterCoordinate(X+1)-WaterCoordinate(X-1));
            const double Dy=.5*(WaterCoordinate(Y+1)-WaterCoordinate(Y-1));
            UVs.Emplace(FMath::Max(Dx,Dy),0);
            if (X < SeaCells && Y < SeaCells)
            {
                Indices.Append({ A, A + Stride, A + 1, A + 1, A + Stride, A + Stride + 1 });
            }
        }
    }
    TArray<int32, TInlineAllocator<Perimeter>> Edge;
    for (int32 I = 0; I < SeaCells; ++I) Edge.Add(I);
    for (int32 I = 0; I < SeaCells; ++I) Edge.Add(I * Stride + SeaCells);
    for (int32 I = 0; I < SeaCells; ++I) Edge.Add(SeaCells * Stride + SeaCells - I);
    for (int32 I = 0; I < SeaCells; ++I) Edge.Add((SeaCells - I) * Stride);

    // Every annulus uses the preceding edge vertices, so a snapped centre never opens a seam.
    for (double Radius = SeaRadiusM, StepM = CellM; Radius < 38000.0;)
    {
        const double Outer = Radius + StepM;
        const int32 First = Vertices.Num();
        const int32 InnerCount = Edge.Num();
        // As radial spacing grows, adjacent vertices along the edge can be twice
        // as close as the supported wavelength requires. Stitch pairs to one edge.
        const int32 EdgeStep = InnerCount % 8 == 0 && StepM >= 16. * Outer / InnerCount ? 2 : 1;
        const int32 OuterCount = InnerCount / EdgeStep;
        for (int32 I = 0; I < OuterCount; ++I)
        {
            const int32 Inner = I * EdgeStep;
            const int32 Next = (I + 1) % OuterCount;
            const FVector InnerPoint = Vertices[Edge[Inner]];
            Vertices.Add(InnerPoint * (Outer / Radius));
            const double RadialSpacing = StepM * InnerPoint.Size2D() / (Radius * CmPerM);
            UVs.Emplace(FMath::Max(RadialSpacing, 8. * Outer / OuterCount), 0);
            const int32 Mid = Edge[(Inner + 1) % InnerCount];
            Indices.Append({ Edge[Inner], Mid, First + I, Mid, First + Next, First + I });
            if (EdgeStep == 2) Indices.Append({ Mid, Edge[Next * EdgeStep], First + Next });
        }
        Edge.SetNum(OuterCount, EAllowShrinking::No);
        for (int32 I = 0; I < OuterCount; ++I) Edge[I] = First + I;
        Radius = Outer;
        // Keep several vertices on a wind-sea ridge well past the yacht. Once even the
        // longest swell has fallen below the grid cutoff, a final ring reaches the horizon.
        StepM = StepM >= 90.0 ? 38000.0 - Radius
            : CellM + .047 * (Radius - SeaRadiusM) + .080 * FMath::Max(0., Radius - 320.);
    }
    // A single horizon-sized bounding box submits even the water behind the camera
    // to the displacement, velocity and depth passes. Partition the existing faces
    // once, copying the very same positions and footprints at the shared edges.
    TArray<FProcMeshSection> Sections;
    Sections.SetNum(SeaTileCount);
    TArray<TMap<int32, uint32>> Remaps;
    Remaps.SetNum(SeaTileCount);
    for (int32 I = 0; I < Indices.Num(); I += 3)
    {
        const FVector Center = (Vertices[Indices[I]] + Vertices[Indices[I+1]] + Vertices[Indices[I+2]]) / 3.;
        const int32 Tile = SeaTileAt(Center);
        FProcMeshSection& Section = Sections[Tile];
        for (int32 Index : MakeArrayView(Indices).Slice(I, 3))
        {
            uint32* Local = Remaps[Tile].Find(Index);
            if (!Local)
            {
                Local = &Remaps[Tile].Add(Index, Section.ProcVertexBuffer.Num());
                FProcMeshVertex& Vertex = Section.ProcVertexBuffer.AddDefaulted_GetRef();
                Vertex.Position = Vertices[Index];
                Vertex.UV0 = UVs[Index];
                Section.SectionLocalBox += Vertex.Position;
            }
            Section.ProcIndexBuffer.Add(*Local);
        }
    }
    for (int32 I = 0; I < Sections.Num(); ++I)
    {
        // Bounds are built on the undisturbed plane. Include displacement in
        // both directions so swell remains visible from deck and below water.
        Sections[I].SectionLocalBox = Sections[I].SectionLocalBox.ExpandBy(FVector(0, 0, 18 * CmPerM));
        SurfaceTiles[I]->SetProcMeshSection(0, Sections[I]);
        SurfaceTiles[I]->SetMaterial(0, Water);
    }
}

UMaterialInstanceDynamic* ASailingSea::SurfaceMaterial() const
{
    return Water;
}

void ASailingSea::SetSurfaceFrame(Sailing::FSeaFrame Frame)
{
    if (!Water) return;
    if (PreviousSurfaceFrame.TimeS > Frame.TimeS || Frame.TimeS-PreviousSurfaceFrame.TimeS > .25f)
        PreviousSurfaceFrame = Frame;
    Water->SetVectorParameterValue(TEXT("SeaHistory"),FLinearColor(PreviousSurfaceFrame.TimeS,PreviousSurfaceFrame.Scale,
        Frame.TimeS-PreviousSurfaceFrame.TimeS,1.f));
    static const FName Modes[] = { TEXT("Wave0"), TEXT("Wave1"), TEXT("Wave2"), TEXT("Wave3"),
        TEXT("Wave4"), TEXT("Wave5"), TEXT("Wave6"), TEXT("Wave7"),
        TEXT("Wave8"), TEXT("Wave9"), TEXT("Wave10"), TEXT("Wave11"), TEXT("Wave12"), TEXT("Wave13"),
        TEXT("Wave14"), TEXT("Wave15"), TEXT("Wave16"), TEXT("Wave17"),
        TEXT("Wave18"), TEXT("Wave19"), TEXT("Wave20"), TEXT("Wave21") };
    static const FName PreviousAmplitudes[] = { TEXT("PrevAmp0"), TEXT("PrevAmp1"), TEXT("PrevAmp2"), TEXT("PrevAmp3"),
        TEXT("PrevAmp4"), TEXT("PrevAmp5") };
    static_assert(UE_ARRAY_COUNT(Modes) == Sailing::SeaWaveCount);
    static_assert(UE_ARRAY_COUNT(PreviousAmplitudes) == (Sailing::SeaWaveCount+3)/4);
    FLinearColor PackedPreviousAmplitudes[UE_ARRAY_COUNT(PreviousAmplitudes)] = {};
    for (int32 I = 0; I < Sailing::SeaWaveCount; ++I)
    {
        const FLinearColor Mode = Sailing::SeaWaveParameter(I, Frame);
        Water->SetVectorParameterValue(Modes[I], Mode);
        PackedPreviousAmplitudes[I/4].Component(I%4) = Sailing::SeaWaveAmplitude(I, PreviousSurfaceFrame.Scale);
    }
    for (int32 I = 0; I < UE_ARRAY_COUNT(PreviousAmplitudes); ++I)
        Water->SetVectorParameterValue(PreviousAmplitudes[I], PackedPreviousAmplitudes[I]);
    PreviousSurfaceFrame = Frame;
    Water->SetScalarParameterValue(TEXT("SeaTime"), Frame.TimeS);
    Water->SetScalarParameterValue(TEXT("SeaScale"), Frame.Scale);
    for (auto& Stone : TidalStone)
    {
        Stone->SetScalarParameterValue(TEXT("SeaTime"),Frame.TimeS);
        Stone->SetScalarParameterValue(TEXT("SeaScale"),Frame.Scale);
    }
    if (Shore)
    {
        Shore->SetScalarParameterValue(TEXT("SeaTime"), Frame.TimeS);
        Shore->SetScalarParameterValue(TEXT("SeaScale"), Frame.Scale);
    }
}

void ASailingSea::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    const ASailingYachtPawn* Yacht = Cast<ASailingYachtPawn>(UGameplayStatics::GetPlayerPawn(this, 0));
    if (!Yacht)
    {
        return;
    }
    const auto* PC=Cast<APlayerController>(Yacht->GetController());
    const ACameraActor* Camera=PC ? Cast<ACameraActor>(PC->GetViewTarget()) : nullptr;
    FVector Position = Camera ? Camera->GetActorLocation() : Yacht->WorldFocus();
    if (!Camera && PC && PC->PlayerCameraManager)
    {
        // Keep the foreground beneath the chase camera and both hulls on the fine lattice.
        const FVector FromFocus = PC->PlayerCameraManager->GetCameraLocation() - Position;
        Position += FromFocus.GetClampedToMaxSize2D(SeaRadiusM * 2 * CmPerM) * .5;
    }
    const FVector2D CenterM(FMath::GridSnap(Position.X / CmPerM, FootCellM), FMath::GridSnap(Position.Y / CmPerM, FootCellM));
    const FVector CenterCm(CenterM.X * CmPerM, CenterM.Y * CmPerM, 0.0);
    // Re-centring the grid changes which vertices draw the water. It does not move the sea horizontally.
    const FVector GridStep = CenterCm-GetActorLocation();
    if (Water) Water->SetVectorParameterValue(TEXT("GridStep"), FLinearColor(GridStep.X,GridStep.Y,0,0));
    SetActorLocation(CenterCm);
    SetSurfaceFrame(Yacht->SeaFrame());
    UpdateChannelBuoys(*Yacht, DeltaSeconds);
    const auto& History = Yacht->ShedWake();
    if (Water)
    {
        Yacht->Traffic().Publish(*Water,Yacht->SeaFrame().TimeS);
        const auto Wake = Yacht->BoatWake();
        Water->SetVectorParameterValue(TEXT("WakePose"), FLinearColor(Wake.SternM.X, Wake.SternM.Y, Wake.Forward.X, Wake.Forward.Y));
        Water->SetScalarParameterValue(TEXT("WakeSpeed"), Wake.SpeedMps);
        Water->SetScalarParameterValue(TEXT("WakeBias"), Wake.HullBias);
        Water->SetScalarParameterValue(TEXT("CoralCoast"), Yacht->HasCoralCoast() ? 1.f : 0.f);
        static const FName Rings[] = {TEXT("Ring0"), TEXT("Ring1"), TEXT("Ring2"), TEXT("Ring3")};
        static_assert(UE_ARRAY_COUNT(Rings) == Sailing::FWaterImpacts::Count);
        for (int32 I = 0; I < UE_ARRAY_COUNT(Rings); ++I)
            Water->SetVectorParameterValue(Rings[I], Yacht->SurfaceImpacts().Rings[I]);
        Water->SetVectorParameterValue(TEXT("NearWhalePrint"),Yacht->SurfaceImpacts().WhalePrints[0]);
        Water->SetVectorParameterValue(TEXT("FarWhalePrint"),Yacht->SurfaceImpacts().WhalePrints[1]);
        if (SentWakeRevision != History.Revision)
        {
            static const FName Marks[] = {TEXT("Mark0"),TEXT("Mark1"),TEXT("Mark2"),TEXT("Mark3"),
                TEXT("Mark4"),TEXT("Mark5"),TEXT("Mark6"),TEXT("Mark7")};
            static const FName Axes[] = {TEXT("Axes0"),TEXT("Axes1"),TEXT("Axes2"),TEXT("Axes3")};
            static_assert(UE_ARRAY_COUNT(Marks) == Sailing::FWakeHistory::Count && UE_ARRAY_COUNT(Axes)*2 == UE_ARRAY_COUNT(Marks));
            for (int32 I = 0; I < UE_ARRAY_COUNT(Marks); ++I) Water->SetVectorParameterValue(Marks[I],History.Marks[I]);
            static const FName BiasNames[] = {TEXT("MarkBias0"),TEXT("MarkBias1")};
            static_assert(UE_ARRAY_COUNT(BiasNames)*4 == Sailing::FWakeHistory::Count);
            for (int32 I = 0; I < UE_ARRAY_COUNT(BiasNames); ++I)
            {
                const float* Bias = History.HullBias+4*I;
                Water->SetVectorParameterValue(BiasNames[I],FLinearColor(Bias[0],Bias[1],Bias[2],Bias[3]));
            }
            for (int32 I = 0; I < UE_ARRAY_COUNT(Axes); ++I)
            {
                const FVector2f A = History.Directions[2*I], B = History.Directions[2*I+1];
                Water->SetVectorParameterValue(Axes[I], FLinearColor(A.X,A.Y,B.X,B.Y));
            }
        }
    }
    SentWakeRevision = History.Revision;
}

ASailingGrove::ASailingGrove()
{
    Palms = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("CoconutPalms"));
    Palms->SetMobility(EComponentMobility::Static);
    Palms->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SetRootComponent(Palms);
}

void ASailingGrove::Plant(UStaticMesh* Tree, const TArray<FTransform>& Transforms)
{
    Palms->ClearInstances();
    Palms->SetStaticMesh(Tree);
    Palms->SetWorldPositionOffsetDisableDistance(8000);
    Palms->AddInstances(Transforms, false);
}

ASailingDolphinPod::ASailingDolphinPod()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Pod")));
    for (int32 I = 0; I < PodSize; ++I)
    {
        UStaticMeshComponent* Dolphin = CreateDefaultSubobject<UStaticMeshComponent>(
            FName(*FString::Printf(TEXT("Dolphin%d"), I + 1)));
        Dolphin->SetupAttachment(GetRootComponent());
        Dolphin->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Dolphin->SetCastShadow(false);
        Dolphins.Add(Dolphin);
    }
}

void ASailingDolphinPod::BeginPlay()
{
    Super::BeginPlay();
    for (int32 I = 0; I < Dolphins.Num(); ++I)
    {
        Dolphins[I]->SetStaticMesh(DolphinMesh);
        Dolphins[I]->SetCustomPrimitiveDataFloat(0, I * 2.09f);
    }
}

void ASailingDolphinPod::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    const ASailingYachtPawn* Yacht = Cast<ASailingYachtPawn>(UGameplayStatics::GetPlayerPawn(this, 0));
    if (!Yacht || !DolphinMesh) return;

    const Sailing::FSeaFrame Sea = Yacht->SeaFrame();
    const double Visit = Sailing::DolphinVisit(GetWorld()->GetTimeSeconds());
    SetActorHiddenInGame(Visit <= 0);
    if (Visit <= 0)
    {
        bSwimming = false;
        return;
    }
    const FVector Ahead = Yacht->GetActorForwardVector().GetSafeNormal2D();
    const FVector Beam = FVector::CrossProduct(FVector::UpVector, Ahead);
    static const FVector2D Positions[] = {{-1100, 1760}, {-1450, 1930}, {-1720, 2010}};
    for (int32 I = 0; I < Dolphins.Num(); ++I)
    {
        UStaticMeshComponent* Dolphin = Dolphins[I];
        const double Phase = Sea.TimeS * 0.72 + I * 1.92;
        const FVector Goal = Yacht->GetActorLocation() + Ahead * (Positions[I].X + 80 * FMath::Sin(Phase * .48))
            + Beam * (Positions[I].Y + 2300 * (1-Visit) + 175 * FMath::Sin(Phase * .86));
        FVector Position = bSwimming ? Dolphin->GetComponentLocation() : Goal;
        FVector Motion = Yacht->GetVelocity() + (Goal - Position) * .62;
        Motion.Z = 0;
        const float Speed = FMath::Min(1250.0, Motion.Size());
        const FRotator Heading = Speed > 25.0 ? Motion.Rotation() : Ahead.Rotation();
        const float Yaw = bSwimming ? FMath::FixedTurn(Dolphin->GetComponentRotation().Yaw, Heading.Yaw, 65.0f * DeltaSeconds) : Heading.Yaw;
        Position += FRotator(0, Yaw, 0).Vector() * Speed * DeltaSeconds;
        const double Water = Yacht->SurfaceHeightM(FVector2D(Position) / CmPerM);
        Position.Z = Water * CmPerM - 900*(1-Visit) - (41.0 + 32.0 * FMath::Sin(Phase));
        Dolphin->SetWorldLocationAndRotation(Position, FRotator(-6.8 * FMath::Cos(Phase), Yaw, 4 * FMath::Sin(Phase * 1.9)));
    }
    bSwimming = true;
}

ASailingTrialMode::ASailingTrialMode()
{
    DefaultPawnClass = ASailingYachtPawn::StaticClass();
    HUDClass = ASailingTrialHUD::StaticClass();
    PlayerControllerClass = ASailingPlayerController::StaticClass();
}
