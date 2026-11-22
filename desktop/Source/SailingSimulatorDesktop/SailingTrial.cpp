#include "SailingTrial.h"
#include "SailingEncounter.h"
#include "SailingExplorer.h"
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
constexpr int32 SeaCells = 160;
constexpr double CellM = 0.36;
constexpr double SeaRadiusM = SeaCells * CellM * 0.5;
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
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickGroup = TG_PostPhysics;
    bAsyncPhysicsTickEnabled = true;

    Hull = CreateDefaultSubobject<UBoxComponent>(TEXT("HullCollision"));
    SetRootComponent(Hull);
    Hull->InitBoxExtent(FVector(475, 224, 57));
    Hull->SetCollisionProfileName(TEXT("PhysicsActor"));
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
    if (Steering != 0)
    {
        Helm.Rudder = FMath::Clamp(Helm.Rudder + Steering * DeltaSeconds * 2.4, -1.0, 1.0);
        bKeyboardRudder = true;
    }
    else if (bKeyboardRudder)
    {
        Helm.Rudder = FMath::FInterpConstantTo(Helm.Rudder, 0.0, DeltaSeconds, 6.4);
        bKeyboardRudder = Helm.Rudder != 0;
    }
    SetThrottle(Helm.Throttle + Throttle * DeltaSeconds * 0.55);
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

void ASailingYachtPawn::ToggleExplorer()
{
    if (SkipperView->Away()) SkipperView->Return();
    else
    {
        bCinematic = false;
        SetRudder(0);
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
}

void ASailingYachtPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Controller) Helm = {};
    if (bRefloatRequested.exchange(false)) RefloatIfGrounded();
    UpdateBowContact();
    {
        FScopeLock Lock(&HelmMutex);
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
    TSharedPtr<const Sailing::FShoreMap,ESPMode::ThreadSafe> Coast;
    const FVector OriginCm = Body->X();
    const FQuat Rotation = Body->R();
    const auto Wake = Sailing::FBoatWake::FromMotion(FVector2D(OriginCm)*.01,
        FVector2D(Rotation.GetForwardVector().GetSafeNormal2D()), FVector2D(Body->V())*.01, Body->W().Z);
    {
        FScopeLock Lock(&HelmMutex);
        Controls = PhysicsHelm;
        ContactWaves = PhysicsImpacts;
        Coast = ShoreMap;
        PhysicsWakeTrail.Record(Wake, SimTime);
    }
    const FVector CenterOfMassCm = OriginCm + Rotation.RotateVector(Body->CenterOfMass());
    const Sailing::FRigidState State = {
        OriginCm / CmPerM, CenterOfMassCm / CmPerM, Rotation, Body->V() / CmPerM, Body->W()
    };
    const float Scale = SeaScale.load(std::memory_order_relaxed);
    Sailing::FLoads Loads = Sailing::CalculateLoads(State, Controls, SimTime, Scale, bCoralPass, &ContactWaves, &PhysicsWakeTrail);
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
        + Impacts.At(XYm,Frame.TimeS).HeightM + WakeTrail.At(XYm,Frame.TimeS).HeightM;
}

void ASailingYachtPawn::DisturbSurface(FVector PositionCm, float HeightM)
{
    Impacts.Emit(FVector2D(PositionCm)*.01, SeaFrame().TimeS, HeightM);
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
        const double Closing = Sea.VelocityMps.Z+FVector2D::DotProduct(Sea.Gradient,FVector2D(Velocity))-Velocity.Z;
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
    Surface = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("WaterSurface"));
    SetRootComponent(Surface);
    // UV0 holds grid spacing. Only the material knows the scale of the
    // world-projected foam, so request its full mip chain on this component.
    Surface->bForceMipStreaming = true;
    Surface->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Surface->SetCastShadow(false);
    Surface->SetCastContactShadow(false);
    Surface->SetAffectDistanceFieldLighting(false);
    WaterMaterial = FindTrialMaterial(TEXT("/Game/Coastal/Materials/M_CoralWater.M_CoralWater"));
    if (!WaterMaterial)
    {
        WaterMaterial = FindTrialMaterial(TEXT("/Game/Materials/M_TrialWater.M_TrialWater"));
    }
}

void ASailingSea::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform);
    BuildSurface();
    Water = UMaterialInstanceDynamic::Create(WaterMaterial, this);
    Surface->SetMaterial(0, Water);
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
        BuildSurface();
        Water = UMaterialInstanceDynamic::Create(WaterMaterial, this);
        Surface->SetMaterial(0, Water);
    }
    BindSurfProfile();
    // All of the island shores use the same material instance and simulation clock.
    for (TActorIterator<AStaticMeshActor> It(GetWorld()); It; ++It)
    {
        UStaticMeshComponent* Mesh = It->GetStaticMeshComponent();
        UMaterialInterface* Base = Mesh ? Mesh->GetMaterial(0) : nullptr;
        if (Base && Base->GetFName() == TEXT("M_CoastalGround"))
        {
            if (!Shore) Shore = UMaterialInstanceDynamic::Create(Base, this);
            Mesh->SetMaterial(0, Shore);
        }
    }
    SetSurfaceFrame({});
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
            const int32 A = Vertices.Add(FVector(X * CellM - SeaRadiusM, Y * CellM - SeaRadiusM, 0) * CmPerM);
            UVs.Emplace(CellM, 0);
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
            : CellM + .030 * (Radius - SeaRadiusM) + .055 * FMath::Max(0., Radius - 320.);
    }
    TArray<FVector> Normals;
    Normals.Init(FVector::UpVector, Vertices.Num());
    Surface->CreateMeshSection_LinearColor(0, Vertices, Indices, Normals, UVs, {}, {}, false);
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
    Water->SetScalarParameterValue(TEXT("CrestShape"), Sailing::SeaCrestShape);
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
    const FVector2D CenterM(FMath::GridSnap(Position.X / CmPerM, CellM), FMath::GridSnap(Position.Y / CmPerM, CellM));
    const FVector CenterCm(CenterM.X * CmPerM, CenterM.Y * CmPerM, 0.0);
    // Re-centring the grid changes which vertices draw the water. It does not move the sea horizontally.
    const FVector GridStep = CenterCm-GetActorLocation();
    if (Water) Water->SetVectorParameterValue(TEXT("GridStep"), FLinearColor(GridStep.X,GridStep.Y,0,0));
    SetActorLocation(CenterCm);
    SetSurfaceFrame(Yacht->SeaFrame());
    const auto& History = Yacht->ShedWake();
    if (Water)
    {
        const auto Wake = Yacht->BoatWake();
        Water->SetVectorParameterValue(TEXT("WakePose"), FLinearColor(Wake.SternM.X, Wake.SternM.Y, Wake.Forward.X, Wake.Forward.Y));
        Water->SetScalarParameterValue(TEXT("WakeSpeed"), Wake.SpeedMps);
        Water->SetScalarParameterValue(TEXT("WakeBias"), Wake.HullBias);
        Water->SetScalarParameterValue(TEXT("CoralCoast"), Yacht->HasCoralCoast() ? 1.f : 0.f);
        static const FName Rings[] = {TEXT("Ring0"), TEXT("Ring1"), TEXT("Ring2"), TEXT("Ring3")};
        static_assert(UE_ARRAY_COUNT(Rings) == Sailing::FWaterImpacts::Count);
        for (int32 I = 0; I < UE_ARRAY_COUNT(Rings); ++I)
            Water->SetVectorParameterValue(Rings[I], Yacht->SurfaceImpacts().Rings[I]);
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
